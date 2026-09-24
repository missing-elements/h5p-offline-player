/// <reference types="@vitest/browser-playwright" />
import { cdp } from 'vitest/browser'
import { afterEach, describe, expect, it } from 'vitest'
import '../../src/h5p-offline-player'
import type { PlayerErrorDetail } from '../../src/h5p-offline-player'
import { FAILURE_BACKOFF_MS } from '../../src/shared/constants'
import { busyPackages } from '../../src/shared/locks'
import {
  FIXTURES,
  clearPackageCaches,
  createPlayer,
  frameFetch,
  play,
  virtualUrl,
  waitFor,
  waitForSettled
} from '../browser/utils'

/**
 * The player against a browser that has no room left. The quota is the real one, capped through
 * the same DevTools override as "simulate custom storage quota", so the writes that fail are the
 * ones that would fail on a full disk — in the Service Worker and in the Jobs worker, where a
 * test page cannot reach. Its own Vitest project, because the override is per browser profile
 * and would otherwise land on whatever other test file happened to be running.
 */

const setQuota = (quotaSize?: number) =>
  cdp().send('Storage.overrideQuotaForOrigin', {
    origin: location.origin,
    ...(quotaSize === undefined ? {} : { quotaSize })
  })

const usage = async () => (await navigator.storage.estimate()).usage ?? 0

const MEDIA = 'content/media/big.bin'

describe('a browser with no storage to spare', () => {
  afterEach(async () => {
    await setQuota()
    await clearPackageCaches()
  })

  it('plays a package from a host with Range when the store refuses every write', async () => {
    // Once with room, so the worker is registered and the package's row exists.
    await play(FIXTURES.basic)
    await clearPackageCaches()
    // Below anything the origin already holds: from here every write is refused.
    await setQuota(1)

    const player = await play(FIXTURES.basic)

    // It played, and nothing of it was stored: every entry was served straight from the archive.
    const own = (await caches.keys()).filter((name) => name.endsWith(player.pkgId!))
    for (const name of own) {
      const keys = await (await caches.open(name)).keys()
      expect(keys.filter((request) => request.url.includes('/whole/'))).toEqual([])
    }
  })

  it('keeps the content up when a large entry does not fit, says so with the numbers, and tries again once space is back', { timeout: 40_000 }, async () => {
    await clearPackageCaches()
    // Room for the libraries, not for a 20 MB extraction.
    await setQuota((await usage()) + 512 * 1024)

    const player = createPlayer()
    const errors: PlayerErrorDetail[] = []
    player.addEventListener('error', (event) => {
      errors.push((event as unknown as CustomEvent<PlayerErrorDetail>).detail)
    })
    const settled = waitForSettled(player)
    player.setAttribute('src', FIXTURES.largeDeflated)
    await settled

    // The runtime asks for the media on its own; the extraction fails and is reported without
    // taking the player down.
    await waitFor(() => errors.some((detail) => detail.code === 'quota'), 30_000)
    await waitFor(() => player.state === 'ready')
    const failure = errors.find((detail) => detail.code === 'quota')!
    expect(failure.message).toContain(MEDIA)
    expect(failure.message).toContain('needs 20 MB')
    expect(failure.message).toMatch(/using .* of the .* the browser allows it/)

    // A request for the entry is answered with the failure at once, not after a stall.
    const started = performance.now()
    const response = await frameFetch(player, virtualUrl(player, MEDIA), { headers: { Range: 'bytes=0-1023' } })
    expect(response.status).toBe(507)
    expect(await response.text()).toContain('Not enough storage')
    expect(performance.now() - started).toBeLessThan(5_000)

    // Space comes back — here the cap is lifted — and once the failure has aged past the backoff
    // the entry is extracted after all.
    await setQuota()
    await new Promise((resolve) => setTimeout(resolve, FAILURE_BACKOFF_MS + 500))
    const recovered = await frameFetch(player, virtualUrl(player, MEDIA), { headers: { Range: 'bytes=0-1023' } })
    expect([200, 206]).toContain(recovered.status)
    expect((await recovered.arrayBuffer()).byteLength).toBe(1024)
  })

  it('reports a download that does not fit with the size and the reason', async () => {
    await clearPackageCaches()
    await setQuota((await usage()) + 512 * 1024)

    const player = createPlayer()
    const settled = waitForSettled(player)
    player.setAttribute('src', FIXTURES.noRangeLargeStored)
    const result = await settled

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.detail.code).toBe('quota')
    expect(result.detail.message).toContain('needs 20 MB')
    expect(result.detail.message).toContain('partial downloads')
    expect(player.state).toBe('error')

    // A package that failed to load is not loaded: its lock is gone, so it can be evicted.
    await waitFor(async () => !(await busyPackages()).has(player.pkgId!))
  })
})
