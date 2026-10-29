# Setting up the player

The README's [Which setup](../README.md#which-setup) chooses between installing the element on
your site and embedding the player page from a separate domain. This page has each path in full:
the library pack from your own site, loading from jsDelivr, caching and upgrades.

## Requirements

- The page on `https://`, or `localhost` while developing: the player needs a Service Worker.
- CORS headers on the package host, so the page can read the `.h5p`. `Range` support is optional:
  without it the archive is downloaded once and played from the cache.
- A browser with Service Workers, the Cache API, IndexedDB, Web Locks and `DecompressionStream`;
  [Compatibility](compatibility.md) says which are tested.

## Install with a bundler

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
runtime is a separate package because it is GPL-3.0 (see the README's
[Licence](../README.md#licence)). With a bundler that does not emit `new URL(…, import.meta.url)`
assets, esbuild among them, serve both packages' `dist/` and set `sw` and `assets-base`, as under
*Install without a build step*.

For [`libraries="pack"`](libraries.md) served from your own site rather than jsDelivr, install
`@missing-elements/h5p-libraries` too and hand over its `pack` export, which the bundler emits as
one asset per library:

```js
import { pack } from '@missing-elements/h5p-libraries'

document.querySelector('h5p-player').pack = pack
```

## Install without a build step

Copy the files onto your own site, so that nothing a learner's browser loads comes from anyone
else's server; npm is only how you get them. `public/` stands for the folder your site is served
from:

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
attribute, and the worker is always the element's own version. For `libraries="pack"`, copy the
library pack too, with the list of its libraries' licences, and name its folder with
`pack-base="/h5p-libraries/"`:

```bash
npm install @missing-elements/h5p-libraries
cp -r node_modules/@missing-elements/h5p-libraries/parts public/h5p-libraries
cp node_modules/@missing-elements/h5p-libraries/libraries.txt public/h5p-libraries/
```

To upgrade, delete the folders and copy them again. Serve them with `Cache-Control: no-cache`, or
with no caching header at all: the file names stay the same from one version to the next, so a
copy a browser kept from before an upgrade would run against the new Service Worker.
[Single-worker hosts and upgrades](single-worker.md) has the rest.

### From jsDelivr

Or load the element and the runtime from jsDelivr, and copy only the Service Worker:

```html
<script type="module"
  src="https://cdn.jsdelivr.net/npm/@missing-elements/h5p-offline-player@1.2.0/dist/h5p-player.js"></script>
<h5p-player src="https://host.example/course.h5p" sw="/h5p-sw.js"
            assets-base="https://cdn.jsdelivr.net/npm/@missing-elements/h5p-runtime@1.0.0/dist/"></h5p-player>
```

Copy `dist/h5p-sw.js` of the same version onto your own site: browsers register a Service Worker
only from the page's origin. Its scope is `/h5p/`, so an existing site worker is left alone. Pin
the version, and copy the worker again whenever you change it; the element warns when the two
differ. Every learner's browser then fetches the player from jsDelivr, as it does the pack's
libraries unless `pack-base` names a copy of your own. Do not serve *packages* from jsDelivr: it
cuts ranges from a compressed copy, and a range-read package breaks.

## Embed

[`@missing-elements/h5p-embed`](../packages/embed#readme) writes the player page as a static site:

```bash
npx @missing-elements/h5p-embed@latest h5p-player --packages https://host.example
```

It needs Node 22 or later. Write `@latest`: without it, npm on an older Node quietly installs the
last version that supported it, which writes a player from before 1.0.

Deploy it to a separate registrable domain that holds nothing else (a subdomain would receive
your site's cookies) and frame it:

```html
<iframe src="https://h5p-player.example.net/?src=https://host.example/course.h5p&xapi=https://your-site.example"
        allow="fullscreen; microphone; camera" style="width: 100%; border: 0"></iframe>
<script src="https://h5p-player.example.net/resizer.js"></script>
```

`microphone` and `camera` are for the content types that record or film: Audio Recorder, Speak the
Words and AR Scavenger. A frame from another site gets neither unless the page allows it. The
embed package's [README](../packages/embed#readme) has the page's query parameters, the policy
files it writes for each kind of host, and the SCORM package it can write instead.

## When something goes wrong

[Troubleshooting](troubleshooting.md) lists the symptoms, causes and fixes. A site that allows
one Service Worker, or must work offline, mounts the player in its own worker:
[Single-worker hosts and upgrades](single-worker.md).
