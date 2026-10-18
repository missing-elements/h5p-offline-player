import { memoryHandle, zipOf } from './helpers/archives'
import { describe, expect, it } from 'vitest'
import { Uint8ArrayReader, ZipReader } from '@zip.js/zip.js'
import { indexFingerprint, librariesFingerprint, platformOf, revisionOf, withProvenance } from '../../src/shared/revision'
import { PackageReader } from '../../src/sw/package-reader'
import { VERSION } from '../../src/shared/constants'
import type { SourceHandle } from '../../src/shared/source'
// The normalizer's copy of the recipe, which a publisher runs at release. The two must agree.
import { indexFingerprint as nodeFingerprint } from '../../../normalize/lib/fingerprint.mjs'

const encode = (text: string) => new TextEncoder().encode(text)

/** The shared vector: both implementations must produce exactly this. */
const VECTOR = [
  { rawName: encode('h5p.json'), crc32: 0x12345678, compressedSize: 120, size: 300, method: 8 },
  // Past 4 GiB, so the sizes have to be written as u64.
  { rawName: encode('content/video.mp4'), crc32: 0xdeadbeef, compressedSize: 5_000_000_000, size: 5_000_000_000, method: 0 }
]
const VECTOR_FINGERPRINT = 'sha256:500da1583cedb6224e3dacfb14afc0fba8e944a5f48268c1d696b34b700f9915'

const handleOf = (bytes: Uint8Array<ArrayBuffer>): SourceHandle => memoryHandle(bytes).handle

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

  it('names several parts of the pack by one fingerprint of the set, once settled', async () => {
    const content = await PackageReader.open('p', handleOf(await zipOf(PACKAGE)), { requireLibraries: false })
    const part = async (folder: string) =>
      PackageReader.open(folder, handleOf(await zipOf({ 'h5p.json': PACKAGE['h5p.json'], [`${folder}/library.json`]: '{}' })), { requireLibraries: false })
    const [a, b] = [await part('H5P.A-1.0'), await part('H5P.B-1.0')]
    content.use(a)
    content.use(b)
    // Not before: a revision that names only some of what was played would be wrong.
    expect(content.revision()).toBeUndefined()
    await content.settleRevision()
    const set = await librariesFingerprint([a.fingerprint!, b.fingerprint!])
    expect(content.revision()).toBe(`${content.fingerprint}; libraries ${set}`)
  })
})

describe('librariesFingerprint', () => {
  const one = `sha256:${'1'.repeat(64)}`
  const two = `sha256:${'2'.repeat(64)}`

  it('is SHA-256 over the fingerprints, sorted, a line each', async () => {
    expect(await librariesFingerprint([one, two])).toBe('sha256:4b7de16713be46a2c4ef6a364470515305f6189e7688c1de495568a26713b19e')
  })

  it('names the set, whatever order the parts were attached in', async () => {
    expect(await librariesFingerprint([two, one])).toBe(await librariesFingerprint([one, two]))
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
  const platform = platformOf(VERSION)
  const statement = {
    verb: { id: 'http://adlnet.gov/expapi/verbs/completed' },
    object: { id: 'https://host.example/course.h5p', objectType: 'Activity' },
    context: { contextActivities: { parent: [{ id: 'x' }] } }
  }

  it('names the player and the version that stamped it', () => {
    expect(platform).toBe(`h5p-offline-player ${VERSION}`)
  })

  it('fills in revision and platform, keeping what the context already had', () => {
    const stamped = withProvenance(statement, 'sha256:a', platform) as typeof statement & {
      context: { revision: string; platform: string }
    }
    expect(stamped.context).toEqual({
      contextActivities: { parent: [{ id: 'x' }] },
      revision: 'sha256:a',
      platform
    })
    // A copy: the statement the frame sent is left alone.
    expect(statement.context).not.toHaveProperty('revision')
  })

  it('treats an absent objectType as an Activity, as the spec does', () => {
    const stamped = withProvenance({ object: { id: 'x' } }, 'sha256:a', platform) as { context: object }
    expect(stamped.context).toEqual({ revision: 'sha256:a', platform })
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
    expect(stamped.context).toEqual({ platform })
  })
})
