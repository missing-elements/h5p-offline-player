import { expect } from 'vitest'
import type { H5PPlayerElement, PlayerErrorDetail } from '../../src/h5p-offline-player'

/**
 * Test support for the browser suite. Every test here drives the real element against the real
 * Service Worker and the real fixtures: the parts worth testing — a synthesized frame document,
 * a `206` assembled out of cache chunks, a worker that survives its own restart — have no
 * meaningful behaviour outside a browser.
 */

export const FIXTURES = {
  basic: '/fixtures/basic.h5p',
  largeDeflated: '/fixtures/large-deflated.h5p',
  largeStored: '/fixtures/large-stored.h5p',
  /** A large deflated entry that does not compress, so its span is fetched in segments over HTTP. */
  segmented: '/fixtures/segmented.h5p',
  traversal: '/fixtures/traversal.h5p',
  notH5P: '/fixtures/not-h5p.h5p',
  corrupt: '/fixtures/corrupt.h5p',
  /** Every entry carrying a data descriptor, as a writer that streams — h5p.com's — lays them out. */
  streamed: '/fixtures/streamed.h5p',
  /** The same archives from a host that ignores `Range`, forcing the chunked adapter. */
  noRangeBasic: '/no-range/basic.h5p',
  noRangeLargeStored: '/no-range/large-stored.h5p',
  noRangeStreamed: '/no-range/streamed.h5p',
  /** A genuine 404. The dev server answers a missing `/fixtures/…` with its HTML fallback. */
  missing: '/no-range/missing.h5p',
  /** A URL that answers 200 with a page instead of an archive — a login wall, in the wild. */
  htmlInsteadOfArchive: '/fixtures/missing.h5p',
  /** Content with no libraries: what h5p.com and h5p.org hand you by default. */
  contentOnly: '/fixtures/content-only.h5p',
  /** The same, for a content type this repo can supply locally. */
  needsLibraries: '/fixtures/needs-libraries.h5p',
  /** Library folders and nothing else, to fill the gap in the one above. */
  libraries: '/fixtures/libraries.h5p',
  /** Library folders with no version suffix, the shape older packages use. */
  unversioned: '/fixtures/unversioned.h5p'
} as const

export function waitForEvent<T = unknown>(
  target: EventTarget,
  name: string,
  timeoutMs = 30_000
): Promise<CustomEvent<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      target.removeEventListener(name, onEvent)
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for "${name}"`))
    }, timeoutMs)

    const onEvent = (event: Event) => {
      clearTimeout(timer)
      target.removeEventListener(name, onEvent)
      resolve(event as CustomEvent<T>)
    }

    target.addEventListener(name, onEvent)
  })
}

/** Resolves on whichever of `ready` or `error` arrives first, so a failure reports its own code. */
export function waitForSettled(player: H5PPlayerElement, timeoutMs = 30_000): Promise<
  { ok: true } | { ok: false; detail: PlayerErrorDetail }
> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out after ${timeoutMs}ms; state was "${player.state}"`)),
      timeoutMs
    )

    const done = (result: { ok: true } | { ok: false; detail: PlayerErrorDetail }) => {
      clearTimeout(timer)
      player.removeEventListener('ready', onReady)
      player.removeEventListener('error', onError)
      resolve(result)
    }

    const onReady = () => done({ ok: true })
    const onError = (event: Event) =>
      done({ ok: false, detail: (event as CustomEvent<PlayerErrorDetail>).detail })

    player.addEventListener('ready', onReady)
    player.addEventListener('error', onError)
  })
}

export function createPlayer(attributes: Record<string, string> = {}): H5PPlayerElement {
  document.body.innerHTML = ''

  const player = document.createElement('h5p-player') as H5PPlayerElement
  player.style.height = '400px'
  for (const [name, value] of Object.entries(attributes)) {
    player.setAttribute(name, value)
  }
  document.body.append(player)

  return player
}

/** Mounts a player, waits for it to play, and fails the test with the player's own error if not. */
export async function play(src: string, attributes: Record<string, string> = {}) {
  const player = createPlayer(attributes)
  const settled = waitForSettled(player)
  player.setAttribute('src', src)

  const result = await settled
  if (!result.ok) {
    expect.fail(`${src} failed to play: ${result.detail.code} — ${result.detail.message}`)
  }

  return player
}

/** The document the runtime actually runs in, once the frame has booted. */
export function frameDocument(player: H5PPlayerElement): Document {
  const iframe = player.shadowRoot?.querySelector('iframe') as HTMLIFrameElement
  const doc = iframe?.contentDocument
  if (!doc) throw new Error('The frame has no document')
  return doc
}

export function frameWindow(player: H5PPlayerElement): Window {
  const iframe = player.shadowRoot?.querySelector('iframe') as HTMLIFrameElement
  const view = iframe?.contentWindow
  if (!view) throw new Error('The frame has no window')
  return view
}

/** Absolute URL of an entry on the virtual file server, for a direct fetch. */
export function virtualUrl(player: H5PPlayerElement, entry: string): string {
  return `${player.scope}virtual/${player.pkgId}/${entry}`
}

/** Drops every cached package, so a test that measures a cold load really gets one. */
export async function clearPackageCaches(): Promise<void> {
  const names = await caches.keys()
  await Promise.all(names.filter((name) => name.startsWith('h5p-pkg-')).map((name) => caches.delete(name)))
}

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 10_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await predicate()) return
    if (Date.now() >= deadline) throw new Error('Timed out waiting for a condition')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/**
 * Fetches through the frame, which is the client the Service Worker actually controls. The test
 * page itself sits outside the worker's scope — as a host page does — so a fetch made from here
 * would go to the network and 404.
 */
export function frameFetch(
  player: H5PPlayerElement,
  url: string,
  init?: RequestInit
): Promise<Response> {
  return (frameWindow(player) as Window & typeof globalThis).fetch(url, init)
}
