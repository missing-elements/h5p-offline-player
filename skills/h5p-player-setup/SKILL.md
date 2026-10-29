---
name: h5p-player-setup
description: Self-host H5P on a website with no H5P server. Use when asked to play, embed or self-host H5P content or .h5p files on a static site, in an app (Vite, webpack, Next, Astro, plain HTML) or in a CMS, or for H5P without Moodle, WordPress, Lumi or a third-party service. Picks between installing h5p-offline-player on the site (the element's API) and serving its player page from a separate domain the user runs and framing it (for sites with sessions or packages they did not make), by what is on the site's origin.
license: MIT
---

# Self-host the H5P player

`@missing-elements/h5p-offline-player` is one custom element, `<h5p-player>`. It plays a `.h5p`
package from a URL or a picked file: the archive is read in place and a Service Worker serves
its files to the H5P runtime. Everything runs on infrastructure the user controls: no H5P
server, no backend, no third-party service. A site either installs it, or embeds it — an
iframe of a player page on a separate domain the site's organisation runs. Installed, three things matter: the
element (`h5p-player.js`), the worker (`h5p-sw.js`) and the runtime, which is a second package,
`@missing-elements/h5p-runtime`, because it is GPL-3.0 while the player is MIT. Only the worker
has to be served from the site's own origin; browsers refuse a cross-origin Service Worker.

## 1. Pick the setup

Decide by what is on the site's origin, not by its tooling. An H5P package is JavaScript and
the player runs it on the origin that serves the frame: installed on the site, a package can
read the page, its non-`HttpOnly` cookies and storage, and call the site's APIs as the signed-in
user. Ask, or read from the project: does the site have signed-in users; who makes the
packages; does it need results with the learner's identity, `resume="host"`, cmi5 or a file
picker; can it host a file at all.

| The site | Setup |
|---|---|
| Needs the element's API (above) and plays only packages its own team made | **Install**: with a bundler if it has one (Vite, webpack 5, Rollup, Next, Nuxt, Astro, SvelteKit), else without a build step |
| Static, no sessions, its own packages | **Install**, keeping every request on its own domain; **Embed** works too, at the cost of a second domain |
| Has signed-in users: an LMS, a portal, anything with accounts or an admin area | **Embed**, from a player domain the organisation runs, or **Install** with every package `untrusted` |
| Plays packages it did not make: uploads, links from users or teachers, a marketplace | **Install** with `untrusted` on them, or **Embed** |
| Cannot host a file: a page builder, a hosted CMS, an LMS page the user only edits | **Embed**, from a player domain the organisation runs; the page itself only takes the snippet |

When the site has sessions *and* needs the API, the safety rows win, and say why: installed,
a package played as it is runs as the site. Offer the three ways out — install and play every
package `untrusted`, embed a player page hosted on a separate domain and take results by the xAPI
relay, or install the player only on an origin that holds no session (a separate origin for the
course pages) — and install on the session origin without `untrusted` only if the user confirms
every package is their own team's.

`untrusted` (`<h5p-player untrusted src="…">`) plays a package as data: none of its own code runs,
its libraries come from the library pack, and its content is checked against each library's field
definitions before it is shown, as the H5P CMS plugins check an author's upload — as contained as
in an H5P plugin on the same site. Content made for a newer minor version of a library than the
pack has plays at the pack's older one (`downgrade-libraries="off"` refuses it instead); a package
that needs a library the pack lacks, or a newer major, is refused. Embed adds a separate origin on
top.

## 2. Do it

**Install with a bundler**

```bash
npm i @missing-elements/h5p-offline-player @missing-elements/h5p-runtime
```

```js
import '@missing-elements/h5p-offline-player'
import { runtime } from '@missing-elements/h5p-runtime'

document.querySelector('h5p-player').runtime = runtime
```

```html
<h5p-player src="https://host.example/course.h5p"></h5p-player>
```

Nothing else: both packages name their files with `new URL('./file', import.meta.url)`, which
these bundlers emit and rewrite, and the runtime's `runtime` export is the list of its files'
URLs, handed to the element as a property before `src` is set. Only one thing needs care: **the
imports must run in the browser.** In a framework that renders on the server, import them from
a client-only place (a `useEffect`, a `<script>` in Astro, `onMount`, `client-only` in Nuxt),
and mark the tag as a custom element if the framework demands it (Vue:
`compilerOptions.isCustomElement`). esbuild alone (no Vite) does not rewrite `new URL`; then
serve both packages' `dist/` from static paths and set `sw="/that/path/h5p-sw.js"
assets-base="/the/runtime's/dist/"`.

**Install without a build step**

Copy the files onto the site, so that nothing a learner's browser loads comes from another
server; npm only fetches them. `public/` is the folder the site is served from:

```bash
npm install @missing-elements/h5p-offline-player @missing-elements/h5p-runtime
cp -r node_modules/@missing-elements/h5p-offline-player/dist public/h5p-player
cp -r node_modules/@missing-elements/h5p-runtime/dist public/h5p-player/frame-assets
```

```html
<script type="module" src="/h5p-player/h5p-player.js"></script>
<h5p-player src="https://host.example/course.h5p"></h5p-player>
```

No `sw` or `assets-base`: the element finds `h5p-sw.js` and `frame-assets/` beside its own
script, and the worker always matches the element's version. For `libraries="pack"`, also copy
`@missing-elements/h5p-libraries`' `parts/` to `public/h5p-libraries/`, with its `libraries.txt`
beside them, and set `pack-base="/h5p-libraries/"`. On an upgrade, delete the folders and copy
them again: `cp -r` into a folder that exists nests the copy inside it.

If the user prefers a CDN to copying the files, read `references/cdn.md`: the worker still has
to be copied onto the site.

**Embed:** read `references/embed.md`. It writes the player page with
`npx @missing-elements/h5p-embed@latest`, deploys it to a separate domain the organisation runs,
and gives the site an iframe snippet.

**Options:** the element follows the content's height by default; set `auto-resize="off"` only
when the page sizes it itself. Do not set `resume` unless the user asks for it. For sizing, the
display options (`frame`, `copyright`, `export`, `custom-css`, `activity-id`, `user` and the
rest), the language and `resume`, read `references/options.md`.

## 3. Check it

1. The page is served over `https://` or `localhost`, never `file://`.
2. Open it, load a package, and confirm the element's `state` reaches `ready`
   (`document.querySelector('h5p-player').state`, or listen for `statechange`).
3. In DevTools → Application → Service Workers there is a registration whose scope ends in
   `/h5p/`, on the page's own origin.
4. The frame is not 150 px tall with content inside it; if it is, see `references/troubleshooting.md`.
5. `curl -sI -H 'Range: bytes=0-0' <package url>` answers, ideally, `206`, which lets a large
   package start after a few kilobytes instead of downloading whole. For a package on another
   origin than the page, it also shows an `access-control-allow-origin` header — without it no
   browser can read the file and the element reports `no-cors`; a package on the page's own
   origin needs none.

## 4. When it does not work

Read `references/troubleshooting.md`: every error the element reports, and the usual symptoms
(the frame at 150 px, the host page inside the frame, a video that takes minutes to start), with
cause and fix.

## 5. Hand over

For an embed, tell the user the player page's domain is theirs to keep running and must hold nothing else, that results are the page's to collect through the relay or there are none, and that a package runs its own scripts on that domain. For an install, tell the user three
things. The player is MIT; the H5P core runtime it loads is GPL-3.0, which
is why it is the separate package `@missing-elements/h5p-runtime`, whose `LICENSE.txt` and
`NOTICE.txt` must stay with any copy of its `dist/` — the player links against none of it and
only names its files. Results arrive
only as `xapi` and `finished` events on the element, stored nowhere, so an LRS or their own
backend has to listen; a learner's place in the content is kept only with the `resume`
attribute, in the browser's storage on that device (or handed to the host with
`resume="host"`), never sent. And if they generate or rewrite packages, `npx @missing-elements/h5p-verify@latest
course.h5p` checks a package plays before it is published.

The element's API and events: https://github.com/missing-elements/h5p-offline-player/blob/main/docs/api.md
Each install path in full: https://github.com/missing-elements/h5p-offline-player/blob/main/docs/setup.md
Every symptom and its fix: https://github.com/missing-elements/h5p-offline-player/blob/main/docs/troubleshooting.md
Single-worker hosts and upgrades: https://github.com/missing-elements/h5p-offline-player/blob/main/docs/single-worker.md
