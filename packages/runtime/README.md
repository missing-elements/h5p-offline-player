# @missing-elements/h5p-runtime

The H5P core runtime and the frame boot script that
[`<h5p-player>`](https://www.npmjs.com/package/@missing-elements/h5p-offline-player) loads inside
its frame. It is a package of its own because it is **GPL-3.0** — the H5P core is — while the
player is MIT: a site decides whether to install this, serve it from a CDN, or copy it next to
the player, and the player's own package carries none of it. [NOTICE.md](NOTICE.md) says what is
in here and where it came from.

## Use

With a bundler, import it and hand it to the element; the bundler emits the files and the
element finds them:

```js
import '@missing-elements/h5p-offline-player'
import { runtime } from '@missing-elements/h5p-runtime'

document.querySelector('h5p-player').runtime = runtime
```

Without one, point the element at a copy of `dist/`, on your site or on a CDN:

```html
<h5p-player src="course.h5p"
            assets-base="https://cdn.jsdelivr.net/npm/@missing-elements/h5p-runtime@0/dist/"></h5p-player>
```

Or copy `dist/` to `frame-assets/` next to `h5p-player.js`, which is where the element looks when
told nothing. Keep `LICENSE.txt` and `NOTICE.txt` with the copy.

## What is in `dist/`

| File | What |
|---|---|
| `main.bundle.js`, `frame.bundle.js` | h5p-standalone's loader and the H5P core with jQuery |
| `h5p.css` | the core stylesheet, rebuilt to stand alone |
| `fonts/` | Inter and Open Sans, declared by the player's frame document |
| `frame-boot.js` | the script that boots the runtime in the frame and talks to the element |
| `MANIFEST.json` | the versions and the font list |
| `LICENSE.txt`, `NOTICE.txt` | the licences, to travel with the directory |

The player's `h5p-sw.js` and this package's `frame-boot.js` have to agree on the boot
configuration they exchange; a player release names the runtime versions it works with as an
optional peer dependency.
