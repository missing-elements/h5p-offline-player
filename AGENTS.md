# AGENTS.md

Working notes for this repository. This file is the index: what the project is, how to work in
it, and every design rule in one line. [`design/`](design/) holds the rules in full, with the
reasons and the measurements behind them, one file per area; together they are the authority on
the design, and where they and the code disagree, one of them is wrong. **Before changing code in
an area, read its file in `design/`.** A name in italics, *like this*, is a rule or a section
there: grep `design/` for it. The README and `docs/` are written for people integrating the
packages.

## What this is

Self-hosted H5P without an H5P server: a browser-only player, shipped as one web component,
that a host puts on infrastructure it controls. That is the product's main benefit, and the
documents lead with it. It plays an arbitrary `.h5p` archive
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

## Where things are

A pnpm workspace of eleven parts: nine packages and two apps. Eight of the packages are published
to npm; the ninth, the VS Code extension, is a `.vsix`. In `design/`, `src/…` and `scripts/…` mean
the player's unless a file says otherwise. [`design/layout.md`](design/layout.md) maps every file.

| Part | What it is |
|---|---|
| `packages/player/` | `@missing-elements/h5p-offline-player`, MIT: the `<h5p-player>` element, the Service Worker (`src/sw/`), the Jobs worker (`src/jobs/`), what the three contexts share (`src/shared/`), and `./plan`, its library rules for author and embed |
| `packages/runtime/` | `@missing-elements/h5p-runtime`, GPL-3.0: the H5P core vendored at a commit, and the boot script that runs in the frame |
| `packages/libraries/` | `@missing-elements/h5p-libraries`: the library pack, one archive per library, checked against the H5P hub every week |
| `packages/normalize/` | `@missing-elements/h5p-normalize`: rewrites a package so it streams |
| `packages/verify/` | `@missing-elements/h5p-verify`: plays a package headless and reports, or opens it for a person |
| `packages/author/` | `@missing-elements/h5p-author`: a playable package of any content type from a short source |
| `packages/cmi5/` | `@missing-elements/h5p-cmi5`: a page holding the element as a cmi5 assignable unit |
| `packages/embed/` | `@missing-elements/h5p-embed`: the embed site for a player domain, and a package as a SCORM zip |
| `packages/vscode/` | H5P Preview, the VS Code extension |
| `apps/demo/` | the dev server for the whole repository, and the hosted site and its installable app |
| `apps/skills/` | the agent skills' test project |
| `skills/` | the agent skills, at the root, where `npx skills add` looks |
| `docs/` | the README's longer sections, for integrators |
| `design/` | the design rules in full |

## Commands

From the repository root:

```bash
pnpm install           # pnpm 10: dependency install scripts stay off, see pnpm-workspace.yaml
pnpm --filter @missing-elements/h5p-offline-player exec playwright install chromium   # once, for the browser tests

pnpm dev               # vendors assets, builds fixtures, serves the demo on :5173
pnpm test              # every package: the player's unit + browser suites, the normalizer's and verifier's tests
pnpm test:unit         # fast, no browser
pnpm test:browser
H5P_TEST_BROWSER=firefox pnpm test:engine   # the player's browser suite and the app's tests in
                       # Firefox, or webkit; after `playwright install firefox webkit` in the player
pnpm typecheck         # every package
pnpm build             # the player: types, element, both workers; builds the runtime package on the way
pnpm normalize course.h5p          # rewrite a package so it streams: media stored, mp4 index first
pnpm verify course.h5p             # play a package in a headless browser and report whether it works
pnpm author build source.json course.h5p  # a package of any content type in the pack from a short source;
                       # after pnpm build, or the player's build:plan, whose dist/h5p-plan.js it imports
pnpm --filter @missing-elements/h5p-author sync:skill  # the h5p-author skill's type files' fields, from the pack
pnpm --filter h5p-preview package  # the VS Code extension's .vsix, from the player as pnpm build left it
pnpm --filter h5p-preview test:vscode  # its suite in a VS Code it downloads; under xvfb-run on Linux
pnpm --filter h5p-preview screenshot  # its listing's screenshot, images/preview.png, in that VS Code
pnpm build:demo        # the hosted demo into apps/demo/dist-demo/, what Vercel runs
pnpm demo:content      # rebuild apps/demo/demo/content/*.h5p from their sources; needs the H5P hub
pnpm demo:og           # re-render the social card, apps/demo/demo/og-image.png
pnpm demo:icons        # re-render the installable app's icons, apps/demo/app/icons/
pnpm demo:screenshots  # re-render the app's install-dialog screenshots, apps/demo/app/screenshots/,
                       # from the built site: after pnpm build:demo
pnpm libraries         # rebuild packages/libraries from the H5P hub; before a release, and every
                       # Monday by .github/workflows/libraries.yml, which opens a PR when a library changed
pnpm l10n              # take the core's translations from Moodle's language packs again, into
                       # packages/runtime/l10n/; every Monday by .github/workflows/l10n.yml, which
                       # opens a PR when a translation changed
pnpm core:sync master  # vendor the H5P core from h5p-php-library's newest commit, into
                       # packages/runtime/vendor/h5p-core/; with no argument, the recorded commit
                       # again; then the sweep, and the release notes name the commit
pnpm sweep             # play every content type in the pack, untrusted and trusted, and check
                       # each boots; after pnpm build
pnpm preview:demo      # serves dist-demo/ with the production headers and the /no-range route
```

`pnpm test` runs the packages one at a time (`--workspace-concurrency=1`). The demo's `test`
runs the player's `prepare:dev` and the verifier's runs the player's `build`, and both of those
begin with `sync:assets`, which deletes `public/frame-assets/` and writes it again. Run in
parallel, as `pnpm -r` does once their shared dependency is done, one run deleted the directory
while the other was writing into it. CI hit exactly that: ENOENT on `frame.bundle.js`.

pnpm forwards extra arguments on its own: `pnpm preview:demo --port 4199`, not `-- --port`. A
literal `--` reaches the script, which Vite then reads as the end of its options.

`pnpm test:browser` runs two browser projects: `browser`, the suite, and `browser-emulated`,
the tests that emulate a browser condition through CDP — a storage cap, a slow link. Those get a
browser of their own, one file at a time, because the emulation is per browser profile and would
otherwise land on whatever other file was running.

`pnpm dev` and `pnpm test` both run the player's `prepare:dev` first, which builds the runtime
package (`packages/runtime/dist/`, the vendored H5P core plus the boot script) and copies it
to `packages/player/public/frame-assets/`, and builds the fixtures into
`packages/player/public/fixtures/`. None of those directories is in git; all are reproducible.

The browser provider is a package, not a name: `provider: playwright()` from
`@vitest/browser-playwright`. Vitest 4 moved providers out of the core package, so a bare
`provider: 'playwright'` string silently stops being valid.

**What is tested**, by the owner's rule: the packages and their source, and of the demo app only
the installable app; the demo's pages are checked by hand, and the skills are tested from
`apps/skills`. [`design/testing.md`](design/testing.md) has the rule in full, the engines, CI and
the content-type sweep.

Node 22 LTS or 24 LTS: the commands the packages ship need 22, and the browser packages keep
`>=20`. Packages are published with pnpm, which rewrites the `workspace:` ranges, and each one's
`prepublishOnly` is its guard: [`design/build.md`](design/build.md).

## Design rules, by area

### Serving archives: [`design/serving.md`](design/serving.md)

Read it before changing the Service Worker's file server (`src/sw/mount.ts`, `package-reader.ts`, `routes.ts`, `watermark-wait.ts`), how a source is read (`src/shared/source.ts`, `block-cache.ts`, `source-reader.ts`, `span-stream.ts`, `resilient-stream.ts`, `range.ts`, `local-header.ts`, `forward-index.ts`, `mime.ts`) or the warm (`src/jobs/warm.ts`).

- `SourceReader` overrides `createReadable`.
- A large span over HTTP is then pulled by several connections at once.
- Small reads over HTTP go through a block cache, and a rebuilt reader finds it.
- Waiting on the watermark is bounded by a stall, not by a wall clock.
- A ranged read survives the link, and a body the server gives up on ends short.
- A body that streams holds its fetch event open.
- Some video cannot be streamed at all, and `preload` is the only lever.
- Prefetch waits for `ready`, runs one entry at a time, and is off by default.
- The cache is never the authority on size.
- Every response needs a `Content-Type`.
- `RangeHttpHandle.read` slices a `200` body as it flows, like `stream` always did.
- The archive's size never comes from a plain `GET`.
- On a host that honours `Range`, the libraries are pulled whole before the frame boots.
- Media is held to a lower inline bar than everything else.
- An inline entry is inflated once per burst.
- An unknown `pkgId` is a 404 on every route.
- An archive from a host that ignores `Range` is indexed as it downloads.

### Storage and the Jobs worker: [`design/storage.md`](design/storage.md)

Read it before changing the chunk store, eviction or quota (`src/shared/chunk-store.ts`, `eviction.ts`, `locks.ts`, `storage.ts`, `idb.ts`) or the Jobs worker (`src/jobs/`).

- The watermark is always a prefix.
- A resumed write must start on a chunk boundary.
- Job requests are deduplicated for two seconds, not for the whole wait.
- The chunk writer's `abort` publishes nothing.
- A downloaded archive is read back before it is reported done.
- An aborted job gives up its `inFlight` key at once, not when the abort finishes.
- Extractions run one at a time, and the order is the policy.
- A chunk streams out of the cache; it is not materialised.
- The watermark is announced, not only polled.
- The Jobs worker carries no zip.js and reads no index.
- Bulk fetches are `cache: 'no-store'`.
- Eviction empties a cache before it deletes it.
- Caching an inline entry is a convenience; a refused write is served around.
- A failed extraction is recorded, not rediscovered.
- Bookkeeping never takes a request down.
- The quota message carries the numbers.
- Eviction never touches a package under a Web Lock, in any tab.

### Libraries: [`design/libraries.md`](design/libraries.md)

Read it before changing which libraries a package plays with: the library check, the `libraries` sources, the pack and its parts, refresh, downgrade, addons, the merged manifest (`src/sw/pack-plan.ts`, `src/shared/library-folders.ts`, `content-libraries.ts`, `pack.ts`, `src/plan.ts`, the element's `index()`, `packages/libraries/`).

- A package is refused at index time if it does not carry its own libraries.
- A package may be served from more than one archive.
- When a bundle is attached, `h5p.json` is synthesized, not served.
- Addons are added as the platforms add them.
- An unreachable library source falls back to a bundle downloaded from it before.
- `libraries="pack"` is the library pack the release pins, and the H5P hub is not asked.
- jsDelivr cuts ranges from a compressed copy.
- A library bundle is downloaded, never range-read.
- The pack is split, a package downloads the parts it needs, and the pack's newer versions play in place of a package's older ones.
- `libraries` is a list, tried in order.
- Content written for a newer minor than any source has plays at the newest older one.
- The pack carries what an H5P site's upload check wants, and the player never serves it.

### The frame and the runtime: [`design/frame.md`](design/frame.md)

Read it before changing the frame document or the boot route (`src/sw/frame-document.ts`, `library-load.ts`) or the runtime package (`packages/runtime/`: the boot script, upgrades, translations).

- Content written for an older minor is upgraded before the runtime reads it.
- The core's strings follow the content's language.
- The runtime is the H5P core at a commit, and the frame loads what the worker's `boot` route names, in h5p-standalone's order.
- A 404 from the virtual server is load-bearing.
- h5p-standalone's options are attributes by the same names, and ride in the package record.
- The frame uses `embedType: 'div'`.
- `H5P.getContentPath` answers the content's own folder.
- The frame is navigated in place, not through its `src`.
- The frame's `<html>` carries `class="h5p-iframe"`.
- The frame's own CSS pins a YouTube iframe over its box.
- The frame reports the runtime's own failed loads.

### Results and saved state: [`design/results.md`](design/results.md)

Read it before changing what reaches the host: statements and `revision`, `finished`, `resume` (`src/shared/revision.ts`, `src/user-data-store.ts`, `packages/runtime/src/finished.ts`).

- Every statement names the build it came from.
- `finished` is the content's result: H5P's own rule, and the core's mark on sub-content.
- The saved state never leaves the page, and never meets the Service Worker.

### The element: [`design/element.md`](design/element.md)

Read it before changing `src/h5p-offline-player.ts`: loads, the worker's registration and upgrade, the events, the element's box and its height.

- What a load asked for is the load's, not the package's.
- The element says what it is playing: `source`, `metadata`, `libraryBundle`.
- Clearing site data demolishes three things at once, all held by handles that still look valid.
- The element waits for *its own* registration to reach `activated`.
- `navigator.serviceWorker` is read through `serviceWorkers()`, never directly by the element.
- The first load after an upgrade is brought to the element's version before the frame boots.
- A `need-file` request that times out leaves `pendingFiles`, not just its promise.
- A runtime error after `ready` is an event, not a state.

### Untrusted packages and security: [`design/security.md`](design/security.md)

Read it before changing entry names, `untrusted`, the content check (`packages/runtime/src/content-check.ts`), the frame's policy or the messages between the frame and the element.

- Entry names are rejected, never sanitised.
- The traversal check that matters is the one on archive names, not on request paths.
- An untrusted package plays as data.
- The frame CSP's runtime allowlist is written without schemes.
- The frame posts to `location.origin`, and the element checks `event.origin`.

## The other packages, the site and the rest

- **The normalizer** (`packages/normalize/`): [`design/normalize.md`](design/normalize.md).
- **The verifier** (`packages/verify/`): [`design/verify.md`](design/verify.md).
- **The author package** (`packages/author/`, `skills/h5p-author/`): [`design/author.md`](design/author.md).
- **The VS Code extension** (`packages/vscode/`): [`design/vscode.md`](design/vscode.md).
- **The SCORM package** (`packages/embed/lib/scorm*.mjs`, `packages/embed/scorm/`, the SCORM page): [`design/scorm.md`](design/scorm.md).
- **The embed site** (`packages/embed/` but its SCORM side, the demo's `/embed`): [`design/embed.md`](design/embed.md).
- **cmi5** (`packages/cmi5/`, the demo's cmi5 page, CATAPULT): [`design/cmi5.md`](design/cmi5.md).
- **The hosted demo and the app** (`apps/demo/`, `vercel.json`, `api/`): [`design/demo.md`](design/demo.md). It compiles the element from the player's source, not from `dist/`, as [`design/layout.md`](design/layout.md) explains.
- **Build shape, types and publishing** (the artefacts and how each is built, the plain-JS packages' declarations, Node versions): [`design/build.md`](design/build.md).
- **Tests and CI** (the engines, CI's browsers, the fixtures, the sweep): [`design/testing.md`](design/testing.md).
- **Licensing and names**: [`design/licensing.md`](design/licensing.md). The player is MIT and carries no GPL code: the H5P core and the boot script are `@missing-elements/h5p-runtime`, GPL-3.0, reached only over HTTP and `postMessage`, and every shipped file with third-party code opens with its notice. A name that leads with "H5P" says who made it ("… by Missing Elements"), as H5P Group's trademark policy asks.
- **Scope** (what differs from the original architecture document, and what is not built yet): [`design/scope.md`](design/scope.md).
