---
name: h5p-player-setup
description: Put an H5P player on a website with no server. Use when asked to play, embed or self-host H5P content or .h5p files on a static site, in an app (Vite, webpack, Next, Astro, plain HTML) or in a CMS, or for H5P without Moodle, WordPress or Lumi. Uses h5p-offline-player, one web component plus a Service Worker; nothing is unpacked on a server.
license: MIT
---

# Put the H5P player on a site

`@missing-elements/h5p-offline-player` is one custom element, `<h5p-player>`. It plays a `.h5p`
package from a URL or a picked file: the archive is read in place and a Service Worker serves
its files to the H5P runtime. Three files matter: the element (`h5p-player.js`), the worker
(`h5p-sw.js`) and the runtime folder (`frame-assets/`). Only the worker has to be served from
the site's own origin; browsers refuse a cross-origin Service Worker.

## 1. Pick the setup

Ask, or read from the project, three things: is there a bundler; can a file be placed on the
site's own origin; where do the packages come from.

| The site | Setup |
|---|---|
| Has a bundler: Vite, webpack 5, Rollup, or a framework on one (Next, Nuxt, Astro, SvelteKit) | **A** |
| Plain HTML, a CMS theme, a static site with no build | **B** |
| Cannot host even one file: a page builder, a locked-down CMS | **C** |

## 2. Do it

**A · with a bundler**

```bash
npm i @missing-elements/h5p-offline-player
```

```js
import '@missing-elements/h5p-offline-player'
```

```html
<h5p-player src="https://host.example/course.h5p" auto-resize></h5p-player>
```

Nothing else: the element names its files with `new URL('./file', import.meta.url)`, which
these bundlers emit and rewrite. Only one thing needs care: **the import must run in the
browser.** In a framework that renders on the server, import it from a client-only place (a
`useEffect`, a `<script>` in Astro, `onMount`, `client-only` in Nuxt), and mark the tag as a
custom element if the framework demands it (Vue: `compilerOptions.isCustomElement`).
esbuild alone (no Vite) does not rewrite `new URL`; then serve the package's `dist/` from a
static path and set `sw="/that/path/h5p-sw.js" assets-base="/that/path/frame-assets/"`.

**B · no build step**

```html
<script type="module"
  src="https://cdn.jsdelivr.net/npm/@missing-elements/h5p-offline-player@<version>/dist/h5p-player.js"></script>
<h5p-player src="https://host.example/course.h5p" sw="/h5p-sw.js" auto-resize></h5p-player>
```

Download `https://cdn.jsdelivr.net/npm/@missing-elements/h5p-offline-player@<version>/dist/h5p-sw.js`
and place it on the site; `sw` points at it. The root is fine: its scope becomes `/h5p/`, not
`/`, so an existing site worker is untouched. Use one explicit version (`npm view
@missing-elements/h5p-offline-player version` for the latest) in both URLs — unpinned, the CDN
moves and the copied worker does not — and re-download `h5p-sw.js` on every upgrade; the
console warns when the two differ.

**C · iframe, nothing on the site**

```html
<iframe src="https://h5p-offline-player.vercel.app/embed?src=https://host.example/course.h5p"
        allow="fullscreen" style="width: 100%; border: 0"></iframe>
```

Add `&xapi=<your page's origin>` to receive statements by `postMessage`. Safari blocks Service
Workers in cross-origin iframes; there the page shows an "open the player" link instead. Only for
a site that truly cannot host a file, and say so to the user: their content then runs on a
third party's origin.

**Always:** `auto-resize` so the element follows the content's height, or handle the `resize`
event yourself. Any CSS goes on the `h5p-player` tag itself; the inside is shadow DOM.

**Resume, only when asked for.** By default a reload starts the content over and nothing is
stored. `resume` keeps the content's own saved state — the slide reached, the answers so far, the
position in a video — in the browser's storage on that device and hands it back on the next
load; `resume="host"` keeps nothing on the device and gives the host page a `userdata` event on
every save, to hand back through `userData` before the next load. Ask before setting it: on a
shared machine the state one person leaves is what the next one finds, so a site with accounts
takes `host`, a kiosk or a classroom device takes neither, and a learner's own device takes
`resume`. Either way nothing is sent anywhere, and xAPI statements are still not stored.

## 3. Check it

1. The page is served over `https://` or `localhost`, never `file://`.
2. Open it, load a package, and confirm the element's `state` reaches `ready`
   (`document.querySelector('h5p-player').state`, or listen for `statechange`).
3. In DevTools → Application → Service Workers there is a registration whose scope ends in
   `/h5p/`, on the page's own origin.
4. The frame is not 150 px tall with content inside it; if it is, see the table.
5. `curl -sI -H 'Range: bytes=0-0' <package url>` shows an `access-control-allow-origin`
   header — without it no browser can read the file and the element reports `no-cors` — and
   ideally `206`, which lets a large package start after a few kilobytes instead of downloading
   whole.

## 4. When it does not work

| Report | Cause | Fix |
|---|---|---|
| `error: no-worker` | page on `http://` or `file://`; or `sw` points at another origin | serve over https; keep the worker same-origin |
| `error: network`, "is an http: URL and this page is served over https:" | mixed content: an `http://` package or bundle on an `https://` page | use the `https://` URL; `http://localhost` is exempt |
| `error: no-cors` | the package host sends no CORS headers | host the package where you control headers (GitHub Pages works as it comes), or offer a file picker: `player.file = input.files[0]` |
| `error: bad-archive`, "contains no libraries" | an h5p.com / h5p.org export: `content/` only | set `libraries="hub"` to fetch them from h5p.org, or `libraries="/path/libraries.h5p"` pointing at a bundle you host (the repository ships one with every hub content type's libraries, plus its `libraries.txt` of licences) |
| worker or `frame-assets/` 404 after a build | the bundler did not rewrite `new URL` (esbuild) | serve `dist/` statically and set `sw` and `assets-base` |
| the frame renders the host page inside itself | an SPA fallback answered a virtual route with `index.html`: the worker is not registered | check the registration; after "clear site data" reload once |
| content collapsed to 150 px | the element has no height: no `auto-resize` and none set by CSS; or the host's CSP has `style-src 'self'` and the browser lacks `adoptedStyleSheets`, so the fallback `<style>` is blocked | add `auto-resize`, or give the `h5p-player` tag a height; update the browser |
| `error: runtime` after `ready` | a content type threw a non-fatal exception, common on resize | log it; do not hide the player |
| Vite dev only: worker or assets 404 | the package is hoisted somewhere Vite does not serve (a monorepo); the element's own fallback for `.vite/deps/` covers the normal layout | add the package to `optimizeDeps.exclude`, or set `sw` and `assets-base` |
| a video takes minutes to start, then plays | the package, not the player: the video is compressed inside the zip and its index is at the end | the `h5p-normalize` skill; `preload="auto"` only moves the wait earlier |
| the content starts over on every reload | `resume` is not set, which is the default | set `resume` (or `resume="host"`) if the user wants that, see section 2 |
| "This content has changed since you last used it. You'll be starting over." | the package at that URL was replaced since the state was saved; the state is keyed by the build | expected, H5P's own dialog; OK drops the old state and the content saves afresh under the new build |

## 5. Hand over

Tell the user three things. The runtime under `frame-assets/` is the H5P core, GPL-3.0, and its
`LICENSE.txt` and `NOTICE.txt` must stay with it; the player's own code is MIT. Results arrive
only as `xapi` and `finished` events on the element, stored nowhere, so an LRS or their own
backend has to listen; a learner's place in the content is kept only with the `resume`
attribute, in the browser's storage on that device (or handed to the host with
`resume="host"`), never sent. And if they generate or rewrite packages, `npx @missing-elements/h5p-verify
course.h5p` checks a package plays before it is published.

The full guide, with the element's API, the events, single-worker hosts and every symptom:
https://github.com/missing-elements/h5p-offline-player/blob/main/h5p-player-setup.md
