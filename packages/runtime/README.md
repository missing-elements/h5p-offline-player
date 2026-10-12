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
            assets-base="https://cdn.jsdelivr.net/npm/@missing-elements/h5p-runtime@0.2.0/dist/"></h5p-player>
```

Or copy `dist/` to `frame-assets/` next to `h5p-player.js`, where the element looks by default.

`dist/` holds `main.bundle.js` and `frame.bundle.js` (h5p-standalone's loader, the H5P core and
jQuery), `h5p.css`, `fonts/`, `frame-boot.js`, `l10n.js`, `MANIFEST.json`, `LICENSE.txt` and
`NOTICE.txt`. Use a runtime version within the range the player names as its optional peer
dependency.

## Checking content

For a package the element plays `untrusted`, the boot script checks the content against the
`semantics.json` of the libraries served before the runtime reads it, as the H5P platforms check
an author's content: every field held to its type, text stripped to the tags the field allows and
plain text escaped, numbers to their range, sub-content to the libraries a field names, anything
the semantics do not name removed. It is a port of h5p-php-library's `H5PContentValidator`, and
on the same content it gives the same result. Content whose main library has no `semantics.json`
does not play. The player serves such a package's `content.json` only to a boot script that
checks it, so `untrusted` needs this package at 0.2 or later.

## Languages

`l10n.js` has the core's own strings — "Fullscreen", "Rights of use", the licence names, the
"this content has changed" dialog — in more than fifty languages, taken from Moodle's language
packs, where Moodle's translators keep them. The frame loads it when the element's `lang`, which
the element inherits from the page like any other, is not English, and picks the language from
it: `<html lang="de">` shows them in German, `de-AT` gets `de` and `nb` gets Norwegian. A string a
language lacks stays English, and so does a language with none. The file is about 50 kB
compressed, fetched once; a page in English never asks for it. `runtime.l10nJs` names it for a
bundler.

`pnpm l10n` in this package takes the strings from Moodle again, and a weekly workflow does the
same and opens a pull request when a translation changed. A language added or corrected is a
release of this package alone: the player knows no list of languages.
