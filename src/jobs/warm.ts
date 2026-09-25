import { WARM_ENTRY, WARM_STALL_MS } from '../shared/constants'
import { QuotaError, type ChunkStore } from '../shared/chunk-store'
import { contentTypeOf } from '../shared/mime'
import type { WarmSpan } from '../shared/protocol'
import type { SourceHandle } from '../shared/source'

/**
 * Warming: pulls the spans the index named whole, one ranged request each, and lands every entry
 * in them in the cache as the bytes pass — the same inline entries the virtual server would
 * otherwise inflate one request at a time while the frame boots.
 *
 * The walk is driven by the central directory, not by the bytes: each entry's local header is
 * expected exactly where the index says, read for its name and extra lengths, and followed by the
 * compressed size the index gave. Nothing is guessed, so a header that is not where it should
 * be abandons the span rather than resynchronising — positions can no longer be trusted — and
 * the virtual server serves the rest on demand, as it did before warming existed.
 *
 * It never fails a load. Out of room: stop, the store is full and the server serves around it.
 * A span that stops flowing: give up on it. A corrupt entry: skip it, the server will report it
 * when asked. Only a warm that landed everything writes the marker that spares the next load.
 */

const LOCAL_HEADER_SIGNATURE = 0x04034b50
const LOCAL_HEADER_FIXED_SIZE = 30
const STORED = 0
const DEFLATE = 8

export interface WarmProgress {
  /** Bytes of the spans consumed so far. */
  loaded: number
  total: number
}

export interface WarmResult {
  /** Entries landed in the cache. */
  stored: number
  /** Entries passed over: an unsupported method, or a body the store refused for a reason other than room. */
  skipped: number
  /** Every span was walked to its end and the marker written. */
  complete: boolean
}

export async function warmPackage(
  handle: SourceHandle,
  spans: WarmSpan[],
  store: ChunkStore,
  options: { signal: AbortSignal; onProgress?: (progress: WarmProgress) => void }
): Promise<WarmResult> {
  const { signal } = options
  const total = spans.reduce((sum, span) => sum + (span.end - span.start), 0)
  const result: WarmResult = { stored: 0, skipped: 0, complete: false }
  let done = 0

  for (const span of spans) {
    if (signal.aborted) return result
    const cursor = new ByteCursor(await handle.stream({ start: span.start, end: span.end - 1 }), signal)

    try {
      let position = span.start
      for (const entry of span.entries) {
        if (signal.aborted) return result

        await cursor.skip(entry.offset - position)
        const header = await cursor.take(LOCAL_HEADER_FIXED_SIZE)
        const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
        if (view.getUint32(0, true) !== LOCAL_HEADER_SIGNATURE) {
          throw new Error(`${entry.name}: no local header at ${entry.offset}`)
        }
        const nameLength = view.getUint16(26, true)
        const extraLength = view.getUint16(28, true)
        await cursor.skip(nameLength + extraLength)
        const compressed = await cursor.take(entry.compressedSize)
        position = entry.offset + LOCAL_HEADER_FIXED_SIZE + nameLength + extraLength + entry.compressedSize

        if (entry.method !== STORED && entry.method !== DEFLATE) {
          result.skipped += 1
        } else {
          try {
            await store.putWhole(entry.name, () => bodyOf(compressed, entry.method), contentTypeOf(entry.name), entry.size)
            result.stored += 1
          } catch (error) {
            // No room is the end of it: the store is full for the rest of the spans too.
            if (error instanceof QuotaError) throw error
            result.skipped += 1
          }
        }

        options.onProgress?.({ loaded: done + (position - span.start), total })
      }
    } finally {
      await cursor.close()
    }
    // The span's last entry ends short of its nominal end — the slack past the archive's last
    // entry, or a data descriptor — so the span is reported whole once it is walked.
    done += span.end - span.start
    options.onProgress?.({ loaded: done, total })
  }

  if (signal.aborted) return result
  // A whole entry, not chunk meta: the marker says the inline entries are here, and a package
  // from a `Range` host has no business in the chunk store at all.
  await store.putWhole(WARM_ENTRY, () => JSON.stringify({ stored: result.stored, bytes: total }), 'application/json')
  result.complete = true
  return result
}

function bodyOf(compressed: Uint8Array<ArrayBuffer>, method: number): ReadableStream<Uint8Array> {
  const raw = new Blob([compressed]).stream()
  if (method === STORED || compressed.length === 0) return raw
  // The lib types the codec's input as `BufferSource`, stricter than the plain views it gets.
  const inflate = new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>
  return raw.pipeThrough(inflate)
}

/**
 * Sequential access over a stream: take n bytes, skip n bytes. Holds at most one chunk beyond
 * what was asked for. A read that produces nothing for `WARM_STALL_MS` ends the stream, and an
 * abort cancels it.
 */
class ByteCursor {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>
  private pending: Uint8Array | null = null
  private readonly onAbort = () => void this.reader.cancel().catch(() => {})

  constructor(
    stream: ReadableStream<Uint8Array>,
    private readonly signal: AbortSignal
  ) {
    this.reader = stream.getReader()
    signal.addEventListener('abort', this.onAbort, { once: true })
  }

  async take(count: number): Promise<Uint8Array<ArrayBuffer>> {
    const out = new Uint8Array(count)
    let filled = 0
    while (filled < count) {
      const chunk = await this.next()
      const use = Math.min(chunk.length, count - filled)
      out.set(chunk.subarray(0, use), filled)
      filled += use
      if (use < chunk.length) this.pending = chunk.subarray(use)
    }
    return out
  }

  async skip(count: number): Promise<void> {
    let left = count
    while (left > 0) {
      const chunk = await this.next()
      const use = Math.min(chunk.length, left)
      left -= use
      if (use < chunk.length) this.pending = chunk.subarray(use)
    }
  }

  async close(): Promise<void> {
    this.signal.removeEventListener('abort', this.onAbort)
    try {
      await this.reader.cancel()
    } catch {
      // A stream that already ended has nothing to cancel.
    }
  }

  private async next(): Promise<Uint8Array> {
    if (this.pending && this.pending.length > 0) {
      const chunk = this.pending
      this.pending = null
      return chunk
    }
    const result = await withStallBound(this.reader.read(), () => void this.reader.cancel().catch(() => {}))
    if (result.done) throw new Error('The span ended before its last entry')
    return result.value
  }
}

function withStallBound<T>(read: Promise<T>, onStall: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onStall()
      reject(new Error(`No bytes for ${WARM_STALL_MS} ms`))
    }, WARM_STALL_MS)
    read.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}
