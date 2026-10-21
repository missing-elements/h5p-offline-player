import { STORED } from './local-header.js'
import type { ByteRange } from './range.js'

/**
 * Restricts a byte stream to an inclusive range without buffering it. Used to answer a `Range`
 * request from an entry the cache holds in one piece: the body is sliced as it flows rather than
 * read into memory and cut.
 */
export function sliceStream(
  source: ReadableStream<Uint8Array>,
  range: ByteRange
): ReadableStream<Uint8Array> {
  const wanted = range.end - range.start + 1
  let seen = 0
  let emitted = 0

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (emitted >= wanted) return

      const chunkStart = seen
      seen += chunk.length

      // Everything before the range: drop it.
      if (seen <= range.start) return

      const from = Math.max(0, range.start - chunkStart)
      const to = Math.min(chunk.length, from + (wanted - emitted))
      const slice = chunk.subarray(from, to)

      emitted += slice.length
      controller.enqueue(slice)

      if (emitted >= wanted) controller.terminate()
    }
  })

  void source.pipeTo(transform.writable).catch(() => {
    // `terminate()` above aborts the pipe once the range is satisfied; that is the normal end.
  })

  return transform.readable
}

/**
 * A stream opened only once something reads it. A stream is otherwise pulled as soon as it is
 * constructed, and one nobody consumes would open a request for its whole span and leave it
 * hanging; the virtual server and the span reader both hand out streams that may never be read.
 */
export function deferredStream(open: () => Promise<ReadableStream<Uint8Array>>): ReadableStream<Uint8Array> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        reader ??= (await open()).getReader()
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
 * An entry's bytes as the archive stored them, inflated when the entry is deflated: the native
 * codec, which is what zip.js would have used. The lib types the codec's input as `BufferSource`,
 * stricter than the plain views it gets, so the one cast for it lives here.
 */
export function inflated(stored: ReadableStream<Uint8Array>, method: number, compressedSize: number): ReadableStream<Uint8Array> {
  if (method === STORED || compressedSize === 0) return stored
  const inflate = new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>
  return stored.pipeThrough(inflate)
}
