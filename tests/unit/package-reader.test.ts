import { describe, expect, it } from 'vitest'
import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter, configure } from '@zip.js/zip.js'
import { PackageReader } from '../../src/sw/package-reader'
import type { SourceHandle } from '../../src/shared/source'
import type { ByteRange } from '../../src/shared/range'

configure({ useWebWorkers: false })

/** A real zip, in memory, over a handle that counts what is read from it. */
async function zipOf(files: Record<string, string | Uint8Array>, stored: string[] = []) {
  const writer = new ZipWriter(new BlobWriter('application/zip'))
  for (const [name, content] of Object.entries(files)) {
    const reader = typeof content === 'string' ? new TextReader(content) : new Uint8ArrayReader(content)
    await writer.add(name, reader, stored.includes(name) ? { level: 0 } : undefined)
  }
  return new Uint8Array(await (await writer.close()).arrayBuffer())
}

function memoryHandle(bytes: Uint8Array<ArrayBuffer>) {
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

const manifest = (mainLibrary: string, deps: Array<[string, number, number]>) =>
  JSON.stringify({
    title: 'test',
    mainLibrary,
    preloadedDependencies: deps.map(([machineName, majorVersion, minorVersion]) => ({
      machineName,
      majorVersion,
      minorVersion
    }))
  })

describe('PackageReader.dataRange', () => {
  it('reads a stored entry’s local header once, however many ranges are sliced from it', async () => {
    const media = new Uint8Array(4096).map((_, i) => i % 251)
    const bytes = await zipOf(
      {
        'h5p.json': manifest('H5P.A', [['H5P.A', 1, 0]]),
        'H5P.A-1.0/library.json': '{}',
        'content/content.json': '{}',
        'content/media/a.bin': media
      },
      ['content/media/a.bin']
    )
    const { handle, reads, streams } = memoryHandle(bytes)
    const reader = await PackageReader.open('pkg', handle)
    const { entry } = reader.get('content/media/a.bin')!
    expect(entry.method).toBe(0)

    // Opening the package already streamed h5p.json; count from here.
    const readsBefore = reads.length
    const streamsBefore = streams.length
    // The burst a media element opens with: several ranges, all at once.
    const bodies = await Promise.all([
      reader.sliceStream(entry, { start: 0, end: 99 }),
      reader.sliceStream(entry, { start: 100, end: 199 }),
      reader.sliceStream(entry, { start: 4000, end: 4095 })
    ])
    // ...and a seek later on.
    await reader.sliceStream(entry, { start: 2000, end: 2047 })

    // One header read for all four; each used to cost its own.
    expect(reads.length - readsBefore).toBe(1)
    expect(streams.length - streamsBefore).toBe(4)

    const tail = new Uint8Array(await new Response(bodies[2]).arrayBuffer())
    expect(tail).toEqual(media.subarray(4000, 4096))
  })
})

describe('PackageReader.use', () => {
  it('sees libraries attached after a lookup has already missed', async () => {
    const content = await zipOf({
      'h5p.json': manifest('H5P.Text', [['H5P.Text', 1, 0]]),
      'content/content.json': '{}'
    })
    const bundle = await zipOf({
      'h5p.json': manifest('H5P.Text', [['H5P.Text', 1, 1]]),
      'H5P.Text-1.1/library.json': '{}',
      'H5P.Text-1.1/text.js': 'void 0'
    })
    const reader = await PackageReader.open('content', memoryHandle(content).handle, { requireLibraries: false })
    const libraries = await PackageReader.open('bundle', memoryHandle(bundle).handle, { requireLibraries: false })

    // A miss first: this is what builds the memoised library index.
    expect(reader.get('H5P.Text-1.0/text.js')).toBeUndefined()

    reader.use(libraries)

    // 1.0 asked for, 1.1 supplied. A library index not dropped by use() would still say no.
    expect(reader.get('H5P.Text-1.0/text.js')?.entry.name).toBe('H5P.Text-1.1/text.js')
    expect(reader.missingLibraries()).toBeNull()
  })
})
