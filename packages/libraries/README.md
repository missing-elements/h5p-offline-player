# @missing-elements/h5p-libraries

One `.h5p` carrying the H5P hub's runtime libraries for every content type it serves, each at the
newest minor of its major, for
[`<h5p-player>`](https://www.npmjs.com/package/@missing-elements/h5p-offline-player)'s
`libraries` attribute. With it, an export that carries only `content/` (common from h5p.com and
h5p.org) plays without asking the hub.

## Use

From a CDN, versioned, with CORS:

```html
<h5p-player src="stripped.h5p"
            libraries="https://cdn.jsdelivr.net/npm/@missing-elements/h5p-libraries@0/libraries.h5p hub"></h5p-player>
```

Or serve `libraries.h5p` yourself and name that URL. `hub` is the fallback for libraries the
bundle lacks; leave it out for a site that must not reach h5p.org.

With a bundler:

```js
import libraries from '@missing-elements/h5p-libraries/libraries.h5p?url'
player.setAttribute('libraries', `${libraries} hub`)
```

## Licences

Each library keeps its own licence (mostly MIT; also MPL-2.0, public domain,
and GPL-3.0 for flowplayer and H5P.MaterialDesignIcons).
[`libraries.txt`](libraries.txt) lists each one's version, licence and authors; serve it beside
the bundle.

`pnpm libraries` in the repository rebuilds the bundle and `libraries.txt`.
