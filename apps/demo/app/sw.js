/**
 * The installable app's Service Worker, scope `/app/`. One worker does two jobs, in this order:
 *
 * 1. The player's routes. `mountH5P` answers `/app/h5p/…` — the virtual file server and the
 *    frame documents — and leaves every other request alone. This is the setup the player's
 *    guide describes for a host that allows one worker per origin, and here it is required, not
 *    chosen: the frame is a client of whichever worker serves it, so the frame's own requests for
 *    the runtime, its stylesheet and its fonts come to this worker, and only this worker can
 *    answer them from the precache when there is no network. A second worker beside ours would
 *    never see them.
 * 2. The app shell. Everything the app needs to start with no network — this page, its scripts
 *    and styles, the element, the runtime and the fonts — is cached on install and served from
 *    the cache first. The list is written in by `scripts/build-demo.mjs` from what the build
 *    produced; in dev it is empty, and everything goes to the dev server.
 *
 * `mountH5P` calls `skipWaiting` on install and `clients.claim` on activate, so a new version
 * takes over at once, and the page that was open picks up the new shell on its next load.
 */
import { configure } from '@zip.js/zip.js'
import { mountH5P } from '@missing-elements/h5p-offline-player/sw'

// A Service Worker cannot spawn a nested Worker, so zip.js has to inflate in place.
configure({ useWebWorkers: false })

mountH5P(self)

/* global __APP_PRECACHE__ */
const PRECACHE = __APP_PRECACHE__
const CACHE = `h5p-app-${PRECACHE.version}`
const SCOPE = new URL(self.registration.scope)
// The player's routes, which step 1 answers; its listener was added first and runs first.
const H5P_ROUTES = new URL('h5p/', SCOPE).href
const SHELL = SCOPE.pathname
const precached = new Set(PRECACHE.urls)

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // `reload` skips the HTTP cache: a revalidated copy from the last version must not be
      // precached under this one's name.
      await cache.addAll(PRECACHE.urls.map((url) => new Request(url, { cache: 'reload' })))
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Only this app's caches: the player's own, `h5p-pkg-…`, are its business.
      const names = await caches.keys()
      await Promise.all(names.filter((name) => name.startsWith('h5p-app-') && name !== CACHE).map((name) => caches.delete(name)))
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== SCOPE.origin || url.href.startsWith(H5P_ROUTES)) return

  // The app is one page, whatever its query: `?src=` is read by the page itself, and so is a
  // file the operating system hands over, which arrives as a navigation to the page.
  if (request.mode === 'navigate' && (url.pathname === SHELL || url.pathname === `${SHELL}index.html`)) {
    if (precached.has(SHELL)) event.respondWith(fromCache(SHELL, request))
    return
  }

  if (precached.has(url.pathname)) event.respondWith(fromCache(url.pathname, request))
})

/** The precached copy, or the network if the cache has lost it — site data cleared, say. */
async function fromCache(path, request) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(path)
  return hit ?? fetch(request)
}
