import { describe, expect, it } from 'vitest'
import { BlobWriter, TextReader, Uint8ArrayReader, ZipReader, ZipWriter, configure } from '@zip.js/zip.js'
import { indexFingerprint, platformOf, revisionOf, withProvenance } from '../../src/shared/revision'
import { PackageReader } from '../../src/sw/package-reader'
import type { SourceHandle } from '../../src/shared/source'
// The normalizer's copy of the recipe, which a publisher runs at release. The two must agree.
import { indexFingerprint as nodeFingerprint } from '../../../normalize/lib/fingerprint.mjs'

configure({ useWebWorkers: false })

const encode = (text: string) => new TextEncoder().encode(text)

/** The shared vector: both implementations must produce exactly this. */
const VECTOR = [
  { rawName: encode('h5p.json'), crc32: 0x12345678, compressedSize: 120, size: 300, method: 8 },
  // Past 4 GiB, so the sizes have to be written as u64.
  { rawName: encode('content/video.mp4'), crc32: 0xdeadbeef, compressedSize: 5_000_000_000, size: 5_000_000_000, method: 0 }
]
const VECTOR_FINGERPRINT = 'sha256:500da1583cedb6224e3dacfb14afc0fba8e944a5f48268c1d696b34b700f9915'

async function zipOf(files: Record<string, string>) {
  const writer = new ZipWriter(new BlobWriter('application/zip'))
  for (const [name, content] of Object.entries(files)) await writer.add(name, new TextReader(content))
  return new Uint8Array(await (await writer.close()).arrayBuffer())
}

function handleOf(bytes: Uint8Array<ArrayBuffer>): SourceHandle {
  return {
    descriptor: { type: 'file', name: 'a.h5p', size: bytes.length, lastModified: 0 },
    size: bytes.length,
    async read(range) {
      return bytes.subarray(range.start, range.end + 1)
    },
    async stream(range) {
      return new Blob([bytes.subarray(range.start, range.end + 1)]).stream()
    }
  }
}

const PACKAGE = {
  'h5p.json': JSON.stringify({ title: 't', mainLibrary: 'H5P.A', preloadedDependencies: [] }),
  'content/content.json': '{"text":"one"}'
}

describe('indexFingerprint', () => {
  it('produces the shared vector', async () => {
    expect(await indexFingerprint(VECTOR)).toBe(VECTOR_FINGERPRINT)
  })

  it('agrees with the normalizer, which is what a publisher records at release', async () => {
    expect(nodeFingerprint(VECTOR)).toBe(VECTOR_FINGERPRINT)
  })

  it('changes with a checksum, a size, a name or the order', async () => {
    const [a, b] = VECTOR
    const variants = [
      [{ ...a, crc32: a.crc32 + 1 }, b],
      [{ ...a, compressedSize: 121 }, b],
      [{ ...a, rawName: encode('H5P.json') }, b],
      [b, a]
    ]
    for (const variant of variants) expect(await indexFingerprint(variant)).not.toBe(VECTOR_FINGERPRINT)
  })
})

describe('the reader', () => {
  it('fingerprints the central directory the way anyone reading the archive would', async () => {
    const bytes = await zipOf(PACKAGE)
    const reader = await PackageReader.open('p', handleOf(bytes), { requireLibraries: false })

    const zip = new ZipReader(new Uint8ArrayReader(bytes))
    const entries = await zip.getEntries()
    const expected = nodeFingerprint(
      entries.map((entry) => ({
        rawName: entry.rawFilename,
        crc32: entry.signature ?? 0,
        compressedSize: entry.compressedSize,
        size: entry.uncompressedSize,
        method: entry.compressionMethod
      }))
    )
    expect(reader.fingerprint).toBe(expected)
    expect(reader.revision()).toBe(expected)
  })

  it('names another build when one file changes', async () => {
    const first = await PackageReader.open('p', handleOf(await zipOf(PACKAGE)), { requireLibraries: false })
    const second = await PackageReader.open(
      'p',
      handleOf(await zipOf({ ...PACKAGE, 'content/content.json': '{"text":"two"}' })),
      { requireLibraries: false }
    )
    expect(second.fingerprint).not.toBe(first.fingerprint)
  })

  it('adds an attached bundle to the revision', async () => {
    const content = await PackageReader.open('p', handleOf(await zipOf(PACKAGE)), { requireLibraries: false })
    const bundle = await PackageReader.open(
      'b',
      handleOf(await zipOf({ 'h5p.json': PACKAGE['h5p.json'], 'H5P.A-1.0/library.json': '{}' })),
      { requireLibraries: false }
    )
    content.use(bundle)
    expect(content.revision()).toBe(`${content.fingerprint}; libraries ${bundle.fingerprint}`)
  })
})

describe('revisionOf', () => {
  it('is the package alone without a bundle', () => {
    expect(revisionOf('sha256:a')).toBe('sha256:a')
  })

  it('lists each bundle after the package', () => {
    expect(revisionOf('sha256:a', ['sha256:b', 'sha256:c'])).toBe('sha256:a; libraries sha256:b, sha256:c')
  })
})

describe('withProvenance', () => {
  const platform = platformOf('0.1.8')
  const statement = {
    verb: { id: 'http://adlnet.gov/expapi/verbs/completed' },
    object: { id: 'https://host.example/course.h5p', objectType: 'Activity' },
    context: { contextActivities: { parent: [{ id: 'x' }] } }
  }

  it('fills in revision and platform, keeping what the context already had', () => {
    const stamped = withProvenance(statement, 'sha256:a', platform) as typeof statement & {
      context: { revision: string; platform: string }
    }
    expect(stamped.context).toEqual({
      contextActivities: { parent: [{ id: 'x' }] },
      revision: 'sha256:a',
      platform: 'h5p-offline-player 0.1.8'
    })
    // A copy: the statement the frame sent is left alone.
    expect(statement.context).not.toHaveProperty('revision')
  })

  it('treats an absent objectType as an Activity, as the spec does', () => {
    const stamped = withProvenance({ object: { id: 'x' } }, 'sha256:a', platform) as { context: object }
    expect(stamped.context).toEqual({ revision: 'sha256:a', platform: 'h5p-offline-player 0.1.8' })
  })

  it('leaves a statement about something other than an Activity alone', () => {
    const about = { object: { objectType: 'StatementRef', id: 'x' } }
    expect(withProvenance(about, 'sha256:a', platform)).toBe(about)
  })

  it('never overwrites a revision or platform the content set itself', () => {
    const own = { object: { id: 'x' }, context: { revision: 'v2', platform: 'lms' } }
    expect((withProvenance(own, 'sha256:a', platform) as typeof own).context).toEqual({ revision: 'v2', platform: 'lms' })
  })

  it('sets the platform even when the revision is not known', () => {
    const stamped = withProvenance({ object: { id: 'x' } }, null, platform) as { context: object }
    expect(stamped.context).toEqual({ platform: 'h5p-offline-player 0.1.8' })
  })
})
