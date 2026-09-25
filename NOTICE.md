# Third-party notices

`@missing-elements/h5p-offline-player` is published under `(MIT AND GPL-3.0-only)`. The
parenthesis is deliberate: the player's own code is MIT, and the package also ships code that is
not. This file says which is which.

## The player's own code — MIT

`dist/h5p-player.js`, `dist/h5p-sw.js`, `dist/h5p-sw-mount.js`, `types/` and everything under
`src/` and `scripts/` in the repository: MIT, see [LICENSE](LICENSE).

## zip.js — BSD-3-Clause

The two Service Worker scripts in `dist/`, `h5p-sw.js` and `h5p-sw-mount.js`, bundle [zip.js](https://github.com/gildas-lormeau/zip.js) as the
archive reader. They are minified with legal comments removed, so its notice does not survive
into the files themselves and is reproduced here instead, as its licence requires:

```
BSD 3-Clause License

Copyright (c) 2023, Gildas Lormeau

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## The H5P runtime in `dist/frame-assets/` — GPL-3.0

`dist/frame-assets/` is the runtime the element loads inside its frame, copied unmodified from
[h5p-standalone](https://github.com/tunapanda/h5p-standalone) 3.8.2. h5p-standalone's own
code is MIT (Copyright (c) 2015 Tunapanda), but `frame.bundle.js` is built from the H5P core
scripts in its `vendor/h5p/js/` — `h5p.js`, `h5p-event-dispatcher.js`, `h5p-x-api.js`,
`h5p-x-api-event.js`, `h5p-content-type.js`, `h5p-confirmation-dialog.js`, `request-queue.js`,
`h5p-action-bar.js`, `h5p-tooltip.js` — which come from
[h5p/h5p-php-library](https://github.com/h5p/h5p-php-library), licensed under the
**GNU General Public License v3.0**. The core stylesheet (`styles/h5p.css`, `styles/h5p-fonts.css`),
the `h5p-*` icon fonts and `images/` come from the same repository. Upstream confirmed this in
[tunapanda/h5p-standalone#188](https://github.com/tunapanda/h5p-standalone/issues/188); its npm
metadata still says MIT.

The full licence text is in [licenses/GPL-3.0.txt](licenses/GPL-3.0.txt) and, so that it travels
with the files, in `dist/frame-assets/LICENSE.txt`; `dist/frame-assets/NOTICE.txt` lists the
files. Keep both beside the directory when you copy or serve it. Corresponding source:
<https://github.com/tunapanda/h5p-standalone/tree/v3.8.2> (`src/` and `vendor/h5p/`).
h5p-standalone does not record which h5p-php-library revision `vendor/h5p/` was taken from.

Also inside `dist/frame-assets/`:

- jQuery 3.5.1, in `frame.bundle.js` — MIT, Copyright JS Foundation and other contributors,
  <https://jquery.org/license>.
- regenerator-runtime, in `main.bundle.js` — MIT, see `main.bundle.js.LICENSE.txt`.
- Inter, `fonts/inter/` — SIL Open Font License 1.1, see `fonts/inter/LICENSE.txt`.
- Open Sans, `fonts/open-sans/` — SIL Open Font License 1.1, see `fonts/open-sans/OFL.txt`.

## What this means for a site

A site that serves `frame-assets/` to browsers is distributing GPL-3.0 code, with what that
entails for keeping the notices and making the source available; the notice and the tag above
are what it needs. Whether the copyleft reaches the page around the player is a legal question
this file does not answer: the element and its workers exchange only messages and HTTP with the
runtime, while the small boot script runs in the same document and calls its API.
