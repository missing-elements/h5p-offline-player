# AGENTS.md

Working notes for this repository. Read `h5p-offline-player-architecture.md` first — it is the
design, and it is the authority when this file and the code disagree. `h5p-player-setup.md` is
the guide written for people integrating the package.

## What this is

A browser-only H5P player, shipped as one web component. It plays an arbitrary `.h5p` archive
fetched from a URL or picked from disk, with no server-side code and no extraction step: the zip
is read in place and a Service Worker serves its entries to the H5P runtime over a virtual file
server.

The hard constraints that shape every file here:

- **Static hosting only.** No proxy, no backend, no build step required of the host.
- **Every large transfer streams.** Nothing is buffered whole. The one deliberate exception is
  the segment window used to fetch a large span over several connections, which holds up to
  16 MB — see `segmentedStream`.
- **No long work in the Service Worker.** Browsers kill a worker event after a few minutes
  (Safari sooner) and a killed inflate cannot resume, so downloads and extractions run in a
  page-side dedicated worker that lives as long as the tab.
- **Archives are untrusted.** Any compression method, any size, any entry name, possibly hostile.

## Layout

```
src/
  h5p-offline-player.ts   the <h5p-player> custom element — the only public entry point
  shared/                 code that runs in all three contexts (page, Service Worker, Jobs worker)
    constants.ts          sizes, timeouts, cache names, the version stamp
    protocol.ts           every message shape and the PackageRecord written to IndexedDB
    source.ts             probe + the three source adapters; imports no zip.js, so the element stays small
    source-reader.ts      the zip.js reader bridge and the segmented fetch behind it
    chunk-store.ts        Cache API: whole entries, chunked entries, watermarks, eviction
    idb.ts                the `packages` table
    entry-names.ts        entry-name normalisation — the security boundary for hostile archives
    range.ts, mime.ts, pkg-id.ts
  sw/
    sw-entry.ts           standalone worker  -> dist/h5p-sw.js
    mount.ts              mountH5P(self)     -> dist/h5p-sw-mount.js; the virtual file server
    package-reader.ts     zip index + per-entry serving strategy
    frame-document.ts     the frame HTML the worker synthesizes, and its CSP
    frame-boot.ts         the script that runs inside that frame; built to a string, never imported
    watermark-wait.ts     the stall-bounded wait for an entry's bytes, and what counts as progress
    routes.ts             URL shape of the virtual routes
    stream-utils.ts
  jobs/
    jobs-worker.ts        downloads, extractions and warming; the only long-running code
    job-queue.ts          the order extractions run in: one at a time, demand first, promotion on a repeat
    chunk-writer.ts       a WritableStream that lands bytes in the chunk store and publishes a watermark
    warm.ts               walks the library spans off one ranged request each and caches their entries
scripts/                  sync-h5p-assets, build-workers, copy-frame-assets, build-fixtures,
                          normalize-h5p (the package rewriter; scripts/lib/ holds its zip writer,
                          mp4 remux and policy); scripts/lib/frame-boot-plugin.mjs builds the
                          frame's boot script for esbuild and Vite alike
demo/ + index.html        the hosted player page; demo/index.html is the examples index,
                          demo/setup.html the setup page for integrators, the rest are the
                          individual embedding demos, all sharing demo/player-page.css
embed.html                the embeddable page, /embed: the element alone, driven by the query
                          string (demo/embed-page.js); demo/embed.html is the site that embeds it
demo/content/             the packages the demo plays, committed; built from demo/content/src/ by
                          scripts/build-demo-content.mjs
api/no-range.js           the Vercel function that stands in for a host without Range on the demo
vite.plugins.ts           the dev, preview and build plugins both Vite configs share
vite.demo.config.ts       the hosted demo: the pages plus dist/'s layout at the site root -> dist-demo/
vercel.json               the deployment: build command, the /no-range rewrite, caching and security headers
tests/unit/               pure logic, node environment
tests/browser/            the real element against the real worker, chromium via vitest browser mode
tests/fixtures/src/       the source of the generated .h5p archives
```

## Commands

```bash
npm install            # .npmrc sets ignore-scripts: h5p-standalone has an `only-allow yarn` guard
npx playwright install chromium   # once, for the browser tests

npm run dev            # vendors assets, builds fixtures, serves the demo on :5173
npm test               # unit + browser
npm run test:unit      # fast, no browser
npm run test:browser
npm run typecheck      # tsc -b plus the tests project
npm run build          # types, element, both workers, frame assets
npm run normalize -- course.h5p   # rewrite a package so it streams: media stored, mp4 index first
npm run build:demo     # the hosted demo into dist-demo/, what Vercel runs
npm run demo:content   # rebuild demo/content/*.h5p from their sources; needs the H5P hub
npm run demo:og        # re-render the social card, demo/og-image.png
npm run preview:demo   # serves dist-demo/ with the production headers and the /no-range route
```

`npm run test:browser` runs two browser projects: `browser`, the suite, and `browser-emulated`,
the tests that emulate a browser condition through CDP — a storage cap, a slow link. Those get a
browser of their own, one file at a time, because the emulation is per browser profile and would
otherwise land on whatever other file was running.

`npm publish` runs `prepublishOnly` — typecheck, the unit suite and the build — so a broken tree
cannot ship; the browser suite is left out because it needs an installed Chromium.

`npm run dev` and `npm test` both run `prepare:dev` first, which vendors the h5p-standalone
runtime into `public/frame-assets/` and builds the fixtures into `public/fixtures/`. Neither
directory is in git; both are reproducible.

Use Node 22 LTS or 24 LTS. Vitest's `engines` covers `^22.12 || ^24 || >=26`, so an odd-numbered
release such as Node 23 prints an `EBADENGINE` warning on install. It is only a warning — the
suite runs — but it is not worth chasing, and no patched Vitest accepts Node 23. The package's
own `engines` stays at `>=20`: that is what the build scripts need, and nothing in `dist` runs on
Node at all.

The browser provider is a package, not a name: `provider: playwright()` from
`@vitest/browser-playwright`. Vitest 4 moved providers out of the core package, so a bare
`provider: 'playwright'` string silently stops being valid.

## The three contexts

Most bugs here come from forgetting which context a line runs in.

| Context | Lives as long as | Can | Cannot |
|---|---|---|---|
| Page (element) | The tab | Hold the `File`, own the Jobs worker, emit DOM events | Touch package bytes |
| Service Worker | One event, unpredictably | Serve requests, read IndexedDB and the chunk store | Run long work, spawn a Worker, hold state across events |
| Jobs worker | The tab | Download, inflate, take Web Locks | Intercept requests, reach the DOM |

The Service Worker is **stateless by assumption**. Any handler may be the first one after a
restart, so it rebuilds readers from the `packages` table on demand. When it needs something only
a page can do, it messages the frame client (`event.clientId`), the frame relays to its parent
element, and the element acts. That relay is why `frame-document.ts` has a `message` listener.

## Invariants worth knowing before changing anything

- **Entry names are rejected, never sanitised.** `normalizeEntryName` returns `null` for anything
  that cannot be a plain relative path. Stripping `..` would let `content/../h5p.json` shadow a
  real entry. zip.js is called with `filenameValidation: 'tolerant'` on purpose: its own check
  refuses the *whole archive* over one bad name, and we want per-entry rejection so a legitimate
  package with one hostile path still plays.
- **The traversal check that matters is the one on archive names, not on request paths.** A URL
  can never carry `..` to the worker — the URL parser collapses `..` and `%2e%2e` alike before
  the request is made. `normalizeRequestPath` still decodes before validating, as defence in
  depth, but the attack it is named for arrives through the central directory.
- **The watermark is always a prefix.** Chunks are written in order, so a reader can serve
  anything below `meta.available` without checking which chunks exist. Do not write chunks out of
  order.
- **A resumed write must start on a chunk boundary.** `createChunkWriter` asserts this. Partial
  chunks are rewritten as they fill, with a doubling interval — a fixed interval is O(n²) in
  bytes rewritten.
- **`SourceReader` overrides `createReadable`.** Without it zip.js falls back to walking an entry
  through `readUint8Array` in 64 kB steps. Over a picked `File` each step is a free `slice()`;
  over HTTP each one is a request, and a 218 MB video meant roughly 3,500 round trips to the
  origin — slow enough to look like a hang and enough to get throttled. One ranged request covers
  the span. This is the main reason a large package behaved completely differently from disk and
  from a URL.
- **A large span over HTTP is then pulled by several connections at once.** One request per span
  is necessary but not sufficient: plenty of hosts cap a single connection well below the link.
  `segmentedStream` runs `SEGMENT_CONCURRENCY` ranged requests of `SEGMENT_SIZE` and emits them in
  order — download parallel, inflate serial, because a deflate stream has to be fed from the
  front. Measured against a server capping each connection at 4 MB/s, a 42 MB entry went from
  10.7 s to 3.1 s. Against one real host the gain was 1.28x, because that link was already near
  its own ceiling, so expect anything between the two and nothing at all when the bottleneck is
  the last mile. Before reaching for something cleverer, measure which of the two limits you are
  against: `curl -o /dev/null -w '%{speed_download}'` on one connection versus four parallel
  ranges settles it in seconds.
  A rolling window, not "split the span into N parts": splitting a 230 MB span four ways would
  leave three 57 MB quarters in memory waiting their turn. The window keeps at most
  `SEGMENT_CONCURRENCY * SEGMENT_SIZE` — 16 MB — outstanding for a span of any size, which is a
  deliberate loosening of the one-chunk-in-memory rule and the reason the segment is 4 MB rather
  than the 8 MB used elsewhere. It applies only to `range-http`: a picked file and an archive
  already in the chunk store are local reads, where splitting costs buffering and buys nothing.
  **The first segment streams, and the others open only once it flows.** Handing a segment over
  whole meant the inflate saw nothing until 4 MB had landed, and on a link that is itself the
  limit the four connections shared it, so the first byte of output waited for roughly 16 MB of
  transfer. Measured with a 40 MB deflated video at 4 Mbit/s: 34 s to the first extracted byte,
  past the stall bound, so the media request got a 503 for a job that was perfectly healthy; a
  real 93 MB package from a host with half-second latency took 8.6 s on a fast link. `Segment`
  keeps a request's bytes as they arrive and the consumer follows it live when its turn comes,
  and the window fills only after the first byte, which costs a per-connection-capped host one
  round trip and nothing else. Same 40 MB at 4 Mbit/s now: first byte in under two seconds.
- **Waiting on the watermark is bounded by a stall, not by a wall clock.** Inflating a few hundred
  megabytes over a network legitimately takes minutes, and a request for the *tail* of such an
  entry cannot be answered until it finishes: an mp4 whose `moov` index sits at the end — common,
  since faststart is not the default — is undecodable until then, and extraction only runs
  forward. So a range beginning past the watermark is answered in full with a body that follows
  the extraction, and a request with no `Range` header gets a `200` of the true length the same
  way. Only a watermark that stops moving, twice, gives up — and **input counts as movement**:
  the Jobs worker announces the bytes it has taken from the network every `INPUT_LIVENESS_MS`
  on the watermark channel (`announceActivity`, nothing written), and `waitForWatermark` resets
  its stall clock on them, so a slow or erratic host cannot make a live job look dead before its
  first flush. The first flush itself is 256 kB, not 1 MB, for the same reason: it is what the
  opening probe and the bound both wait on.
- **Some video cannot be streamed at all, and `preload` is the only lever.** Progressive serving
  assumes the player can use the front of a file. Two package properties together break that: the
  mp4 is deflated in the zip, so no `Range` reaches a byte without the whole stream before it, and
  the mp4 is not faststart, so its `moov` index is the last few kilobytes and nothing decodes
  until the final byte. A real example measured here — a 237 MB package from sodix.de — has both:
  a 220 MB mp4 deflated at ratio 0.991 (the packager compressed an already-compressed file for a
  0.9% saving) whose `moov` sits behind a 230 MB `mdat`. Three escape routes were probed near the
  end of that stream and none opened: the last 2 MB hold no chain of stored blocks to skip
  through, there are no `00 00 FF FF` markers at head, middle or tail, and so nothing offers pako
  or zlib a byte-aligned boundary to re-enter at. Read that scan for no more than it says: `00 00
  FF FF` is an *empty* stored block, so its absence proves only that the compressor never called
  `Z_SYNC_FLUSH`, and an ordinary stored block is marked by `BTYPE=00` in a 3-bit header that can
  only be found by walking the chain from the start. It is not evidence that the whole stream is
  Huffman-coded, and it does not need to be: every compressed byte crosses the network either
  way, which is the thing that actually costs. Inflation is not the cost either — native `DecompressionStream` runs at 625 MB/s,
  so 220 MB inflates in under a second against roughly two minutes of network. The wait is the
  transfer, it is genuinely required, and the only thing left is to start it earlier. That is what
  `preload="auto"` does. What remains theoretically possible is deflate resynchronisation —
  brute-force a block boundary near the end, decode forward, discard the first 32 kB as
  window-contaminated, recover `moov`, and serve a synthesized faststart file — which needs a
  hand-written bit-level inflate and is not worth it for one badly built zip. The other cost of a deflated
  video — the whole of it is pulled once anything touches it, watched or not — has a design and
  no code yet: demand-paced extraction, under *Not built yet*.
- **Prefetch waits for `ready`, runs one entry at a time, and is off by default.** Not at index
  time: those bytes would compete with the archive reads that boot the runtime and make the player
  itself slower to appear. Not in parallel: two concurrent extractions just halve the rate of
  whichever video the learner reaches first. Archive order rather than largest first, because the
  order a packager wrote entries in tracks the order content uses them better than size does. Off
  by default because it spends a learner's bandwidth on media they may never reach — the same
  reasoning that keeps `libraries` off. `PackageReader.prefetchable()` names the candidates and
  they ride back on the `indexed` reply, so no extra round trip.
- **The cache is never the authority on size.** An entry's real size comes from the zip central
  directory, so the virtual server can answer with the correct total length while only a prefix
  exists. That is what lets a cold video start playing.
- **A package is refused at index time if it does not carry its own libraries.** `h5p.json`
  declares `preloadedDependencies`; each one must appear as `<name>-<major>.<minor>/library.json`
  or `<name>/library.json`. This is not a nicety: exports from h5p.com and h5p.org routinely
  contain nothing but `h5p.json` and `content/`, because the site they came from already has the
  libraries. Without the check, h5p-standalone asks for `<MainLibrary>/library.json`, takes the
  404 as "these folders are unversioned", asks again without the version, takes a second 404 and
  fails with nothing anyone can act on. `findMissingLibraries` is pure and unit-tested; the
  end-to-end case is the `content-only.h5p` fixture.
- **A package may be served from more than one archive.** `PackageReader.get()` returns a
  `LocatedEntry` — the entry *and* the reader it came from — because `libraries` can attach a
  second archive to fill the gaps in a stripped export. Extracted bytes are cached against the
  owning archive's `pkgId`, not the package being played, so one library bundle is inflated once
  and shared by every package that uses it. Two consequences worth remembering: a job is always
  addressed at the archive that owns the entry, and a bundle registered with `role: 'libraries'`
  is never held to its own manifest.
- **When a bundle is attached, `h5p.json` is synthesized, not served.** A content-only export
  strips `preloadedDependencies` down to the main library as well as dropping the folders, so the
  runtime would load Interactive Video and none of the interaction types inside it — "Unable to
  find constructor for: H5P.Text". `mergedManifest()` unions the two dependency lists and keeps
  only entries whose folder is actually reachable, with the content's own version winning.
- **A library bundle is downloaded, never range-read.** It is read exhaustively — every library's
  JSON, scripts and styles — so the element registers it as `chunked` even when the host honours
  `Range`. Against the real H5P hub this was the difference between 76 and 7 seconds.
- **A 404 from the virtual server is load-bearing.** h5p-standalone probes `library.json` under
  both the versioned and unversioned folder names and picks whichever answers.
- **The frame uses `embedType: 'div'`.** With the default `iframe` type, H5P core creates an inner
  `about:blank` frame, and whether that child inherits the Service Worker controller differs
  between browsers.
- **The frame's `<html>` carries `class="h5p-iframe"`.** Seven rules in the core stylesheet are
  keyed on `html.h5p-iframe`: the base sans-serif font, the content's 16px/1.5 type, full width,
  the fullscreen heights. In a normal install H5P writes that class onto the `<html>` of the
  iframe it creates; div embedding puts it on a `<div>`, where none of those selectors can match
  and the content renders unstyled in the browser's default serif. This document *is* the H5P
  document, so it carries the class. Two things follow: `html` and `body` are then 100% tall, so
  auto-resize measures `#h5p-root` rather than `documentElement.scrollHeight` — the latter can
  never report less than the frame — and the inline frame CSS must not fight the core rules.
- **Every response needs a `Content-Type`.** A zip records none. Browsers ignore a stylesheet that
  is not `text/css`, and Safari refuses media served as `application/octet-stream`.
- **The frame CSP's runtime allowlist is written without schemes.** `RUNTIME_ALLOWLIST` in
  `frame-document.ts` names the origins real content types reach at runtime — a MathJax CDN, and
  Google's WebFont loader plus the two Google Fonts origins it pulls in turn. A scheme-less
  host-source is matched against the page's own scheme, so an https frame accepts only https
  while `http://localhost` also accepts http. That is not cosmetic: pre-2022 H5P.ArithmeticQuiz
  builds its loader URL with `('https:' == document.location.protocol ? 'https' : 'http')`, so a
  `https://`-pinned entry blocks it during local development. When a content type is blocked, the
  console names the directive and the origin — add it here, to the right directive, and remember
  that one feature often spans three (script, style, font). The list covers what H5P itself
  loads: MathJax, Google's WebFont loader, and the YouTube, Vimeo and Panopto player APIs that
  H5P.Video puts in the document before embedding a player (`frame-src *` covers the embed, not
  the script that creates it). A host that only some deployments use — a tenant's Panopto server
  — belongs in the host's `allow-origins` attribute instead, which appends host-sources and drops
  anything that is not plainly a host, so a value cannot append directives of its own.
- **Clearing site data demolishes three things at once, all held by handles that still look
  valid.** The IndexedDB connection is force-closed, so `idb.ts` listens for `versionchange` and
  `close`, drops the cached handle, and retries a transaction once on `InvalidStateError` —
  otherwise every later call throws "the database connection is closing" for the rest of the
  worker's life. The Service Worker registration is unregistered, so `ensureWorker` re-checks it
  with `getRegistration` on every load instead of trusting its cached one; without that, the
  routes fall through to the origin, and a dev server or SPA host answers an unknown path with
  its own `index.html` — the frame then renders the host page inside itself, with no error
  anywhere. The chunk store is emptied, which needs nothing: a cold package is the normal case.
- **The element waits for *its own* registration to reach `activated`**, not for
  `navigator.serviceWorker.ready` — that tracks the page's controller and may never resolve for a
  nested scope.
- **Job requests are deduplicated for two seconds, not for the whole wait.** A job can die with
  the tab that owned it; a long window would leave the entry unserved until it expired. The real
  deduplication is the Jobs worker's in-flight map plus a Web Lock. `waitForWatermark` re-asks
  when the watermark has not moved for `JOB_STALL_MS`.

- **The chunk writer's `abort` publishes nothing.** Everything that reached the store is already
  recorded by the `publish` that followed its write; bytes still in the partial buffer were never
  stored. Publishing `written` on abort — which it once did — put the watermark past the data,
  and a reader that trusted it got a short body.
- **An aborted job gives up its `inFlight` key at once, not when the abort finishes.** The
  teardown takes several tasks, and a second press of Play posts `abort` and `download` back to
  back; a key still held by the dying job made the new request look like a duplicate, and nothing
  ever answered it. The `finally` deletes only its own entry for the same reason.
- **A `need-file` request that times out leaves `pendingFiles`, not just its promise.** Left in
  the map, its settled promise answered every later call for the package and the page was never
  asked again — even once it had the file to give.
- **`RangeHttpHandle.read` slices a `200` body as it flows, like `stream` always did.** A host
  classified `range-http` answered `206` once, which is not a promise it always will; buffering a
  whole-archive `200` to take a slice held the whole file, and under `segmentedStream` four of
  them at once.

- **The archive's size never comes from a plain `GET`.** When a host does not expose
  `Content-Range`, the probe measures the archive with `Range: bytes=0-` and reads `Content-Length`
  off the `206`, and the Jobs worker's download trusts that size over the `Content-Length` of its
  own plain `GET`. A host that compresses the archive on the way out — GitHub Pages gzips
  `application/octet-stream` — answers a plain `GET` with the gzipped copy's length, and
  `Content-Encoding` is not readable cross-origin either, so nothing marks the number as wrong: an
  84.6 MB package measured 84.4 MB, and zip.js searched for the end of the central directory
  275 kB short of it — "Could not read the archive index" within a second. Chromium, Firefox and
  WebKit all send `Accept-Encoding: identity` on any request carrying a `Range` header, which is
  also why the ranged reads themselves were right all along. A suffix range (`bytes=-22`, the
  end-of-central-directory record without knowing the size) is not an alternative: it is not a
  simple range in the Fetch spec's sense, so it triggers a preflight that a static host does not
  answer, and the fetch fails. `/compressing/<fixture>` on the dev server is that host, gzip
  applied to ranges too when the request accepts it; `tests/browser/compressing-host.test.ts`
  pins the browser behaviour the probe depends on, and `tests/unit/source-probe.test.ts` covers
  the fallback with CORS-filtered headers.
- **On a host that honours `Range`, the libraries are pulled whole before the frame boots.** The
  runtime reads them exhaustively at boot — every `library.json`, script and stylesheet — and an
  inline entry read on demand costs two ranged requests, the 30-byte local header and then the
  data. Measured against a real host (nginx in front of a store, `stream.dev.mkis.fwu.de`): a
  90 MB package with 53 libraries took 136 s to `ready`, 128 of them in 156 requests for 0.54 MB,
  because that host answers one client's requests roughly one at a time — eight small ranges
  fired together took 4.8 to 14 s each, the same eight in sequence 0.5 to 0.7 s. Its non-media
  entries lay in two runs, 3.85 MB and 0.16 MB, which one request each pulled in 6.5 s and 1.0 s.
  So `PackageReader.warmSpans()` names those runs — small inline entries that are not media,
  coalesced across gaps of at most `WARM_GAP`, a span kept only if it holds something the boot
  reads, the total capped at `WARM_MAX_BYTES` — and they ride back on the `indexed` reply; the
  element hands them to the Jobs worker as a `warm` job and boots the frame when it is done.
  `warm.ts` walks each span by the offsets the central directory gave, inflates each entry and
  `putWhole`s it, then writes a marker under `WARM_ENTRY` so the next load skips it. The spans
  travel in the reply rather than being recomputed in the Jobs worker because that worker's own
  reader would cost another round of index requests — five seconds on that host. Three rules:
  it never fails a load (no room, a stalled span, a header that is not where the index said —
  the frame boots against whatever landed, and the virtual server serves the rest on demand);
  only a warm that landed everything writes the marker; and it runs for `range-http` only, since
  a picked file and a downloaded archive are local reads. `tests/unit/warm.test.ts` builds a real
  archive with a video between two library folders and checks the split, the walk and the marker;
  `tests/browser/warm.test.ts` checks the phase, the cache and the skip on a second load.
- **Extractions run one at a time, and the order is the policy.** A runtime asks for every
  video it instantiates at boot, not only the one on screen: an Interactive Book from sodix.de
  with six deflated videos (4.6 to 57.8 MB, none faststart) kept two `<video>` elements attached
  and still requested all six within the first second — H5P.Video creates a media element per
  chapter, and a detached one loads its header all the same. Three extractions and three inline
  inflates then shared 1.27 MB/s, and the first chapter's 21 MB video, which plays nothing until
  its last byte because its `moov` is at the end, finished at 26 s instead of the 16 s it takes
  alone. So the Jobs worker runs extractions through `JobQueue`: a demand — the virtual server's
  `need-job` — queues behind earlier demands and ahead of every prefetch; a repeated demand for a
  queued entry moves it to the front, which the server's two-second dedupe keeps the boot burst
  from doing to itself while a learner opening a later chapter is heard at once; a prefetch
  (`extract` with `prefetch: true`, which is how `advancePrefetch` posts) goes to the back and
  promotes nothing. The running job is never interrupted, since a deflate stream cannot resume.
  Two things keep a queued entry's waiters honest: the Jobs worker announces it as `queued` on the
  watermark channel every `INPUT_LIVENESS_MS`, which `waitForWatermark` counts as alive, and
  `serveChunked` answers a queued entry at once with its headers and a body that follows, rather
  than holding the request open until the first flush — behind a long queue that could be
  minutes, longer than a fetch event may stay unanswered. Downloads and warming are not queued;
  both happen before the frame boots. `job-queue.test.ts` pins the order, `jobs-worker.test.ts`
  drives three extractions through the real worker and checks they never overlap.
- **Media is held to a lower inline bar than everything else.** `INLINE_MAX_SIZE` is 16 MB, and an
  inline entry is copied whole before its first byte is served; a media element wants the head
  first and the rest by ranges. So `chooseStrategy` puts media over `MEDIA_INLINE_MAX_SIZE`
  (1 MB) on the slice path when stored and the chunked path when deflated, where the head is
  served on demand and a deflated one takes its turn in the queue. Before this, the same book's
  three smaller videos, 5 to 10 MB each, were inflated whole by the Service Worker on their
  probes, in parallel with the three extractions, for chapters nobody had opened.
- **An inline entry is inflated once per burst.** `cacheInline` keeps a per-instance map of
  writes in flight; concurrent requests for the same cold file join the first one instead of each
  inflating and racing on the same `cache.put`. The map dies with the worker, which only costs
  the dedupe.
- **The frame posts to `location.origin`, and the element checks `event.origin`.** Both sides are
  same-origin by construction, so nothing legitimate is lost — but `pkgId` is a hash of the URL,
  so frame URLs are guessable, and a wildcard would hand every xAPI statement to any third-party
  page that framed one. Not `frame-ancestors 'self'`: that checks every ancestor, and Setup C puts
  a third-party page at the top of the chain on purpose. It would also be silently ignored in a
  `<meta>` policy, which is where the frame's CSP lives.
- **A chunk streams out of the cache; it is not materialised.** `readRange` pipes each chunk's
  body through, slicing a partial one as it flows, so the 64 kB a media element probes with costs
  64 kB rather than the 8 MB chunk around it.
- **The watermark is announced, not only polled.** `setMeta` posts each write on a
  `BroadcastChannel`; `waitForWatermark` wakes on the notice and polls at `WATERMARK_POLL_MS`
  only as the fallback that catches a dead job. Two channel objects, because a channel never
  hears itself — which is also what lets the unit test hear it.
- **The Jobs worker keeps one reader per package.** The central directory does not change, and
  re-reading it per extraction was a round of ranged requests per job for an answer it had.
- **Bulk fetches are `cache: 'no-store'`.** The chunk store is the cache; a second copy in the
  browser's HTTP cache doubled the storage for nothing.
- **An unknown `pkgId` is a 404 on every route.** `UnknownPackageError` is what `openReader`
  throws for a package the table does not know, and `handleFetch` maps it before the generic
  `bad-archive` → 422.
- **Eviction empties a cache before it deletes it.** In Chromium `caches.delete()` frees nothing
  the write that triggered it can use: the bytes stay on the books until every `Cache` object
  anyone holds for that cache has been garbage-collected, and the virtual server makes one per
  request. Measured against a simulated quota: with a handle alive the space never came back,
  with handles dropped it took about 770 ms, with the entries deleted first it was back in 3 ms.
  Before `emptyCache`, a write under pressure evicted every idle package in turn, found each
  eviction had freed nothing yet, and gave up — while a reload seconds later found the room.
  One cost that remains: a partial chunk is rewritten as it fills, and the Cache API holds the
  old and the new copy together while the put lands, so an entry needs up to twice its last
  partial — 16 MB at most — of spare room for a moment. A store within one chunk of full can
  therefore still refuse a write that would have fitted afterwards.
- **Caching an inline entry is a convenience; a refused write is served around.** Everything
  under `INLINE_MAX_SIZE` — including a stored mp4 — is copied into the cache before it is
  served, but nothing requires that. When the copy is refused for lack of space after eviction
  has found nothing more to drop, `serveUncached` streams the entry from the archive for that
  response alone, and the store is left untried for `FAILURE_BACKOFF_MS` so a media element
  probing a 10 MB entry with a burst of ranges does not copy 10 MB into a full store for each.
  Consequence: a package on a host that honours `Range`, or picked from disk, plays with no
  storage at all. Before this, a refused write was a 507, and the runtime's script loader —
  which waits on `load` alone — left the frame blank at `indexing` for ever, with no event.
  The one place storage is a hard requirement is a host without `Range`: the archive has to
  land whole, and a package larger than the room is refused with its size and the reason.
- **A failed extraction is recorded, not rediscovered.** The Jobs worker writes the failure into
  the entry's `ChunkMeta.error` and drops its chunks — a deflate stream cannot be resumed, and
  until the next attempt the partial chunks only hold space the rest of the package may need.
  `waitForWatermark` returns on a recorded failure, so a request gets its 507 (quota) or 500 at
  once instead of after the 15 s stall; after `FAILURE_BACKOFF_MS` the record is cleared and the
  entry tried again, because the space may have come back.
- **Bookkeeping never takes a request down.** An origin filled to the last byte refuses a
  hundred-byte write as readily as a chunk: `setMeta` therefore goes through the same eviction
  as the chunks (it once assumed tiny meant exempt), `touchPackage` and the `status` update are
  best-effort, and `register` keeps an existing row when the new one does not fit — the id is a
  hash of the source, so the row names the same package.
- **The quota message carries the numbers.** Built where the write failed, in the Jobs worker,
  from `navigator.storage.estimate()` and the size that was needed — the archive's for a
  download, the entry's for an extraction — because "quota exceeded" tells nobody whether the
  package is too big for this browser or the site has merely filled up. One caveat for testing
  it: under DevTools' "simulate custom storage quota", writes fail at the simulated cap while
  `estimate().quota` keeps reporting the real one, so the message reads oddly there and a
  pre-flight check could not have helped. `tests/browser-emulated/` uses that same override through
  CDP, in a Vitest project of its own because the override is per browser profile.
- **A runtime error after `ready` is an event, not a state.** Before `ready` it is the boot
  failing and the state goes to `error`; after it the content is up and, in practice, still
  working — H5P content types throw non-fatal exceptions routinely, on resize in particular —
  so the element reports it and leaves `ready` alone. A host that hides the player on `error`
  must not hide working content. The demo pages follow: the player page shows it as a note, the
  embed page only logs it.
- **The frame's own CSS pins a YouTube iframe over its box.** H5P.Video's YouTube handler does
  that with `player.g.style = …`, reaching into the YouTube API object's minified internals; the
  field was renamed, so up to 1.6.66 — the version the hub still ships, and the one inside every
  existing export — the line throws and the iframe flows below its 16:9 box, clipped away by the
  wrapper: sound, black picture, the same in Lumi. The rule `.h5p-video.h5p-youtube iframe`
  says what the line meant; the fixed library (1.6.80, `getIframe()`) sets the same styles, so
  the rule is idle there. A workaround for one library, kept because that library is inside
  packages this player will be handed for years.
- **The frame reports the runtime's own failed loads.** Its `error` listener is capture-phase,
  because a resource failure fires on the element and never bubbles, and it reports only tags
  marked `data-h5p` — the ones h5p-standalone injected. A content image that 404s, or an
  optional script a content type reaches for, is the content's business.
- **Eviction never touches a package under a Web Lock, in any tab.** Every lock name starts with
  `h5p:<pkgId>:` (`locks.ts`): the Jobs worker holds one per download or extraction for as long
  as it writes — the job key *is* the lock name — and the element holds `playing`, shared, for as
  long as a package is loaded. `busyPackages()` reads `navigator.locks.query()` and
  `coldestIdlePackage` skips anything held, so a write in one tab or a learner mid-video in
  another survives a quota squeeze caused by a third. Both workers install the same policy through
  `installEvictionPolicy`; before that the Jobs worker — where the large writes, and so the quota
  errors, actually are — had no policy and evicted whichever cache the browser listed first.
- **An archive from a host that ignores `Range` is indexed as it downloads.** The central
  directory is at the end, so a download that has to complete before it can be read holds every
  entry hostage — including the libraries that arrived in the first second. `LocalHeaderScanner`
  (`forward-index.ts`) walks the local headers off the same bytes on their way to the chunk store;
  the Jobs worker publishes what it has found as a `ForwardIndexSnapshot` beside the watermark,
  announced on the same channel; the Service Worker builds a `partial` `PackageReader` from it and
  serves from that until the archive is whole, when a reader from the central directory — the
  authority — replaces it. Three rules keep a partial index honest:
  - **An entry is in the snapshot only once its bytes have all arrived.** Recording it off its
    header alone would let the worker reach for data that is not there yet.
  - **The element boots only when `bootReady()` holds:** `h5p.json` has arrived and every
    dependency it declares resolves to a folder that is present *and finished arriving* — a
    folder has finished once an entry of a later folder has arrived, since exporters write a
    folder's files together. An index the scanner had to give up on never says ready.
  - **On a partial reader a miss waits; it does not 404.** h5p-standalone treats a 404 as a fact
    about the package. `awaitEntry` wakes on each index publish and each move of the archive
    watermark until the entry appears, the reader can prove it absent (`provablyAbsent`: its folder
    has finished arriving, or it is the versioned probe on a library the package keeps
    unversioned), or the real index answers. The stall bound watches the *archive* watermark: the
    index stands still for the whole of a large entry while bytes keep coming, and a healthy
    200 MB download must not read as a dead one. A stall answers 503, never a wrong 404.

  Two facts about real packages shape this, both measured, not assumed. A PHP-style export
  (`boardgame.h5p`) puts libraries before content and uses no data descriptors: it boots after
  about a hundred entries with 40 MB of media still to come. An h5p.com export
  (`interactive-video-2-618.h5p`) sets bit 3 on *every* entry — sizes after the data, all stored —
  so a walker that trusts local-header sizes gets nothing from it; the scanner resolves those by
  finding the descriptor signature and accepting it only where its compressed size equals the
  bytes seen since the data began. h5p-standalone probes the *versioned* folder name first, so on
  a modern export the boot never issues the one 404 a partial index would have to wait on.
  `zip.js`'s own `ZipReaderStream` is not an option here: it buffers the entire input into a Blob
  and then reads the central directory from the end (`getEntriesGenerator` → `streamToBlob`) —
  a streaming surface over whole-archive buffering.

## The normalizer

`npm run normalize -- course.h5p` rewrites a package once so that it streams. It is the fix for
the deflated, non-faststart video above, applied where it belongs — to the package, by whoever
publishes it. `scripts/lib/normalize.mjs` holds the policy, `mp4-faststart.mjs` the remux and
`zip-writer.mjs` the output side; `scripts/normalize-h5p.mjs` is the command. Four things about
it that the code does not say by itself:

- **It writes the zip itself.** zip.js reads the input — descriptors, zip64, inflate, all
  handled — but its `ZipWriter`, asked not to write a data descriptor, buffers the whole entry
  until it knows the sizes (`!dataDescriptor && !emptyEntry` takes the buffered path in
  `zip-writer.js`). The normalizer always knows them — stored bytes the source measured, or bytes
  it has counted itself — so `StreamingZipWriter` puts a complete local header in front of each
  entry and never buffers. No descriptors also means the forward scanner reads an entry's size
  off its header instead of hunting for a descriptor signature through 200 MB of video.
- **Faststart is a remux, not a re-encode.** Only the `stco`/`co64` chunk offset tables inside
  `moov` change, by `moov`'s own length, and only for positions that lay between `mdat` and
  `moov`; an atom after `moov` keeps its position. Anything the walker does not understand — a
  fragmented file, a compressed `cmov`, an offset that would outgrow `stco` — is left exactly as
  it was. A deflated mp4 is inflated to a temp file first, because `moov` is at the end and a
  deflate stream cannot be seeked; a stored one is read in place in the source archive.
- **Library folders stay whole; only `content/` media moves to the end.** The forward index
  treats a folder as finished once a later folder has begun, so a library's own png pulled to the
  end would be reported absent after its library had "arrived".
- **It drops what the player would drop.** Directory entries, names that are not plain relative
  paths, duplicates after normalisation — read with `filenameValidation: 'tolerant'` for the same
  reason the player uses it. `plainRelativeName` is a copy of `normalizeEntryName`, because the
  scripts cannot import TypeScript; keep the two in step.

Measured on the fixtures: `boardgame.h5p` grows 38.1 → 38.8 MB with 158 media entries inflated to
stored (its mp4s were already faststart); the h5p.com export keeps its media as it was and only
has its two stored JSON files deflated, 17 → 5 kB. `unzip -t` is the independent check on an
output. What the script cannot do is make a host that ignores `Range` serve a video before the
video has arrived: an entry enters the forward index only once it is complete, so on such a host
a normalized package gains the early boot and the seekable video, and still waits for the bytes.

## The element's own box

Three things about the shadow CSS that are easy to undo by accident:

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

Answering `hello` is load-bearing. Until it is answered H5P leaves its document at full height
and never reports a content size — so a missing reply looks like "sizing does not work" rather
than like a failed handshake. On the reply it sets `body { height: auto; overflow: hidden }` and
starts reporting, which is what the handshake test asserts.

Sizes come from the resize events content types raise when they actually change. A
`ResizeObserver` on the frame would both miss those and fire on changes that are not resizes;
H5P also deliberately stays quiet when a resize would not change the height, so no event is not
the same as a broken exchange.

`externalEmbed: false` is the other native mode and is **not** usable here: it has the frame call
`window.parent.H5P.fullScreen(...)`, read `window.parent.H5P.isFullscreen` and forward xAPI
through `window.parent.H5P.externalDispatcher`. That assumes the embedding page is itself an H5P
page with core loaded — which is the arrangement this whole design exists to avoid.

## Build shape

Three artefacts, built three different ways, because they are consumed three different ways:

| Artefact | Built by | Why |
|---|---|---|
| `dist/h5p-player.js` | Vite library build | An ES module the host imports |
| `dist/h5p-sw.js` | esbuild, IIFE | Registered by URL; has to run on a site with no build step |
| `dist/h5p-sw-mount.js` | esbuild, ESM | For hosts that enforce one worker per origin |
| `dist/frame-assets/` | copied verbatim | h5p-standalone, unmodified |
| `dist-demo/` | `scripts/build-demo.mjs` | The hosted demo: the pages, and `dist/`'s layout at the site root |

The Jobs worker is not an artefact: `vite.config.ts` bundles it with esbuild into a string behind
`virtual:h5p-jobs-worker`, and the element spawns it from a `blob:` URL. One fewer file for a host
to deploy.

The frame's boot script is built the same way. `src/sw/frame-boot.ts` is a typed module nothing
imports; `scripts/lib/frame-boot-plugin.mjs` bundles it to a minified classic script behind
`virtual:h5p-frame-boot` — as an esbuild plugin for the two worker builds and, through
`frameBootPlugin()` in `vite.plugins.ts`, for Vite when the unit tests load `frame-document.ts`.
The document inlines that string under its nonce and puts the per-package configuration in a
`<script type="application/json">` block beside it, so the script is the same bytes for every
package and the JSON needs no nonce. Before this the script was a template literal, and every
frame document shipped its comments and indentation. TypeScript sees the plugin through
`frame-boot-plugin.d.mts`; `tsconfig.node.json` does not enable `allowJs`.

**The element is minified after Vite, in `build-workers.mjs`.** Vite leaves an ES library's
whitespace and comments alone on purpose: esbuild drops `/* @__PURE__ */` annotations when it
minifies whitespace, and a consumer's bundler tree-shakes a library by them. This module
registers the element on import, so nothing in it can be shaken out and nothing is lost by the
extra pass. Vite's own output was 215 kB with every JSDoc block in it.

**The element does not carry zip.js.** It probes a source and never reads an archive, but
`source.ts` used to import zip.js for the reader bridge, and zip.js has module-level side effects
Rollup cannot drop, so 100 kB of it rode along. The bridge now lives in `source-reader.ts`,
imported by the reader and the Jobs worker only. Element bundle before and after: 314 kB
(131 kB gzipped) to 205 kB (85 kB gzipped); the Jobs worker string inside it, which does need
zip.js, is 190 kB of that.

**Shipped strings carry no comments.** The frame's `<style>` block and the element's shadow CSS
are explained in TypeScript comments beside the constants, not inside them; a comment inside a
template literal survives every minifier and ships with every response.

In dev the same plugin file serves the Service Worker at any path ending in `/h5p-sw.js`, so
`new URL('./h5p-sw.js', import.meta.url)` resolves in dev and in a consuming app alike. **esbuild
bundles both workers behind Vite's back**, so the plugin has a `handleHotUpdate` that invalidates
the virtual module when anything under `src/` changes. Without it the page keeps running a worker
bundle that no longer matches the source — a genuinely confusing hour.

## The hosted demo

`vercel.json` deploys `dist-demo/` — the output of `npm run build:demo` — as a static site plus
one function. The site root has the layout of the package's `dist/`: `h5p-player.js` unhashed
(an explicit entry of `vite.demo.config.ts`, named without a hash), with `h5p-sw.js` and
`frame-assets/` beside it, so the pages set neither `sw` nor `assets-base` and the element finds
both the way it does in any app that serves `dist/` statically. The worker's scope is therefore
`/h5p/`, and a request that reaches Vercel under it is a 404 rather than a page — the
SPA-fallback trap described above cannot happen there.

- **`/no-range/<fixture>` is a function, `api/no-range.js`.** Vercel's static files honour
  `Range`, so the host-that-ignores-Range case — the common one in the wild — would otherwise not
  exist on the demo at all. The function fetches the fixture back from the deployment's own
  static files and answers `200` with the whole body and no `Accept-Ranges`. Behind deployment
  protection that internal fetch gets the login page; `VERCEL_AUTOMATION_BYPASS_SECRET` on the
  project makes it send the bypass header. The `?throttle=` pacing is dev and preview only.
- **The CSP header is real, and it reaches more than the pages.** `connect-src 'self' https:`
  because the page and the blob Jobs worker fetch whatever package URL a visitor pastes;
  `worker-src blob:` for that worker; `frame-src 'self'` for the frame. The same header lands on
  `/h5p-sw.js` and so becomes the Service Worker's own policy, which is the second reason
  `connect-src` has to cover the package hosts. It does not reach the frame document — the worker
  synthesizes that response, and its policy is the `<meta>` in `frame-document.ts`. `vite
  preview` applies the same headers (`vite.demo.config.ts` reads them out of `vercel.json`), so a
  violation shows up locally before it ships.
- **The element's shadow styles are a constructable stylesheet because of that header.** Under
  `style-src 'self'` an inline `<style>` in the shadow root is blocked without a word, and the
  frame collapses to an iframe's intrinsic height with the content otherwise working — found by
  driving the built demo under the production CSP. `CSSStyleSheet.replaceSync` is CSSOM and is
  not subject to it; the `<style>` element remains only as the fallback for a browser without
  `adoptedStyleSheets`.
- **`/embed` is Setup C, and it is a page of its own.** The element alone, `auto-resize`, and
  the query string for `src`, `libraries`, `preload` and `xapi`. Three decisions in
  `demo/embed-page.js`: it speaks H5P's resizer protocol *upward* — `hello`, then `resize` with
  `scrollHeight` — so a site that already includes h5p.org's `h5p-resizer.js` for its h5p.org
  embeds resizes this frame with no code of its own; it relays xAPI only when `xapi=` names the
  parent's origin and posts to that origin only, which is the opt-in the frame-to-element channel
  cannot have; and it detects the Safari case by the `no-worker` error inside a frame rather than
  by sniffing the user agent, and answers with a `target="_top"` link to itself. The height it
  reports is the body's own, not `documentElement.scrollHeight`, for the reason the element
  measures `#h5p-root` and not the document. `/embed` without `.html` is a Vercel rewrite in
  production and Vite's own html fallback locally.
- **The pages carry their metadata, and the origin is filled in at build time.** Titles,
  descriptions, canonical links, Open Graph and Twitter tags, JSON-LD for the software on the
  front page, `robots.txt` and `sitemap.xml`, and the GitHub link in every page's navigation. The
  absolute URLs are written as `%SITE_URL%` in the HTML and replaced by `siteUrlPlugin`
  (`vite.plugins.ts`), which runs before Vite's own `%ENV%` pass so Vite does not warn about a
  name it does not know. `build-demo.mjs` decides the origin — `SITE_URL` if set, else Vercel's
  `VERCEL_PROJECT_PRODUCTION_URL`, else the preview's localhost — and writes the sitemap and
  robots file with it. `/embed` stays out of the sitemap and carries `noindex`. The social card,
  `demo/og-image.png`, is rendered by `npm run demo:og` in Chromium from a small HTML page and
  committed, because link previews want a raster image and the deploy has no browser.
- **What a public demo means.** The frame is same-origin by design, and a package's libraries
  are JavaScript, so `/?src=<any url>` runs a stranger's code on the demo's origin. That is the
  architecture — a host chooses what it plays — not a flaw in it, and it is why the demo origin
  must hold nothing: no cookies, no accounts, no storage worth reading.
- **Caching.** Hashed files under `/assets/` are immutable; `h5p-sw.js` is `no-cache`;
  `frame-assets/` and `fixtures/` revalidate hourly. Fixtures also carry permissive CORS with
  `Range` allowed and `Content-Range` exposed, so another player instance can be pointed at them.
- **The demo plays real content; the fixtures never ship.** `public/fixtures/` is the test
  suite's stub library saying "Served from the archive, never extracted to disk", which is right
  for a test and wrong for a visitor. The site plays four packages from `demo/content/`: a
  Question Set, an Interactive Video on a ten-second Big Buck Bunny clip, an Accordion on how the
  player works, and Dialog Cards for its vocabulary. They are built by
  `scripts/build-demo-content.mjs` from `demo/content/src/<name>/` — our `content.json` and a
  `manifest.json` naming the content type — with the libraries taken from the H5P hub's bundle
  for that type, exactly what `libraries="hub"` fetches at runtime. The script keeps only the
  dependency closure the content needs (walked from `library.json`, plus every sub-content
  library the params name), drops the editor libraries the hub ships, and runs the result through
  the normalizer, so each package is also an example of what the normalizer produces. The outputs
  are committed, 5.2 MB for the four, because a deploy should need neither the hub nor the video
  host; `npm run demo:content` regenerates them. Provenance: the libraries are MIT, the text is
  ours under CC0, and the clip is Big Buck Bunny, © Blender Foundation, CC BY 3.0, credited in the
  package metadata and on the player page. The `/no-range/` route serves this content on the site,
  and this content or a fixture locally, which is what the browser tests need.

## Testing

Unit tests cover the pure logic: name normalisation, range parsing, chunk arithmetic, strategy
selection, the CSP and the generated frame document, and the normalizer's writer, remux and
policy. They are fast and are where a rule belongs. `tsconfig.test.json` has `allowJs` so the
tests can import `scripts/lib/*.mjs`; the scripts are typed through JSDoc and not checked.

Browser tests drive the real element in chromium. They are the only place the interesting parts
exist at all — a worker serving a `206` assembled out of cache chunks has no meaningful behaviour
outside a browser. Two things to know when writing them:

- **The test page is not controlled by the worker.** Its scope is `/src/h5p/` and the test page is
  not under it, exactly as a host page is not. A `fetch` of a virtual URL from the test realm goes
  to the network and 404s. Use `frameFetch(player, url)` from `tests/browser/utils.ts`, which
  fetches through the frame — the client the worker actually controls.
- **State carries between tests.** Caches and the `packages` table survive; `play()` replaces the
  document body, which disconnects the previous element and terminates its Jobs worker mid-job. A
  test that needs a cold load must call `clearPackageCaches()`.

`segmented.h5p` is `large-deflated.h5p` with media that does not compress: 20 MB of zeros deflate
to 20 kB, which is never fetched in segments, so only this archive takes `segmentedStream` end to
end. The slow-link test in `tests/browser-emulated/` throttles the browser to 1 MB/s and expects
the first bytes of it inside eight seconds.

`/compressing/<fixture>` is the dev server standing in for GitHub Pages: `Range` honoured, CORS
open, and the archive gzipped — ranges included, cut from the gzipped copy — whenever the request
accepts gzip, which a browser's plain `GET` does and its ranged requests do not. In the suite it is
same-origin, so every header is readable and the probe never needs its size fallback there; the
browser test pins the two lengths the same archive answers with, and the unit test covers the
fallback against headers filtered the way CORS filters them.

`large-deflated.h5p` carries `content/media/unused.bin`, large and deflated and referenced by
nothing. It is the only way to tell a prefetch from a demand fetch: the fixture's own
`big.bin` is rendered as a video by the test library, so the runtime requests it either way.

Fixtures are generated (`scripts/build-fixtures.mjs`) rather than committed, because two of them
need entries no ordinary zip tool will write — a path traversal, and 20 MB of media to take the
slice and chunk paths. The script clears only the archives it owns, so a real `.h5p` dropped into
`public/fixtures/` to try against the demo survives `npm run dev`.

For a manual check against a real, fully bundled package (eight libraries, a genuine H5P content
type), the h5p-standalone repo ships one:

```bash
curl -sL -o public/fixtures/real.h5p \
  https://raw.githubusercontent.com/tunapanda/h5p-standalone/master/test/h5p-test.h5p
```

## Licensing

The package is `(MIT AND GPL-3.0-only)`, and the parenthesis is the point: our code is MIT,
`dist/frame-assets/` is not. h5p-standalone declares MIT and its own code is, but its
`frame.bundle.js` is built from `vendor/h5p/js/` — h5p.js, the event dispatcher, xAPI, the content
type base, the confirmation dialog, the request queue, the action bar, the tooltip — copied from
`h5p/h5p-php-library`, which is GPL-3.0 by its LICENSE.txt and composer.json. H5P's own licensing
page says the GPL is there because of the HTML purifier on the PHP side and has promised since
2017 to make it optional; the JavaScript carries no separate grant, so it is GPL by the
repository's terms. The core stylesheet and the `h5p-*` icon fonts come from the same repository.
Upstream confirmed the consequence in tunapanda/h5p-standalone#188 on 2026-08-26 and has not
changed its metadata. Three things follow:

- `NOTICE.md` at the root is kept by hand; `LICENSE.txt` and `NOTICE.txt` inside `frame-assets/`
  are written by `sync-h5p-assets.mjs`, so they always name the h5p-standalone tag actually
  vendored — that tag is the corresponding source, since upstream records no h5p-php-library
  revision. Bumping h5p-standalone regenerates them and means re-reading `NOTICE.md`; do not
  hand-edit anything under `public/frame-assets/`.
- Both worker bundles and the minified element are built with `legalComments: 'none'`, so the
  zip.js BSD-3-Clause notice does not survive into `dist/`. `NOTICE.md` reproduces it, which is
  what its clause 2 asks for. A new dependency that ends up in a bundle means a new entry there.
- The demo site serves the same directory, so the same files are on it, and `index.html`'s
  JSON-LD names both licences.

Whether the copyleft reaches our own code is a legal question and is not settled here. The
element and the workers exchange only messages and HTTP with the runtime; the frame boot script
runs in the same document and calls its API.

## Where this differs from the written design

The architecture and setup documents predate the code. These are deliberate additions, not drift:

- A `resize` event and an `auto-resize` attribute. H5P content sizes itself, and without these
  every host page has to reimplement the same listener.
- A `statechange` event, so a host can mirror `state` without polling.
- A `runtime` error after `ready` does not move the state to `error`. The design's state machine
  has one `error` state; a content type that throws once after booting is not that.
- A chunked entry requested with no `Range` header is answered `200` with its true length and a
  body that follows the extraction. Chrome's first request for a media resource carries no
  `Range`, and the design's original `503` there kept a cold video from ever starting. The `503`
  with `Retry-After: 1` survives only for an entry whose extraction has produced no bytes at all
  within the stall window.
- A host that ignores `Range` no longer means "download everything, then index". The archive is
  still downloaded whole — the design's `chunked` adapter — but it is indexed from its local
  headers as it arrives, and the frame boots as soon as the runtime's libraries are present.
- Eviction is lock-aware across tabs, not only "never the package currently being served". The
  design's rule protected the package doing the writing; a Web Lock under `h5p:<pkgId>:` — held
  by a writing job or a playing element anywhere on the origin — now protects any package in use.
- Generated types live in `types/`, not `dist/index.d.ts`.
- A normalizer script. The design leaves the package's layout to whoever built it; the script
  is how they get the layout the player streams best.
- The libraries are warmed into the cache before the frame boots on a `Range` host. The design
  reads every entry on demand; on a high-latency host that made the boot a matter of minutes.

## Not built yet

Deliberately out of scope for v1, per the architecture document: the editor, offline management
(save, library, delete), results storage and save-and-resume, persistent file handles. xAPI is
emitted as events and stored nowhere.

**Demand-paced extraction.** Considered on 2026-09-25 against a real package and deferred; the
design is recorded here so it does not have to be rediscovered. Since then extractions run one at
a time in demand order (see the queue invariant above), which takes care of the *contention*
between videos; what follows is about the bytes a single job pulls that nobody watches. Today the first request for a
deflated entry starts a job that inflates the whole file, because a deflate stream cannot be
restarted in the middle. Measured: an 80 MB deflated mp4 (ratio 0.937, faststart; H5P.Video creates
its `<video>` with `preload="metadata"`, so the header is asked for the moment the content renders)
pulled 26 MB from GitHub Pages in the first 15 s with the video paused, and the whole 81 MB from a
local host, whether or not play was pressed. Interactive Video's icon fonts and SVGs, which the
browser requests only once their CSS applies, then queued behind four 4 MB segments: 1.3–1.8 s
each against 52 ms on the idle link. That is the "UI still loading while the video already plays"
a user sees. Two things were tried and ruled out: priority hints on the segment fetches change
nothing on that host (240–306 ms per small read under load, hint or no hint), and smaller segments
only slow the video — the contest is for bandwidth, and only pulling fewer bytes wins it. Random
access into the stream is not an option either: a checkpoint index would need a bit-level
inflater and could only cover the part already inflated, which the chunk store serves anyway.

A deflate stream cannot be restarted, but it can be paused: the inflater's state is a few tens of
kilobytes in the Jobs worker, and `segmentedStream` already stops opening requests when its output
is not consumed. The design:

- The Service Worker's streaming path announces consumption on the watermark channel, the way it
  announces liveness today: entry, and the position read up to.
- The chunk writer gates its writes at the highest announced position plus a read-ahead of one or
  two segments, and waits for the next notice.
- Prefetch (`preload`) announces unbounded demand; running ahead is its point.
- A forward seek announces its position, and the job runs at full speed until it gets there.

It buys a few megabytes at boot instead of the whole file, nothing on the network while paused,
and icon contention of a couple of seconds on a slow link instead of the whole load. It does not
change what deflate costs: a seek past the watermark still waits for the transfer of everything in
between, and the cache then holds what was watched rather than the whole file, so replaying an
unwatched part is a network cost again. The delicate part is `waitForWatermark`: a job paused for
lack of demand must not read as a dead one, so either the pause is visible on the channel or the
stall clock starts only once demand has been announced. Roughly 150 lines across the chunk
writer, the channel, `mount.ts` and the Jobs worker, plus tests. Deferred because the package-side
fix exists — `npm run normalize` stores the video, after which the media element drives every byte
and the same boot pulled 1.4 MB instead of 81 — and because it is not yet known how often the
player is handed a deflated video nobody can normalize: the h5p.com export analysed above stored
everything, while this one and the sodix.de one deflated everything.
