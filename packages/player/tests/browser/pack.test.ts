import { describe, expect, it } from 'vitest'
import '../../src/h5p-offline-player'
import type { H5PPlayerElement } from '../../src/h5p-offline-player'
import { ChunkStore } from '../../src/shared/chunk-store'
import { ARCHIVE_ENTRY } from '../../src/shared/constants'
import * as db from '../../src/shared/idb'
import { packageLockName } from '../../src/shared/locks'
import { partPkgId } from '../../src/shared/pkg-id'
import { FIXTURES, clearPackageCaches, createPlayer, frameWindow, messageOf, play, settle, waitForSettled } from './utils'

/**
 * The library pack, split into one archive per library: `libraries="pack"` downloads the parts a
 * package needs and no others, and plays the pack's newer version of a library a package carries.
 *
 * `/fixtures/pack/` is a pack of three, written by `splitPack` as the real one is: the fixture
 * content type at 1.2 with its upgrade steps, which append each version they pass to the
 * message, its sub-content type at 1.1, and a library nothing here needs. `pack-base` names it;
 * jsDelivr's copy, which the element otherwise uses, is not reached from the suite.
 */

const PACK = '/fixtures/pack/'
const BASIC_MESSAGE = 'Served from the archive, never extracted to disk.'
const withPack = (extra: Record<string, string> = {}) => ({ libraries: 'pack', 'pack-base': PACK, ...extra })
/** A URL of its own per play, so each package's row holds only this play's load. */
const fresh = (src: string, tag: string) => `${src}${src.includes('?') ? '&' : '?'}case=${tag}-${Date.now()}`

/** The settings the load kept: the parts attached, by their file names, and the package's own folders withheld. */
async function loadOf(player: H5PPlayerElement): Promise<{ parts: string[]; superseded: string[]; partIds: string[] }> {
  const row = await db.getPackage(player.pkgId!)
  const view = Object.values(row?.views ?? {}).sort((a, b) => b.registered - a.registered)[0]
  const partIds = view?.parts ?? []
  const parts = await Promise.all(partIds.map((id) => db.getPackage(id)))
  return {
    parts: parts.map((part) => (part?.source as { url: string }).url.split('/').pop()!).sort(),
    superseded: view?.superseded ?? [],
    partIds
  }
}

describe('the library pack, split into parts', () => {
  it('supplies a content-only export with the parts it needs, and no others', async () => {
    const player = await play(fresh(FIXTURES.needsLibraries, 'fill'), withPack())

    // Written for 1.0, played at the pack's 1.2: its steps ran.
    expect(messageOf(player)).toBe('Libraries came from somewhere else. [1.1] [1.2]')
    expect((await loadOf(player)).parts).toEqual(['H5P.OfflineTest-1.2.h5p'])
    expect(player.libraryBundle).toMatchObject({ url: new URL(PACK, location.href).href, origin: location.origin, refreshed: [] })
  })

  it("takes the sub-content's libraries from the pack too, and names them all by one fingerprint", async () => {
    const player = await play(fresh(FIXTURES.writtenFor10, 'sub-content'), withPack())

    expect(frameWindow(player).document.querySelector('.h5p-offline-child-text')?.textContent).toBe('Child written for 1.0 [child 1.1]')
    expect((await loadOf(player)).parts).toEqual(['H5P.OfflineChild-1.1.h5p', 'H5P.OfflineTest-1.2.h5p'])
    expect(player.revision).toMatch(/^sha256:[0-9a-f]{64}; libraries sha256:[0-9a-f]{64}$/)
  })

  it("plays the pack's newer version of a library the package carries, its content upgraded", async () => {
    const player = await play(fresh(FIXTURES.basic, 'refresh'), withPack())

    expect(messageOf(player)).toBe(`${BASIC_MESSAGE} [1.1] [1.2]`)
    expect(player.libraryBundle?.refreshed).toEqual([{ library: 'H5P.OfflineTest', from: '1.0.0', to: '1.2.0' }])
    expect(await loadOf(player)).toMatchObject({ parts: ['H5P.OfflineTest-1.2.h5p'], superseded: ['H5P.OfflineTest-1.0'] })
  })

  it('refreshes a library kept in a folder with no version, as older packages keep them', async () => {
    // Before the warm its library.json is not read, and nothing is planned over it; after, the
    // version it gives is older than the pack's.
    const player = await play(fresh(FIXTURES.unversioned, 'unversioned'), withPack())

    expect(messageOf(player)).toBe(`${BASIC_MESSAGE} [1.1] [1.2]`)
    expect(await loadOf(player)).toMatchObject({ parts: ['H5P.OfflineTest-1.2.h5p'], superseded: ['H5P.OfflineTest'] })
  })

  it("plays the pack's folders, named with versions, beside the package's own named without", async () => {
    // The content type comes from the pack at 1.2; the extra library, which the pack has at the
    // package's own version, from the package's folder named without one. h5p-standalone named
    // every folder one way, by its first dependency, and ended its boot on the extra library's 404.
    const player = await play(fresh(FIXTURES.unversionedPack, 'mixed'), withPack())

    expect(messageOf(player)).toBe(`${BASIC_MESSAGE} [1.1] [1.2]`)
    expect(await loadOf(player)).toMatchObject({ parts: ['H5P.OfflineTest-1.2.h5p'], superseded: ['H5P.OfflineTest'] })
    const view = frameWindow(player) as Window & { h5pOfflineExtraLoaded?: boolean; H5PIntegration: { libraryDirectories: Record<string, string> } }
    expect(view.h5pOfflineExtraLoaded).toBe(true)
    // So that the core's `H5P.getLibraryPath` finds the folder its name does not say.
    expect(view.H5PIntegration.libraryDirectories).toEqual({ 'H5P.OfflineExtra-1.0': 'H5P.OfflineExtra' })
  })

  it('plays the package as exported with refresh-libraries="off"', async () => {
    const player = await play(fresh(FIXTURES.basic, 'off'), withPack({ 'refresh-libraries': 'off' }))

    expect(messageOf(player)).toBe(BASIC_MESSAGE)
    expect(player.libraryBundle).toBeNull()
    expect((await loadOf(player)).parts).toEqual([])
  })

  it('refreshes nothing without libraries="pack", whatever else names the pack', async () => {
    const player = await play(fresh(FIXTURES.basic, 'no-pack'), { 'pack-base': PACK })
    expect(messageOf(player)).toBe(BASIC_MESSAGE)
    expect(player.libraryBundle).toBeNull()
  })

  it('uses a part kept from before with no request, and says so', async () => {
    await clearPackageCaches()
    const first = await play(fresh(FIXTURES.needsLibraries, 'first'), withPack())
    expect(first.libraryBundle?.fromCache).toBe(false)

    const second = await play(fresh(FIXTURES.needsLibraries, 'second'), withPack())
    expect(second.libraryBundle?.fromCache).toBe(true)
  })

  it('holds each part it plays from, so eviction leaves it alone', async () => {
    const player = await play(fresh(FIXTURES.writtenFor10, 'held'), withPack())
    const { partIds } = await loadOf(player)
    const held = new Set(((await navigator.locks.query()).held ?? []).map((lock) => lock.name))
    for (const id of partIds) expect(held.has(packageLockName(id, 'playing')), id).toBe(true)
  })

  it('refuses a part whose bytes do not match the index, and plays a package that carries its libraries as exported', async () => {
    const tampered = withPack({ 'pack-base': '/fixtures/pack-tampered/' })

    const { result } = await settle(fresh(FIXTURES.needsLibraries, 'tampered'), tampered)
    if (result.ok) expect.fail('expected the tampered part to be refused')
    expect(result.detail.code).toBe('bad-archive')
    expect(result.detail.message).toContain('H5P.OfflineTest-1.0')
    expect(result.detail.message).toContain("index's hash")

    // The refresh is given up; the package plays its own copy, as exported.
    const player = await play(fresh(FIXTURES.basic, 'tampered'), tampered)
    expect(messageOf(player)).toBe(BASIC_MESSAGE)
    expect(player.libraryBundle).toBeNull()
  })

  it('checks a part kept whole but never checked, and downloads it again when it does not match', async () => {
    // What a Jobs worker stopped between a part's last write and its check leaves behind: the
    // part complete, under its hash's id, holding other bytes — here another part's. Taken as
    // checked for being whole, it was attached as the library (#58).
    const index = (await (await fetch(`${PACK}index.json`)).json()) as { libraries: Array<{ folder: string; sha256: string }> }
    const part = index.libraries.find(({ folder }) => folder === 'H5P.OfflineTest-1.2')!
    const other = index.libraries.find(({ folder }) => folder !== part.folder)!
    const wrong = new Uint8Array(await (await fetch(`${PACK}${other.folder}.h5p`)).arrayBuffer())
    const id = await partPkgId(part.sha256)
    const store = new ChunkStore(id)
    await store.destroy()
    await store.putChunk(ARCHIVE_ENTRY, 0, wrong)
    await store.setMeta(ARCHIVE_ENTRY, { size: wrong.length, available: wrong.length, complete: true })

    const player = await play(fresh(FIXTURES.needsLibraries, 'unchecked'), withPack())
    expect(messageOf(player)).toBe('Libraries came from somewhere else. [1.1] [1.2]')
    // A store of its own: the worker deleted the cache this one holds, and wrote a new one.
    expect((await new ChunkStore(id).getArchiveMeta())?.checked).toBe(part.sha256)
  })

  it("keeps what the package carries when the host's copy of the pack cannot be read", async () => {
    const missing = withPack({ 'pack-base': '/no-range/no-such-pack/' })

    const player = await play(fresh(FIXTURES.basic, 'unread'), missing)
    expect(messageOf(player)).toBe(BASIC_MESSAGE)

    const { result } = await settle(fresh(FIXTURES.needsLibraries, 'unread'), missing)
    if (result.ok) expect.fail('expected the package to be refused')
    expect(result.detail).toMatchObject({ code: 'bad-archive', missingLibraries: { folders: ['H5P.OfflineTest-1.0'] } })
    expect(result.detail.message).toContain('library pack')
  })

  it('takes the pack from the pack property, as a bundler hands it over', async () => {
    const index = await (await fetch(`${PACK}index.json`)).json()
    const pack = { libraries: index.libraries.map((library: { folder: string }) => ({ ...library, url: `${PACK}${library.folder}.h5p` })) }

    const player = createPlayer({ libraries: 'pack' })
    player.pack = pack
    // Relative URLs are taken against the page, so the property hands back absolute ones.
    expect(player.pack?.libraries[0].url).toBe(new URL(`${PACK}${index.libraries[0].folder}.h5p`, location.href).href)
    const settled = waitForSettled(player)
    player.setAttribute('src', fresh(FIXTURES.needsLibraries, 'property'))
    const result = await settled
    if (!result.ok) expect.fail(`${result.detail.code} — ${result.detail.message}`)

    expect(messageOf(player)).toBe('Libraries came from somewhere else. [1.1] [1.2]')
    expect(player.libraryBundle?.url).toBe(new URL(PACK, location.href).href)
  })

  it('plays an untrusted package from the parts it needs, none of its own code running', async () => {
    const player = await play(fresh(FIXTURES.untrusted, 'untrusted'), { untrusted: '', 'pack-base': PACK })

    expect(messageOf(player)).toBe('Content from an untrusted package. [1.1] [1.2]')
    expect((frameWindow(player) as unknown as { ownLibraryRan?: boolean }).ownLibraryRan).toBeUndefined()
    expect((await loadOf(player)).parts).toEqual(['H5P.OfflineTest-1.2.h5p'])
  })

  it('attaches the parts while a download from a host without Range is under way', async () => {
    // Paced, the archive's library folder arrives seconds before its media: the parts are
    // planned and attached then, and the frame boots with them before the download ends. The
    // pack's 1.2 needs nothing the package's own 1.0 did, so the extra library stays out.
    // The server sends 64 kB at a time and the download first publishes its index at 256 kB, so the
    // frame may boot from the fourth slice and has until the fifth, one slice's interval, to plan,
    // fetch and attach the parts: half a second at 128 kB/s, which a slow runner did not make
    // (#75), and two at 32 kB/s.
    const states: string[] = []
    const { player, result } = await settle(fresh(`${FIXTURES.needsDependencyNoRange}?throttle=32768`, 'paced'), withPack(), (each) =>
      each.addEventListener('statechange', (event) => states.push((event as CustomEvent<{ state: string }>).detail.state))
    )
    if (!result.ok) expect.fail(`${result.detail.code} — ${result.detail.message}`)

    // Booted from the forward index: no `indexing` after the download, which only a frame that
    // waited for the whole archive goes through.
    expect(states).toEqual(['probing', 'downloading', 'ready'])
    expect(messageOf(player)).toBe(`${BASIC_MESSAGE} [1.1] [1.2]`)
    expect(player.libraryBundle?.refreshed).toEqual([{ library: 'H5P.OfflineTest', from: '1.0.0', to: '1.2.0' }])
    expect((frameWindow(player) as unknown as { h5pOfflineExtraLoaded?: boolean }).h5pOfflineExtraLoaded).toBeUndefined()
  })
})
