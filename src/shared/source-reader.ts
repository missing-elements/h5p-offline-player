import { Reader, type CreateReadableOptions } from '@zip.js/zip.js'
import type { SourceHandle } from './source'
import { streamSpan } from './span-stream'

/**
 * The zip.js side of a source: `SourceReader` presents a `SourceHandle` to zip.js. Kept apart
 * from the handles in `source.ts` because this is the one module that imports zip.js, and the
 * element — which probes a source but never reads an archive — must not carry it; how a span is
 * actually pulled, in segments or in one request, lives in `span-stream.ts`, which the Jobs
 * worker uses without zip.js.
 */

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
    return streamSpan(this.handle, { start, end })
  }
}
