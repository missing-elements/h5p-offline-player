# Packages without libraries

Exports from h5p.com and h5p.org routinely contain `content/` and nothing else: the site they
came from already has the libraries, so bundling them would be waste. Anywhere else such a
package cannot run, and the runtime's only symptom is a 404 for `<MainLibrary>/library.json`.

The player refuses these up front and names what is absent. `libraries` tells it where to look
instead:

```html
<!-- the official H5P content-type server, keyed on the package's mainLibrary -->
<h5p-player src="stripped.h5p" libraries="hub"></h5p-player>

<!-- or any .h5p that carries the library folders -->
<h5p-player src="stripped.h5p" libraries="/h5p/libraries-bundle.h5p"></h5p-player>
```

Entries then resolve against the package first and the bundle second, and the two `h5p.json`
manifests are merged — a stripped export also cuts `preloadedDependencies` down to the main
library, so without the merge an Interactive Video would load but its interactions would not. The
bundle is downloaded once, cached, and shared by every package that uses it. When the source
cannot be reached later — no network, or the hub down — a bundle downloaded whole from the same
URL before is used instead, so a stripped export plays offline once one has played online.

It is off by default. `libraries="hub"` is a request to a third party on every cold load, which is
the host's decision to make, not the element's.

**A ready-made bundle.** The repository ships one: the H5P hub's runtime libraries for every
content type it serves, 98 libraries in ~10 MB, each at its newest minor version — the pack the
[offline app](https://h5p-offline-player.vercel.app/app/) carries. Download
[`libraries.h5p`](https://github.com/missing-elements/h5p-offline-player/raw/main/apps/demo/app/libraries.h5p)
and serve it from your own site, next to the element:

```html
<h5p-player src="stripped.h5p" libraries="/h5p/libraries.h5p"></h5p-player>
```

Take [`libraries.txt`](https://github.com/missing-elements/h5p-offline-player/blob/main/apps/demo/app/libraries.txt)
with it: it lists each library's licence and authors, and the licences — mostly MIT, a few MPL
and GPL-3.0 — ask for their notices to travel with the code. Serve it yourself rather than
pointing at the demo site's copy, which is not sent with CORS headers and changes when the pack
is refreshed. A package that needs a newer minor than the bundle carries is still refused with
the missing libraries named; `pnpm demo:libraries` rebuilds the bundle from the hub.
