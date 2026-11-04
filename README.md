# @missing-elements/h5p-offline-player

[![npm](https://img.shields.io/npm/v/%40missing-elements%2Fh5p-offline-player)](https://www.npmjs.com/package/@missing-elements/h5p-offline-player)
[![licence](https://img.shields.io/npm/l/%40missing-elements%2Fh5p-offline-player)](https://github.com/missing-elements/h5p-offline-player/blob/main/LICENSE)

Self-hosted [H5P](https://h5p.org) without an H5P server. One web component plays `.h5p` files
from your own URLs or from disk, on static hosting you control: no Moodle, WordPress or Lumi, no
backend, no third-party service between your learners and your content.

**[Live demo](https://h5p-offline-player.vercel.app/)** ·
[Offline app](https://h5p-offline-player.vercel.app/app/) ·
[H5P to SCORM](https://h5p-offline-player.vercel.app/demo/scorm.html) ·
[VS Code extension](https://marketplace.visualstudio.com/items?itemName=MissingElements.h5p-preview) ·
[How it compares](https://h5p-offline-player.vercel.app/demo/compare.html)

Stable since 1.0, released on 18 October 2026, and maintained: the library pack follows the H5P
hub, and the translations Moodle's, every week.
[Compatibility](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/compatibility.md) says what a version number
promises. The player is MIT; the H5P runtime it loads is GPL-3.0 and published separately
([Licence](#licence)).

## Quick start

With a bundler (Vite, webpack 5, Rollup):

```bash
npm install @missing-elements/h5p-offline-player @missing-elements/h5p-runtime
```

```html
<h5p-player src="https://host.example/course.h5p"></h5p-player>
```

```js
import '@missing-elements/h5p-offline-player'
import { runtime } from '@missing-elements/h5p-runtime'

const player = document.querySelector('h5p-player')
player.runtime = runtime
player.addEventListener('xapi', (e) => console.log(e.detail.statement))
```

The bundler emits the Service Worker and the runtime (the H5P core, a package of its own because
it is GPL-3.0) as assets, so there is nothing to copy. The page must be on `https://` or
`localhost`, and a package from another origin needs CORS headers on its host. For exports
without their libraries, as h5p.com makes them, add `libraries="pack"`: the
[library pack](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/libraries.md), from jsDelivr or a copy on your
site. [Setting up the player](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/setup.md) covers a site without
a bundler and the Embed setup; [the element's API](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/api.md)
lists every attribute, property and event.

## Which setup

An H5P package is JavaScript, and the player runs it on the origin that serves the frame.

| Your site | Setup |
|---|---|
| Needs the element's API (results to your backend, `resume="host"`, cmi5, a file picker) and plays packages you made | **Install** |
| Plays packages you did not make | **Install** with `untrusted` on them, or **Embed** |
| Has signed-in users | **Embed**, from a separate domain you run, or **Install** with every package `untrusted` |
| Cannot host a file (page builder, hosted CMS, LMS page) | **Embed** |

**Install** is the quick start above; `untrusted` on the element plays a package as data, none of
its own code running. **Embed** frames the player page that
[`@missing-elements/h5p-embed`](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/embed#readme)
writes, from a domain that holds nothing else, so a package never sees your site's cookies,
storage or page.

## Features

- **Plays the packages people have.** Large ones stream, and exports without their libraries, as
  h5p.com and h5p.org make them, play against a [library pack](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/libraries.md) of every
  content type the H5P hub serves.
- **Plays packages you did not make** with [`untrusted`](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/untrusted.md): none of their
  code runs, and their content is checked by a port of H5P's own validator.
- **Reports results you can audit:** xAPI statements that name the
  [build of the package](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/revision.md) they came from, [cmi5](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/cmi5.md), [resume](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/resume.md), and a
  [SCORM 1.2 package](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/embed#a-scorm-package-for-an-lms) for Moodle, ILIAS, OpenOLAT,
  Chamilo, SCORM Cloud or Frappe LMS.
- **No tracking:** no account, cookies or telemetry, and nothing it stores leaves the learner's
  browser ([privacy](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/privacy.md)).
- **Works offline, in the content's language:** an installable app, and H5P's own buttons in any
  of more than fifty languages.
- **Comes with tools:** [`h5p-verify`](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/verify.md) checks that a package plays,
  [`h5p-normalize`](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/streaming-video.md) makes its video stream, and
  [`h5p-author`](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/author#readme) builds one from a short JSON source.

It is a player, not an editor, and it stores no results: its events go wherever your page sends
them. Coming from [h5p-standalone](https://github.com/tunapanda/h5p-standalone)? This player
reads the `.h5p` itself, with nothing to unzip, and
[takes its options by the same names](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/h5p-standalone.md).

## Documentation

- **Set up:** [Setting up the player](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/setup.md) ·
  [The element's API](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/api.md) ·
  [Troubleshooting](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/troubleshooting.md) ·
  [Single-worker hosts and upgrades](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/single-worker.md) ·
  [Coming from h5p-standalone](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/h5p-standalone.md)
- **Packages:** [Libraries](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/libraries.md) ·
  [Packages you did not make](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/untrusted.md) ·
  [Video that cannot stream](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/streaming-video.md) ·
  [Verifying a package](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/verify.md) ·
  [The frame's CSP](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/frame-csp.md)
- **Results:** [Resume](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/resume.md) ·
  [Which build a learner completed](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/revision.md) ·
  [cmi5](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/cmi5.md) ·
  [A SCORM package](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/embed#a-scorm-package-for-an-lms)
- **Policies:** [Compatibility](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/compatibility.md) ·
  [Privacy and data protection](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/privacy.md) ·
  [Accessibility](https://github.com/missing-elements/h5p-offline-player/blob/main/ACCESSIBILITY.md) ·
  [Security](https://github.com/missing-elements/h5p-offline-player/blob/main/SECURITY.md)

## Packages

| Package | What it is |
|---|---|
| [`@missing-elements/h5p-offline-player`](https://www.npmjs.com/package/@missing-elements/h5p-offline-player) | The `<h5p-player>` element and its workers |
| [`@missing-elements/h5p-runtime`](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/runtime#readme) | The H5P core the player loads in its frame, GPL-3.0 |
| [`@missing-elements/h5p-libraries`](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/libraries#readme) | The library pack: the runtime libraries of every content type the H5P hub serves |
| [`@missing-elements/h5p-embed`](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/embed#readme) | The player page as a static site, and a package as a SCORM zip |
| [`@missing-elements/h5p-verify`](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/verify#readme) | Plays a package headless and reports whether it works, or opens it in your browser |
| [`@missing-elements/h5p-normalize`](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/normalize#readme) | Rewrites a package so its video streams |
| [`@missing-elements/h5p-author`](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/author#readme) | Builds a package of any content type from a short JSON source |
| [`@missing-elements/h5p-cmi5`](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/cmi5#readme) | Makes a page holding the element a cmi5 assignable unit |
| [H5P Preview](https://marketplace.visualstudio.com/items?itemName=MissingElements.h5p-preview) | Plays `.h5p` files in VS Code, and from [Open VSX](https://open-vsx.org/extension/MissingElements/h5p-preview) in Cursor and VSCodium |

## Agent skills

[![skills.sh](https://skills.sh/b/missing-elements/h5p-offline-player)](https://skills.sh/missing-elements/h5p-offline-player)

Four skills for Claude Code and other agents that can read files and run commands, installed
with [skills](https://skills.sh/):

```bash
npx skills add missing-elements/h5p-offline-player
```

[`h5p-author`](https://github.com/missing-elements/h5p-offline-player/tree/main/skills/h5p-author)
turns a prompt or a lesson into H5P content of any of 28 types, chosen with you first, checks it
in the real player and opens it for you to play. `h5p-player-setup` puts H5P on a site,
`h5p-normalize` fixes video that will not stream, and `h5p-verify` checks that a package plays.
None needs a provider API key or an H5P server.

## Contributing

A pnpm workspace: see [CONTRIBUTING.md](https://github.com/missing-elements/h5p-offline-player/blob/main/CONTRIBUTING.md),
[docs/development.md](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/development.md)
and [AGENTS.md](https://github.com/missing-elements/h5p-offline-player/blob/main/AGENTS.md) with [design/](https://github.com/missing-elements/h5p-offline-player/tree/main/design), which hold
the design and the reasons behind it. Report vulnerabilities privately, as
[SECURITY.md](https://github.com/missing-elements/h5p-offline-player/blob/main/SECURITY.md) describes.

## Licence

The player is MIT ([LICENSE](https://github.com/missing-elements/h5p-offline-player/blob/main/LICENSE));
its Service Worker bundles [zip.js](https://github.com/gildas-lormeau/zip.js), BSD-3-Clause
([NOTICE.md](https://github.com/missing-elements/h5p-offline-player/blob/main/packages/player/NOTICE.md)).
The H5P runtime the frame loads, the H5P core from [h5p-php-library](https://github.com/h5p/h5p-php-library)
and the script that boots it, is GPL-3.0 and published separately as
[`@missing-elements/h5p-runtime`](https://www.npmjs.com/package/@missing-elements/h5p-runtime);
the player talks to it only over HTTP and `postMessage`, and its
[NOTICE.md](https://github.com/missing-elements/h5p-offline-player/blob/main/packages/runtime/NOTICE.md)
says what serving it entails. Whether the copyleft reaches the page around the player is a legal
question this README does not answer.
