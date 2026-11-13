# @missing-elements/h5p-offline-player

[![npm](https://img.shields.io/npm/v/%40missing-elements%2Fh5p-offline-player)](https://www.npmjs.com/package/@missing-elements/h5p-offline-player)
[![licence](https://img.shields.io/npm/l/%40missing-elements%2Fh5p-offline-player)](https://github.com/missing-elements/h5p-offline-player/blob/main/LICENSE)

Self-hosted [H5P](https://h5p.org) without an H5P server. One web component plays `.h5p` files
from your own URLs or from disk, on static hosting you control: no Moodle, WordPress or Lumi, no
backend, and no service of ours or H5P Group's between your learners and your content.

**[Live player demo](https://h5p-offline-player.vercel.app/)** ·
[Offline app](https://h5p-offline-player.vercel.app/app/) ·
[H5P to SCORM](https://h5p-offline-player.vercel.app/demo/scorm.html) ·
[Lovable example](https://embed-h5p-file.lovable.app/) ·
[VS Code extension](https://marketplace.visualstudio.com/items?itemName=MissingElements.h5p-preview)

Version 1 since October 2026; [Compatibility](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/compatibility.md)
says what a version number promises. **Every week** a job rebuilds the library pack from the H5P
hub and the interface strings from Moodle's translations, opens a pull request when either
changed, and plays every content type in the pack, trusted and untrusted.

## Features

- **Plays the packages people have.** Large ones stream, and exports without their libraries, as
  h5p.com and h5p.org make them, play against a [library pack](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/libraries.md)
  of the 53 content types the H5P hub serves.
- **Plays packages you did not make** with [`untrusted`](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/untrusted.md): none of their
  code runs, and their content is checked by a port of H5P's own validator.
- **Reports results you can audit:** xAPI statements that name the
  [build of the package](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/revision.md) they came from, [cmi5](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/cmi5.md), [resume](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/resume.md), and a
  [SCORM zip](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/embed#a-scorm-package-for-an-lms): SCORM 1.2, checked in
  Moodle, ILIAS, OpenOLAT, Chamilo, SCORM Cloud and Frappe LMS, or 2004, checked in Moodle and
  SCORM Cloud.
- **No tracking:** no account, cookies or telemetry, and nothing it stores leaves the learner's
  browser. The library pack comes from jsDelivr unless you serve a copy
  ([privacy](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/privacy.md)).
- **Works offline, in the content's language:** an installable app, and H5P's own buttons in
  English and 56 other languages.
- **Tested in Chromium, Firefox and WebKit** on every change, and in Safari on macOS and iOS by
  hand ([browsers](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/compatibility.md#browsers)).
- **Comes with tools:** [`h5p-verify`](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/verify.md) checks that a package plays,
  [`h5p-normalize`](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/streaming-video.md) makes its video stream, and
  [`h5p-author`](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/author#readme) builds one from a short JSON source, which a
  Moodle site accepts as an upload too.

It is a player, not an editor, and it stores no results: its events go wherever your page sends
them. Coming from [h5p-standalone](https://github.com/tunapanda/h5p-standalone)? This player
reads the `.h5p` itself, with nothing to unzip, and
[takes its options by the same names](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/h5p-standalone.md).

## Quick start

With Vite or webpack 5; both packages ship TypeScript declarations:

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
it is GPL-3.0) as files, so there is nothing to copy. The page must be on `https://` or
`localhost`, and a package from another origin needs CORS headers on its host. A package that
carries its libraries plays as it is; one exported without them, as h5p.com exports, needs
`libraries="pack"`.

Packages you did not make, or a site with signed-in users: play every package `untrusted`, or
embed the player from a domain of its own, as
[Which setup](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/setup.md#which-setup) explains.
[Setting up the player](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/setup.md) also covers a page without a bundler, Rollup and
esbuild, and the one-prompt install on Lovable;
[the element's API](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/api.md) lists every attribute, property and event.

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

Five skills for Claude Code and other agents that can read files and run commands, installed
with [skills](https://skills.sh/); add `--skill <name>` for one of them. None needs a provider API
key or an H5P server.

```bash
npx skills add missing-elements/h5p-offline-player
```

| Skill | What it does |
|---|---|
| [`h5p-author`](https://github.com/missing-elements/h5p-offline-player/tree/main/skills/h5p-author) | Turns a prompt or a lesson into H5P content of any of 28 types, chosen with you first, checks it in the real player and opens it for you to play |
| [`h5p-verify`](https://github.com/missing-elements/h5p-offline-player/tree/main/skills/h5p-verify) | Checks that a package plays, and opens it in your browser for you to try |
| [`h5p-to-scorm`](https://github.com/missing-elements/h5p-offline-player/tree/main/skills/h5p-to-scorm) | Turns a package into a SCORM zip that an LMS plays, grades and resumes, and says what to set in yours |
| [`h5p-player-setup`](https://github.com/missing-elements/h5p-offline-player/tree/main/skills/h5p-player-setup) | Puts H5P on a website, from the player on the site itself or framed from a domain of your own |
| [`h5p-normalize`](https://github.com/missing-elements/h5p-offline-player/tree/main/skills/h5p-normalize) | Rewrites a package whose video will not stream |

In a chat app, `h5p-author` installs from a zip: Claude and Grok take one, ChatGPT's Plugins
another, both at
[missing-elements.github.io/h5p/create-with-ai/#install](https://missing-elements.github.io/h5p/create-with-ai/#install),
from the release the build page runs.

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
