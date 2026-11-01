# @missing-elements/h5p-offline-player

[![npm](https://img.shields.io/npm/v/%40missing-elements%2Fh5p-offline-player)](https://www.npmjs.com/package/@missing-elements/h5p-offline-player)
[![licence](https://img.shields.io/npm/l/%40missing-elements%2Fh5p-offline-player)](https://github.com/missing-elements/h5p-offline-player/blob/main/LICENSE)

Self-hosted [H5P](https://h5p.org) without an H5P server. A standalone player in one web component, on static
hosting you control, that plays `.h5p` packages from your own URLs or from disk in any front end:
no Moodle, WordPress or Lumi, no backend, no extraction step, no third-party service between your
learners and your content.

**Status:** stable since 1.0, released on 18 October 2026, and maintained.
[Compatibility](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/compatibility.md) says what a version number promises,
and the library pack is checked against the H5P hub and the translations against Moodle's every
week. The player is MIT; the H5P runtime it loads is GPL-3.0 and published separately, as
[Licence](#licence) explains. Report vulnerabilities privately, as [SECURITY.md](https://github.com/missing-elements/h5p-offline-player/blob/main/SECURITY.md) describes.

- [Player](https://h5p-offline-player.vercel.app/) — paste a URL or pick a file
- [Offline app (PWA)](https://h5p-offline-player.vercel.app/app/) — install it and play `.h5p` files with no network
- [VS Code extension](https://marketplace.visualstudio.com/items?itemName=MissingElements.h5p-preview) — click a `.h5p` and it plays in an editor tab, offline; on [Open VSX](https://open-vsx.org/extension/MissingElements/h5p-preview) for Cursor and VSCodium
- [How it compares](https://h5p-offline-player.vercel.app/demo/compare.html) with h5p.com, the CMS plugins, Lumi and h5p-standalone

Once the player's files are on your site, as [Which setup](#which-setup) describes, a package is
one element:

```html
<script type="module" src="h5p-player.js"></script>
<h5p-player src="https://host.example/course.h5p"></h5p-player>
```

## Why this player

[h5p-standalone](https://github.com/tunapanda/h5p-standalone) plays a package you have unzipped
onto a server. It is smaller and has been around longer, and for a few packages you are happy to
unzip, it is enough. This player reads the `.h5p` file itself, from a URL or from disk, so a large
package's video plays while the rest is still arriving, and a package you did not make can play
without its own code running.

It is a player, not an editor: author in Lumi, on h5p.com or in a site with the H5P plugin, and
play the export here. It stores no results: the `xapi` and `finished` events go wherever your
page, an LRS or cmi5 sends them, and a package wrapped as a SCORM zip reports to the LMS it is
uploaded to.
[How it compares](https://h5p-offline-player.vercel.app/demo/compare.html) says when to choose
something else.

## What it does

- **Plays the packages people have.** Large ones stream, a video starting before the archive has
  arrived. An export without its libraries, as h5p.com and h5p.org make them, plays against a
  [library pack](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/libraries.md)
  of every content type the H5P hub serves, downloading only the libraries it needs.
- **Validates what it plays.** With `untrusted`, none of a package's own code runs, and its content
  is checked field by field against each library's definitions by a port of H5P's own validator:
  [Packages you did not make](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/untrusted.md).
- **Gives results you can audit.** Every xAPI statement names the
  [build it came from](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/revision.md),
  [cmi5](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/cmi5.md) launches it from an LMS, a
  [SCORM package](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/embed#a-scorm-package-for-an-lms)
  puts one in Moodle, ILIAS, OpenOLAT, Chamilo or another LMS with its score, and [resume](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/resume.md)
  keeps the learner's place.
- **Works offline, in the content's language.** The installable app plays with no network, on iOS
  too, and H5P's own buttons follow the language the content is written in, any of more than fifty.
  Nothing leaves your page unless your code sends it:
  [privacy](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/privacy.md).
- **Comes with tools for pipelines.** [`h5p-verify`](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/verify.md)
  plays a package headless and says whether it works, [`h5p-normalize`](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/streaming-video.md)
  rewrites one so its video streams, [`h5p-embed`](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/embed#readme)
  writes the embed site, and [`h5p-author`](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/author#readme)
  builds a package of any content type from a short JSON source. The [agent skills](#agent-skills)
  cover those workflows and authoring.
- **Is tested where it runs.** CI runs the browser tests in Chromium, Firefox and WebKit on every
  change, and plays every content type in the library pack, untrusted and trusted, on each change
  to the player, the runtime or the pack, and every week.

## Which setup

An H5P package is JavaScript, and the player runs it on the origin that serves the frame.

| Your site | Setup |
|---|---|
| Needs the element's API (results to your backend, `resume="host"`, cmi5, a file picker) and plays packages you made | **Install** |
| Plays packages you did not make | **Install** with `untrusted` on them, or **Embed** |
| Has signed-in users | **Embed**, from a separate domain you run, or **Install** with every package `untrusted` |
| Cannot host a file (page builder, hosted CMS, LMS page) | **Embed** |

Installed, you get the whole API, and a package played as it is runs as your site. Embedded, a
package never sees your cookies, storage or page, and you get results as relayed xAPI. `untrusted`
plays a package as data, none of its own code running and its content checked, as an H5P plugin
checks an author's upload: [Packages you did not make](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/untrusted.md).

Both need the page on `https://` or `localhost`, and CORS headers on the package host; `Range`
support is optional. [Setting up the player](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/setup.md)
has every path below in full: the library pack from your own site, jsDelivr, caching, upgrades.

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
runtime is a separate package because it is GPL-3.0 (see [Licence](#licence)).

### Install without a build step

Copy the files onto your own site; npm is only how you get them. `public/` stands for the folder
your site is served from:

```bash
npm install @missing-elements/h5p-offline-player @missing-elements/h5p-runtime
cp -r node_modules/@missing-elements/h5p-offline-player/dist public/h5p-player
cp -r node_modules/@missing-elements/h5p-runtime/dist public/h5p-player/frame-assets
```

```html
<script type="module" src="/h5p-player/h5p-player.js"></script>
<h5p-player src="https://host.example/course.h5p"></h5p-player>
```

The element finds the Service Worker and the runtime beside its own script, so it needs no other
attribute. Serve the folder with `Cache-Control: no-cache`: the file names stay the same from one
version to the next.

### Embed

[`@missing-elements/h5p-embed`](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/embed#readme)
writes the player page as a static site (Node 22 or later):

```bash
npx @missing-elements/h5p-embed@latest h5p-player --packages https://host.example
```

Deploy it to a separate registrable domain that holds nothing else and frame it:

```html
<iframe src="https://h5p-player.example.net/?src=https://host.example/course.h5p&xapi=https://your-site.example"
        allow="fullscreen; microphone; camera" style="width: 100%; border: 0"></iframe>
<script src="https://h5p-player.example.net/resizer.js"></script>
```

When something goes wrong, see [Troubleshooting](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/troubleshooting.md). A site that
allows one Service Worker, or must work offline, mounts the player in its own worker:
[single-worker hosts](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/single-worker.md).

## API

`<h5p-player>` takes the package as `src` or as a `file` from a picker, the library pack as
`libraries="pack"`, `untrusted`, `resume`, `lang` and H5P's display options by their own names,
and emits `ready`, `xapi`, `finished`, `userdata`, `progress`, `resize`, `statechange` and `error`.
[The element's API](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/api.md)
lists every attribute, property, method and event with its `detail`; it is the contract
[Compatibility](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/compatibility.md) holds a version to.

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

- [Setting up the player](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/setup.md) — each install path in full: the pack from your own site, jsDelivr, caching, upgrades
- [The element's API](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/api.md) — every attribute, property, method and event
- [Packages you did not make](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/untrusted.md) — `untrusted` and the content check
- [Video that cannot stream](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/streaming-video.md) — `preload` and the normalizer
- [Libraries](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/libraries.md) — the library pack, for packages without their libraries and older than it
- [The frame's CSP](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/frame-csp.md) — `allow-origins`, and what `untrusted` narrows
- [Which build a learner completed](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/revision.md) — `revision`
- [Resume](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/resume.md) — saved state on the device or with the host
- [Privacy and data protection](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/privacy.md) — what is stored and sent, for a privacy notice or a GDPR review
- [cmi5](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/cmi5.md) — launching from an LMS
- [A SCORM package](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/embed#a-scorm-package-for-an-lms) — one package in an LMS, with its score and the learner's place, and the LMSs it is checked in
- [Verifying a package](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/verify.md) — `h5p-verify`
- [Troubleshooting](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/troubleshooting.md) — symptoms, causes and fixes
- [Single-worker hosts and upgrades](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/single-worker.md)
- [Compatibility](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/compatibility.md) — what a version number promises, and what it does not
- [Coming from h5p-standalone](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/h5p-standalone.md) — its options by their names here
- [Accessibility](https://github.com/missing-elements/h5p-offline-player/blob/main/ACCESSIBILITY.md)

## Agent skills

[![skills.sh](https://skills.sh/b/missing-elements/h5p-offline-player)](https://skills.sh/missing-elements/h5p-offline-player)

```bash
npx skills add missing-elements/h5p-offline-player
```

[`h5p-author`](https://github.com/missing-elements/h5p-offline-player/tree/main/skills/h5p-author)
turns a prompt or lesson into H5P content of any of 28 types, chosen with you first: quizzes, fill
in the blanks, flash cards, presentations, interactive books, branching scenarios, interactive video
and more. It verifies the package in the real player and opens it in your browser for you to play
before handing it over. `h5p-player-setup` puts H5P on a
site, `h5p-normalize` fixes packages whose video will not stream, and `h5p-verify` checks that a
generated package plays. They work with Claude Code and other agents with filesystem and command
access, with no provider API key or H5P server; a verifier pass checks startup and rendering, not
whether the answers are right.

## Development

A pnpm workspace; see [docs/development.md](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/development.md)
and [AGENTS.md](https://github.com/missing-elements/h5p-offline-player/blob/main/AGENTS.md).

## Licence

The player is MIT ([LICENSE](https://github.com/missing-elements/h5p-offline-player/blob/main/LICENSE));
its Service Worker bundles [zip.js](https://github.com/gildas-lormeau/zip.js), BSD-3-Clause
([NOTICE.md](https://github.com/missing-elements/h5p-offline-player/blob/main/packages/player/NOTICE.md)).
The H5P runtime the frame loads is GPL-3.0, the H5P core from
[h5p-php-library](https://github.com/h5p/h5p-php-library) and the script that boots it, published
separately as [`@missing-elements/h5p-runtime`](https://www.npmjs.com/package/@missing-elements/h5p-runtime);
the player talks to it only over HTTP and `postMessage`, and its
[NOTICE.md](https://github.com/missing-elements/h5p-offline-player/blob/main/packages/runtime/NOTICE.md)
says what serving it entails. Whether the copyleft reaches the page around the player is a legal
question this README does not answer.
