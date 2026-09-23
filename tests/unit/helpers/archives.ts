import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter, configure } from '@zip.js/zip.js'
import type { SourceHandle } from '../../../src/shared/source'
import type { ByteRange } from '../../../src/shared/range'

configure({ useWebWorkers: false })

export type Files = Record<string, string | Uint8Array<ArrayBuffer>>

/**
 * A real archive from zip.js, in memory. `descriptors: true` adds every entry from a stream,
 * which is how a writer that cannot seek ends up putting the sizes after the data.
 */
export async function zipOf(files: Files, options: { descriptors?: boolean; stored?: string[] } = {}) {
  const writer = new ZipWriter(new BlobWriter('application/zip'))
  for (const [name, content] of Object.entries(files)) {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
    const reader = options.descriptors
      ? new Blob([bytes]).stream()
      : typeof content === 'string'
        ? new TextReader(content)
        : new Uint8ArrayReader(content)
    await writer.add(name, reader, {
      dataDescriptor: options.descriptors ?? false,
      level: options.stored?.includes(name) ? 0 : undefined
    })
  }
  return new Uint8Array(await (await writer.close()).arrayBuffer())
}

/** A handle over bytes in memory that counts what is read and what is streamed from it. */
export function memoryHandle(bytes: Uint8Array<ArrayBuffer>) {
  const reads: ByteRange[] = []
  const streams: ByteRange[] = []
  const handle: SourceHandle = {
    descriptor: { type: 'file', name: 'a.h5p', size: bytes.length, lastModified: 0 },
    size: bytes.length,
    async read(range) {
      reads.push(range)
      return bytes.subarray(range.start, range.end + 1)
    },
    async stream(range) {
      streams.push(range)
      return new Blob([bytes.subarray(range.start, range.end + 1)]).stream()
    }
  }
  return { handle, reads, streams }
}

export const manifest = (mainLibrary: string, deps: Array<[string, number, number]>) =>
  JSON.stringify({
    title: 'test',
    mainLibrary,
    preloadedDependencies: deps.map(([machineName, majorVersion, minorVersion]) => ({
      machineName,
      majorVersion,
      minorVersion
    }))
  })

export const collect = async (stream: ReadableStream<Uint8Array>) =>
  new Uint8Array(await new Response(stream).arrayBuffer())
