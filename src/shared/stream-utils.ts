import type { ByteRange } from './range'

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
