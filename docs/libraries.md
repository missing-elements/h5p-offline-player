# Packages without libraries

Exports from h5p.com and h5p.org routinely contain `content/` and nothing else: the site they
came from already has the libraries, so bundling them would be waste. Anywhere else such a
package cannot run, and the runtime's only symptom is a 404 for `<MainLibrary>/library.json`.

The player refuses these up front and names what is absent. `libraries` tells it where to look
instead, and the recommended value is a bundle, with the hub behind it:

```html
<h5p-player src="stripped.h5p"
            libraries="https://cdn.jsdelivr.net/npm/@missing-elements/h5p-libraries@0/libraries.h5p hub"></h5p-player>
```

[`@missing-elements/h5p-libraries`](https://www.npmjs.com/package/@missing-elements/h5p-libraries)
is one `.h5p` carrying the H5P hub's runtime libraries for every content type it serves — 98
libraries from 52 content types, about 10 MB, each at the newest minor of its major — the pack
the [offline app](https://h5p-offline-player.vercel.app/app/) carries. From the CDN it is
versioned, sent with CORS and immune to anything the hub does; or install the package and serve
`libraries.h5p` from your own site, with its `libraries.txt`, the list of each library's licence
and authors — mostly MIT, two MPL, two GPL-3.0 — which those licences ask to travel with the
code. With a bundler, `import libraries from '@missing-elements/h5p-libraries/libraries.h5p?url'`
emits it beside your own files.

`libraries` takes several sources, separated by spaces, tried in order. The second word above,
`hub`, is the H5P content-type server, keyed on the package's main library: it is asked only
for what the bundle lacks — a newer minor than the bundle was built with, a content type added
to the hub since — and never otherwise. Leave it out for a site that must not reach h5p.org;
use it alone, `libraries="hub"`, for a site that would rather ask the hub every time. The hub
is a request to a third party on every cold load, which is why none of this is on by default:
that is the host's decision to make, not the element's.

Entries then resolve against the package first and the bundle second, and the two `h5p.json`
manifests are merged — a stripped export also cuts `preloadedDependencies` down to the main
library, so without the merge an Interactive Video would load but its interactions would not. A
bundle is downloaded once, cached, and shared by every package that uses it. When its source
cannot be reached later — no network, the hub down or moved — a bundle downloaded whole from the
same URL before is used instead, so a stripped export plays offline once one has played online.
The worker keeps one bundle per package: when the hub answers after the bundle could not, the
hub's bundle for that content type, which carries the type's whole set, takes the bundle's place
for that package.

A package that needs a library none of the sources carry is still refused with the missing
libraries named; `pnpm libraries` in the repository rebuilds the bundle from the hub.
