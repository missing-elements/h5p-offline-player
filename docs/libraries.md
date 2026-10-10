# Packages without libraries

Exports from h5p.com and h5p.org often contain only `content/`, without the libraries. The
player refuses such a package and names what is missing. `libraries` tells it where to look; the
recommended value is a bundle with the hub behind it:

```html
<h5p-player src="stripped.h5p"
            libraries="https://cdn.jsdelivr.net/npm/@missing-elements/h5p-libraries@0/libraries.h5p hub"></h5p-player>
```

[`@missing-elements/h5p-libraries`](https://www.npmjs.com/package/@missing-elements/h5p-libraries)
is one `.h5p`, about 10 MB, with the H5P hub's runtime libraries for every content type it
serves, each at the newest minor of its major. Load it from the CDN, or install the package and
serve `libraries.h5p` from your own site together with `libraries.txt`, the list of each
library's licence and authors, which those licences ask to travel with the code. With a bundler,
`import libraries from '@missing-elements/h5p-libraries/libraries.h5p?url'` emits it.

`libraries` takes several sources separated by spaces, tried in order. `hub` is the H5P
content-type server, asked only for what earlier sources lack. Leave it out for a site that must
not reach h5p.org; use `libraries="hub"` alone to ask the hub every time. Nothing is on by
default, since the hub is a third-party request on every cold load.

A bundle is downloaded once, cached and shared by every package that uses it. If its source is
unreachable later, a bundle downloaded whole from the same URL before is used, so a stripped
export plays offline once it has played online.

A package that needs a library no source carries is still refused, with the missing libraries
named. `pnpm libraries` in the repository rebuilds the bundle from the hub.
