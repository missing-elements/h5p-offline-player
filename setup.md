# h5p-player — setup guide

How to self-host the browser-only H5P player: on your own site, or on a player domain of your own that your site frames. No H5P server, no backend, no third-party service in the learner's path. For the system design see `architecture.md`.

## Requirements

- Site served over `https://` (or `localhost`). Service Workers do not run on `http://` or `file://`.
- The Service Worker script must come from the origin that runs the player: your site when you install, the player domain when you embed. With a bundler this is automatic; without one, place `h5p-sw.js` on the site.
- Package URLs must send CORS headers. `Range` support (a `206` to `Range: bytes=0-0`) is optional and lets packages stream without a full download. GitHub Pages meets both.

There are no fixed paths. The worker's scope is `<directory of h5p-sw.js>/h5p/`, so it never claims a scope an existing site worker owns.

## Which setup

Choose by what is on your site's origin. An H5P package is JavaScript, and it runs on the origin that serves the frame: installed on your site, a package can read your page, its non-`HttpOnly` cookies and storage, and call your APIs as the signed-in user.

| Your site | Setup |
|---|---|
| Needs the element's API — results with the learner's identity to your own backend, `resume="host"`, cmi5, a file picker, `custom-js` — and plays only packages you or your team made | **Install**, with a bundler or without a build step |
| A static site with no sessions — docs, a course site, a portfolio — playing your own packages | **Install**. **Embed** works too, at the cost of a second domain |
| An installable app that plays files the learner picks | **Install**, with the handlers mounted in the app's own worker (*Single-worker hosts*) |
| Has signed-in users: an LMS, a school or company portal, anything with an account or an admin area | **Embed**, from a player domain you run |
| Plays packages you did not make: uploads, links pasted by users or teachers, a marketplace | **Embed**, from a player domain you run |
| Cannot host a file: a page builder, a hosted CMS, a wiki, an LMS page you only edit | **Embed**, from a player domain your organisation runs |

When two rows apply — signed-in users *and* a need for the element's API — the safety rows win: embed, and take results through the relay, or install the player only on a separate origin with no session, the way a cmi5 assignable unit usually sits apart from its LMS.

- **Install** keeps the element and its events on your page, but every package runs as your site. Ask before opening a package from a link, as the demo does.
- **Embed** gives results only as relayed xAPI; no `resume="host"`, `user`, `custom-js` or file picker. Storage is partitioned per embedding site, so a package downloads once per site that embeds it.

## Install with a bundler (Vite, webpack 5, Rollup)

*Formerly Setup A.* See *Which setup* for when this fits.

```bash
npm i @missing-elements/h5p-offline-player @missing-elements/h5p-runtime
```

```js
import '@missing-elements/h5p-offline-player';
import { runtime } from '@missing-elements/h5p-runtime';

document.querySelector('h5p-player').runtime = runtime;
```

```html
<h5p-player src="https://host.example/course.h5p"></h5p-player>
```

Setting `src` loads and plays; set `runtime` before it. Vite (build and dev), Rollup and webpack 5 emit both packages' files as assets with no configuration.

- **Vite dev server:** if the packages sit where Vite does not serve — a monorepo that hoists them above the app's root — add both to `optimizeDeps.exclude`, or set `sw` and `assets-base` as below.
- **webpack:** a `module.rules` entry matching `.css` or `.js` everywhere also matches these assets; give it `dependency: { not: ['url'] }`.
- **esbuild and other bundlers that do not analyse `new URL(…, import.meta.url)`:** serve the player's `dist/` from a static path and the runtime's from there or the CDN, and point the element at them:

```html
<h5p-player src="…" sw="/vendor/h5p-player/h5p-sw.js"
            assets-base="https://cdn.jsdelivr.net/npm/@missing-elements/h5p-runtime/dist/"></h5p-player>
```

`sw` must stay same-origin; `assets-base` may be a CDN. With neither `runtime` nor `assets-base` the element looks in `frame-assets/` beside its own script.

**Already have a Service Worker?** Nothing changes: the two registrations have different scopes and never see each other's requests. To merge them, see *Single-worker hosts*.

## Install without a build step

*Formerly Setup B.* For plain HTML or a CMS theme you control. See *Which setup* for when this fits.

```html
<script type="module"
  src="https://cdn.jsdelivr.net/npm/@missing-elements/h5p-offline-player/dist/h5p-player.js"></script>
<h5p-player src="https://host.example/course.h5p" sw="/h5p-sw.js"
            assets-base="https://cdn.jsdelivr.net/npm/@missing-elements/h5p-runtime/dist/"></h5p-player>
```

Download `https://cdn.jsdelivr.net/npm/@missing-elements/h5p-offline-player/dist/h5p-sw.js` once, place it on the site (the root is safe) and point `sw` at it; browsers reject a cross-origin Service Worker. The runtime loads from the CDN via `assets-base`, or copy `@missing-elements/h5p-runtime`'s `dist/` to `frame-assets/` beside a copy of the element.

Under a Content-Security-Policy that does not allow `blob:` workers, also place `dist/h5p-jobs.js` on the site and point `jobs` at it.

## Embed — the player in an iframe, on a domain of your own

*Formerly Setup C.* Your page carries an `<iframe>` and one script line; packages run on the frame's origin, never on yours.

**The player page.** `npx @missing-elements/h5p-embed h5p-player` writes it as a static folder, with its policy as `_headers` (Netlify, Cloudflare Pages), `vercel.json` (Vercel) and a `<meta>` tag for other hosts. `--packages <origins>` limits where packages may come from, `--ancestors <origins>` which sites may frame it (needs a header-capable host); [its README](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/embed#readme) has the rest. Deploy it to a separate registrable domain that holds nothing else — no accounts, no cookies: `h5p-player.example.net`, not `h5p.example.com`, since a subdomain receives cookies set for `.example.com`. The demo's `/embed` ([live example](https://h5p-offline-player.vercel.app/demo/embed.html)) is not a service to embed from.

```html
<iframe src="https://h5p-player.example.net/?src=https://h5p-offline-player.vercel.app/demo/content/quiz.h5p&xapi=https://your-site.example"
        allow="fullscreen" style="width: 100%; border: 0"></iframe>
```

Query parameters: `src` (required); `libraries` (`pack` for the player domain's copy, `hub` or a URL); `preload=auto`; `xapi`, your page's origin; and `frame`, `copyright`, `export`, `icon`, `reporting` (bare), `fullscreen=off`, `activity-id=<IRI>`, `custom-css=<URL>`. Not `custom-js` or `user`.

**Sizing.** Add `<script src="https://h5p-player.example.net/resizer.js"></script>` to your page (h5p.org's `h5p-resizer.js` works too). Or answer the messages yourself: reply to `{ context: 'h5p', action: 'hello' }` with the same message, and on `{ context: 'h5p', action: 'resize', scrollHeight }` set the iframe's height.

**xAPI.** Relayed only when `xapi=` names the parent's origin, and posted to that origin only, as `{ context: 'h5p-offline-player', action: 'xapi', verb, statement }` and, at the end, `action: 'finished'` with the final statement. Check `event.origin` against the player's origin and `event.source` against your iframe. Any package can post a well-formed statement with any score, so treat relayed results as the learner's report; a grade that matters belongs with cmi5 or an assessment your server checks.

**Trying a package first.** [Embed My](https://embed-my.org/) runs the same page as a public service that checks a package from its link. Use it to test, not to serve learners: it puts a third party in every learner's path.

**Limits.** The embedding page must be served over https (or localhost); in an insecure page the frame has no Service Worker. Safari and iOS Safari run the framed player with no prompt.

## Element API

```html
<h5p-player
  src="…"              package URL — setting it loads; setting it again aborts and reloads
  sw="…"               worker URL (default: h5p-sw.js next to the element, same-origin)
  jobs="…"             background worker URL, for a CSP without `blob:` in `worker-src`
                       (default: a blob: URL, then h5p-jobs.js next to the element, same-origin)
  assets-base="…"      the runtime's dist/ (default: frame-assets/ beside the element);
                       the `runtime` property wins over it
  libraries="…"        for packages exported without their libraries: a `.h5p` URL carrying
                       library folders, `hub`, or several separated by spaces, tried in order —
                       "/h5p/libraries.h5p hub" (default: unset — such packages are refused).
                       Cached; an earlier download is used when the URL is unreachable
  allow-origins="…"    extra origins for the frame's CSP, space separated
  auto-resize="off"    size the element yourself (default: follows the content's height,
                       as an inline style)
  preload="…"          `auto` pulls large deflated media once the content is up (default: `none`)
  resume               keep the content's saved state on this device and resume from it
                       (default: off). `host` keeps nothing: the page gets `userdata` events
                       and sets `userData` before the next load
  frame copyright export icon embed
                       H5P's action bar and its buttons, as bare attributes (default: all off);
                       `export` offers `download-url` or the package URL; `embed` offers
                       `embed-code` (`:w` and `:h` for the size) and `resize-code`
  fullscreen="off"     take the fullscreen button away (default: on)
  custom-css="…"       stylesheets and scripts to load in the frame after the runtime's own,
  custom-js="…"        space separated; their origins join the frame's CSP
  reporting            the submit button, in content types that have one
  activity-id="…"      the id statements name as their object (default: the package URL)
></h5p-player>
```

Properties: `src`, `file` (a `File` from a picker; setting it loads), `runtime`, `user` (`{ name, mail }`, the actor of every statement; set it before `src`), `pkgId`, `preload`, `resume` (`off | device | host`), `userData` (the entries a host hands in under `resume="host"`), `state` (`idle | probing | downloading | indexing | ready | error`), `scope` (read-only), `revision` (read-only: the build playing), and `source`, `metadata`, `libraryBundle` (as on `ready`). `clearUserData()` forgets the state kept on the device for the package loaded now; set `src` again to start it over.

**`resume`.** Off by default, since on a shared machine one learner's state is what the next finds. Every package played on the site can read the stored state, so with `resume` on play only packages you trust. A state saved against another build is not handed over. Nothing is sent anywhere, and xAPI statements are never stored.

**Revision.** Every statement carries `context.revision` (`sha256:…` over the archive's index, then `; libraries sha256:…` for an attached bundle) and `context.platform` (`h5p-offline-player <version>`), unless the content set them. Record the revision for each release — the normalizer prints it — and compare statements against that record in an audit.

Events (all `CustomEvent`, payload in `detail`):

| Event | When |
|---|---|
| `ready` | Runtime initialised, content visible. `detail` carries `pkgId`, `source` (`range-http`, `chunked` or `file`, with its size), `metadata` (title, licence, authors, `mainLibrary`), `revision` and `libraryBundle` (which bundle supplied missing libraries, and whether from cache) |
| `xapi` | Any xAPI statement from the content — the only channel for results |
| `finished` | Content reported completion / score |
| `userdata` | With `resume`: the content saved its state — `dataType`, `subContentId`, `data`, `revision`. `data: null` means drop your copy. Under `host`, keep the latest per `dataType` and `subContentId`, by user and package, and hand them back as `userData` |
| `progress` | `fraction` 0–1; `phase` is `download`, `libraries`, `warm` or `extract` |
| `error` | `code`: `no-cors`, `no-worker`, `network`, `quota`, `bad-archive`, `runtime`. A `runtime` error after `ready` leaves `state` at `ready`: do not hide the player on it |

```js
const p = document.querySelector('h5p-player');
p.addEventListener('xapi', e => console.log(e.detail.statement));
p.addEventListener('error', e => {
  if (e.detail.code === 'no-cors') showDownloadHint();
});
input.onchange = () => (p.file = input.files[0]);
```

## Licences

The player is MIT. The H5P core runtime is GPL-3.0 and ships separately as `@missing-elements/h5p-runtime`; the two exchange HTTP and `postMessage` only. A site that serves the runtime is distributing GPL code, so keep its notices reachable: its bundled files each open with a licence comment, and when you copy `dist/` by hand, copy `LICENSE.txt` and `NOTICE.txt` too. The full account is `NOTICE.md` in each package.

## Coming from h5p-standalone

The element runs h5p-standalone inside its frame and takes its options by the same names where they still apply.

| h5p-standalone | Here | Note |
|---|---|---|
| `h5pJsonPath` | `src` or `file` | The package, not a folder |
| `frameJs`, `frameCss` | `runtime` or `assets-base` | |
| `frame`, `copyright`, `export`, `icon`, `embed` | the same, as bare attributes | `frame` shows the action bar the buttons live in |
| `fullScreen` | `fullscreen="off"` to turn off | On by default here |
| `downloadUrl` | `download-url` | Defaults to the package URL |
| `embedCode`, `resizeCode` | `embed-code`, `resize-code` | Same `:w` and `:h` placeholders |
| `customCss`, `customJs` | `custom-css`, `custom-js` | Space separated; their origins are allowed by the frame's CSP |
| `reportingIsEnabled` | `reporting` | |
| `xAPIObjectIRI` | `activity-id` | Defaults to the package URL |
| `user` | the `user` property | `{ name, mail }`; never stored |
| `metadata`, `title` | — | Read from the package's `h5p.json` |
| `contentUserData`, `saveFreq` | `resume`, `userData` | |
| `ajax.setFinishedUrl`, `postUserStatistics` | the `finished` event | Nothing is posted anywhere |
| `ajax.contentUserDataUrl` | `resume="host"` and the `userdata` event | |
| `id`, `librariesPath`, `contentJsonPath`, `embedType`, `preventH5PInit` | — | Decided by the package and the frame |

For formulas, see Troubleshooting rather than `customJs`.

## Troubleshooting

`npx @missing-elements/h5p-normalize course.h5p` is "normalize" below: it rewrites a package once so its media streams, leaving the content untouched.

| Symptom | Cause | Fix |
|---|---|---|
| `error: no-cors` | Package host sends no CORS headers | Ask the user to download the file and use `file` |
| `error: network`, "is an http: URL and this page is served over https:" | `src` or `libraries` is `http://` on an `https://` page | Use the `https://` URL. `http://localhost` works as is |
| `error: no-worker` | Page on `http://`, in-app browser without Service Workers, or `sw` cross-origin | Use `https://`; show "Open in Safari / Chrome"; serve `h5p-sw.js` from your origin |
| Worker or runtime files 404 after build | Bundler does not analyse `new URL(…, import.meta.url)` (esbuild), or the `runtime` property is not set | Set `player.runtime`; or serve both packages' `dist/` and set `sw` + `assets-base` |
| Worker blocked by CSP | `sw` points at another origin | Keep the worker same-origin |
| Console: creating a worker from `blob:` violates `worker-src` | The page refuses `blob:` workers; the element falls back to `h5p-jobs.js` | Set `jobs` to that file to skip the attempt. If `error: no-worker` follows, `h5p-jobs.js` is missing or not same-origin |
| Video won't play in Safari, other browsers fine | `h5p-sw.js` older than the element (no build step) | Re-download `h5p-sw.js`; the console warns on version mismatch |
| Console: `503` from the worker for a media file, after about 30 s | Nothing of the entry arrived for 30 s: the extracting tab closed or the host stopped answering | Reload. If it repeats, check the host answers `Range` requests promptly |
| `error: quota` | Not enough storage after evicting everything idle — a host without `Range`, where the whole archive must land, or one large deflated entry | Show `event.detail.message` (size needed, usage against quota). Normalize the package, or move it to a host that supports ranges |
| `error: bad-archive`, "Could not read the archive index" | The bytes are not a whole zip: a login page, a truncated upload, or an old element on a compressing host | `curl -sI -H 'Range: bytes=0-0' <url>` should give a `206` whose body starts with `PK`; `unzip -t` a download. Update the element |
| `error: bad-archive`, "contains no libraries" | An export with `content/` but no library folders (h5p.com, h5p.org) | Set `libraries` to `https://cdn.jsdelivr.net/npm/@missing-elements/h5p-libraries@0/libraries.h5p` (or your own copy, with its `libraries.txt`), optionally followed by a space and `hub`; or `libraries="hub"` alone; or re-export with libraries. `event.detail.missingLibraries` names them |
| Console: 404 for `<Library>-<major>.<minor>/library.json` on load | The runtime probing folder names | Ignore it. One per load is expected |
| Console: "violates the following Content Security Policy directive" | Content loads from an origin the frame does not permit | Built in: MathJax CDNs, Google WebFont, YouTube, Vimeo, Panopto. Add anything else to `allow-origins` |
| No copyright button with `frame copyright` | `h5p.json` names no licence, `U`, or one H5P does not know (such as `MIT`) | Give `h5p.json` a licence H5P knows (CC BY, CC0 1.0, GNU GPL, PD, C, …) |
| Formulas show as raw LaTeX, `\(…\)` or `$$…$$` | The package lacks `H5P.MathDisplay`; the player injects none, and a `libraries` bundle is not attached to a complete package | Add `H5P.MathDisplay-1.0/` to the archive and `H5P.MathDisplay` to `preloadedDependencies` (hub, MIT). It loads MathJax from a CDN, so formulas need the network even in the installable app |
| A video shows nothing for a long time, then plays (often the first of several) | The mp4 is deflated in the zip *and* not faststart, so it plays nothing until its last byte; videos are extracted one at a time | Normalize the package; until then, `preload="auto"` starts the transfer early |
| A video never starts after the host stays down for minutes | The player retries a silent or dropped link for a few minutes, then fails the entry with an `error` event | Reload once the host is back |
| `error: runtime`, content blank | Content type threw — usually a library missing from the archive, or a script blocked by the frame CSP | Check the console inside the frame; report the archive |
| `error: runtime` while the content works | A non-fatal exception, common on resize. `state` stays `ready` | Log it |
| YouTube video: `error: runtime` naming `youtube.js` | H5P.Video up to 1.6.66; the player works around it, so the video plays | Re-export with H5P.Video 1.6.80 or later to lose the error |

## Single-worker hosts (advanced)

Where only one Service Worker per origin is allowed (Angular `ngsw`, some Next.js PWA plugins, team policy), mount the handlers in the host's worker:

```js
// host's sw.js
import { mountH5P } from '@missing-elements/h5p-offline-player/sw';
mountH5P(self);                       // call before Workbox routing so h5p/* is claimed first
```

Routes then live under `<hostScope>h5p/`, and the element uses them instead of registering its own worker. Upgrading the package means rebuilding the host's worker.

**An app that must work offline needs this setup.** The frame's requests for the runtime, `h5p.css` and the fonts go to the worker that mounts the routes, so that worker must also precache them with your app shell, and the page must be controlled by it before the element loads anything — on a first visit, wait for `controllerchange` after registering. Worked example: the demo's installable app, [`apps/demo/app/sw.js`](https://github.com/missing-elements/h5p-offline-player/blob/main/apps/demo/app/sw.js) and [`app.js`](https://github.com/missing-elements/h5p-offline-player/blob/main/apps/demo/app/app.js).

## Versioning

- Cache names include the package major version; minor and patch updates reuse cached packages, and a worker update never invalidates them.
- After an upgrade, the element updates its own worker before the first load (waiting up to three seconds).
- Installed without a build step: re-download `h5p-sw.js` after upgrading. The element logs a warning when versions differ.
- Single-worker hosts update their own worker; offer a reload on `controllerchange`, as the demo's app does.
