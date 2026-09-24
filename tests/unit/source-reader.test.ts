import { describe, expect, it } from 'vitest'
import type { SourceHandle } from '../../src/shared/source'
import { SourceReader } from '../../src/shared/source-reader'
import {
  SEGMENT_CONCURRENCY,
  SEGMENT_MIN_SPAN,
  SEGMENT_SIZE
} from '../../src/shared/constants'
import { sliceStream } from '../../src/shared/stream-utils'
import type { ByteRange } from '../../src/shared/range'

/**
 * How zip.js is allowed to read a source.
 *
 * Left to itself zip.js walks an entry in 64 kB steps through `readUint8Array`. Over a picked
 * `File` each step is a free `slice()`, which is why a large package plays fine from disk; over
 * HTTP each one is a request, and a 218 MB video meant about 3,500 round trips to the origin.
 * Providing `createReadable` is what collapses that into one.
 */
function fakeHandle(size: number) {
  const bytes = new Uint8Array(size)
  for (let i = 0; i < size; i += 1) bytes[i] = i % 251

  const reads: ByteRange[] = []
  const streams: ByteRange[] = []

  const handle: SourceHandle = {
    descriptor: { type: 'range-http', url: 'https://host.example/course.h5p', size },
    size,
    async read(range) {
      reads.push(range)
      return bytes.subarray(range.start, range.end + 1)
    },
    async stream(range) {
      streams.push(range)
      return new Blob([bytes.subarray(range.start, range.end + 1)]).stream()
    }
  }

  return { handle, reads, streams, bytes }
}

const collect = async (stream: ReadableStream<Uint8Array>) =>
  new Uint8Array(await new Response(stream).arrayBuffer())

describe('SourceReader.createReadable', () => {
  it('reads a whole entry in one request rather than paging through it', async () => {
    const { handle, reads, streams } = fakeHandle(1024 * 1024)

    const body = await collect(new SourceReader(handle).createReadable())

    expect(streams).toEqual([{ start: 0, end: 1024 * 1024 - 1 }])
    expect(reads).toEqual([])
    expect(body.length).toBe(1024 * 1024)
  })

  it('translates offset and size into one inclusive range', async () => {
    const { handle, streams, bytes } = fakeHandle(4096)

    const body = await collect(new SourceReader(handle).createReadable({ offset: 100, size: 50 }))

    expect(streams).toEqual([{ start: 100, end: 149 }])
    expect(Array.from(body)).toEqual(Array.from(bytes.subarray(100, 150)))
  })

  it('reads to the end when no size is given', async () => {
    const { handle, streams } = fakeHandle(4096)
    await collect(new SourceReader(handle).createReadable({ offset: 4000 }))
    expect(streams).toEqual([{ start: 4000, end: 4095 }])
  })

  it('clamps a span that runs past the end', async () => {
    const { handle, streams } = fakeHandle(4096)
    await collect(new SourceReader(handle).createReadable({ offset: 4000, size: 9999 }))
    expect(streams).toEqual([{ start: 4000, end: 4095 }])
  })

  it('does not touch the source for an empty span', async () => {
    const { handle, reads, streams } = fakeHandle(4096)

    const body = await collect(new SourceReader(handle).createReadable({ offset: 10, size: 0 }))

    expect(body.length).toBe(0)
    expect(streams).toEqual([])
    expect(reads).toEqual([])
  })

  it('starts no request until the stream is read', async () => {
    const { handle, streams } = fakeHandle(4096)

    new SourceReader(handle).createReadable()
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(streams).toEqual([])
  })

  it('still answers the small reads the central directory needs', async () => {
    const { handle, reads, bytes } = fakeHandle(4096)

    const header = await new SourceReader(handle).readUint8Array(30, 4)

    expect(reads).toEqual([{ start: 30, end: 33 }])
    expect(Array.from(header)).toEqual(Array.from(bytes.subarray(30, 34)))
  })
})

describe('sliceStream', () => {
  it('takes a range out of a stream without buffering the whole of it', async () => {
    const source = new Blob([new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])]).stream()

    const body = await collect(sliceStream(source, { start: 3, end: 6 }))

    // This is what answers a host that ignores `Range` and sends the whole archive: the slice is
    // cut as the body flows, instead of holding hundreds of megabytes to cut it afterwards.
    expect(Array.from(body)).toEqual([3, 4, 5, 6])
  })
})

/**
 * A handle that synthesises bytes per range and streams them in pieces, under the test's control
 * when it asks for it: `hold()` stops every stream at its next piece until `release(n)` lets that
 * many through, `flow()` lets everything through. It records which ranges were opened, in order,
 * how many downloads were in flight at once, and how many were cancelled.
 */
function pieceHandle(size: number, type: 'range-http' | 'file' = 'range-http', piece = 64 * 1024) {
  const opened: ByteRange[] = []
  let inFlight = 0
  let peak = 0
  let cancelled = 0
  let allowance = Infinity
  const waiting: Array<() => void> = []

  const gate = () =>
    new Promise<void>((resolve) => {
      if (allowance > 0) {
        allowance -= 1
        resolve()
      } else {
        waiting.push(resolve)
      }
    })

  const fill = (range: ByteRange) => {
    const out = new Uint8Array(range.end - range.start + 1)
    for (let i = 0; i < out.length; i += 1) out[i] = (range.start + i) % 251
    return out
  }

  const handle: SourceHandle = {
    descriptor:
      type === 'range-http'
        ? { type: 'range-http', url: 'https://host.example/course.h5p', size }
        : { type: 'file', name: 'course.h5p', size, lastModified: 0 },
    size,
    async read(range) {
      opened.push(range)
      return fill(range)
    },
    async stream(range) {
      opened.push(range)
      inFlight += 1
      peak = Math.max(peak, inFlight)
      let position = range.start
      let settled = false
      const settle = () => {
        if (settled) return
        settled = true
        inFlight -= 1
      }
      return new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            if (position > range.end) {
              settle()
              controller.close()
              return
            }
            await gate()
            const end = Math.min(position + piece - 1, range.end)
            controller.enqueue(fill({ start: position, end }))
            position = end + 1
          },
          cancel() {
            cancelled += 1
            settle()
          }
        },
        { highWaterMark: 0 }
      )
    }
  }

  return {
    handle,
    opened,
    peak: () => peak,
    cancelled: () => cancelled,
    hold() {
      allowance = 0
    },
    release(count: number) {
      allowance += count
      while (allowance > 0 && waiting.length) {
        allowance -= 1
        waiting.shift()!()
      }
    },
    flow() {
      allowance = Infinity
      for (const resolve of waiting.splice(0)) resolve()
    }
  }
}

/** Reads a stream to the end without keeping it, and reports what it saw. */
async function drain(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  let length = 0
  let inOrder = true

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    for (let i = 0; i < value.length; i += 1) {
      if (value[i] !== (length + i) % 251) inOrder = false
    }
    length += value.length
  }

  return { length, inOrder }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('fetching a large span over several connections', () => {
  const SPAN = SEGMENT_MIN_SPAN + SEGMENT_SIZE

  it('reassembles the segments in order, byte for byte', async () => {
    const { handle } = pieceHandle(SPAN)

    // Order is the whole point: the consumer is an inflate, and a deflate stream has no way back.
    expect(await drain(new SourceReader(handle).createReadable())).toEqual({
      length: SPAN,
      inOrder: true
    })
  })

  it('splits into segments that tile the span with no gap and no overlap', async () => {
    const { handle, opened } = pieceHandle(SPAN)
    await drain(new SourceReader(handle).createReadable())

    expect(opened).toHaveLength(Math.ceil(SPAN / SEGMENT_SIZE))

    const ordered = [...opened].sort((a, b) => a.start - b.start)
    expect(ordered[0].start).toBe(0)
    expect(ordered[ordered.length - 1].end).toBe(SPAN - 1)
    for (let i = 1; i < ordered.length; i += 1) {
      expect(ordered[i].start).toBe(ordered[i - 1].end + 1)
    }
  })

  it('hands over the first bytes before the first segment is complete, and only then opens more connections', async () => {
    // Enough segments to fill the window; SPAN itself holds only three.
    const fake = pieceHandle(SEGMENT_SIZE * 6)
    fake.hold()
    const reader = new SourceReader(fake.handle).createReadable().getReader()

    // One connection, nothing through it yet: the consumer waits on the first piece.
    const first = reader.read()
    await settle()
    expect(fake.opened).toHaveLength(1)

    // The first piece is enough to be handed over — the segment is nowhere near complete.
    fake.release(1)
    const { value } = await first
    expect(value!.length).toBe(64 * 1024)
    expect(fake.opened).toHaveLength(1)

    // Now that the first segment is flowing, the rest of the window opens.
    const second = reader.read()
    await settle()
    expect(fake.opened).toHaveLength(SEGMENT_CONCURRENCY)
    expect(fake.peak()).toBe(SEGMENT_CONCURRENCY)

    fake.flow()
    await second
    await reader.cancel()
  })

  it('keeps no more than the window in flight, whatever the size of the span', async () => {
    const fake = pieceHandle(SEGMENT_SIZE * 12)
    await drain(new SourceReader(fake.handle).createReadable())

    // A fixed window is what keeps memory flat: splitting the span N ways instead would leave
    // whole fractions of a 200 MB video waiting their turn in memory.
    expect(fake.peak()).toBeLessThanOrEqual(SEGMENT_CONCURRENCY)
    expect(fake.peak()).toBeGreaterThanOrEqual(SEGMENT_CONCURRENCY - 1)
    expect(fake.opened).toHaveLength(12)
  })

  it('stops every connection when the consumer cancels', async () => {
    const fake = pieceHandle(SEGMENT_SIZE * 6)
    fake.hold()
    const reader = new SourceReader(fake.handle).createReadable().getReader()
    const first = reader.read()
    await settle()
    fake.release(1)
    await first
    const second = reader.read()
    await settle()
    expect(fake.opened).toHaveLength(SEGMENT_CONCURRENCY)

    await reader.cancel()
    await settle()

    // A segment already in flight used to run to completion; now the abort reaches the request.
    expect(fake.cancelled()).toBe(SEGMENT_CONCURRENCY)
    await expect(second).resolves.toEqual({ done: true, value: undefined })
  })

  it('leaves a local source alone, where splitting buys nothing', async () => {
    const { handle, opened } = pieceHandle(SPAN, 'file')

    expect(await drain(new SourceReader(handle).createReadable())).toEqual({
      length: SPAN,
      inOrder: true
    })
    expect(opened).toHaveLength(1)
  })

  it('opens nothing until the stream is actually read', async () => {
    const { handle, opened } = pieceHandle(SPAN)
    new SourceReader(handle).createReadable()

    await Promise.resolve()
    expect(opened).toHaveLength(0)
  })

  it('still uses one request below the threshold', async () => {
    const { handle, opened } = pieceHandle(SEGMENT_MIN_SPAN - 1)
    await drain(new SourceReader(handle).createReadable())

    expect(opened).toHaveLength(1)
  })
})
