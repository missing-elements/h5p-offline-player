import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import '../../src/h5p-offline-player'
import { VERSION } from '../../src/shared/constants'
import { FIXTURES, frameFetch, play } from './utils'

/**
 * The first load after a player update. Registering again with an unchanged script URL returns
 * the existing registration without fetching the script, so before the element checked, that load
 * booted against the old worker and the browser swapped the new one in about a second into the
 * boot. `/versioned/h5p-sw.js` is the real worker reporting whatever version the dev server is
 * told, at one URL, which is what an update looks like to the browser.
 */
const SW = '/versioned/h5p-sw.js'
const SCOPE = new URL('/versioned/h5p/', location.href).href

const serveVersion = (version: string) => fetch(`/versioned/__version?v=${encodeURIComponent(version)}`)

/** The version the worker controlling the frame reports, over its own `_ping` route. */
async function frameWorkerVersion(player: Parameters<typeof frameFetch>[0]): Promise<string> {
  const response = await frameFetch(player, `${SCOPE}virtual/_ping`, { cache: 'no-store' })
  return ((await response.json()) as { version: string }).version
}

describe('a player update', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await serveVersion('')
    await (await navigator.serviceWorker.getRegistration(SCOPE))?.unregister()
  })

  it('plays on a host whose worker script is an older copy, and says so', async () => {
    await serveVersion('0.0.1')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const player = await play(FIXTURES.basic, { sw: SW })

    expect(await frameWorkerVersion(player)).toBe('0.0.1')
    expect(warn.mock.calls.some(([line]) => String(line).includes('Service Worker is 0.0.1'))).toBe(true)
  })

  it('updates the worker before the frame boots, and nothing replaces it afterwards', async () => {
    // The host deploys the new release: same URL, the element's own version.
    await serveVersion('')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const player = await play(FIXTURES.basic, { sw: SW })

    expect(await frameWorkerVersion(player)).toBe(VERSION)
    expect(warn.mock.calls.some(([line]) => String(line).includes('Service Worker is'))).toBe(false)

    // Before the check, the frame's own navigation found the new script and installed it now.
    const registration = await navigator.serviceWorker.getRegistration(SCOPE)
    let replaced = false
    registration?.addEventListener('updatefound', () => (replaced = true))
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    expect(replaced).toBe(false)
    expect(registration?.installing ?? registration?.waiting ?? null).toBeNull()
  })
})
