# Third-party notices

`@missing-elements/h5p-offline-player` is published under the MIT licence, and so is everything
in it: `dist/h5p-player.js`, `dist/h5p-sw.js`, `dist/h5p-sw-mount.js`, `dist/h5p-jobs.js`,
`types/` and the sources under `src/` and `scripts/` in the repository — see [LICENSE](LICENSE).
Two things are worth knowing beyond that.

## zip.js — BSD-3-Clause

The two Service Worker scripts in `dist/`, `h5p-sw.js` and `h5p-sw-mount.js`, bundle
[zip.js](https://github.com/gildas-lormeau/zip.js) as the archive reader. They are minified with
the notices inside zip.js's sources removed, and each file opens instead with a `/*! … */`
comment carrying the licence below in full — so it travels with the file when a bundler emits it
on its own. It is reproduced here as well:

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

## The H5P runtime is not in this package

The element plays content inside a frame that runs the H5P core runtime, and that runtime is
**GPL-3.0** — it comes from [h5p/h5p-php-library](https://github.com/h5p/h5p-php-library) by way
of [h5p-standalone](https://github.com/tunapanda/h5p-standalone). Up to 0.4 this package shipped
it under `dist/frame-assets/` and was published as `(MIT AND GPL-3.0-only)`. From 0.5 it does
not: the runtime, its stylesheet and fonts, and the script that boots it inside the frame are
[`@missing-elements/h5p-runtime`](https://www.npmjs.com/package/@missing-elements/h5p-runtime),
a package of its own under the GPL, with its own `NOTICE.md`. A site installs that package,
serves it from a CDN or copies its `dist/` next to the element, and the element names its files;
the two exchange HTTP and `postMessage` and nothing else. What a site serving the runtime has to
do about the GPL is in that package's notice, not here.
