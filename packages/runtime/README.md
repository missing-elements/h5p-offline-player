# @missing-elements/h5p-runtime

The H5P core runtime and frame boot script that
[`<h5p-player>`](https://www.npmjs.com/package/@missing-elements/h5p-offline-player) loads in its
frame. It is **GPL-3.0-only**, as the H5P core is, and kept apart from the MIT player. Keep
`LICENSE.txt` and `NOTICE.txt` with every copy you serve.
[NOTICE.md](NOTICE.md) says what is in here and where it came from.

## Use

With a bundler:

```js
import '@missing-elements/h5p-offline-player'
import { runtime } from '@missing-elements/h5p-runtime'

document.querySelector('h5p-player').runtime = runtime
```

Without one, point the element at a copy of `dist/`:

```html
<h5p-player src="course.h5p"
            assets-base="https://cdn.jsdelivr.net/npm/@missing-elements/h5p-runtime@0.1.0/dist/"></h5p-player>
```

Or copy `dist/` to `frame-assets/` next to `h5p-player.js`, where the element looks by default.

`dist/` holds `main.bundle.js` and `frame.bundle.js` (h5p-standalone's loader, the H5P core and
jQuery), `h5p.css`, `fonts/`, `frame-boot.js`, `MANIFEST.json`, `LICENSE.txt` and `NOTICE.txt`.
Use a runtime version within the range the player names as its optional peer dependency.
