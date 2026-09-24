import { Reader, type CreateReadableOptions } from '@zip.js/zip.js'
import {
  ARCHIVE_ENTRY,
  SEGMENT_CONCURRENCY,
  SEGMENT_MIN_SPAN,
  SEGMENT_SIZE
} from './constants'
import { ChunkStore } from './chunk-store'
import { PlayerError, type RemoteSourceDescriptor, type SourceDescriptor } from './protocol'
import type { ByteRange } from './range'
import { sliceStream } from './stream-utils'

/**
 * Source adapters. One interface — a size and a byte-range read — over the three ways an archive
 * can be reached. The Service Worker and the Jobs worker both build handles from the persisted
 * descriptor, so neither has to know how the package was opened.
 */

export interface SourceHandle {
  readonly descriptor: SourceDescriptor
  /** Total size in bytes. Known for every handle by the time one is built. */
  readonly size: number
  /** Reads an inclusive byte range into memory. Callers keep these bounded. */
  read(range: ByteRange): Promise<Uint8Array>
  /** Streams an inclusive byte range. Used to serve large stored entries without buffering. */
  stream(range: ByteRange): Promise<ReadableStream<Uint8Array>>
  /**
   * Bytes taken from the network so far, over every read and stream of this handle. Only a
   * network handle counts: it is how a job shows it is alive while the inflate has produced
   * nothing yet, and a local read has no such silence.
   */
  readonly received?: number
}

/* ------------------------------------------------------------------ probing */

/** Aborts the body of a response we only wanted the headers of. */
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // A cancelled body that errors tells us nothing we act on.
  }
}

function parseContentRangeSize(header: string | null): number | null {
  if (!header) return null
  const match = /\/(\d+)$/.exec(header.trim())
  return match ? Number(match[1]) : null
}

function readValidator(response: Response): string | null {
  // Both need `Access-Control-Expose-Headers` to be readable, so this is usually null. When it
  // is readable, a republished archive at the same URL gets a fresh pkgId instead of stale chunks.
  return response.headers.get('etag') ?? response.headers.get('last-modified')
}

/**
 * Decides how an archive can be reached.
 *
 * A single `GET` with `Range: bytes=0-0` answers both questions that matter: a host without CORS
 * rejects it at the network layer, and a host that ignores `Range` answers `200` with the whole
 * body (which is why the body is cancelled as soon as the headers arrive — a `HEAD` would prove
 * neither, and is often blocked outright).
 */
export async function probeSource(
  url: string,
  signal?: AbortSignal
): Promise<RemoteSourceDescriptor> {
  let response: Response
  try {
    response = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal, cache: 'no-store' })
  } catch (error) {
    if (signal?.aborted) throw error
    // A CORS rejection and a dead host are indistinguishable from here; the actionable one is CORS.
    throw new PlayerError('no-cors', `Cannot read ${url} from the browser (no CORS headers?)`, {
      cause: error
    })
  }

  const validator = readValidator(response)

  if (!response.ok && response.status !== 206) {
    await discardBody(response)
    throw new PlayerError('network', `${url} returned ${response.status}`)
  }

  if (response.status === 206) {
    const size = parseContentRangeSize(response.headers.get('content-range'))
    await discardBody(response)

    // `Content-Range` is not CORS-safelisted; `Content-Length` is. When the host exposes neither
    // usable size, a second plain GET gives one from `Content-Length`.
    const resolved = size ?? (await sizeFromPlainGet(url, signal))
    if (resolved === null) {
      // Range works but the length is unknowable, so the central directory cannot be found from
      // the end. Download it instead.
      return { type: 'chunked', url, size: null, validator }
    }

    return { type: 'range-http', url, size: resolved, validator }
  }

  // Status 200 to a Range request: the host ignores Range and sent the whole archive.
  const declared = response.headers.get('content-length')
  await discardBody(response)
  return { type: 'chunked', url, size: declared ? Number(declared) : null, validator }
}

async function sizeFromPlainGet(url: string, signal?: AbortSignal): Promise<number | null> {
  const response = await fetch(url, { signal, cache: 'no-store' })
  const length = response.headers.get('content-length')
  await discardBody(response)
  return length ? Number(length) : null
}

/* ------------------------------------------------------------------ handles */

class RangeHttpHandle implements SourceHandle {
  received = 0

  constructor(
    readonly descriptor: Extract<SourceDescriptor, { type: 'range-http' }>,
    readonly size: number
  ) {}

  /** Counts a body's bytes as they pass, without holding any of them. */
  private counted(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
    return body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform: (chunk, controller) => {
          this.received += chunk.length
          controller.enqueue(chunk)
        }
      })
    )
  }

  private async fetchRange(range: ByteRange): Promise<Response> {
    // The chunk store is the cache. Letting the browser's HTTP cache keep a second copy of a
    // large archive doubles the storage for nothing.
    const response = await fetch(this.descriptor.url, {
      headers: { Range: `bytes=${range.start}-${range.end}` },
      cache: 'no-store'
    })
    if (response.status !== 206 && response.status !== 200) {
      throw new PlayerError('network', `Range request failed with ${response.status}`)
    }
    return response
  }

  async read(range: ByteRange): Promise<Uint8Array> {
    const response = await this.fetchRange(range)
    if (response.status !== 200) {
      const bytes = new Uint8Array(await response.arrayBuffer())
      this.received += bytes.length
      return bytes
    }

    // A host that answered 200 sent the whole archive. It is sliced as it flows, exactly as
    // `stream` does it: buffering it to take the slice would hold the whole file — and under
    // `segmentedStream`, four whole files at once. The slice ends the pipe, which cancels the
    // body, so the transfer stops there too.
    if (!response.body) throw new PlayerError('network', 'Range response had no body')
    return new Uint8Array(
      await new Response(sliceStream(this.counted(response.body), range)).arrayBuffer()
    )
  }

  async stream(range: ByteRange): Promise<ReadableStream<Uint8Array>> {
    const response = await this.fetchRange(range)
    if (!response.body) throw new PlayerError('network', 'Range response had no body')

    // A host that answered 200 sent the whole archive. Buffering it to take a slice would mean
    // holding hundreds of megabytes; the body is sliced as it flows instead.
    const body = this.counted(response.body)
    return response.status === 200 ? sliceStream(body, range) : body
  }
}

class ChunkedHandle implements SourceHandle {
  private store: ChunkStore

  constructor(
    readonly descriptor: Extract<SourceDescriptor, { type: 'chunked' }>,
    readonly size: number,
    pkgId: string
  ) {
    this.store = new ChunkStore(pkgId)
  }

  read(range: ByteRange): Promise<Uint8Array> {
    return this.store.readRangeBytes(ARCHIVE_ENTRY, range)
  }

  async stream(range: ByteRange): Promise<ReadableStream<Uint8Array>> {
    return this.store.readRange(ARCHIVE_ENTRY, range)
  }
}

class FileHandle implements SourceHandle {
  constructor(
    readonly descriptor: Extract<SourceDescriptor, { type: 'file' }>,
    private readonly blob: Blob
  ) {}

  get size(): number {
    return this.blob.size
  }

  async read(range: ByteRange): Promise<Uint8Array> {
    const slice = this.blob.slice(range.start, range.end + 1)
    return new Uint8Array(await slice.arrayBuffer())
  }

  async stream(range: ByteRange): Promise<ReadableStream<Uint8Array>> {
    return this.blob.slice(range.start, range.end + 1).stream()
  }
}

/**
 * Builds a handle from a persisted descriptor. A `file` descriptor needs the `File` itself, which
 * only the page holds — the caller fetches it from the page before calling this.
 */
export async function openSource(
  pkgId: string,
  descriptor: SourceDescriptor,
  file?: Blob,
  options: {
    /**
     * Open a chunked archive that is still downloading. Only the forward index can address such
     * a handle — its size is what has arrived so far — so this is for the reader built from that,
     * never for zip.js, which needs the end of the file.
     */
    partial?: boolean
  } = {}
): Promise<SourceHandle> {
  switch (descriptor.type) {
    case 'range-http':
      return new RangeHttpHandle(descriptor, descriptor.size)

    case 'chunked': {
      const meta = await new ChunkStore(pkgId).getArchiveMeta()
      if (!meta || (!meta.complete && !options.partial)) {
        throw new PlayerError('bad-archive', 'Archive has not finished downloading')
      }
      return new ChunkedHandle(descriptor, meta.size ?? meta.available, pkgId)
    }

    case 'file': {
      if (!file) throw new PlayerError('bad-archive', 'The picked file is no longer available')
      return new FileHandle(descriptor, file)
    }
  }
}

/**
 * One segment of a span: a ranged request whose bytes are kept as they arrive, so that when the
 * segment's turn comes the consumer takes what is already there and then follows the request
 * live, rather than waiting for the whole segment to land first.
 */
class Segment {
  private readonly arrived: Uint8Array[] = []
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private finished = false
  private failure: unknown = null
  private wake: (() => void) | null = null
  private cancelled = false
  /** Bytes that have arrived so far. */
  received = 0

  constructor(open: () => Promise<ReadableStream<Uint8Array>>) {
    void this.pump(open)
  }

  private async pump(open: () => Promise<ReadableStream<Uint8Array>>): Promise<void> {
    try {
      const stream = await open()
      if (this.cancelled) {
        await stream.cancel()
        return
      }
      this.reader = stream.getReader()
      for (;;) {
        const { done, value } = await this.reader.read()
        if (done) break
        this.arrived.push(value)
        this.received += value.length
        this.wake?.()
      }
    } catch (error) {
      if (!this.cancelled) this.failure = error
    } finally {
      this.finished = true
      this.wake?.()
    }
  }

  /** The next chunk that has arrived, waiting for one when none has; `null` once the segment is done. */
  async next(): Promise<Uint8Array | null> {
    for (;;) {
      const chunk = this.arrived.shift()
      if (chunk) return chunk
      if (this.failure) throw this.failure
      if (this.finished) return null
      await new Promise<void>((resolve) => {
        this.wake = resolve
      })
      this.wake = null
    }
  }

  cancel(): void {
    this.cancelled = true
    this.arrived.length = 0
    void this.reader?.cancel().catch(() => {})
    this.wake?.()
  }
}

/**
 * Pulls one span over several connections and emits it in order.
 *
 * A rolling window rather than "split into N halves and join": splitting a 230 MB span four ways
 * would have three whole quarters waiting in memory for their turn. Here at most
 * `SEGMENT_CONCURRENCY` segments exist at once, a finished one is emitted as soon as its turn
 * comes, and starting the next only when one is consumed keeps the window — and the memory —
 * flat for a span of any size.
 *
 * Order is what makes this usable at all: the consumer is an inflate, and a deflate stream has to
 * be fed from the front. So the download is parallel and the decode stays serial.
 *
 * Two things about the start. The first segment is handed over as it arrives, not once it is
 * complete: on a link that is itself the limit, waiting for a whole 4 MB segment meant the inflate
 * saw nothing until it landed. And the other connections open only once the first is flowing:
 * opened together, the four share the link and the first segment's bytes — the only ones the
 * inflate can use yet — arrive at a quarter of the rate, so the first byte of output waited for
 * roughly 16 MB of transfer. Measured against a 40 MB deflated video on a 4 Mbit/s link, that was
 * 34 s to the first extracted byte — past the 30 s the virtual server gives an extraction to
 * produce anything. A host that caps each connection loses nothing to the ramp: the others open
 * as soon as the first byte arrives.
 */
function segmentedStream(handle: SourceHandle, span: ByteRange): ReadableStream<Uint8Array> {
  const total = span.end - span.start + 1
  const count = Math.ceil(total / SEGMENT_SIZE)
  const segments = new Map<number, Segment>()

  /** The next segment to open. */
  let next = 0
  /** The segment being emitted. */
  let current = 0

  const open = (index: number) => {
    const start = span.start + index * SEGMENT_SIZE
    const range = { start, end: Math.min(start + SEGMENT_SIZE - 1, span.end) }
    segments.set(index, new Segment(() => handle.stream(range)))
  }

  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        for (;;) {
          if (current >= count) {
            controller.close()
            return
          }
          // Opened here rather than in `start`, so nothing is fetched until something reads.
          if (next === current) open(next++)
          const segment = segments.get(current)!

          if (segment.received > 0) {
            while (next < count && segments.size < SEGMENT_CONCURRENCY) open(next++)
          }

          const chunk = await segment.next()
          if (chunk) {
            controller.enqueue(chunk)
            return
          }
          segments.delete(current)
          current += 1
        }
      },
      cancel() {
        for (const segment of segments.values()) segment.cancel()
        segments.clear()
        next = count
        current = count
      }
    },
    { highWaterMark: 0 }
  )
}

/* ------------------------------------------------------------------ zip.js bridge */

/**
 * Presents a `SourceHandle` as a zip.js reader. zip.js only ever asks for the central directory
 * and local headers through this, so reads stay small even for a multi-gigabyte archive.
 */
export class SourceReader extends Reader<SourceHandle> {
  size: number

  constructor(private readonly handle: SourceHandle) {
    super(handle)
    this.size = handle.size
  }

  async readUint8Array(index: number, length: number): Promise<Uint8Array> {
    if (length === 0) return new Uint8Array(0)
    const end = Math.min(index + length, this.size) - 1
    if (end < index) return new Uint8Array(0)
    return this.handle.read({ start: index, end })
  }

  /**
   * Streams a span in one read instead of paging through it.
   *
   * zip.js only calls `readUint8Array` when a reader does not provide this, and it then walks the
   * entry in 64 kB steps. Over a `File` each step is a free `slice()`; over HTTP each one is a
   * request, so inflating a 218 MB video meant about 3,500 round trips to the origin — slow
   * enough to look like a hang, and enough to get throttled. One ranged request covers it.
   */
  createReadable(options: CreateReadableOptions = {}): ReadableStream<Uint8Array> {
    const start = options.offset ?? 0
    const end = Math.min(start + (options.size ?? this.size - start), this.size) - 1

    if (end < start) return new Blob([]).stream()

    const handle = this.handle

    // Several connections beat one on a host that caps a single stream, which many do. Only for
    // `range-http`: a picked file and an archive already in the chunk store are local reads, and
    // splitting those buys nothing while costing the buffering.
    if (handle.descriptor.type === 'range-http' && end - start + 1 >= SEGMENT_MIN_SPAN) {
      return segmentedStream(handle, { start, end })
    }
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null

    return new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          reader ??= (await handle.stream({ start, end })).getReader()
          const { done, value } = await reader.read()
          if (done) controller.close()
          else controller.enqueue(value)
        },
        async cancel(reason) {
          await reader?.cancel(reason)
        }
      },
      // A high-water mark of zero keeps the request until something actually reads: a stream is
      // otherwise pulled as soon as it is constructed, and one nobody consumes would open a
      // fetch for the whole entry and leave it hanging.
      { highWaterMark: 0 }
    )
  }
}
