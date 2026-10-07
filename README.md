# @missing-elements/h5p-offline-player

[![npm](https://img.shields.io/npm/v/%40missing-elements%2Fh5p-offline-player)](https://www.npmjs.com/package/@missing-elements/h5p-offline-player)
[![licence](https://img.shields.io/npm/l/%40missing-elements%2Fh5p-offline-player)](https://github.com/missing-elements/h5p-offline-player/blob/main/LICENSE)
[![skills.sh](https://skills.sh/b/missing-elements/h5p-offline-player)](https://skills.sh/missing-elements/h5p-offline-player)

A browser-only H5P player, as one web component, self-hostable and builds fully offline PWA. It plays an arbitrary `.h5p` archive from a URL
or from disk — no server-side extraction, no backend, nothing to unpack ahead of time.

**Try it:** 

[Player](https://h5p-offline-player.vercel.app/) — paste a URL or pick a file

[Offline app (PWA)](https://h5p-offline-player.vercel.app/app/) — install it in Chrome or Edge and play `.h5p` files with no network

```html
<script type="module" src="h5p-player.js"></script>
<h5p-player src="https://host.example/course.h5p"></h5p-player>
```

Setting `src` loads, the way it does on `<video>`.

## Getting started

The player is three things: the element (`h5p-player.js`, an ES module), a Service Worker script
(`h5p-sw.js`) and a folder of H5P runtime files (`frame-assets/`). The worker is the one file that
has to be served from **your own origin**, because browsers refuse to register a worker from
anywhere else. The other two can come from your bundle or from a CDN.

**A · With a bundler** (Vite, webpack 5, Rollup):

```bash
# With npm
npm install @missing-elements/h5p-offline-player
# With pnpm
pnpm add @missing-elements/h5p-offline-player
```

```js
import '@missing-elements/h5p-offline-player'
```

```html
<h5p-player src="https://host.example/course.h5p"></h5p-player>
```

That is all: nothing to copy, nothing to configure. The element names every file it needs —
the worker, the two runtime scripts, the stylesheet, each font — with its own
`new URL('./file', import.meta.url)`, and each file stands alone, so these bundlers emit them as
hashed assets and rewrite the URLs themselves, in the dev server as in the build. A bundler that
does not follow that pattern, esbuild among them, leaves the files behind: then serve the
package's `dist/` folder from a static path and set `sw` and `assets-base` to it.

**B · No build step:**

```html
<script type="module"
  src="https://cdn.jsdelivr.net/npm/@missing-elements/h5p-offline-player/dist/h5p-player.js"></script>
<h5p-player src="https://host.example/course.h5p" sw="/h5p-sw.js"></h5p-player>
```

Copy `dist/h5p-sw.js` from the same CDN path onto your site and point `sw` at it. The frame assets
keep loading from the CDN. At the root its scope is `/h5p/`, not `/`, so an existing site worker
is left alone.

**C · An iframe, nothing on your site:** frame the hosted player page,
`/embed?src=<package url>`. It sizes itself through H5P's own resizer protocol and relays xAPI
statements to your page on request, and takes the display options below as query parameters
(`&frame&copyright`, `&activity-id=…`). See Setup C in the setup guide. A third-party site embedding it from GitHub Pages: [alekswebnet.github.io/h5p](https://alekswebnet.github.io/h5p/).

```html
<iframe src="https://h5p-offline-player.vercel.app/embed?src=https://h5p-offline-player.vercel.app/demo/content/quiz.h5p&xapi=https://your-site.example"
        allow="fullscreen" style="width: 100%; border: 0"></iframe>
<script src="https://h5p-offline-player.vercel.app/resizer.js"></script>
```

The script line sizes the iframe to the content; without it the frame keeps the height your CSS gives it.

Requirements: the page is on `https://` or `localhost`, and the package's host sends CORS
headers. `Range` support on the host is optional; without it the archive is downloaded once and
played from the browser's cache.

The full guide, with single-worker hosts and troubleshooting, is
[h5p-player-setup.md](https://github.com/missing-elements/h5p-offline-player/blob/main/h5p-player-setup.md).

## How it works

An `.h5p` file is a zip. Normally a server unpacks it and serves the files; here a Service Worker
reads the archive in place and answers the H5P runtime's requests out of it:

- the archive's **central directory** is read over HTTP `Range` requests, so a 300 MB package
  costs a few kilobytes before it starts;
- **large spans are pulled by several connections at once** and reassembled in order, because a
  single connection is often capped well below the link — the first one streams straight into
  the inflate, and the others open once it flows, so a slow link still sees its first bytes
  within a second or two;
- **small entries and scripts** are inflated once into a Cache API store — and on a host that
  honours `Range`, the runs of the archive that hold the libraries are pulled whole before the
  frame boots, a few requests instead of one or two per file. Against a host that answers a
  client's requests one at a time, that was the difference between a 128 s boot and a 9 s one;
- **large stored media** is sliced straight out of the archive — never extracted, never stored;
- **large deflated media** is inflated into 8 MB chunks by a page-side worker, and served
  progressively as a shorter `206` so a cold video starts before extraction finishes. One video
  at a time, the one the content asked for first at the head of the line, because a runtime that
  instantiates six videos at boot asks for all six, and sharing the link six ways only makes the
  one on screen slow;
- the **frame document** the runtime lives in is generated by the worker, with a per-response CSP.

Nothing larger than one chunk is ever held in memory. A host that does not honour `Range` is
handled by downloading the archive into the chunk store — indexed from its local headers as it
arrives, so a package laid out libraries-first boots while its media is still coming down. A host
with no CORS headers cannot be read by any browser, and the element says so with `error: no-cors`
so the page can offer a file picker instead.

## API

| Name | Set as | What it does |
|---|---|---|
| `src` | attribute, property | The package URL. Setting it loads; setting it again aborts and reloads; removing it empties the player |
| `file` | property | A `File` from a picker. Setting it loads with no network and wins over `src`; `null` empties the player |
| `sw` | attribute | The worker's URL. Default: `h5p-sw.js` next to the element. Must be same-origin |
| `jobs` | attribute | The background worker's URL, for a page whose CSP has no `blob:` in `worker-src`. Default: a `blob:` URL, then `h5p-jobs.js` next to the element. Must be same-origin |
| `assets-base` | attribute | The directory of the frame assets. Default: `frame-assets/` next to the element; may be a CDN |
| `libraries` | attribute | `hub`, or the URL of a `.h5p` that carries library folders, for packages that ship without their own. Default: unset, and such packages are refused (see Guides) |
| `allow-origins` | attribute | Extra origins the frame's CSP should permit, space separated (see Guides) |
| `frame`, `copyright`, `export`, `icon`, `embed` | attribute | h5p-standalone's display options, by name: the bare attribute shows the H5P action bar, and the copyright, download, H5P-icon and embed buttons in it. The copyright dialog is built from the package's `h5p.json` and its media's own notices; `export` needs `download-url` or a package URL; `embed` needs `embed-code`. Default: all off |
| `fullscreen` | attribute | `off` removes the fullscreen button. Default: on |
| `download-url` | attribute | What the download button offers. Default: the package URL |
| `embed-code` | attribute | What the embed button offers; `:w` and `:h` stand for the size |
| `resize-code` | attribute | The sizing script the embed dialog offers under "advanced" with that code; h5p-standalone's `resizeCode` |
| `custom-css`, `custom-js` | attribute | Stylesheets and scripts to load in the frame after the runtime's own, space separated; h5p-standalone's `customCss` and `customJs`. Their origins are allowed by the frame's CSP without `allow-origins` |
| `reporting` | attribute | The bare attribute enables the submit button in content types that have one: Question Set, Interactive Video, Course Presentation, Interactive Book; h5p-standalone's `reportingIsEnabled` |
| `activity-id` | attribute | The id statements carry as their object; h5p-standalone's `xAPIObjectIRI`. Default: the package URL, or the frame's own URL for a file |
| `user` | property | The learner, `{ name, mail }`, as the actor of every statement; h5p-standalone's `user`. Read by the load, so set it before `src`. Default: H5P's anonymous actor |
| `auto-resize` | attribute | `off` to size the element yourself, from CSS or the `resize` event. By default it follows the content's own height |
| `preload` | attribute, property | `auto` pulls large deflated media before the content asks (see Guides). Default: `none` |
| `resume` | attribute, property | `device` (or the bare attribute) keeps the content's saved state on this device and resumes from it; `host` hands it to the host page instead (see Guides). Default: `off` |
| `userData` | property | Under `resume="host"`, the state to hand the content: `[{ dataType, subContentId, data }]` as earlier `userdata` events carried it. Read by the load, so set it before `src` |
| `state` | property, read-only | `idle`, `probing`, `downloading`, `indexing`, `ready` or `error` |
| `pkgId` | property, read-only | The id of the package loaded now; `null` before one is |
| `revision` | property, read-only | The build's fingerprint, the same value the statements carry (see Guides); `null` until the package is indexed |
| `scope` | property, read-only | The Service Worker scope the virtual routes live under; `null` until registered |

| Method | What it does |
|---|---|
| `clearUserData()` | Forgets the state kept on this device for the package loaded now, or the one loaded last. The content keeps running; set `src` again to start it over. Returns a promise |

Every event is a `CustomEvent`; what it carries is in `event.detail`.

| Event | `detail` | When |
|---|---|---|
| `ready` | `{ pkgId }` | The runtime is up and the content is visible |
| `xapi` | `{ statement, verb }` | Any xAPI statement from the content, `verb` its verb's id (`http://adlnet.gov/expapi/verbs/answered`, …) — the only channel for results; statements are never stored |
| `finished` | `{ statement }` | The content reported completion; the score is in the statement's `result` |
| `userdata` | `{ pkgId, dataType, subContentId, data, revision }` | With `resume`: the content saved its state, `data` as the JSON it produced, against the build `revision` names. `data: null` means the content deleted it: drop your copy |
| `progress` | `{ phase, fraction, loaded, total, entry? }` | `phase` is `download`, `libraries`, `warm` or `extract`; `fraction` is 0–1, or `null` with `total` when the size is unknown |
| `resize` | `{ height }` | The content reported a new height, in CSS pixels |
| `statechange` | `{ state }` | `state` changed |
| `error` | `{ code, message, missingLibraries? }` | `code` is `no-cors`, `no-worker`, `network`, `quota`, `bad-archive` or `runtime`; `missingLibraries` comes with a package that lacks the libraries it declares. A `runtime` error after `ready` leaves `state` at `ready`: the content threw but is still running |

```js
const player = document.querySelector('h5p-player')
player.addEventListener('xapi', (e) => console.log(e.detail.statement))
player.addEventListener('error', (e) => {
  if (e.detail.code === 'no-cors') showDownloadHint()
})
input.onchange = () => (player.file = input.files[0])
```

The element renders the content and nothing else — no URL field, no file picker, no progress bar,
no "open in another browser" banner. Those belong to the host page, built out of these events.
The demo's [player page](https://github.com/missing-elements/h5p-offline-player/blob/main/apps/demo/index.html)
is a working example of one.

### Guides

- [Video that cannot stream](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/streaming-video.md) — why a deflated, non-faststart mp4
  waits for its last byte, what `preload="auto"` changes, and the normalizer that fixes the package.
- [Packages without libraries](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/libraries.md) — `libraries="hub"`, or a bundle you host;
  a ready-made one with every hub content type is in the repository.
- [What the frame is allowed to reach](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/frame-csp.md) — the generated CSP,
  `allow-origins`, and why `'unsafe-eval'` is in it.
- [Which build a learner completed](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/revision.md) — the `revision` every statement
  carries, and what it does and does not prove.
- [Resuming where the learner left off](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/resume.md) — `resume`, what is stored where,
  and `resume="host"` for a site with its own users.
- [cmi5](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/cmi5.md) — the player as an assignable unit an LMS launches, with
  [`@missing-elements/h5p-cmi5`](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/cmi5): the launch, the course
  structure, what is sent, and why cmi5 rather than SCORM or LTI for this player.
- [Checking that a package plays](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/verify.md) — `h5p-verify` plays a package headless
  and says whether it worked, for the last step of a pipeline that makes packages.

## Requirements

- The page is served over `https://` or `localhost`. Service Workers do not run on `http://` or
  `file://`.
- `h5p-sw.js` is served from the site's own origin — browsers reject cross-origin Service Worker
  registration. With a bundler this is automatic. Frame assets may come from a CDN.
- Under a Content-Security-Policy, `worker-src` (or `script-src`, when there is no `worker-src`)
  allows `'self'`. The element starts its background worker from a `blob:` URL when the policy
  allows that and from `h5p-jobs.js` beside it when not; set `jobs` to that file to skip the
  `blob:` attempt, and the violation report it leaves, altogether.
- Package URLs send CORS headers. `Range` support is optional but avoids a full download first.
- Storage is optional on a host that honours `Range`, and for a file picked from disk: the
  player caches what fits and serves the rest straight from the archive. A host without `Range`
  makes it a requirement — the whole archive has to be stored — and a package larger than the
  room the browser gives the site is refused with `error: quota`, naming the size it needed.

Integration details, including bundler-specific setup and single-worker hosts, are in
[h5p-player-setup.md](https://github.com/missing-elements/h5p-offline-player/blob/main/h5p-player-setup.md). The design is in
[h5p-offline-player-architecture.md](https://github.com/missing-elements/h5p-offline-player/blob/main/h5p-offline-player-architecture.md).

## Accessibility

Conformance is judged on the player and the content type together. [ACCESSIBILITY.md](https://github.com/missing-elements/h5p-offline-player/blob/main/ACCESSIBILITY.md)
says which part is whose, what the player does (no focus trap, the frame named after the
package, fullscreen from the keyboard), what a host page should do, and what a keyboard-only
run over seven content types found.

## Agent skills

The repository ships three [agent skills](https://agentskills.io) under `skills/`, for Claude
Code, Cursor, Copilot, Codex and the rest:

```bash
npx skills add missing-elements/h5p-offline-player                       # all three
npx skills add missing-elements/h5p-offline-player --skill h5p-verify    # one
```

| Skill | For an agent that |
|---|---|
| `h5p-player-setup` | is asked to put H5P content on a website: which setup, the exact lines, how to check it, what goes wrong |
| `h5p-normalize` | hears that a package's video takes minutes to start, or publishes packages to a static host: diagnose with a dry run, rewrite once, keep the revision |
| `h5p-verify` | generates or rewrites `.h5p` packages: run `h5p-verify` before claiming one works, and read what it reports |

## Development

A pnpm workspace: the player in `packages/player`, the normalizer in `packages/normalize`, the
verifier in `packages/verify`, the cmi5 wiring in `packages/cmi5`, the demo site in `apps/demo`. The commands, the demo site and the
installable app are in [docs/development.md](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/development.md); working on the code
starts with [AGENTS.md](https://github.com/missing-elements/h5p-offline-player/blob/main/AGENTS.md).

## Licence

The player's own code — the element, the two workers, the scripts — is MIT, see
[LICENSE](https://github.com/missing-elements/h5p-offline-player/blob/main/LICENSE). The package as published is not MIT alone, and its `license` field says so:
`(MIT AND GPL-3.0-only)`.

- `dist/frame-assets/` is the H5P core runtime from
  [h5p-standalone](https://github.com/tunapanda/h5p-standalone): the scripts' code unmodified, the
  stylesheet rebuilt so that it stands alone. h5p-standalone's own code is
  MIT, but its `frame.bundle.js`, stylesheet and icon fonts come from
  [h5p-php-library](https://github.com/h5p/h5p-php-library), which is **GPL-3.0**; upstream
  confirms it in [issue #188](https://github.com/tunapanda/h5p-standalone/issues/188) while
  its npm metadata still says MIT. The directory carries its own `LICENSE.txt` and `NOTICE.txt`.
  Keep them with it when you copy or serve it: a site serving these files is distributing GPL
  code. A bundler emits the runtime files without the text files beside them, so
  `frame.bundle.js`, `main.bundle.js` and `h5p.css` each open with a notice comment naming
  their licences and the corresponding source. Whether the copyleft reaches the page around the player is a legal question, not one
  this README answers.
- The two Service Worker scripts in `dist/`, `h5p-sw.js` and `h5p-sw-mount.js`, bundle [zip.js](https://github.com/gildas-lormeau/zip.js)
  (BSD-3-Clause). Both open with its licence in full, so the notice travels with them when a
  bundler emits them on their own, and [NOTICE.md](https://github.com/missing-elements/h5p-offline-player/blob/main/packages/player/NOTICE.md) reproduces it.
  Each of the player's own files opens with a one-line notice of its own: MIT asks for its notice
  to accompany copies, and a bundler emits each file alone.
