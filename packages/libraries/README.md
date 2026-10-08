# @missing-elements/h5p-libraries

One `.h5p` carrying the H5P hub's runtime libraries for every content type it serves — 98
libraries from 52 content types, about 10 MB, each at the newest minor of its major — for
[`<h5p-player>`](https://www.npmjs.com/package/@missing-elements/h5p-offline-player)'s
`libraries` attribute. Exports from h5p.com and h5p.org routinely contain `content/` and no
libraries, because the site they came from already has them; with this bundle such a package
plays without a request to the hub, and keeps playing when the hub is unreachable or has moved.

## Use

From a CDN, versioned, with CORS, nothing to host:

```html
<h5p-player src="stripped.h5p"
            libraries="https://cdn.jsdelivr.net/npm/@missing-elements/h5p-libraries@0/libraries.h5p hub"></h5p-player>
```

Or serve `libraries.h5p` from your own site and name that URL. The second word, `hub`, is the
fallback: a package that needs a library the bundle lacks — a newer minor, a content type added
to the hub since — is then asked for from the hub, and only then. Leave it out for a site that
must not reach h5p.org.

With a bundler, import the file as a URL and the bundler emits it:

```js
import libraries from '@missing-elements/h5p-libraries/libraries.h5p?url'
player.setAttribute('libraries', `${libraries} hub`)
```

The bundle is downloaded once per browser and cached; a package that needs it is attached to it
rather than copied. Every statement the content sends then names the bundle's build in
`context.revision` beside the package's own.

## Licences

The libraries are other people's work and keep their licences: MIT for most, MPL-2.0 for two,
GPL-3.0 for two (flowplayer and H5P.MaterialDesignIcons), public domain for two.
[`libraries.txt`](libraries.txt) lists each library with its version, licence and authors; serve
it beside the bundle, since those licences ask for their notices to travel with the code.

## Rebuilding

`pnpm libraries` in the repository rebuilds the bundle from the hub and rewrites
`libraries.txt`; see the repository's `AGENTS.md`.
