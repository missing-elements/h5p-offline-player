# H5P Toolkit by Missing Elements

Everything you needed an [H5P](https://h5p.org) server for (playing, building, checking,
packaging for an LMS) as static files, command-line tools and agent skills.

**[Live player demo](https://h5p-offline-player.vercel.app/)** ·
[Build with AI](https://missing-elements.github.io/h5p/build/) ·
[Offline app](https://h5p-offline-player.vercel.app/app/) ·
[H5P to SCORM](https://h5p-offline-player.vercel.app/demo/scorm.html) ·
[VS Code extension](https://marketplace.visualstudio.com/items?itemName=MissingElements.h5p-preview)

The player and the packages around it are at version 1 since October 2026, and
[Compatibility](https://github.com/missing-elements/h5p-toolkit/blob/main/docs/compatibility.md)
says what a version number promises; the author package, the MCP server and the VS Code
extension are 0.x. **Every week** a job rebuilds the library pack from the H5P hub and the
interface strings from Moodle's translations, opens a pull request when either changed, and plays
every content type in the pack, trusted and untrusted.

## What it does

| To | Use |
|---|---|
| Play `.h5p` files on your site, from your own URLs or from disk | [`<h5p-player>`](https://github.com/missing-elements/h5p-toolkit/tree/main/packages/player#readme), a web component |
| Play them from a domain of your own, or hand an LMS a SCORM zip or a cmi5 unit | [`h5p-embed`](https://github.com/missing-elements/h5p-toolkit/tree/main/packages/embed#readme), [`h5p-cmi5`](https://github.com/missing-elements/h5p-toolkit/tree/main/packages/cmi5#readme) |
| Build an activity of any content type from a prompt or a short JSON source | the [`h5p-author` skill](https://github.com/missing-elements/h5p-toolkit/tree/main/skills/h5p-author), [the build page](https://missing-elements.github.io/h5p/build/), or [`h5p-mcp`](https://github.com/missing-elements/h5p-toolkit/tree/main/packages/mcp#readme) in Claude Desktop |
| Check that a package plays before you hand it over | [`h5p-verify`](https://github.com/missing-elements/h5p-toolkit/tree/main/packages/verify#readme) |
| Make a package's video start at once | [`h5p-normalize`](https://github.com/missing-elements/h5p-toolkit/tree/main/packages/normalize#readme) |
| Play `.h5p` files with no network, or in your editor | [the offline app](https://h5p-offline-player.vercel.app/app/), [H5P Preview](https://marketplace.visualstudio.com/items?itemName=MissingElements.h5p-preview) for VS Code |

## Why this one

- **No H5P server anywhere.** H5P usually runs in Moodle, WordPress or Drupal with its plugin, on
  an h5p.com account, or in Lumi on a desktop. Here a `.h5p` plays from a URL on static hosting,
  with nothing unzipped, and the tools run on your computer or in your agent.
  [The comparison](https://h5p-offline-player.vercel.app/demo/compare.html) goes through
  h5p-standalone, Lumi, h5p.com and the plugins.
- **The packages people have.** Exports without their libraries, as h5p.com and h5p.org make
  them, play against a library pack of every content type the H5P hub serves, and packages you
  did not make play [`untrusted`](https://github.com/missing-elements/h5p-toolkit/blob/main/docs/untrusted.md),
  with none of their code run.
- **What a model builds is checked.** `h5p-author` writes a package that carries its libraries,
  which Moodle accepts as an upload, and `h5p-verify` plays it in the real H5P runtime in a
  headless browser before anyone hands it over.
- **Nothing passes through a server of ours:** no account, cookies or telemetry, and the library
  pack comes from jsDelivr unless you serve a copy
  ([privacy](https://github.com/missing-elements/h5p-toolkit/blob/main/docs/privacy.md)).

It is not an editor: H5P's own editor is not here, so content comes from the tools above or from
an H5P site. Nothing here stores results either: xAPI events go wherever your page sends them.

## Quick start

**Play** a package on your site, with Vite or webpack 5:

```bash
npm install @missing-elements/h5p-offline-player @missing-elements/h5p-runtime
```

```html
<h5p-player src="https://host.example/course.h5p"></h5p-player>
```

```js
import '@missing-elements/h5p-offline-player'
import { runtime } from '@missing-elements/h5p-runtime'

document.querySelector('h5p-player').runtime = runtime
```

A package that carries its libraries plays as it is; one exported without them, as h5p.com
exports, needs `libraries="pack"` on the element.
[Setting up the player](https://github.com/missing-elements/h5p-toolkit/blob/main/docs/setup.md)
covers pages without a bundler, other bundlers, CORS, and which setup suits packages you did not
make.

**Build** with AI, in Claude Code or another agent that runs commands:

```bash
npx skills add missing-elements/h5p-toolkit --skill h5p-author
```

Then ask it for an activity, such as "a five-question quiz on the water cycle, as H5P": it asks
which content type, builds the `.h5p`, checks it and opens it for you to play. In a chat app,
[the build page](https://missing-elements.github.io/h5p/build/) turns what the chat wrote into the
file, in your browser; in Claude Desktop,
[`h5p-mcp`](https://github.com/missing-elements/h5p-toolkit/tree/main/packages/mcp#readme) builds
it onto your disk.

**Check** a package, with Node 22 or later:

```bash
npx @missing-elements/h5p-verify@latest course.h5p
```

## Packages

| Package | What it is |
|---|---|
| [`@missing-elements/h5p-offline-player`](https://github.com/missing-elements/h5p-toolkit/tree/main/packages/player#readme) | The `<h5p-player>` element and its workers |
| [`@missing-elements/h5p-runtime`](https://github.com/missing-elements/h5p-toolkit/tree/main/packages/runtime#readme) | The H5P core the player loads in its frame, GPL-3.0 |
| [`@missing-elements/h5p-libraries`](https://github.com/missing-elements/h5p-toolkit/tree/main/packages/libraries#readme) | The library pack: the runtime libraries of every content type the H5P hub serves |
| [`@missing-elements/h5p-embed`](https://github.com/missing-elements/h5p-toolkit/tree/main/packages/embed#readme) | The player page as a static site, and a package as a SCORM zip |
| [`@missing-elements/h5p-verify`](https://github.com/missing-elements/h5p-toolkit/tree/main/packages/verify#readme) | Plays a package headless and reports whether it works, or opens it in your browser |
| [`@missing-elements/h5p-normalize`](https://github.com/missing-elements/h5p-toolkit/tree/main/packages/normalize#readme) | Rewrites a package so its video streams |
| [`@missing-elements/h5p-author`](https://github.com/missing-elements/h5p-toolkit/tree/main/packages/author#readme) | Builds a package of any content type from a short JSON source, and reads one back into its source |
| [`@missing-elements/h5p-mcp`](https://github.com/missing-elements/h5p-toolkit/tree/main/packages/mcp#readme) | A local MCP server: an app such as Claude Desktop builds a package onto your disk, checks it and opens it in your browser, or reads one to change it |
| [`@missing-elements/h5p-cmi5`](https://github.com/missing-elements/h5p-toolkit/tree/main/packages/cmi5#readme) | Makes a page holding the element a cmi5 assignable unit |
| [H5P Preview](https://marketplace.visualstudio.com/items?itemName=MissingElements.h5p-preview) | Plays `.h5p` files in VS Code, and from [Open VSX](https://open-vsx.org/extension/MissingElements/h5p-preview) in Cursor and VSCodium |

## Agent skills

Five skills for Claude Code and other agents that can read files and run commands, installed
with [skills](https://skills.sh/); add `--skill <name>` for one of them. None needs a provider API
key or an H5P server.

```bash
npx skills add missing-elements/h5p-toolkit
```

| Skill | What it does |
|---|---|
| [`h5p-author`](https://github.com/missing-elements/h5p-toolkit/tree/main/skills/h5p-author) | Turns a prompt or a lesson into H5P content of any of 28 types, chosen with you first, checks it in the real player and opens it for you to play |
| [`h5p-verify`](https://github.com/missing-elements/h5p-toolkit/tree/main/skills/h5p-verify) | Checks that a package plays, and opens it in your browser for you to try |
| [`h5p-to-scorm`](https://github.com/missing-elements/h5p-toolkit/tree/main/skills/h5p-to-scorm) | Turns a package into a SCORM zip that an LMS plays, grades and resumes, and says what to set in yours |
| [`h5p-player-setup`](https://github.com/missing-elements/h5p-toolkit/tree/main/skills/h5p-player-setup) | Puts H5P on a website, from the player on the site itself or framed from a domain of your own |
| [`h5p-normalize`](https://github.com/missing-elements/h5p-toolkit/tree/main/skills/h5p-normalize) | Rewrites a package whose video will not stream |

A chat app takes `h5p-author` as a zip that you upload or attach. Download it from
[missing-elements.github.io/h5p/create-with-ai/#install](https://missing-elements.github.io/h5p/create-with-ai/#install),
which says where it goes in each app. The zip holds the same h5p-author release as the site's
build page runs.

## Documentation

- **Set up:** [Setting up the player](https://github.com/missing-elements/h5p-toolkit/blob/main/docs/setup.md) ·
  [The element's API](https://github.com/missing-elements/h5p-toolkit/blob/main/docs/api.md) ·
  [Troubleshooting](https://github.com/missing-elements/h5p-toolkit/blob/main/docs/troubleshooting.md) ·
  [Single-worker hosts and upgrades](https://github.com/missing-elements/h5p-toolkit/blob/main/docs/single-worker.md) ·
  [Coming from h5p-standalone](https://github.com/missing-elements/h5p-toolkit/blob/main/docs/h5p-standalone.md)
- **Packages:** [Libraries](https://github.com/missing-elements/h5p-toolkit/blob/main/docs/libraries.md) ·
  [Packages you did not make](https://github.com/missing-elements/h5p-toolkit/blob/main/docs/untrusted.md) ·
  [Video that cannot stream](https://github.com/missing-elements/h5p-toolkit/blob/main/docs/streaming-video.md) ·
  [Verifying a package](https://github.com/missing-elements/h5p-toolkit/blob/main/docs/verify.md) ·
  [The frame's CSP](https://github.com/missing-elements/h5p-toolkit/blob/main/docs/frame-csp.md)
- **Results:** [Resume](https://github.com/missing-elements/h5p-toolkit/blob/main/docs/resume.md) ·
  [Which build a learner completed](https://github.com/missing-elements/h5p-toolkit/blob/main/docs/revision.md) ·
  [cmi5](https://github.com/missing-elements/h5p-toolkit/blob/main/docs/cmi5.md) ·
  [A SCORM package](https://github.com/missing-elements/h5p-toolkit/tree/main/packages/embed#a-scorm-package-for-an-lms)
- **Policies:** [Compatibility](https://github.com/missing-elements/h5p-toolkit/blob/main/docs/compatibility.md) ·
  [Privacy and data protection](https://github.com/missing-elements/h5p-toolkit/blob/main/docs/privacy.md) ·
  [Accessibility](https://github.com/missing-elements/h5p-toolkit/blob/main/ACCESSIBILITY.md) ·
  [Security](https://github.com/missing-elements/h5p-toolkit/blob/main/SECURITY.md)

## Contributing

A pnpm workspace: see [CONTRIBUTING.md](https://github.com/missing-elements/h5p-toolkit/blob/main/CONTRIBUTING.md),
[docs/development.md](https://github.com/missing-elements/h5p-toolkit/blob/main/docs/development.md)
and [AGENTS.md](https://github.com/missing-elements/h5p-toolkit/blob/main/AGENTS.md) with [design/](https://github.com/missing-elements/h5p-toolkit/tree/main/design), which hold
the design and the reasons behind it. Report vulnerabilities privately, as
[SECURITY.md](https://github.com/missing-elements/h5p-toolkit/blob/main/SECURITY.md) describes.

## Licence

Every package is MIT ([LICENSE](https://github.com/missing-elements/h5p-toolkit/blob/main/LICENSE))
but two. The H5P runtime the player's frame loads, the H5P core from
[h5p-php-library](https://github.com/h5p/h5p-php-library) and the script that boots it, is GPL-3.0
and published apart as [`@missing-elements/h5p-runtime`](https://www.npmjs.com/package/@missing-elements/h5p-runtime);
the player talks to it only over HTTP and `postMessage`, and its
[NOTICE.md](https://github.com/missing-elements/h5p-toolkit/blob/main/packages/runtime/NOTICE.md)
says what serving it entails. The library pack holds H5P's libraries, each under its own licence,
most MIT, as [its list](https://github.com/missing-elements/h5p-toolkit/blob/main/packages/libraries/libraries.txt)
says. What a package bundles keeps its licence too: the player's Service Worker carries
[zip.js](https://github.com/gildas-lormeau/zip.js), BSD-3-Clause
([NOTICE.md](https://github.com/missing-elements/h5p-toolkit/blob/main/packages/player/NOTICE.md)).
Whether the copyleft reaches the page around the player is a legal question this README does not
answer.
