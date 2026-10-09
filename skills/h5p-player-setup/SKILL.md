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
| Has signed-in users: an LMS, a portal, anything with accounts or an admin area | **Embed**, from a player domain the organisation runs |
| Plays packages it did not make: uploads, links from users or teachers, a marketplace | **Embed**, from a player domain the organisation runs |
| Cannot host a file: a page builder, a hosted CMS, an LMS page the user only edits | **Embed**, from a player domain the organisation runs; the page itself only takes the snippet |

When the site has sessions *and* needs the API, the safety rows win, and say why: installed,
every package runs as the site. Offer the two ways out — embed a player page hosted on a
separate domain and take results by the xAPI relay, or install the player only on an origin
that holds no session (a separate origin for the course pages) — and install on the session
origin only if the user confirms every package is their own team's.

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

```html
<script type="module"
  src="https://cdn.jsdelivr.net/npm/@missing-elements/h5p-offline-player@<version>/dist/h5p-player.js"></script>
<h5p-player src="https://host.example/course.h5p" sw="/h5p-sw.js"
            assets-base="https://cdn.jsdelivr.net/npm/@missing-elements/h5p-runtime@<version>/dist/"></h5p-player>
```

Download `https://cdn.jsdelivr.net/npm/@missing-elements/h5p-offline-player@<version>/dist/h5p-sw.js`
and place it on the site; `sw` points at it. `assets-base` names the runtime package's `dist/`
on the CDN, since the player's own package does not carry the runtime. The root is fine: its scope becomes `/h5p/`, not
`/`, so an existing site worker is untouched. Use one explicit version (`npm view
@missing-elements/h5p-offline-player version` for the latest) in both URLs — unpinned, the CDN
moves and the copied worker does not — and re-download `h5p-sw.js` on every upgrade; the
console warns when the two differ.

**Sizing:** the element follows the content's own height by default. Set `auto-resize="off"`
only when the page sizes it itself, from CSS or from the `resize` event, because the height the
element writes is an inline style and would beat the page's rule. Any CSS goes on the
`h5p-player` tag itself; the inside is shadow DOM.

**Coming from h5p-standalone:** its options carry over by name as attributes — `frame`,
`copyright`, `export`, `icon`, `embed` (bare = on), `fullscreen="off"`, `download-url`,
`embed-code`, `custom-css`, `custom-js`, `reporting`, `activity-id` — and `user` as a property.
The guide's "Coming from h5p-standalone" table maps every option, including the ones the `.h5p`
or the events replace. Formulas need `H5P.MathDisplay` in the package, not a `customJs` recipe.

**Resume, only when asked for.** By default a reload starts the content over and nothing is
stored. `resume` keeps the content's own saved state — the slide reached, the answers so far, the
position in a video — in the browser's storage on that device and hands it back on the next
load; `resume="host"` keeps nothing on the device and gives the host page a `userdata` event on
every save, to hand back through `userData` before the next load. Ask before setting it: on a
shared machine the state one person leaves is what the next one finds, so a site with accounts
takes `host`, a kiosk or a classroom device takes neither, and a learner's own device takes
`resume`. Either way nothing is sent anywhere, and xAPI statements are still not stored.

**Embed**

The player page is a static site that `@missing-elements/h5p-embed` writes:

```bash
npx @missing-elements/h5p-embed h5p-player --packages https://host.example
```

`--packages` limits the hosts packages may come from (add `https://api.h5p.org` for
`libraries=hub`), `--ancestors` the sites that may frame the page; leave both out to allow any.
Deploy the folder to a domain of the organisation's own: a separate registrable domain
(`h5p-player.example.net`, not a subdomain of the site, which would receive its cookies) that
holds nothing else — no accounts, no cookies. Netlify and Cloudflare Pages read the `_headers`
it writes and Vercel its `vercel.json`; elsewhere the page carries the policy in a `<meta>` tag,
without `--ancestors`. The site's page then carries:

```html
<iframe src="https://h5p-player.example.net/?src=https://host.example/activities/week-1-quiz.h5p&frame&copyright&export"
        title="Week 1 knowledge check" loading="lazy" allow="fullscreen"
        style="width: 100%; min-height: 540px; border: 0"></iframe>
<script src="https://h5p-player.example.net/resizer.js"></script>
```

The script line sizes the iframe to the content; a page that already has h5p.org's
`h5p-resizer.js` needs no second one. `title` is what screen readers announce, so name the
activity; `min-height` is for a platform that strips the script. Encode `&`, `#`, `+`, `%` and
spaces inside `src`. Parameters, by the element's attribute names: `libraries=pack`, `hub` or
`libraries=<url>` for a package without libraries, `preload=auto`, `frame`, `copyright`,
`export`, `icon`, `reporting`, `fullscreen=off`, `activity-id=<IRI>`, `custom-css=<URL>`, and
`xapi=<the page's origin>` to receive statements by `postMessage`. Not `custom-js` or `user`.

Paste it into the platform's HTML block (Custom HTML in WordPress, Embed in Squarespace, Wix or
Google Sites, HTML view in Moodle). The embedding page must be https (or localhost); the frame
registers its own worker there, in Safari and on iOS too. A CSP on the site needs `frame-src
https://h5p-player.example.net`. With `xapi=`, listen for the relay and check where it came from:

```js
const frame = document.querySelector('iframe')
addEventListener('message', ({ source, origin, data }) => {
  if (source !== frame.contentWindow || origin !== 'https://h5p-player.example.net') return
  if (data?.context !== 'h5p-offline-player') return
  if (data.action === 'xapi') send(data.statement)      // every statement
  if (data.action === 'finished') send(data.statement)  // the final one, with result.score
})
```

Those checks prove the sender, not the score: any package can post any statement, so relayed
results are the learner's report, not proof for a grade.

Do not embed from Embed My (embed-my.org) or from the demo site in production: Embed My is a
test tool — every learner's browser would connect to a service the organisation has no data
processing agreement with, which a GDPR or security review will not pass. It is fine for trying
whether a package embeds before the domain is set up.

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
| `error: bad-archive`, "contains no libraries" | an h5p.com / h5p.org export: `content/` only | set `libraries` to a bundle, with the hub behind it: `libraries="https://cdn.jsdelivr.net/npm/@missing-elements/h5p-libraries@0/libraries.h5p hub"` — `@missing-elements/h5p-libraries` carries every hub content type's libraries (serve it yourself with its `libraries.txt` of licences if the site must not reach a CDN), and `hub` is asked only for what it lacks; `libraries="hub"` alone fetches from h5p.org every time |
| worker or runtime files 404 after a build | the bundler did not rewrite `new URL` (esbuild); or an install with a bundler but without `player.runtime`, so the element looked for `frame-assets/` beside a hashed bundle | set `runtime` from `@missing-elements/h5p-runtime`; or serve both packages' `dist/` statically and set `sw` and `assets-base` |
| the frame renders the host page inside itself | an SPA fallback answered a virtual route with `index.html`: the worker is not registered | check the registration; after "clear site data" reload once |
| content collapsed to 150 px | `auto-resize="off"` with no height from CSS; or the host's CSP has `style-src 'self'` and the browser lacks `adoptedStyleSheets`, so the fallback `<style>` is blocked | remove `auto-resize="off"`, or give the `h5p-player` tag a height; update the browser |
| `error: runtime` after `ready` | a content type threw a non-fatal exception, common on resize | log it; do not hide the player |
| Vite dev only: worker or assets 404 | the packages are hoisted somewhere Vite does not serve (a monorepo); their own fallback for `.vite/deps/` covers the normal layout | add both packages to `optimizeDeps.exclude`, or set `sw` and `assets-base` |
| a video takes minutes to start, then plays | the package, not the player: the video is compressed inside the zip and its index is at the end | the `h5p-normalize` skill; `preload="auto"` only moves the wait earlier |
| the content starts over on every reload | `resume` is not set, which is the default | set `resume` (or `resume="host"`) if the user wants that, see section 2 |
| "This content has changed since you last used it. You'll be starting over." | the package at that URL was replaced since the state was saved; the state is keyed by the build | expected, H5P's own dialog; OK drops the old state and the content saves afresh under the new build |

## 5. Hand over

For an embed, tell the user the player page's domain is theirs to keep running and must hold nothing else, that results are the page's to collect through the relay or there are none, and that a package runs its own scripts on that domain. For an install, tell the user three
things. The player is MIT; the H5P core runtime it loads is GPL-3.0, which
is why it is the separate package `@missing-elements/h5p-runtime`, whose `LICENSE.txt` and
`NOTICE.txt` must stay with any copy of its `dist/` — the player links against none of it and
only names its files. Results arrive
only as `xapi` and `finished` events on the element, stored nowhere, so an LRS or their own
backend has to listen; a learner's place in the content is kept only with the `resume`
attribute, in the browser's storage on that device (or handed to the host with
`resume="host"`), never sent. And if they generate or rewrite packages, `npx @missing-elements/h5p-verify
course.h5p` checks a package plays before it is published.

The full guide, with the element's API, the events, single-worker hosts and every symptom:
https://github.com/missing-elements/h5p-offline-player/blob/main/h5p-player-setup.md
