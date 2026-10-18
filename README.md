# @missing-elements/h5p-offline-player

[![npm](https://img.shields.io/npm/v/%40missing-elements%2Fh5p-offline-player)](https://www.npmjs.com/package/@missing-elements/h5p-offline-player)
[![licence](https://img.shields.io/npm/l/%40missing-elements%2Fh5p-offline-player)](https://github.com/missing-elements/h5p-offline-player/blob/main/LICENSE)
[![skills.sh](https://skills.sh/b/missing-elements/h5p-offline-player)](https://skills.sh/missing-elements/h5p-offline-player)

Self-hosted H5P without an H5P server. One web component, on static hosting you control, that
plays `.h5p` packages from your own URLs or from disk: no Moodle, WordPress or Lumi, no backend,
no extraction step, no third-party service between your learners and your content.

- [Player](https://h5p-offline-player.vercel.app/) — paste a URL or pick a file
- [Offline app (PWA)](https://h5p-offline-player.vercel.app/app/) — install it and play `.h5p` files with no network
- [How it compares](https://h5p-offline-player.vercel.app/demo/compare.html) with h5p.com, the CMS plugins, Lumi and h5p-standalone

```html
<script type="module" src="h5p-player.js"></script>
<h5p-player src="https://host.example/course.h5p"></h5p-player>
```

## What it does

- **Plays the packages people have.** Large ones stream: a video starts before the archive has
  arrived, and a host without `Range` support still gets an early start. An export without its
  libraries, as h5p.com and h5p.org make them, plays against a
  [library pack](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/libraries.md) of every content type the H5P hub serves, downloading
  only the libraries it needs; an older export plays the pack's newer versions of its own, and its
  content is upgraded to them first.
- **Validates what it plays.** With `untrusted`, none of a package's own code runs, and its content
  is checked field by field against each library's definitions by a port of H5P's own validator.
  Every package's entry names and libraries are checked before it starts. See
  [Packages you did not make](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/untrusted.md).
- **Gives results you can audit.** Every xAPI statement names the
  [build it came from](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/revision.md), `finished` is the content's own result,
  [cmi5](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/cmi5.md) launches it from an LMS, and [resume](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/resume.md) keeps the
  learner's place.
- **Works offline, in the learner's language.** The installable app plays with no network, on iOS
  too, and H5P's own buttons follow `lang` in more than fifty languages. Results stay on your page
  unless your code sends them; [privacy](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/privacy.md)
  lists what the player fetches, and what it keeps on the device.
- **Comes with tools for pipelines.** [`h5p-verify`](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/verify.md) plays a package headless
  and says whether it works, [`h5p-normalize`](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/streaming-video.md) rewrites one so its
  video streams, and [`h5p-embed`](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/embed#readme)
  writes the embed site. The [agent skills](#agent-skills) cover all three.
- **Is tested where it runs.** CI runs the browser tests in Chromium, Firefox and WebKit, and plays
  every content type in the library pack, untrusted and trusted, on each change and every week.

## Which setup

An H5P package is JavaScript, and the player runs it on the origin that serves the frame.

| Your site | Setup |
|---|---|
| Needs the element's API (results to your backend, `resume="host"`, cmi5, a file picker) and plays packages you made | **Install** |
| Plays packages you did not make | **Install** with `untrusted` on them, or **Embed** |
| Has signed-in users | **Embed**, from a separate domain you run, or **Install** with every package `untrusted` |
| Cannot host a file (page builder, hosted CMS, LMS page) | **Embed** |

Installed, you get the whole API, and a package played as it is runs as your site. Embedded, a
package never sees your cookies, storage or page, and you get results as relayed xAPI.

`untrusted` plays a package as data. None of its own code runs: its libraries come from the
library pack, and its content is checked against each library's field definitions before it is
shown, as the H5P CMS plugins check an author's upload. Installed with `untrusted`, a package is
as contained as in an H5P plugin on the same site, and Embed adds a separate origin on top. A
package that needs a newer library than the pack has is refused until the pack catches up.
[Packages you did not make](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/untrusted.md) has the details.

Both need the page on `https://` or `localhost`, and CORS headers on the package host. `Range`
support is optional: without it the archive is downloaded once and played from the cache.

### Install with a bundler

Vite, webpack 5, Rollup:

```bash
npm install @missing-elements/h5p-offline-player @missing-elements/h5p-runtime
```

```js
import '@missing-elements/h5p-offline-player'
import { runtime } from '@missing-elements/h5p-runtime'

document.querySelector('h5p-player').runtime = runtime
```

The bundler emits the Service Worker, the runtime and its fonts as assets; nothing to copy. The
runtime is a separate package because it is GPL-3.0 (see [Licence](#licence)). With a bundler
that does not emit `new URL(…, import.meta.url)` assets, esbuild among them, serve both packages'
`dist/` and set `sw` and `assets-base`.

For [`libraries="pack"`](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/libraries.md)
served from your own site rather than jsDelivr, install `@missing-elements/h5p-libraries` too
and hand over its `pack` export, which the bundler emits as one asset per library:

```js
import { pack } from '@missing-elements/h5p-libraries'

document.querySelector('h5p-player').pack = pack
```

### Install without a build step

```html
<script type="module"
  src="https://cdn.jsdelivr.net/npm/@missing-elements/h5p-offline-player@0.10.0/dist/h5p-player.js"></script>
<h5p-player src="https://host.example/course.h5p" sw="/h5p-sw.js"
            assets-base="https://cdn.jsdelivr.net/npm/@missing-elements/h5p-runtime@0.2.5/dist/"></h5p-player>
```

Copy `dist/h5p-sw.js` of the same version onto your own site: browsers register a Service Worker
only from the page's origin. Its scope is `/h5p/`, so an existing site worker is left alone. Pin
the version, and copy the worker again whenever you change it; the element warns when the two
differ.

### Embed

[`@missing-elements/h5p-embed`](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/embed#readme)
writes the player page as a static site:

```bash
npx @missing-elements/h5p-embed h5p-player --packages https://host.example
```

Deploy it to a separate registrable domain that holds nothing else (a subdomain would receive
your site's cookies) and frame it:

```html
<iframe src="https://h5p-player.example.net/?src=https://host.example/course.h5p&xapi=https://your-site.example"
        allow="fullscreen; microphone; camera" style="width: 100%; border: 0"></iframe>
<script src="https://h5p-player.example.net/resizer.js"></script>
```

`microphone` and `camera` are for the content types that record or film: Audio Recorder, Speak the
Words and AR Scavenger. A frame from another site gets neither unless the page allows it.

When something goes wrong, see [Troubleshooting](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/troubleshooting.md). A site that
allows one Service Worker, or must work offline, mounts the player in its own worker:
[single-worker hosts](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/single-worker.md).

## API

| Name | Set as | What it does |
|---|---|---|
| `src` | attribute, property | The package URL. Setting a new one loads; removing it empties the player. To reload the same URL, remove it and set it again |
| `file` | property | A `File` from a picker; wins over `src` |
| `sw` | attribute | The Service Worker's URL, same-origin. Default: `h5p-sw.js` beside the element |
| `jobs` | attribute | The background worker's URL, for a CSP without `blob:` in `worker-src`. Default: `blob:`, then `h5p-jobs.js` beside the element |
| `runtime` | property | The `runtime` export of `@missing-elements/h5p-runtime`. Set before `src` |
| `assets-base` | attribute | Where the runtime's `dist/` is served. Default: `frame-assets/` beside the element |
| `libraries` | attribute | Sources for a package's libraries, tried in order: `pack`, the library pack, of which only the libraries a package needs are downloaded, and whose newer versions play in place of those a package carries; a `.h5p` URL, which only fills gaps; or both. `hub` means `pack`. Default: a package plays as it is, and one without its libraries is refused |
| `pack-base` | attribute | Where `pack` is: the folder of a copy of `@missing-elements/h5p-libraries`' `parts/` on your site. Default: jsDelivr, at the version this release pins |
| `pack` | property | The `pack` export of `@missing-elements/h5p-libraries`, as a bundler emits it; wins over `pack-base`. Set before `src` |
| `refresh-libraries` | attribute | `off` plays the libraries a package carries as exported, and `pack` only fills gaps. Default: the pack's newer versions play |
| `untrusted` | attribute, property | Plays a package you did not make as data: its own library folders are ignored and the libraries come from `libraries` (default `pack`), `content/` serves only H5P's own file types, and the frame's script policy names exact paths. Its content is checked against each library's `semantics.json`, as the H5P CMS plugins check it. A package that needs its own copy of a library is refused, with `missingLibraries.carried` set. Needs the runtime at 0.2 or later |
| `allow-origins` | attribute | Extra origins for the frame's CSP, space separated |
| `frame`, `copyright`, `export`, `icon`, `embed` | attribute | Show the H5P action bar and its buttons. `export` needs `download-url` or a package URL, `embed` needs `embed-code` |
| `fullscreen` | attribute | `off` removes the fullscreen button |
| `download-url`, `embed-code`, `resize-code` | attribute | What the download and embed buttons offer; `:w` and `:h` in `embed-code` stand for the size |
| `custom-css`, `custom-js` | attribute | Stylesheets and scripts loaded in the frame after the runtime's own |
| `reporting` | attribute | Enables the submit button in content types that have one |
| `activity-id` | attribute | The statements' object id. Default: the package URL |
| `lang` | attribute | The language of H5P's own buttons and dialogs, such as "Fullscreen" and "Rights of use", in more than fifty languages. Inherited from the page like any element's language, and read at each load. Default: English |
| `user` | property | `{ name, mail }`, the actor of every statement. Set before `src` |
| `auto-resize` | attribute | `off` to size the element yourself. Default: follows the content's height |
| `preload` | attribute, property | `auto` pulls large deflated media before it is asked for. Default: `none` |
| `resume` | attribute, property | `device` keeps the content's saved state on this device; `host` hands it to the page. Default: `off` |
| `save-interval` | attribute, property | Seconds between saves while the content runs, with `resume`; also saved after each completion and as the page closes. Default: `10` |
| `userData` | property | Under `resume="host"`, the state to restore, as `userdata` events carried it. Set before `src`. Not checked against the build: compare the `revision` you stored |
| `state` | read-only | `idle`, `probing`, `downloading`, `indexing`, `ready` or `error` |
| `pkgId`, `revision` | read-only | The loaded package's id and build fingerprint |
| `source` | read-only | `{ type: 'range-http' \| 'chunked' \| 'file', size, … }` |
| `metadata` | read-only | `h5p.json`'s metadata plus `mainLibrary` |
| `libraryBundle` | read-only | `{ url, origin, fromCache, refreshed? }` for what supplied libraries: for the pack, `refreshed` lists the libraries the package carries that played at the pack's version, `{ library, from, to }` |
| `scope` | read-only | The Service Worker scope |

`clearUserData()` forgets the state kept on this device for the current package; remove `src` and set it again to restart the content.

Events are `CustomEvent`s:

| Event | `detail` | When |
|---|---|---|
| `ready` | `{ pkgId, source, metadata, revision, libraryBundle }` | The content is visible |
| `xapi` | `{ statement, verb }` | Any xAPI statement; nothing is stored |
| `finished` | `{ statement }` | The content reported its result: a `completed` or `answered` statement from the content itself, not from a part inside it. That is H5P's own `setFinished` rule, except that a part created without a parent counts as a part too, which H5P's rule misses for Interactive Book's chapters and Game Map's exercises. It can come more than once, for a question checked again; the last is the result. Content that reports no result of its own never raises it, and Interactive Book reports one only with `reporting` |
| `userdata` | `{ pkgId, dataType, subContentId, data, revision }` | With `resume`: the content saved its state; `data: null` means delete it |
| `progress` | `{ phase, fraction, loaded, total, entry? }` | `download`, `libraries`, `warm` or `extract`; `fraction` is 0–1, or `null` while the total is unknown |
| `resize` | `{ height }` | The content's height changed |
| `statechange` | `{ state }` | `state` changed |
| `error` | `{ code, message, missingLibraries? }` | `no-cors`, `no-worker`, `network`, `quota`, `bad-archive` or `runtime`. An error while `state` stays `ready` (a content exception, or one media file that failed to extract) leaves the content running |

```js
const player = document.querySelector('h5p-player')
player.addEventListener('xapi', (e) => console.log(e.detail.statement))
player.addEventListener('error', (e) => {
  if (e.detail.code === 'no-cors') showDownloadHint()
})
input.onchange = () => (player.file = input.files[0])
```

The element renders the content and nothing else; URL fields, pickers and progress bars belong
to the page. The demo's [player page](https://github.com/missing-elements/h5p-offline-player/blob/main/apps/demo/index.html)
is an example.

## Guides

- [Packages you did not make](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/untrusted.md) — `untrusted` and the content check
- [Video that cannot stream](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/streaming-video.md) — `preload` and the normalizer
- [Libraries](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/libraries.md) — the library pack, for packages without their libraries and older than it
- [The frame's CSP](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/frame-csp.md) — `allow-origins`, and what `untrusted` narrows
- [Which build a learner completed](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/revision.md) — `revision`
- [Resume](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/resume.md) — saved state on the device or with the host
- [Privacy and data protection](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/privacy.md) — what is stored and sent, for a privacy notice or a GDPR review
- [cmi5](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/cmi5.md) — launching from an LMS
- [Verifying a package](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/verify.md) — `h5p-verify`
- [Troubleshooting](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/troubleshooting.md) — symptoms, causes and fixes
- [Single-worker hosts and upgrades](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/single-worker.md)
- [Compatibility](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/compatibility.md) — what a version number promises, and what it does not
- [Coming from h5p-standalone](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/h5p-standalone.md) — its options by their names here
- [Accessibility](https://github.com/missing-elements/h5p-offline-player/blob/main/ACCESSIBILITY.md)

## Agent skills

```bash
npx skills add missing-elements/h5p-offline-player
```

`h5p-player-setup` puts H5P on a site, `h5p-normalize` fixes packages whose video will not
stream, `h5p-verify` checks a generated package plays.

## Development

A pnpm workspace; see [docs/development.md](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/development.md)
and [AGENTS.md](https://github.com/missing-elements/h5p-offline-player/blob/main/AGENTS.md).

## Licence

The player is MIT ([LICENSE](https://github.com/missing-elements/h5p-offline-player/blob/main/LICENSE)).
Its Service Worker bundles [zip.js](https://github.com/gildas-lormeau/zip.js), BSD-3-Clause
([NOTICE.md](https://github.com/missing-elements/h5p-offline-player/blob/main/packages/player/NOTICE.md)).

The H5P runtime the frame loads is GPL-3.0, from [h5p-php-library](https://github.com/h5p/h5p-php-library)
by way of [h5p-standalone](https://github.com/tunapanda/h5p-standalone)
([#188](https://github.com/tunapanda/h5p-standalone/issues/188)). It is published separately as
[`@missing-elements/h5p-runtime`](https://www.npmjs.com/package/@missing-elements/h5p-runtime);
the player talks to it only over HTTP and `postMessage`. Its
[NOTICE.md](https://github.com/missing-elements/h5p-offline-player/blob/main/packages/runtime/NOTICE.md)
says what serving it entails. Whether the copyleft reaches the page around the player is a legal
question this README does not answer.
