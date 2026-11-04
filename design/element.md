# The element

The `<h5p-player>` element's side: what a load is, its worker's registration and upgrade, what it reports, its box and its height. The code: `packages/player/src/h5p-offline-player.ts`, `jobs-worker-handle.ts` and `shadow.css`.

## Invariants

- **What a load asked for is the load's, not the package's.** The `packages` row is keyed by
  `pkgId`, a hash of the source, and up to 2026-10-13 it also held what the last load asked for:
  `untrusted`, the language, the display options, the frame assets, `allow-origins` and the
  attached bundle. Two players of one URL — on one page, or in two tabs — both got whichever
  registered last. Found by the readiness check for the CMS plugins, measured: a player asked for
  French showed German, one asked for no action bar showed one, a trusted player was refused as
  untrusted, and an untrusted one was served the package's own code — a reader cached per package
  was dropped by the other player's `register` and reopened with its settings. Now the element
  makes a random key per load (`loadKey`) and registers with it; the worker keeps the record's
  settings under `views[key]` in the same row (`LoadSettings`), merged in one transaction
  (`changePackage`, which `updatePackage` and `touchPackage` go through too, so a write never
  drops another load's), the newest `KEPT_LOADS` (8) of them; and every route names the load,
  `<pkgId>-<key>` (`loadSegment`, `matchRoute`), so the frame document, every entry and the
  reader — keyed by the same segment — follow that load's settings, and `attach-libraries` and
  `index` carry it too. Random rather than a hash of the settings: two identical players would
  otherwise share a reader, and one reloading would detach the other's bundle between its
  `register` and its `attach`; and nothing outside a frame can name its key. What stays the
  package's: the source, the archive's cache, the title and metadata, `status`, the saved state
  (`resume`, by `pkgId`) and the Web Lock. A worker that knows keys answers `register` with
  `views`; an older one does not, and the element then uses the bare `pkgId` routes, whose
  settings are the row's own fields, still written by every `register` and read only for such a
  route — the same last-registration-wins as before, for an element or worker from before the fix.
  An unknown key is a 404, like an unknown package. `tests/browser/several-players.test.ts` races
  an untrusted and a trusted player, a French and a German one, and adds a trusted player beside
  a running untrusted one; on the code before, all of them failed.
- **The element says what it is playing: `source`, `metadata`, `libraryBundle`.** Added on
  2026-10-09 for the package check an embedding site shows under its preview: the probe's classification and
  size (`currentSource`, exposed as a copy), the manifest's metadata plus `mainLibrary` (new on
  the `indexed` reply, read off the reader), and which bundle supplied missing libraries with
  `fromCache` for the earlier-download fallback — the privacy line "nothing left this origin".
  All three ride on `ready`'s detail with `pkgId` and `revision`, and all are `null` again
  after `forgetPackage`. Deliberately not exposed: the index summary (deflated media, whether
  a video can stream), which the Service Worker alone has and would be a bigger change.
- **Clearing site data demolishes three things at once, all held by handles that still look
  valid.** The IndexedDB connection is force-closed, so `idb.ts` listens for `versionchange` and
  `close`, drops the cached handle, and retries a transaction once on `InvalidStateError` —
  otherwise every later call throws "the database connection is closing" for the rest of the
  worker's life. The Service Worker registration is unregistered, so `ensureWorker` re-checks it
  with `getRegistration` on every load instead of trusting its cached one; without that, the
  routes fall through to the origin, and a dev server or SPA host answers an unknown path with
  its own `index.html` — the frame then renders the host page inside itself, with no error
  anywhere. The registration found must be the one the element holds: another player on the page,
  or another tab, may have registered again first, and the one held has no worker once its last
  client has gone, so every load failed with `no-worker` until a reload (#57). The chunk store is
  emptied, which needs nothing: a cold package is the normal case.
- **The element waits for *its own* registration to reach `activated`**, not for
  `navigator.serviceWorker.ready` — that tracks the page's controller and may never resolve for a
  nested scope.
- **`navigator.serviceWorker` is read through `serviceWorkers()`, never directly by the element.**
  In a frame sandboxed without `allow-same-origin` the property is there and Chromium and WebKit
  throw a `SecurityError` on reading it (Firefox returns the container, whose `register` then
  fails). Read in `connectedCallback`, the throw stopped the element before its load began: no
  `error`, so the embed page never offered to open the package in its own tab (#57). Now it is
  `no-worker`.
- **The first load after an upgrade is brought to the element's version before the frame
  boots.** Registering again with an unchanged script URL returns the existing registration
  without fetching the script — measured in Chromium on 2026-10-04 — so that load booted against
  the old worker, and the frame's navigation, being in scope, made the browser fetch the new one
  and swap it in about a second into the boot, under a frame document the old version wrote:
  errors or an empty frame until a reload. `ensureCurrentWorker` asks the worker's version over
  the control channel, and on a difference calls `registration.update()` and waits for the new
  worker, all bounded by `WORKER_UPDATE_TIMEOUT_MS`; offline or past it, the load goes ahead with
  the worker it has. Same bytes after the update is a host's stale `h5p-sw.js`, still a warning.
  Going ahead is right within a major, whose older worker serves the element, and not across
  one, which it cannot: from 0.10 to 1.0, measured with the published files under the same URLs
  and `h5p-sw.js` answered after four seconds, the load went ahead with the 0.10 worker, the new
  one took over halfway through, and it stayed in `indexing` (#49). So for a worker of another
  major the wait is `WORKER_MAJOR_UPDATE_TIMEOUT_MS`, thirty seconds; the new worker's activation,
  which deletes the old major's caches, took about a second of it with four caches or 124. One
  setup at a time (`workerSetup`): the element keeps its routes before it asks the version, and a
  load that began during the wait — a visitor choosing another package while the first still
  loads — took them as kept and went ahead with the old worker; found reviewing the fix.
  `activated()` waits for the newest worker — installing, then waiting, then active — since a
  changed script URL (a bundler's hash) installs a new worker beside the old active one; that
  wait is bounded by the same timeout whenever an activated worker can serve, because a host's
  own worker that does not skip waiting sits in `waiting` until the old one's last client has
  closed, and a newest worker that turns redundant falls back to the one running. The version is
  asked again after the update rather than read off `installing`: with `skipWaiting` the new
  worker can be active before `update()` resolves. A later navigation in scope
  can still swap the worker under a frame mid-lesson; that is a restart within one version, which
  the stateless worker already survives. `tests/browser/worker-update.test.ts` serves the real
  worker at `/versioned/h5p-sw.js` with the version the dev server is told, so an update is one
  URL with new bytes, and fails on the element from before. The app at `/app/` mounts the
  handlers in its own worker, which deletes the old precache as it activates while the page still
  runs the old shell, so `app.js` offers a reload on a `controllerchange` once controlled.
- **A `need-file` request that times out leaves `pendingFiles`, not just its promise.** Left in
  the map, its settled promise answered every later call for the package and the page was never
  asked again — even once it had the file to give.
- **A runtime error after `ready` is an event, not a state.** Before `ready` it is the boot
  failing and the state goes to `error`; after it the content is up and, in practice, still
  working — H5P content types throw non-fatal exceptions routinely, on resize in particular —
  so the element reports it and leaves `ready` alone. A host that hides the player on `error`
  must not hide working content. The demo pages follow: the player page shows it as a note, the
  embed page only logs it.

## The element's own box

The shadow CSS is `src/shadow.css`, imported `?inline`: Vite hands it to the element as a string,
minified for the build, so the reasons behind the rules can sit beside them as CSS comments. Three
things about it that are easy to undo by accident:

- **The layout lives on an inner `.viewport` wrapper, not on `:host`.** Any rule in the host page
  that names the element — `h5p-player { display: block; height: 400px }`, the obvious thing to
  write — beats a `:host` rule whatever its specificity. Putting the flex column on `:host` looks
  right and collapses the frame to an iframe's intrinsic 150px the moment a host styles the
  element at all.
- **`.viewport` has both `height: 100%` and `min-height: inherit`.** The first covers a host given
  an explicit height, the second a host given only a `min-height`, where a percentage height
  resolves to auto.
- **`:host([hidden])` needs `!important`**, for the same cascade reason: a host's `display` beats
  the shadow tree's, and the UA `[hidden]` rule loses to both.
- **The styles are adopted (`adoptedStyleSheets`), not an inline `<style>`.** A host page with
  `style-src 'self'` blocks the inline element silently and the frame drops to 150px; the
  constructable sheet is CSSOM and passes. See the hosted-demo section.

H5P's fullscreen targets the frame, which the browser sizes itself — the iframe matches
`:fullscreen`, the host does not. `:host(:fullscreen)` is there for a host page calling
`requestFullscreen()` on the element, where auto-resize's inline height would otherwise pin it.

## Sizing

The element speaks H5P's own resizer protocol, the exchange `h5p-resizer.js` implements for a
site embedding h5p.org content. The frame sends `hello`, `prepareResize` and `resize` to
`window.parent` with `context: 'h5p'`; `onResizerMessage` answers them.

Following the reported height is the default (`autoResizes`), and the reason a host can turn it
off is the way it is applied: an inline `height` on the element, which beats any rule in the
host's stylesheet. A page that sizes the element from CSS, or as a flex or grid cell that should
scroll inside, sets `auto-resize="off"`; setting it removes the inline height the element wrote,
and nothing else, since a host's own inline height is not the element's to touch. The bare
attribute is accepted and means the default, so pages from before the change keep working.
`playback.test.ts` pins the default, the opt-out and the return to the default.

Answering `hello` is load-bearing. Until it is answered H5P leaves its document at full height
and never reports a content size — so a missing reply looks like "sizing does not work" rather
than like a failed handshake. On the reply it sets `body { height: auto; overflow: hidden }` and
starts reporting, which is what the handshake test asserts.

Sizes come from the resize events content types raise when they actually change. A
`ResizeObserver` on the frame would both miss those and fire on changes that are not resizes;
H5P also deliberately stays quiet when a resize would not change the height, so no event is not
the same as a broken exchange.

A font arriving is the one change no content raises a resize for, so the boot script raises it
(2026-10-18, #42). The frame's text faces load once text asks for them, and in Chrome H5P's
first measurement often ran before they had: on the demo's player page a Column of text played
after another package lost its bottom 47 px, its action bar, every time, and only a window
resize put it right; WebKit and Firefox had the face in time in the same runs. On each
`loading` of `document.fonts` the boot script waits for `ready` and two animation frames, then
triggers `resize` on every instance, which H5P measures and reports through the same exchange.
Not `loadingdone`, which WebKit never fires, and not `ready` alone, which WebKit resolves before
its layout has taken the face: both measured. `playback.test.ts` gives the fixture's text a face
three times the fallback's size once it loads, and fails in all three engines without this.

`externalEmbed: false` is the other native mode and is **not** usable here: it has the frame call
`window.parent.H5P.fullScreen(...)`, read `window.parent.H5P.isFullscreen` and forward xAPI
through `window.parent.H5P.externalDispatcher`. That assumes the embedding page is itself an H5P
page with core loaded — which is the arrangement this whole design exists to avoid.
