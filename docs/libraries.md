# Packages without libraries

Exports from h5p.com and h5p.org often contain only `content/`, without the libraries. The
player refuses such a package and names what is missing. `libraries` tells it where to look:

```html
<h5p-player src="stripped.h5p" libraries="pack"></h5p-player>
```

`pack` is [`@missing-elements/h5p-libraries`](https://www.npmjs.com/package/@missing-elements/h5p-libraries):
one `.h5p`, about 10 MB, with the H5P hub's runtime libraries for every content type it serves,
each at the newest minor of its major. Each player release names one version of it, on jsDelivr.
The pack is rebuilt from the hub weekly and released with the player.

To keep the request on your own hosting, install the package and serve `libraries.h5p` yourself,
together with `libraries.txt`, the list of each library's licence and authors, which those
licences ask to travel with the code. Then name that URL instead of `pack`, or before it. With a
bundler, `import libraries from '@missing-elements/h5p-libraries/libraries.h5p?url'` emits it.

`libraries` takes several sources separated by spaces, tried in order, each asked only for what
the ones before it lack. Nothing is on by default, since a bundle is a 10 MB request.

`hub` means `pack`. Up to player 0.5 it asked the H5P hub itself, but the only hub host that
answers a browser serves an outdated catalogue, so current exports could not get their libraries
there anyway.

A bundle is downloaded once, cached and shared by every package that uses it. If its source is
unreachable later, a bundle downloaded whole from the same URL before is used, so a stripped
export plays offline once it has played online.

A package that needs a library no source carries is still refused, with the missing libraries
named: usually a library newer than the pack, which the next pack release will carry.
