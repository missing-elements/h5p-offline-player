# Third-party notices

`@missing-elements/h5p-runtime` is published under **GPL-3.0-only**, and everything in it is
either GPL-3.0 or under a licence the GPL accepts. It exists so that
[`@missing-elements/h5p-offline-player`](https://www.npmjs.com/package/@missing-elements/h5p-offline-player),
which is MIT, carries none of this: the player's element and workers exchange only HTTP and
`postMessage` with what is in this package.

## The H5P runtime in `dist/` — GPL-3.0

`dist/` holds the runtime the player loads inside its frame, taken from
[h5p-standalone](https://github.com/tunapanda/h5p-standalone): the scripts' code unmodified,
each given a leading licence comment, the stylesheet rebuilt into `h5p.css` with its icon fonts
and image inlined as data URLs and its Inter and Open Sans faces moved to `fonts/`, listed in
`MANIFEST.json` for the player's frame document to declare. h5p-standalone's own code is MIT
(Copyright (c) 2015 Tunapanda), but `frame.bundle.js` is built from the H5P core scripts in its
`vendor/h5p/js/` — `h5p.js`, `h5p-event-dispatcher.js`, `h5p-x-api.js`, `h5p-x-api-event.js`,
`h5p-content-type.js`, `h5p-confirmation-dialog.js`, `request-queue.js`, `h5p-action-bar.js`,
`h5p-tooltip.js` — which come from [h5p/h5p-php-library](https://github.com/h5p/h5p-php-library),
licensed under the **GNU General Public License v3.0**. The core stylesheet (`h5p.css`), the
`h5p-*` icon fonts and the throbber image inlined in it come from the same repository. Upstream
confirmed this in [tunapanda/h5p-standalone#188](https://github.com/tunapanda/h5p-standalone/issues/188);
its npm metadata still says MIT.

The full licence text is in [LICENSE](LICENSE) and, so that it travels with the files, in
`dist/LICENSE.txt`; `dist/NOTICE.txt` lists the files and names the h5p-standalone tag actually
vendored, which is the corresponding source. Keep both beside the directory when you copy or
serve it. h5p-standalone does not record which h5p-php-library revision `vendor/h5p/` was taken
from.

Also inside `dist/`:

- jQuery 3.5.1, in `frame.bundle.js` — MIT, Copyright JS Foundation and other contributors,
  <https://jquery.org/license>.
- regenerator-runtime, in `main.bundle.js` — MIT, named in the file's own leading comment.
- Inter, `fonts/inter-*.woff2` — SIL Open Font License 1.1, see `fonts/Inter-LICENSE.txt`.
- Open Sans, `fonts/open-sans-*.woff2` — SIL Open Font License 1.1, see `fonts/OpenSans-OFL.txt`.

## The boot script — GPL-3.0

`dist/frame-boot.js` is built from `src/frame-boot.ts` in this package, Copyright (c) 2026
missing-elements, and released under the GPL-3.0 like the runtime it boots. It is the one piece
of the player's own code that runs inside the H5P document and calls the core's API — `H5P.init`,
`newRunnable`, the user-data functions — so it belongs with the core rather than with the
element, which talks to it over `postMessage` only.

## What this means for a site

A site that serves `dist/` to browsers is distributing GPL-3.0 code, with what that entails for
keeping the notices and making the source available; the notices above and the files beside the
directory are what it needs. With a bundler the files are emitted under hashed names and the
text files do not travel; `frame.bundle.js`, `main.bundle.js`, `h5p.css` and `frame-boot.js`
therefore each open with a `/*! … */` comment naming their licences and the corresponding source,
which bundlers leave in an emitted asset.

Whether the copyleft reaches the page around the player is a legal question this file does not
answer. The arrangement is this: the player is a separate program, under its own MIT licence,
which fetches these files over HTTP and exchanges messages with the document they run in; it
does not link against them, call their functions or share their memory.
