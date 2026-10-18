# Third-party notices

`@missing-elements/h5p-runtime` is published under **GPL-3.0-only**, and everything in it is
either GPL-3.0 or under a licence the GPL accepts. It exists so that
[`@missing-elements/h5p-offline-player`](https://www.npmjs.com/package/@missing-elements/h5p-offline-player),
which is MIT, carries none of this: the player's element and workers exchange only HTTP and
`postMessage` with what is in this package.

## The H5P runtime in `dist/` — GPL-3.0

`dist/` holds the runtime the player loads inside its frame: the H5P core from
[h5p/h5p-php-library](https://github.com/h5p/h5p-php-library), licensed under the **GNU General
Public License v3.0**, at the commit `vendor/h5p-core/SOURCE.json` in this package's source names
(`cb64a1f3884408487c3178e31fc140f5d45ca165` of 2026-08-11 as of this writing; `dist/NOTICE.txt`
and `dist/MANIFEST.json` name the one a build took). `frame.bundle.js` is the core's scripts —
`jquery.js`, `h5p.js`, `h5p-event-dispatcher.js`, `h5p-x-api-event.js`, `h5p-x-api.js`,
`h5p-content-type.js`, `h5p-confirmation-dialog.js`, `h5p-action-bar.js`, `request-queue.js`,
`h5p-tooltip.js`, the list and the order upstream's `H5PCore::$scripts` gives — joined into one
file under a licence comment and minified. `h5p.css` is the core's stylesheets, the eight
`H5PCore::$styles` names, joined and rebuilt so that it stands alone: its icon fonts and image
inlined as data URLs, its Inter and Open Sans faces moved to `fonts/` and listed in
`MANIFEST.json` for the player's frame document to declare. `vendor/h5p-core/` in the
[repository](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/runtime)
holds the files as upstream has them, and `scripts/sync-core.mjs` takes them from upstream.

Until 2026-10-18 the core came by way of [h5p-standalone](https://github.com/tunapanda/h5p-standalone),
whose copy of it records no upstream revision
([tunapanda/h5p-standalone#188](https://github.com/tunapanda/h5p-standalone/issues/188)); none of
h5p-standalone's own code is in this package any more.

The full licence text is in [LICENSE](LICENSE) and, so that it travels with the files, in
`dist/LICENSE.txt`; `dist/NOTICE.txt` lists the files and names the h5p-php-library commit they
were built from, which is the corresponding source together with this package's build. Keep both
beside the directory when you copy or serve it.

Also inside `dist/`:

- jQuery 3.5.1, in `frame.bundle.js`, where the core keeps it in `js/jquery.js` — MIT, Copyright
  JS Foundation and other contributors, <https://jquery.org/license>.
- Inter, `fonts/inter-*.woff2` — SIL Open Font License 1.1, see `fonts/Inter-LICENSE.txt`.
- Open Sans, `fonts/open-sans-*.woff2` — SIL Open Font License 1.1, see `fonts/OpenSans-OFL.txt`.

## The boot script — GPL-3.0

`dist/frame-boot.js` is built from `src/frame-boot.ts` in this package, Copyright (c) 2026
missing-elements, and released under the GPL-3.0 like the runtime it boots. It is the one piece
of the player's own code that runs inside the H5P document and calls the core's API — `H5P.init`,
`newRunnable`, the user-data functions — so it belongs with the core rather than with the
element, which talks to it over `postMessage` only. It includes `src/content-upgrade.ts`, which
runs the libraries' own upgrade steps on content written for an older minor, by the rules of
`js/h5p-content-upgrade-process.js` in h5p-php-library (GPL-3.0); it was written for this package
rather than copied from that file. And it carries the core's English interface strings, the
player's part of `getLocalization()` in `h5p.classes.php` at the same commit as the core, which
`scripts/sync-core.mjs` takes into `vendor/h5p-core/strings.json`: the settings it builds start
from them, and a language's strings from `l10n.js` are laid over them.

It also includes `src/content-check.ts`, which checks the content of a package played `untrusted`
against its libraries' semantics. That one is a port: of `H5PContentValidator` in `h5p.classes.php`
from [h5p/h5p-php-library](https://github.com/h5p/h5p-php-library) at commit
`cb64a1f3884408487c3178e31fc140f5d45ca165`, **GPL-3.0**, and of the HTML filter that class copied
from Drupal 7's `includes/common.inc` (`filter_xss` and its helpers, based on kses by Ulf
Harnhammar), Copyright Drupal contributors, **GPL-2.0-or-later**, which the GPL-3.0 accepts. Where
it departs from the original, the file's leading comment says how and why.

## The translations in `dist/l10n.js` — GPL-3.0-or-later

`dist/l10n.js` holds the core's interface strings in every language this package has, built from
`l10n/` in this package's source, which `scripts/build-l10n.mjs` writes from
[Moodle's language packs](https://download.moodle.org/langpack/): Moodle translates the same
strings for its own H5P support, and `core_h5p\framework::t()` in Moodle says which of its
strings is which. Copyright Moodle and its translators, under the **GNU General Public License
v3.0 or later**, which this package's GPL-3.0 accepts. `l10n/index.json` in the
[repository](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/runtime/l10n)
names the pack each
language came from, the date they were taken and the strings left in English, where a pack
had none or one that broke a placeholder. The file opens with a comment naming its source.

## What this means for a site

A site that serves `dist/` to browsers is distributing GPL-3.0 code, with what that entails for
keeping the notices and making the source available; the notices above and the files beside the
directory are what it needs. With a bundler the files are emitted under hashed names and the
text files do not travel; `frame.bundle.js`, `h5p.css`, `frame-boot.js` and
`l10n.js` therefore open with a `/*! … */` comment naming their licences and the
corresponding source, which bundlers leave in an emitted asset.

Whether the copyleft reaches the page around the player is a legal question this file does not
answer. The arrangement is this: the player is a separate program, under its own MIT licence,
which fetches these files over HTTP and exchanges messages with the document they run in; it
does not link against them, call their functions or share their memory.
