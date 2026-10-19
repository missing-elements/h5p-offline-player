import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import '../../src/h5p-offline-player'
import { MAJOR_VERSION, VERSION } from '../../src/shared/constants'
import { FIXTURES, createPlayer, frameFetch, play, waitForSettled } from './utils'

/**
 * The first load after a player update. Registering again with an unchanged script URL returns
 * the existing registration without fetching the script, so before the element checked, that load
 * booted against the old worker and the browser swapped the new one in about a second into the
 * boot. `/versioned/h5p-sw.js` is the real worker reporting whatever version the dev server is
 * told, at one URL, which is what an update looks like to the browser.
 */
const SW = '/versioned/h5p-sw.js'
const SCOPE = new URL('/versioned/h5p/', location.href).href

/** What `/versioned/h5p-sw.js` says it is from now on, and how late it is answered. */
const serveVersion = (version: string, delay = 0) => fetch(`/versioned/__version?v=${encodeURIComponent(version)}&delay=${delay}`)

/** The worker the scope runs brought to `version`, as an earlier visit would have left it. */
async function installVersion(version: string) {
  await serveVersion(version)
  // Registered here when no test before has, so that each test stands on its own.
  const registration = (await navigator.serviceWorker.getRegistration(SCOPE)) ?? (await navigator.serviceWorker.register(SW, { scope: SCOPE }))
  await registration.update()
  await activatedNewest(registration)
}

/** Resolves once nothing is installing or waiting in the scope. */
async function activatedNewest(registration: ServiceWorkerRegistration) {
  const worker = registration.installing ?? registration.waiting
  if (!worker) return
  await new Promise<void>((done) => worker.addEventListener('statechange', () => worker.state === 'activated' && done()))
}

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

  it('waits for the update however slow the script, when the worker running is of another major', async () => {
    // A worker of the major before cannot serve this element: from 0.10 to 1.0, a load that went
    // ahead with it after three seconds never left `indexing` (#49).
    await installVersion(`${MAJOR_VERSION - 1}.99.0`)
    await serveVersion('', 4_000)
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const started = performance.now()
    const player = await play(FIXTURES.basic, { sw: SW })

    expect(performance.now() - started).toBeGreaterThan(4_000)
    expect(await frameWorkerVersion(player)).toBe(VERSION)
  }, 60_000)

  it('holds a load that starts while the update is still on its way', async () => {
    // The element keeps its routes before it asks the worker's version, and a load that began
    // during the wait — a visitor choosing another package while the first still loads — took
    // them as kept and went ahead with the worker of the major before.
    await installVersion(`${MAJOR_VERSION - 1}.99.0`)
    await serveVersion('', 4_000)
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const player = createPlayer({ sw: SW })
    player.setAttribute('src', FIXTURES.basic)
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    const settled = waitForSettled(player)
    player.setAttribute('src', FIXTURES.streamed)

    const result = await settled
    if (!result.ok) expect.fail(`${result.detail.code} — ${result.detail.message}`)
    expect(await frameWorkerVersion(player)).toBe(VERSION)
  }, 60_000)

  it('goes ahead after three seconds within a major, where the worker running serves the element', async () => {
    const older = `${MAJOR_VERSION}.0.0-older`
    await installVersion(older)
    // Slower than the wait, by a margin the load cannot use up before it is ready.
    await serveVersion('', 8_000)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const player = await play(FIXTURES.basic, { sw: SW })

    expect(await frameWorkerVersion(player)).toBe(older)
    expect(warn.mock.calls.some(([line]) => String(line).includes(`Service Worker is ${older}`))).toBe(true)

    // The update it gave up waiting for still lands, and takes the frame over.
    const registration = (await navigator.serviceWorker.getRegistration(SCOPE))!
    if (!registration.installing && !registration.waiting) {
      await new Promise((found) => registration.addEventListener('updatefound', found, { once: true }))
    }
    await activatedNewest(registration)
    expect(await frameWorkerVersion(player)).toBe(VERSION)
  }, 60_000)
})
