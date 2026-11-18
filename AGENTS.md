# AGENTS.md

The index for working in this repository. [`design/`](design/) holds the rules in full, one file
per area, with the reasons and the measurements behind them; it is the authority on the design, and
where it and the code disagree, one of them is wrong. **Before changing code in an area, read its
file in `design/`:** its rules are the bold sentences there, and its opening says what it
covers. A name in italics, *like this*, is a rule or a section there: grep `design/` for it. The
README and `docs/` are written for people integrating the packages.

## What this is

Self-hosted H5P without an H5P server: a browser-only player, shipped as one web component, that a
host puts on infrastructure it controls. That is the product's main benefit, and the documents lead
with it. It plays an arbitrary `.h5p` archive fetched from a URL or picked from disk, with no
server-side code and no extraction step: the zip is read in place and a Service Worker serves its
entries to the H5P runtime over a virtual file server.

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

Most bugs here come from forgetting which context a line runs in. The Service Worker is stateless
by assumption, and asks a page for what only a page can do through the frame:
[`design/serving.md`](design/serving.md).

| Context | Lives as long as | Can | Cannot |
|---|---|---|---|
| Page (element) | The tab | Hold the `File`, own the Jobs worker, emit DOM events | Touch package bytes |
| Service Worker | One event, unpredictably | Serve requests, read IndexedDB and the chunk store | Run long work, spawn a Worker, hold state across events |
| Jobs worker | The tab | Download, inflate, take Web Locks | Intercept requests, reach the DOM |

## Where things are, and whose rules

A pnpm workspace of ten packages and two apps. [`design/layout.md`](design/layout.md) maps the
folders; in `design/`, `src/…` and `scripts/…` mean the player's unless a file says otherwise.

| Part | What it is | Rules |
|---|---|---|
| `packages/player/` | the `<h5p-player>` element, MIT: the Service Worker in `src/sw/`, the Jobs worker in `src/jobs/`, what they share in `src/shared/` | by area, below |
| `packages/runtime/` | the H5P core, vendored, and the frame's boot script, GPL-3.0 | [frame](design/frame.md) |
| `packages/libraries/` | the library pack, one archive per library | [libraries](design/libraries.md) |
| `packages/normalize/` | rewrites a package so it streams | [normalize](design/normalize.md) |
| `packages/verify/` | plays a package headless and reports | [verify](design/verify.md) |
| `packages/author/`, `skills/h5p-author/` | a playable package of any content type from a short source | [author](design/author.md) |
| `packages/mcp/` | the local MCP server: builds, checks and previews in an app with no shell | [mcp](design/mcp.md) |
| `packages/cmi5/` | the element as a cmi5 assignable unit | [cmi5](design/cmi5.md) |
| `packages/embed/`, `skills/h5p-to-scorm/` | the embed site for a player domain, and a package as a SCORM zip | [embed](design/embed.md), [scorm](design/scorm.md) |
| `packages/vscode/` | H5P Preview, the VS Code extension | [vscode](design/vscode.md) |
| `apps/demo/`, `vercel.json`, `api/` | the dev server for the whole repository, the hosted site and its app | [demo](design/demo.md) |
| `apps/skills/`, `skills/` | the agent skills, and the project they are tested from | [testing](design/testing.md) |

The player, by area:

- [Serving archives](design/serving.md): the Service Worker's file server, how a source is read, the warm.
- [Storage and the Jobs worker](design/storage.md): the chunk store, eviction and quota, the Jobs worker.
- [Libraries](design/libraries.md): which libraries a package plays with, the pack, refresh, addons.
- [The frame and the runtime](design/frame.md): the frame document, the boot route, the runtime package.
- [Results and saved state](design/results.md): statements and `revision`, `finished`, `resume`.
- [The element](design/element.md): loads, the worker's registration and upgrade, the events, the box.
- [Untrusted packages and security](design/security.md): entry names, `untrusted`, the content check, the frame's policy and messages.

Across the repository: build shape, types, publishing and Node versions (22 LTS or 24 LTS) in
[`design/build.md`](design/build.md); tests and CI in [`design/testing.md`](design/testing.md);
licensing and names in [`design/licensing.md`](design/licensing.md), where the player is MIT and
carries no GPL code, reaching `@missing-elements/h5p-runtime` only over HTTP and `postMessage`; what
is not built yet in [`design/scope.md`](design/scope.md).

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

Every other command, and what to know when running them: [`design/commands.md`](design/commands.md).
**What is tested**, by the owner's rule: the packages and their source, and of the demo app only
the installable app; the demo's pages are checked by hand, and the skills are tested from
`apps/skills`.
