import { expect, vi } from 'vitest'
import type { H5PPlayerElement, PlayerErrorDetail } from '../../src/h5p-offline-player'

/**
 * Test support for the browser suite. Every test here drives the real element against the real
 * Service Worker and the real fixtures: the parts worth testing — a synthesized frame document,
 * a `206` assembled out of cache chunks, a worker that survives its own restart — have no
 * meaningful behaviour outside a browser.
 */

export const FIXTURES = {
  basic: '/fixtures/basic.h5p',
  /** `basic.h5p` naming its language in `h5p.json`, German and English: H5P's own strings follow it. */
  german: '/fixtures/german.h5p',
  english: '/fixtures/english.h5p',
  /** The content type with an Answer button, reporting `answered`, and a child of itself as a part. */
  finished: '/fixtures/finished.h5p',
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
  /** From a host that honours `Range` but gzips the archive for a client that accepts it — GitHub Pages. */
  compressingBasic: '/compressing/basic.h5p',
  /**
   * From a host that can be taken away mid-transfer — `/stalling/__outage` starts an outage —
   * and paces the body, so a transfer is still under way when it begins.
   */
  stalling: '/stalling/segmented.h5p?rate=2097152',
  /** A genuine 404. The dev server answers a missing `/fixtures/…` with its HTML fallback. */
  missing: '/no-range/missing.h5p',
  /** A URL that answers 200 with a page instead of an archive — a login wall, in the wild. */
  htmlInsteadOfArchive: '/fixtures/html-page.h5p',
  /** Content with no libraries: what h5p.com and h5p.org hand you by default. */
  contentOnly: '/fixtures/content-only.h5p',
  /** The same, for a content type this repo can supply locally. */
  needsLibraries: '/fixtures/needs-libraries.h5p',
  /** Library folders and nothing else, to fill the gap in the one above. */
  libraries: '/fixtures/libraries.h5p',
  /** A whole package whose content type's library.json needs H5P.OfflineExtra, which only the bundle has. */
  needsDependency: '/fixtures/needs-dependency.h5p',
  needsDependencyNoRange: '/no-range/needs-dependency.h5p',
  /** Its own copy of the content type marks the frame when it runs, and `content/` has a file of each kind. */
  untrusted: '/fixtures/untrusted.h5p',
  /** The same from a host that ignores `Range`: booted from the forward index, with the bundle's folders. */
  noRangeUntrusted: '/no-range/untrusted.h5p',
  /** Content only, with markup and fields its semantics do not allow, at the top and in sub-content. */
  untrustedMarkup: '/fixtures/untrusted-markup.h5p',
  /** The fixture bundle without the content type's semantics, which an untrusted package cannot play without. */
  librariesWithoutSemantics: '/fixtures/libraries-without-semantics.h5p',
  /** Needs the content type at 1.3, which only it carries. */
  untrustedNewer: '/fixtures/untrusted-newer.h5p',
  /** The fixture content type at 1.2 and a sub-content type at 1.1, each with an `upgrades.js`. */
  upgradeLibraries: '/fixtures/upgrade-libraries.h5p',
  /** Stripped exports written for 1.0 (with sub-content at 1.0), 1.1 and 1.2, and one whose first step throws. */
  writtenFor10: '/fixtures/upgrade-1.0.h5p',
  writtenFor11: '/fixtures/upgrade-1.1.h5p',
  writtenFor12: '/fixtures/upgrade-1.2.h5p',
  upgradeFails: '/fixtures/upgrade-fails.h5p',
  /** Written for 1.3 with sub-content at 1.2: a minor ahead of every source here (#85). */
  writtenFor13: '/fixtures/upgrade-1.3.h5p',
  /** Written for 1.2, the version served, with sub-content at 1.2, a minor ahead of every source here. */
  newerChild: '/fixtures/newer-child.h5p',
  /** Library folders with no version suffix, the shape older packages use. */
  unversioned: '/fixtures/unversioned.h5p',
  unversionedPack: '/fixtures/unversioned-pack.h5p'
} as const

/**
 * The next `name` event on `target` — with `accept`, the next one whose detail it accepts, so a
 * test waits on the event it means rather than polling a list a listener fills.
 */
export function waitForEvent<T = unknown>(
  target: EventTarget,
  name: string,
  timeoutMs = 30_000,
  accept: (detail: T) => boolean = () => true
): Promise<CustomEvent<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      target.removeEventListener(name, onEvent)
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for "${name}"`))
    }, timeoutMs)

    const onEvent = (event: Event) => {
      if (!accept((event as CustomEvent<T>).detail)) return
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

/**
 * Mounts a player, gives it `src` and waits for the load to settle either way: the player and
 * the outcome, for a test about a load that is expected to fail or to be looked at before it is
 * judged. `prepare` runs between the mount and the `src`, for a listener that has to be in place
 * before the load starts.
 */
export async function settle(src: string, attributes: Record<string, string> = {}, prepare?: (player: H5PPlayerElement) => void, timeoutMs = 30_000) {
  const player = createPlayer(attributes)
  prepare?.(player)
  const settled = waitForSettled(player, timeoutMs)
  player.setAttribute('src', src)
  return { player, result: await settled }
}

/** Mounts a player, waits for it to play, and fails the test with the player's own error if not. */
export async function play(src: string, attributes: Record<string, string> = {}) {
  const { player, result } = await settle(src, attributes)
  if (!result.ok) {
    expect.fail(`${src} failed to play: ${result.detail.code} — ${result.detail.message}`)
  }
  return player
}

/** What the fixture content type wrote on screen: which package, or which copy of the type, drew it. */
export const messageOf = (player: H5PPlayerElement) => frameDocument(player).querySelector('.h5p-offline-test-message')?.textContent

/** Presses the fixture content type's Complete button, which sends a `completed` statement. */
export const pressComplete = (player: H5PPlayerElement) =>
  frameDocument(player).querySelector<HTMLButtonElement>('.h5p-offline-test-complete')!.click()

/**
 * Adds a script to the frame's document and says what became of it: `ran`, `refused` by the
 * browser (a type it will not run, a 404), or `blocked by the policy`. Every listener is taken
 * off on the first answer, so a violation for another URI in the meantime does not use up the
 * one for this script.
 */
export function inject(doc: Document, src: string): Promise<'ran' | 'refused' | 'blocked by the policy'> {
  return new Promise((resolve) => {
    const script = doc.createElement('script')
    const done = (outcome: 'ran' | 'refused' | 'blocked by the policy') => {
      doc.removeEventListener('securitypolicyviolation', onViolation)
      resolve(outcome)
    }
    const onViolation = (event: Event) => {
      if ((event as SecurityPolicyViolationEvent).blockedURI === src) done('blocked by the policy')
    }
    script.src = src
    script.onload = () => done('ran')
    script.onerror = () => done('refused')
    doc.addEventListener('securitypolicyviolation', onViolation)
    doc.body.append(script)
  })
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

/**
 * Absolute URL of an entry on the virtual file server, for a direct fetch: under the frame's own
 * load, `<pkgId>-<key>`, which is what the runtime's requests name, or the package id alone
 * before the frame has a document.
 */
export function virtualUrl(player: H5PPlayerElement, entry: string): string {
  const load = /\/frame\/([0-9a-f-]+)/.exec(frameWindow(player).location.pathname)?.[1] ?? player.pkgId
  return `${player.scope}virtual/${load}/${entry}`
}

/** Drops every cached package, so a test that measures a cold load really gets one. */
export async function clearPackageCaches(): Promise<void> {
  const names = await caches.keys()
  await Promise.all(names.filter((name) => name.startsWith('h5p-pkg-')).map((name) => caches.delete(name)))
}

/** Polls `predicate` until it holds: for a condition no event announces, such as a cache's contents. */
export async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  await vi.waitUntil(predicate, { timeout: timeoutMs, interval: 50 })
}

/** The URLs a spied `fetch` was asked for, as strings, whatever form each request came in. */
export const requestedUrls = (spy: { mock: { calls: unknown[][] } }): string[] =>
  spy.mock.calls.map(([input]) => String(input instanceof Request ? input.url : input))

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
