import { SEGMENT_CONCURRENCY, SEGMENT_MIN_SPAN, SEGMENT_SIZE } from './constants'
import type { ByteRange } from './range'
import type { SourceHandle } from './source'

/**
 * How a span of the archive is pulled: one ranged request, or several at once when the span is
 * large and the host honours `Range`. Both the zip.js bridge and the Jobs worker's extraction
 * come through here, so neither carries the decision and the Jobs worker carries no zip.js.
 */

/**
 * Streams an inclusive range of the source in one read instead of paging through it.
 *
 * Several connections beat one on a host that caps a single stream, which many do. Only for
 * `range-http`: a picked file and an archive already in the chunk store are local reads, and
 * splitting those buys nothing while costing the buffering. Either way nothing is opened until
 * something reads: a stream is otherwise pulled as soon as it is constructed, and one nobody
 * consumes would open a request for the whole span and leave it hanging.
 */
export function streamSpan(handle: SourceHandle, range: ByteRange): ReadableStream<Uint8Array> {
  const { start, end } = range
  if (end < start) return new Blob([]).stream()

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
    { highWaterMark: 0 }
  )
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
