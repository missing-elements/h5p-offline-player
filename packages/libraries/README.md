# @missing-elements/h5p-libraries

The H5P hub's runtime libraries for every content type it serves, each at the newest minor of its
major, for [`<h5p-player>`](https://www.npmjs.com/package/@missing-elements/h5p-offline-player)'s
`libraries="pack"`. With it, an export that carries only `content/` (common from h5p.com and
h5p.org) plays, and an older export plays the newer versions of its libraries.

## What is in it

- `parts/`: one `.h5p` per library folder, and `index.json`, which gives each library's version,
  dependencies and addon patterns, and its archive's size and SHA-256. The player downloads only
  the archives a package needs and checks each against its hash.
- `index.js`: the `pack` export, the index with a static `new URL` for each archive, so a bundler
  emits them as assets of your site.
- `libraries.h5p`: the whole pack as one archive, for a `libraries` URL that takes it as any bundle.
- `libraries.txt`: each library's version, licence and authors.

## Use

The element names this pack itself: `libraries="pack"` fetches the archives a package needs from
jsDelivr, at the version its release pins.

```html
<h5p-player src="stripped.h5p" libraries="pack"></h5p-player>
```

To keep the requests on your own site, serve a copy of `parts/` and name its folder:

```html
<h5p-player src="stripped.h5p" libraries="pack" pack-base="/h5p-libraries/"></h5p-player>
```

Or, with a bundler, hand over the `pack` export:

```js
import { pack } from '@missing-elements/h5p-libraries'

player.pack = pack
player.setAttribute('libraries', 'pack')
```

Every archive is at least 8 kB, padded with the archive's comment where a library is smaller, so
that a bundler emits it as a file rather than inlining it as a `data:` URL, which a page's policy
would refuse to fetch.

## Licences

Each library keeps its own licence (mostly MIT; also MPL-2.0, public domain,
and GPL-3.0 for flowplayer and H5P.MaterialDesignIcons).
[`libraries.txt`](libraries.txt) lists each one's version, licence and authors; serve it beside
the pack.

`pnpm libraries` in the repository rebuilds the pack from the hub, its parts and `libraries.txt`;
`pnpm parts` in this package splits the committed `libraries.h5p` again.
