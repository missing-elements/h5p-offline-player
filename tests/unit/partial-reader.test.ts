import { describe, expect, it } from 'vitest'
import { PackageReader } from '../../src/sw/package-reader'
import { LocalHeaderScanner } from '../../src/shared/forward-index'
import { collect, manifest, memoryHandle, zipOf, type Files } from './helpers/archives'

/**
 * A reader over an archive that is still arriving. What matters is what it claims and when: never
 * ready before every declared library has finished arriving, never a certain "no" for a file that
 * may still be on its way, and correct bytes for what it does serve — off its own inflate, since a
 * forward entry has no zip.js object behind it.
 */

const media = new Uint8Array(150_000).map((_, i) => (i * 13 + 5) % 251)
const files: Files = {
  'h5p.json': manifest('H5P.A', [
    ['H5P.A', 1, 0],
    ['H5P.B', 1, 0]
  ]),
  'H5P.A-1.0/library.json': '{"machineName":"H5P.A"}',
  'H5P.A-1.0/a.js': 'H5P.A = 1;'.repeat(300),
  'H5P.B-1.0/library.json': '{"machineName":"H5P.B"}',
  'content/content.json': '{"x":1}',
  'content/media/big.bin': media
}
const expected = (name: string) => {
  const content = files[name]
  return typeof content === 'string' ? new TextEncoder().encode(content) : content
}

const snapshotAfter = (archive: Uint8Array<ArrayBuffer>, bytes: number) => {
  const scanner = new LocalHeaderScanner()
  scanner.push(archive.subarray(0, bytes))
  return scanner.snapshot()
}

/** Where the entry after `name` begins: the first offset at which `name` counts as arrived. */
const endOf = (archive: Uint8Array<ArrayBuffer>, name: string) => {
  const scanner = new LocalHeaderScanner()
  scanner.push(archive)
  scanner.finish()
  const entry = scanner.entries.find((each) => each.name === name)!
  return entry.dataStart + entry.compressedSize
}

describe('a reader over a downloading archive', () => {
  it('is not ready while a declared library is still arriving', async () => {
    const archive = await zipOf(files, { stored: ['content/media/big.bin'] })
    const reader = await PackageReader.fromForwardIndex(
      'pkg',
      memoryHandle(archive).handle,
      snapshotAfter(archive, endOf(archive, 'H5P.A-1.0/a.js') + 10)
    )

    expect(reader.partial).toBe(true)
    expect(reader.manifest.title).toBe('test')
    expect(reader.get('H5P.A-1.0/a.js')).toBeDefined()
    // H5P.B is declared and has not arrived.
    expect(reader.bootReady()).toBe(false)
  })

  it('is ready once every declared library has finished arriving, with the media still to come', async () => {
    const archive = await zipOf(files, { stored: ['content/media/big.bin'] })
    const reader = await PackageReader.fromForwardIndex(
      'pkg',
      memoryHandle(archive).handle,
      snapshotAfter(archive, endOf(archive, 'content/content.json'))
    )

    // Both library folders are behind the newest entry, so both are complete.
    expect(reader.bootReady()).toBe(true)
    expect(reader.get('content/media/big.bin')).toBeUndefined()

    // A file in a folder that has finished arriving is certainly absent; one in the folder still
    // arriving, or in a folder not seen at all, is not.
    expect(reader.provablyAbsent('H5P.A-1.0/nope.js')).toBe(true)
    expect(reader.provablyAbsent('content/media/big.bin')).toBe(false)
    expect(reader.provablyAbsent('H5P.C-1.0/library.json')).toBe(false)
  })

  it('answers the versioned probe on an unversioned library without waiting', async () => {
    const archive = await zipOf({
      'h5p.json': manifest('H5P.A', [['H5P.A', 1, 0]]),
      'H5P.A/library.json': '{}',
      'content/content.json': '{}'
    })
    const reader = await PackageReader.fromForwardIndex(
      'pkg',
      memoryHandle(archive).handle,
      snapshotAfter(archive, endOf(archive, 'content/content.json'))
    )

    expect(reader.bootReady()).toBe(true)
    expect(reader.get('H5P.A-1.0/library.json')).toBeUndefined()
    expect(reader.provablyAbsent('H5P.A-1.0/library.json')).toBe(true)
  })

  it('absorbs later snapshots and serves what arrived, inflating it itself', async () => {
    const archive = await zipOf(files, { stored: ['content/media/big.bin'] })
    const reader = await PackageReader.fromForwardIndex(
      'pkg',
      memoryHandle(archive).handle,
      snapshotAfter(archive, endOf(archive, 'H5P.A-1.0/a.js') + 10)
    )
    expect(reader.get('content/media/big.bin')).toBeUndefined()

    const full = new LocalHeaderScanner()
    full.push(archive)
    full.finish()
    expect(await reader.absorb(full.snapshot())).toBe(true)

    expect(reader.forwardDone).toBe(true)
    expect(reader.bootReady()).toBe(true)
    expect(reader.provablyAbsent('anything/at/all')).toBe(true)

    const stored = reader.get('content/media/big.bin')!.entry
    const deflated = reader.get('H5P.A-1.0/a.js')!.entry
    expect(stored.zip).toBeUndefined()
    expect(await collect(reader.inflate(stored))).toEqual(expected('content/media/big.bin'))
    expect(await collect(reader.inflate(deflated))).toEqual(expected('H5P.A-1.0/a.js'))
  })

  it('serves a descriptor archive off the offsets the scanner recovered', async () => {
    const archive = await zipOf(files, { descriptors: true, stored: ['content/media/big.bin'] })
    const scanner = new LocalHeaderScanner()
    scanner.push(archive)
    scanner.finish()
    const reader = await PackageReader.fromForwardIndex('pkg', memoryHandle(archive).handle, scanner.snapshot())

    expect(await collect(reader.inflate(reader.get('content/media/big.bin')!.entry))).toEqual(media)
    expect(await collect(reader.inflate(reader.get('H5P.B-1.0/library.json')!.entry))).toEqual(
      expected('H5P.B-1.0/library.json')
    )
  })

  it('never says ready for an index the scanner had to give up on', async () => {
    const archive = await zipOf(files, { stored: ['content/media/big.bin'] })
    const snapshot = snapshotAfter(archive, endOf(archive, 'content/content.json'))
    const reader = await PackageReader.fromForwardIndex('pkg', memoryHandle(archive).handle, {
      ...snapshot,
      stopped: 'unresolved-descriptor'
    })

    // Every library is here, but what the scanner could not see past must wait for the real index.
    expect(reader.bootReady()).toBe(false)
  })
})
