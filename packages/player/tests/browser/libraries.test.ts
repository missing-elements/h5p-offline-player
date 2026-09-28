import { afterEach, describe, expect, it } from 'vitest'
import '../../src/h5p-offline-player'
import {
  FIXTURES,
  clearPackageCaches,
  createPlayer,
  frameDocument,
  frameFetch,
  frameWindow,
  play,
  virtualUrl,
  waitForSettled
} from './utils'

/**
 * Filling in the libraries an export left behind.
 *
 * Exports from h5p.com and h5p.org carry `content/` and nothing else — no library folders, and a
 * `preloadedDependencies` list cut down to the main library. Pointing `libraries` at an archive
 * that has them makes such a package playable: entries are resolved against the content archive
 * first and the bundle second, and the two manifests are merged so the runtime still loads the
 * interaction types the content actually uses.
 */
describe('supplying missing libraries', () => {
  const playWithLibraries = async (src: string, libraries: string) => {
    const player = createPlayer({ libraries })
    const settled = waitForSettled(player)
    player.setAttribute('src', src)

    const result = await settled
    if (!result.ok) {
      expect.fail(`${src} failed: ${result.detail.code} — ${result.detail.message}`)
    }
    return player
  }

  it('plays a stripped export when a bundle supplies what it is missing', async () => {
    const player = await playWithLibraries(FIXTURES.needsLibraries, FIXTURES.libraries)

    expect(player.state).toBe('ready')
    expect(frameDocument(player).querySelector('.h5p-offline-test-message')?.textContent).toBe(
      'Libraries came from somewhere else.'
    )
  })

  it('still refuses it without a libraries attribute', async () => {
    const player = createPlayer()
    const settled = waitForSettled(player)
    player.setAttribute('src', FIXTURES.needsLibraries)

    const result = await settled
    expect(result).toMatchObject({ ok: false, detail: { code: 'bad-archive' } })
  })

  it('reports which libraries are missing, in a form a host can act on', async () => {
    const player = createPlayer()
    const settled = waitForSettled(player)
    player.setAttribute('src', FIXTURES.needsLibraries)

    const result = await settled
    if (result.ok) expect.fail('expected the package to be refused')

    expect(result.detail.missingLibraries).toMatchObject({
      mainLibrary: 'H5P.OfflineTest',
      folders: ['H5P.OfflineTest-1.0'],
      all: true
    })
  })

  it('serves library files from the bundle and content files from the package', async () => {
    const player = await playWithLibraries(FIXTURES.needsLibraries, FIXTURES.libraries)

    const fromBundle = await frameFetch(player, virtualUrl(player, 'H5P.OfflineTest-1.0/library.json'))
    expect(fromBundle.status).toBe(200)
    expect((await fromBundle.json()).machineName).toBe('H5P.OfflineTest')

    const fromPackage = await frameFetch(player, virtualUrl(player, 'content/content.json'))
    expect(fromPackage.status).toBe(200)
    expect((await fromPackage.json()).message).toBe('Libraries came from somewhere else.')
  })

  it('merges the manifests, so a dependency only the bundle names still loads', async () => {
    const player = await playWithLibraries(FIXTURES.needsLibraries, FIXTURES.libraries)

    const merged = await (await frameFetch(player, virtualUrl(player, 'h5p.json'))).json()
    const names = merged.preloadedDependencies.map((d: { machineName: string }) => d.machineName)
    expect(names).toContain('H5P.OfflineTest')
    expect(names).toContain('H5P.OfflineExtra')

    // Named by the bundle alone. Without the merge the runtime would never load it — in a real
    // Interactive Video that is "Unable to find constructor for: H5P.Text".
    expect((frameWindow(player) as unknown as { h5pOfflineExtraLoaded?: boolean }).h5pOfflineExtraLoaded).toBe(true)
  })

  it('names the bundle in the revision, after the package', async () => {
    const player = await playWithLibraries(FIXTURES.needsLibraries, FIXTURES.libraries)
    expect(player.revision).toMatch(/^sha256:[0-9a-f]{64}; libraries sha256:[0-9a-f]{64}$/)
  })

  it("leaves the manifest of a complete package alone", async () => {
    const player = await play(FIXTURES.basic)

    const manifest = await (await frameFetch(player, virtualUrl(player, 'h5p.json'))).json()
    expect(manifest.preloadedDependencies).toHaveLength(1)
    expect(manifest.title).toBe('Offline player test')
  })

  it('reports a library source that cannot be read, naming what is still missing', async () => {
    const player = createPlayer({ libraries: '/fixtures/no-such-bundle.h5p' })
    const settled = waitForSettled(player)
    player.setAttribute('src', FIXTURES.needsLibraries)

    const result = await settled
    if (result.ok) expect.fail('expected the package to be refused')
    expect(result.detail.code).toBe('bad-archive')
    expect(result.detail.message).toContain('H5P.OfflineTest-1.0')
  })
})

/**
 * A library source that cannot be reached — no network, or the hub down — when a bundle was
 * downloaded from it before. `/stalling/` in `reset` mode answers every request `503`, which is
 * what the probe meets. Each play uses a content URL of its own: the worker keeps a package's
 * reader with its bundle attached, and a replay of the same package would never need the
 * libraries again, so it would never reach the fallback.
 */
describe('a library source that cannot be reached', () => {
  const outage = (ms: number) => fetch(`/stalling/__outage?ms=${ms}&mode=reset`, { cache: 'no-store' })
  const content = (tag: string) => `${FIXTURES.needsLibraries}?case=${tag}-${Date.now()}`

  const settle = async (src: string, libraries: string) => {
    const player = createPlayer({ libraries })
    const settled = waitForSettled(player)
    player.setAttribute('src', src)
    return { player, result: await settled }
  }

  afterEach(async () => {
    await outage(0)
  })

  it('plays from the bundle downloaded from it before', async () => {
    const libraries = `/stalling/libraries.h5p?case=earlier-${Date.now()}`
    const first = await settle(content('online'), libraries)
    expect(first.result).toEqual({ ok: true })

    await outage(30_000)
    const { player, result } = await settle(content('offline'), libraries)
    if (!result.ok) expect.fail(`${result.detail.code} — ${result.detail.message}`)
    expect(frameDocument(player).querySelector('.h5p-offline-test-message')?.textContent).toBe(
      'Libraries came from somewhere else.'
    )
  })

  it('still fails, naming what is missing, when nothing was downloaded from it', async () => {
    await outage(30_000)
    const { result } = await settle(content('never'), `/stalling/libraries.h5p?case=never-${Date.now()}`)
    if (result.ok) expect.fail('expected the package to be refused')
    expect(result.detail.code).toBe('bad-archive')
    expect(result.detail.message).toContain('H5P.OfflineTest-1.0')
  })

  it('does not use a bundle whose bytes are gone', async () => {
    const libraries = `/stalling/libraries.h5p?case=evicted-${Date.now()}`
    const first = await settle(content('before'), libraries)
    expect(first.result).toEqual({ ok: true })

    await clearPackageCaches()
    await outage(30_000)
    const { result } = await settle(content('after'), libraries)
    if (result.ok) expect.fail('expected the package to be refused')
    expect(result.detail.code).toBe('bad-archive')
  })
})
