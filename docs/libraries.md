# Libraries: packages without them, and older than the pack

Exports from h5p.com and h5p.org often contain only `content/`, without the libraries. The
player refuses such a package and names what is missing. `libraries` tells it where to look:

```html
<h5p-player src="stripped.h5p" libraries="pack"></h5p-player>
```

## The pack

`pack` is [`@missing-elements/h5p-libraries`](https://www.npmjs.com/package/@missing-elements/h5p-libraries):
the H5P hub's runtime libraries for every content type it serves, each at the newest minor of its
major, as one archive per library, 13.8 MB in all. The player downloads only the archives a
package needs — for the demo's packages, 0.04 to 4 MB — and checks each against the SHA-256 the
pack's index gives. An archive is kept on the device and shared by every package that uses it;
once kept, it is used with no request, online or offline.

Each player release names one version of the pack, carries its index, and fetches its archives
from jsDelivr. The pack is rebuilt from the hub weekly and released with the player.

## Newer versions of the libraries a package carries

With `libraries="pack"`, a library a package carries plays at the pack's version when the pack
has the same major at a higher version, minor first, then patch. An H5P site does both by its
own means: it keeps one patch of each minor, the newest it has seen, and moves content to a newer
minor with H5P's content upgrade, which an administrator starts. An old export then plays with
the fixes and the look of current H5P.

- Equal or older in the pack, or only another major there: the package's own, and nothing is
  downloaded.
- A library the pack does not have keeps the package's own copy, and runs against the pack's
  newer versions of the libraries it shares: H5P's rule is that a minor does not break what
  depends on it.

Content written for an older minor is upgraded before it starts: the player runs the steps each
library ships in its `upgrades.js` on the content's parameters, as the H5P plugins do: a Question
Set written for 1.20 keeps its background image under 1.21, which reads it from a new place. If a
step fails, the content plays as written and the console says so.

`refresh-libraries="off"` plays the libraries a package carries as exported, and the pack only
supplies what is missing: for content that has to show exactly what its author tested.
`libraryBundle.refreshed` and the `ready` event's detail list what played at the pack's version.

A refreshed package is another build: its `revision` names the archives of the pack it played
with ([Which build a learner completed](revision.md)), and a learner's state saved against the
build before starts over, once, with H5P's own "content has changed" dialog. A pack release that
changes none of a package's libraries changes nothing for it.

## On your own hosting

The pack is found in one of three places:

- `libraries="pack"` alone: jsDelivr, at the version the release pins.
- `pack-base`, the folder of a copy of the package's `parts/` on your site. Its `index.json` is
  read from there, and kept, so a package can be planned for with no network:

  ```html
  <h5p-player src="stripped.h5p" libraries="pack" pack-base="/h5p-libraries/"></h5p-player>
  ```

- With a bundler, the `pack` property, which the bundler fills with each archive as an asset of
  your site:

  ```js
  import { pack } from '@missing-elements/h5p-libraries'

  player.pack = pack
  player.setAttribute('libraries', 'pack')
  ```

Serve `libraries.txt` beside it: the list of each library's licence and authors, which those
licences ask to travel with the code. The package also carries the whole pack as one file,
`libraries.h5p`, which a `.h5p` URL in `libraries` takes like any bundle, downloaded whole, with
no refresh.

## Several sources

`libraries` takes several sources separated by spaces, tried in order, each asked only for what
the ones before it lack. The pack refreshes wherever it is in the list, and supplies what is
missing once the sources before it have been tried. A `.h5p` URL only supplies what is missing.
Nothing is on by default: a package is played as it is unless `libraries` names a source.

`hub` means `pack`. Up to player 0.5 it asked the H5P hub itself, but the only hub host that
answers a browser serves an outdated catalogue, so current exports could not get their libraries
there anyway.

## When a source cannot be reached

The pack's archives kept before are used with no request, and a `pack-base` index is kept as last
read. A refresh that cannot be had — an archive that will not download, or does not match its
hash — is given up, and the package plays with its own libraries, as exported. A `.h5p` bundle
downloaded whole from the same URL before is used when that URL cannot be reached, so a stripped
export plays offline once it has played online.

## Packages that are still refused

A package that needs a library no source carries is still refused, with the missing libraries
named: usually a library newer than the pack, which the next pack release will carry. The check
follows each library's own dependencies too, as the runtime does, so an old export whose
libraries ask for a version it does not carry gets that version from the sources as well.

## Addons

The pack also carries `H5P.MathDisplay`, the addon the H5P plugins add to content whose text holds
LaTeX — `\(…\)`, `\[…\]` or `$$…$$` — once an administrator has installed it. The player does the
same when the pack supplies or refreshes anything, the pack standing in for a site's installed
libraries, and with a `.h5p` bundle attached: it adds any addon there to the content its
`library.json` names, so a content-only export shows its formulas. MathDisplay renders them with
MathJax from its own folder, so they work offline. A package from a site that had it lists it
among its dependencies, and played `untrusted` it needs the source to have it.

## Untrusted

With `untrusted`, a package's own library folders are ignored and its libraries come only from
`libraries`, `pack` when that is not set: the archives it needs, nothing it carries. A package
that needs a library the sources lack is refused, and when it carries that library itself, the
error's `missingLibraries.carried` is `true`: playing it without `untrusted` would run its own
copy, which is your decision to make. The content is then checked against the `semantics.json` of
the libraries the sources serve; the pack has them. [Packages you did not make](untrusted.md) has
the rest.
