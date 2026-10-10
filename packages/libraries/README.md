# @missing-elements/h5p-libraries

One `.h5p` carrying the H5P hub's runtime libraries for every content type it serves, each at the
newest minor of its major, for
[`<h5p-player>`](https://www.npmjs.com/package/@missing-elements/h5p-offline-player)'s
`libraries` attribute. With it, an export that carries only `content/` (common from h5p.com and
h5p.org) plays.

## Use

The element names this pack itself: `libraries="pack"` fetches the version its release pins,
from jsDelivr.

```html
<h5p-player src="stripped.h5p" libraries="pack"></h5p-player>
```

Or serve `libraries.h5p` yourself and name that URL. With a bundler:

```js
import libraries from '@missing-elements/h5p-libraries/libraries.h5p?url'
player.setAttribute('libraries', libraries)
```

## Licences

Each library keeps its own licence (mostly MIT; also MPL-2.0, public domain,
and GPL-3.0 for flowplayer and H5P.MaterialDesignIcons).
[`libraries.txt`](libraries.txt) lists each one's version, licence and authors; serve it beside
the bundle.

`pnpm libraries` in the repository rebuilds the bundle and `libraries.txt`.
