# h5p-player — setup guide

How to add the browser-only H5P player to a site. For the system design see `h5p-offline-player-architecture.md`.

## Requirements

- Site served over `https://` (or `localhost`). Service Workers do not run on `http://` or `file://`.
- Two files served from the site's own origin: the worker `h5p-sw.js` and the `frame/` directory. Everything else can come from a bundler or a CDN.
- Package URLs must send CORS headers. Range support (`Accept-Ranges: bytes`) is optional but enables streaming without a full download.

## Default convention

The element assumes this layout unless told otherwise. Follow it and there is nothing to configure.

| What | Path |
|---|---|
| Worker | `/h5p/h5p-sw.js` |
| Frame | `/h5p/frame/` |
| Worker scope | `/h5p/` |
| Virtual package files | `/h5p/virtual/<pkg>/…` |

Override with the `sw`, `frame` and `scope` attributes.

## Setup A — app with a bundler, no existing Service Worker

```bash
npm i @you/h5p-player
npx h5p-player copy public/h5p
```

```js
import '@you/h5p-player';
```

```html
<h5p-player src="https://host.example/course.h5p" store-results></h5p-player>
```

The `copy` command puts `h5p-sw.js` and `frame/` into the static directory. Add it to `postinstall` or the build script so upgrades pick up new files.

## Setup B — site already has a Service Worker

```js
// your sw.js (Workbox, vite-plugin-pwa, hand-written)
import { mountH5P } from '@you/h5p-player/sw';
mountH5P(self, { prefix: '/h5p/' });
```

Still run `npx h5p-player copy public/h5p` for the frame. The element detects that the routes already answer (it pings `/h5p/virtual/_ping`) and skips registration.

## Setup C — no build step

```html
<script type="module"
  src="https://cdn.jsdelivr.net/npm/@you/h5p-player/dist/h5p-player.js"></script>
<h5p-player src="https://host.example/course.h5p"></h5p-player>
```

Download `dist/h5p-sw.js` and `dist/frame/` from the package and place them under `/h5p/` on the site. The worker cannot be loaded from the CDN: the browser rejects cross-origin registration.

## Setup D — iframe embed (no files on the host)

For sites that cannot host the worker, embed the hosted player app:

```html
<iframe src="https://player.example/embed?src=https://host.example/course.h5p"
        allowfullscreen></iframe>
```

Storage and results live on the player's origin. Safari blocks Service Workers in cross-origin iframes, so this mode is online-only there.

## Element API

```html
<h5p-player
  src="…"              package URL
  sw="…"               worker URL (default /h5p/h5p-sw.js)
  frame="…"            frame directory (default /h5p/frame/)
  scope="…"            worker scope (default /h5p/)
  store-results        keep xAPI / save-and-resume in IndexedDB
  autoplay             load on connect (default: wait for load())
></h5p-player>
```

Properties: `src`, `file` (a `File` from a picker — the local-file plugin slot), `pkgId`, `state`.

Methods: `load()`, `saveOffline()`, `removeOffline()`, `results()` → array of xAPI statements, `clearResults()`.

Events (all `CustomEvent`, payload in `detail`):

| Event | When |
|---|---|
| `ready` | Runtime initialised, content visible |
| `xapi` | Any xAPI statement from the content |
| `finished` | Content reported completion / score |
| `progress` | Download or extraction progress, `fraction` 0–1 |
| `offline-ready` | Package fully stored |
| `error` | `code`: `no-cors`, `no-worker`, `scope`, `quota`, `bad-archive` |

```js
const p = document.querySelector('h5p-player');
p.addEventListener('xapi', e => send(e.detail.statement));
p.addEventListener('error', e => {
  if (e.detail.code === 'no-cors') showDownloadHint();
});
input.onchange = () => (p.file = input.files[0]);
```

## What happens at runtime

1. Element connects, registers the worker (or finds it mounted), waits for `ready`.
2. Probes `src` with `HEAD`: CORS? Range? Picks a source adapter and hands it to the worker.
3. Worker indexes the archive, walks dependencies, returns `pkgId`.
4. Element loads `/h5p/frame/index.html?pkg=<pkgId>`; the frame boots h5p-standalone against `/h5p/virtual/<pkgId>`.
5. Worker serves each file by strategy: small entries from cache, stored media by slicing, deflated media by one-pass extraction into chunks.
6. Results arrive as `xapi` events and, with `store-results`, in IndexedDB.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `error: no-cors` | Package host sends no CORS headers | Cannot be fetched from a browser. Ask the user to download the file and use `file` |
| `error: scope` | Worker emitted under `/assets/`, frame outside its scope | Emit the worker at `/h5p/h5p-sw.js`, or set `Service-Worker-Allowed: /` (not possible on GitHub Pages) |
| `error: no-worker` | Page on `http://`, or in-app browser without Service Worker support | Use `https://`; show "Open in Safari / Chrome" |
| Video won't play in Safari | Range responses not `206` | Worker version mismatch — run `copy` again |
| Saved package gone after a week (iOS) | Safari's 7-day eviction for non-installed sites | Prompt the user to add the app to the Home Screen |
| `error: quota` | Not enough storage for extraction | Show `navigator.storage.estimate()` result; offer streaming-only playback |

## Versioning

- Cache names include the package major version. Minor and patch updates reuse saved packages.
- The worker updates itself on the next visit (`skipWaiting`); saved packages are never invalidated by a worker update.
- Run `npx h5p-player copy` after every upgrade so `h5p-sw.js` and `frame/` match the element version. The element logs a warning when they don't.
