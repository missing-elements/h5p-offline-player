# AGENTS.md

Working notes for this repository. This file is the index: what the project is, how to work in
it, and which file holds each area's rules. [`design/`](design/) holds the rules in full, with the
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
pnpm test              # every package, one at a time
pnpm test:unit         # fast, no browser
pnpm test:browser
pnpm typecheck         # every package
pnpm build             # the player: types, element, both workers; builds the runtime package on the way
pnpm verify course.h5p             # play a package in a headless browser and report whether it works
pnpm author build source.json course.h5p  # after pnpm build, or the player's build:plan
```

Every other command (the demo's content, images and screenshots, the library pack, translations,
the core's sync, the sweep, the VS Code extension) and what to know when running them, such as why
`pnpm test` runs one package at a time: [`design/commands.md`](design/commands.md).

**What is tested**, by the owner's rule: the packages and their source, and of the demo app only
the installable app; the demo's pages are checked by hand, and the skills are tested from
`apps/skills`: [`design/testing.md`](design/testing.md). Node 22 LTS or 24 LTS:
[`design/build.md`](design/build.md).

## Design rules, by area

Read the area's file before changing code in it: its rules are the bold sentences there.

- **Serving archives**, [`design/serving.md`](design/serving.md): before changing the Service
  Worker's file server (`src/sw/mount.ts`, `package-reader.ts`, `routes.ts`, `watermark-wait.ts`),
  how a source is read (`src/shared/source.ts`, `block-cache.ts`, `source-reader.ts`,
  `span-stream.ts`, `resilient-stream.ts`, `range.ts`, `local-header.ts`, `forward-index.ts`,
  `mime.ts`) or the warm (`src/jobs/warm.ts`).
- **Storage and the Jobs worker**, [`design/storage.md`](design/storage.md): before changing the
  chunk store, eviction or quota (`src/shared/chunk-store.ts`, `eviction.ts`, `locks.ts`,
  `storage.ts`, `idb.ts`) or the Jobs worker (`src/jobs/`).
- **Libraries**, [`design/libraries.md`](design/libraries.md): before changing which libraries a
  package plays with: the library check, the `libraries` sources, the pack and its parts, refresh,
  downgrade, addons, the merged manifest (`src/sw/pack-plan.ts`, `src/shared/library-folders.ts`,
  `content-libraries.ts`, `pack.ts`, `src/plan.ts`, the element's `index()`, `packages/libraries/`).
- **The frame and the runtime**, [`design/frame.md`](design/frame.md): before changing the frame
  document or the boot route (`src/sw/frame-document.ts`, `library-load.ts`) or the runtime package
  (`packages/runtime/`: the boot script, upgrades, translations).
- **Results and saved state**, [`design/results.md`](design/results.md): before changing what
  reaches the host: statements and `revision`, `finished`, `resume` (`src/shared/revision.ts`,
  `src/user-data-store.ts`, `packages/runtime/src/finished.ts`).
- **The element**, [`design/element.md`](design/element.md): before changing
  `src/h5p-offline-player.ts`: loads, the worker's registration and upgrade, the events, the
  element's box and its height.
- **Untrusted packages and security**, [`design/security.md`](design/security.md): before changing
  entry names, `untrusted`, the content check (`packages/runtime/src/content-check.ts`), the frame's
  policy or the messages between the frame and the element.

## The other packages, the site and the rest

- **The normalizer** (`packages/normalize/`): [`design/normalize.md`](design/normalize.md).
- **The verifier** (`packages/verify/`): [`design/verify.md`](design/verify.md).
- **The author package** (`packages/author/`, `skills/h5p-author/`):
  [`design/author.md`](design/author.md).
- **The VS Code extension** (`packages/vscode/`): [`design/vscode.md`](design/vscode.md).
- **The SCORM package** (`packages/embed/lib/scorm*.mjs`, `packages/embed/scorm/`, the SCORM page,
  `skills/h5p-to-scorm/`): [`design/scorm.md`](design/scorm.md).
- **The embed site** (`packages/embed/` but its SCORM side, the demo's `/embed`):
  [`design/embed.md`](design/embed.md).
- **cmi5** (`packages/cmi5/`, the demo's cmi5 page, CATAPULT): [`design/cmi5.md`](design/cmi5.md).
- **The hosted demo and the app** (`apps/demo/`, `vercel.json`, `api/`):
  [`design/demo.md`](design/demo.md). It compiles the element from the player's source, not from
  `dist/`, as [`design/layout.md`](design/layout.md) explains.
- **Build shape, types and publishing** (the artefacts and how each is built, the plain-JS packages'
  declarations, Node versions): [`design/build.md`](design/build.md).
- **Tests and CI** (the engines, CI's browsers, the fixtures, the sweep):
  [`design/testing.md`](design/testing.md).
- **Licensing and names**: [`design/licensing.md`](design/licensing.md). The player is MIT and
  carries no GPL code: the H5P core and the boot script are `@missing-elements/h5p-runtime`,
  GPL-3.0, reached only over HTTP and `postMessage`, and every shipped file with third-party code
  opens with its notice. A name that leads with "H5P" says who made it ("… by Missing Elements"), as
  H5P Group's trademark policy asks.
- **Scope** (what differs from the original architecture document, and what is not built yet):
  [`design/scope.md`](design/scope.md).
