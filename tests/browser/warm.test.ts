import { describe, expect, it } from 'vitest'
import '../../src/h5p-offline-player'
import type { H5PPlayerElement, PlayerProgressDetail } from '../../src/h5p-offline-player'
import { cacheNameFor } from '../../src/shared/chunk-store'
import { FIXTURES, clearPackageCaches, createPlayer, waitForSettled } from './utils'

/**
 * Warming: on a host that honours `Range`, the runs of the archive that hold the libraries are
 * pulled into the cache before the frame boots, so the runtime's own requests are answered from
 * it. The fixture's five entries are one such run.
 */

function playWatching(src: string) {
  const player = createPlayer()
  const phases = new Set<string>()
  player.addEventListener('progress', (event: Event) => {
    phases.add((event as unknown as CustomEvent<PlayerProgressDetail>).detail.phase)
  })
  const settled = waitForSettled(player)
  player.setAttribute('src', src)
  return settled.then((result) => {
    expect(result).toEqual({ ok: true })
    return { player, phases }
  })
}

async function cacheKeys(player: H5PPlayerElement) {
  const cache = await caches.open(cacheNameFor(player.pkgId!))
  return (await cache.keys()).map((request) => request.url)
}

describe('warming the library spans', () => {
  it('pulls every small entry into the cache before the frame boots', async () => {
    await clearPackageCaches()
    const { player, phases } = await playWatching(FIXTURES.basic)

    expect(phases.has('warm')).toBe(true)
    const keys = await cacheKeys(player)
    expect(keys.some((url) => url.includes('__warm__'))).toBe(true)
    for (const name of [
      'h5p.json',
      'H5P.OfflineTest-1.0/library.json',
      'H5P.OfflineTest-1.0/offline-test.js',
      'H5P.OfflineTest-1.0/offline-test.css',
      'content/content.json'
    ]) {
      const encoded = name.split('/').map(encodeURIComponent).join('/')
      expect(keys.some((url) => url.includes(`/whole/${encoded}`))).toBe(true)
    }
  })

  it('finds the marker on the next load and does it again for nothing', async () => {
    // Warm from the load above: caches carry between tests.
    const { phases } = await playWatching(FIXTURES.basic)
    expect(phases.has('warm')).toBe(false)
  })

  it('is not done for a host that ignores Range, whose archive is local once downloaded', async () => {
    await clearPackageCaches()
    const { player, phases } = await playWatching(FIXTURES.noRangeBasic)

    expect(phases.has('warm')).toBe(false)
    expect((await cacheKeys(player)).some((url) => url.includes('__warm__'))).toBe(false)
  })
})
