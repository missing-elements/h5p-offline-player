import { describe, expect, it } from 'vitest'
import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter, configure } from '@zip.js/zip.js'
import { LocalHeaderScanner } from '../../src/shared/forward-index'

configure({ useWebWorkers: false })

type Files = Record<string, string | Uint8Array<ArrayBuffer>>

/**
 * Real archives from zip.js. `descriptors: true` adds every entry from a stream, which is how a
 * writer that cannot seek ends up putting the sizes after the data — the h5p.com layout.
 */
async function zipOf(files: Files, options: { descriptors?: boolean; stored?: string[] } = {}) {
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

const bytesOf = (files: Files) =>
  Object.fromEntries(
    Object.entries(files).map(([name, content]) => [
      name,
      typeof content === 'string' ? new TextEncoder().encode(content) : content
    ])
  )

function descriptorFlags(archive: Uint8Array): boolean[] {
  // Read bit 3 of the first local header only: enough to prove which kind of archive this is.
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  return [(view.getUint16(6, true) & 0x0008) !== 0]
}

function scan(archive: Uint8Array, chunk: number) {
  const scanner = new LocalHeaderScanner()
  for (let at = 0; at < archive.length; at += chunk) scanner.push(archive.subarray(at, at + chunk))
  scanner.finish()
  return scanner
}

/** The bytes of an entry, located only from what the scanner said, inflated back to the original. */
async function recover(
  archive: Uint8Array<ArrayBuffer>,
  entry: { method: number; dataStart: number; compressedSize: number }
) {
  const span = archive.subarray(entry.dataStart, entry.dataStart + entry.compressedSize)
  if (entry.method === 0) return new Uint8Array(span)
  const inflated = new Blob([span]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(inflated).arrayBuffer())
}

const media = new Uint8Array(200_000).map((_, i) => (i * 31 + 7) % 251)
const files: Files = {
  'h5p.json': JSON.stringify({ title: 'x', mainLibrary: 'H5P.A' }),
  'H5P.A-1.0/library.json': '{"machineName":"H5P.A"}',
  'H5P.A-1.0/a.js': 'void 0;'.repeat(400),
  'content/content.json': '{}',
  'content/images/one.bin': media
}

describe('LocalHeaderScanner', () => {
  for (const chunk of [1, 7, 4096, 1 << 20]) {
    it(`indexes a plain archive fed in ${chunk}-byte chunks`, async () => {
      const archive = await zipOf(files, { stored: ['content/images/one.bin'] })
      expect(descriptorFlags(archive)).toEqual([false])

      const scanner = scan(archive, chunk)
      expect(scanner.entries.map((e) => e.name)).toEqual(Object.keys(files))
      expect(scanner.done).toBe(true)
      expect(scanner.stopped).toBe('central-directory')

      const expected = bytesOf(files)
      for (const entry of scanner.entries) {
        expect(await recover(archive, entry), entry.name).toEqual(expected[entry.name])
        expect(entry.uncompressedSize).toBe(expected[entry.name].length)
      }
    })
  }

  for (const chunk of [1, 13, 65_536]) {
    it(`resolves data-descriptor entries, stored and deflated, in ${chunk}-byte chunks`, async () => {
      const archive = await zipOf(files, { descriptors: true, stored: ['content/images/one.bin'] })
      expect(descriptorFlags(archive)).toEqual([true])

      const scanner = scan(archive, chunk)
      expect(scanner.entries.map((e) => e.name)).toEqual(Object.keys(files))
      expect(scanner.done).toBe(true)

      const expected = bytesOf(files)
      for (const entry of scanner.entries) {
        // Sizes came from the descriptor, found by scanning the data itself.
        expect(entry.uncompressedSize, entry.name).toBe(expected[entry.name].length)
        expect(await recover(archive, entry), entry.name).toEqual(expected[entry.name])
      }
    })
  }

  it('is not fooled by a stored payload that contains the descriptor signature', async () => {
    // The signature bytes, followed by a size that does not match where they sit.
    const trap = new Uint8Array([...new Uint8Array(100), 0x50, 0x4b, 0x07, 0x08, 1, 2, 3, 4, 9, 9, 9, 9, 0, 0, 0, 0, ...new Uint8Array(50)])
    const archive = await zipOf({ 'a.bin': trap, 'b.txt': 'after' }, { descriptors: true, stored: ['a.bin'] })

    const scanner = scan(archive, 5)
    expect(scanner.entries.map((e) => e.name)).toEqual(['a.bin', 'b.txt'])
    expect(await recover(archive, scanner.entries[0])).toEqual(trap)
  })

  it('lists only entries whose data has fully passed, and says how far it has accounted for', async () => {
    const archive = await zipOf(files, { stored: ['content/images/one.bin'] })
    const last = scan(archive, archive.length).entries.at(-1)!
    const scanner = new LocalHeaderScanner()

    // Stop partway through the last entry's data: its header has been read, its bytes have not.
    scanner.push(archive.subarray(0, last.dataStart + 1000))

    expect(scanner.entries.map((e) => e.name)).toEqual(Object.keys(files).slice(0, -1))
    // Accounted for up to where the in-transit entry begins, and not a byte further.
    expect(scanner.parsedTo).toBe(last.headerOffset)
    expect(scanner.done).toBe(false)
    expect(scanner.stopped).toBeNull()

    scanner.push(archive.subarray(last.dataStart + 1000))
    scanner.finish()
    expect(scanner.entries.at(-1)?.name).toBe(last.name)
    expect(scanner.done).toBe(true)
  })

  it('gives up on a descriptor entry whose descriptor never comes, without inventing one', async () => {
    const archive = await zipOf({ 'a.bin': media }, { descriptors: true, stored: ['a.bin'] })
    const scanner = new LocalHeaderScanner()
    // Everything up to just before the descriptor.
    const dataEnd = 30 + 'a.bin'.length + media.length
    scanner.push(archive.subarray(0, dataEnd + 2))
    scanner.finish()

    expect(scanner.entries).toEqual([])
    expect(scanner.stopped).toBe('unresolved-descriptor')
  })

  it('stops on bytes that are not a local header', () => {
    const scanner = new LocalHeaderScanner()
    scanner.push(new TextEncoder().encode('<!doctype html><html>a login page</html>'))
    expect(scanner.stopped).toBe('bad-signature')
    expect(scanner.entries).toEqual([])
  })
})
