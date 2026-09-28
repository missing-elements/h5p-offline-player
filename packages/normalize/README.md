# @missing-elements/h5p-normalize

Rewrites an `.h5p` package once so that it streams well through
[h5p-offline-player](https://github.com/missing-elements/h5p-offline-player). The content is not
changed; only the zip container is:

- media (video, audio, images, fonts, PDF) is stored rather than deflated, so a `Range` request
  can reach any byte of it directly;
- an mp4 whose index (`moov`) sits at the end is remuxed so the index comes first — a remux, not
  a re-encode;
- entries are ordered `h5p.json`, library folders, content, with content media last, so a host
  that ignores `Range` still boots the player before the media has arrived;
- scripts, styles and JSON an exporter left stored are deflated; everything else is copied byte
  for byte.

Run it once, where the package is published — not in the learner's browser.

## Usage

Needs Node 20 or later.

```bash
npx @missing-elements/h5p-normalize course.h5p               # writes course.normalized.h5p
npx @missing-elements/h5p-normalize course.h5p --dry-run     # report only, write nothing
npx @missing-elements/h5p-normalize https://host.example/course.h5p -o course.h5p
```

Or install it, and the command is `h5p-normalize`:

```bash
npm install --save-dev @missing-elements/h5p-normalize
npx h5p-normalize course.h5p
```

| Option | |
|---|---|
| `-o, --output <file>` | where to write; default `<name>.normalized.h5p` beside the input, or in the current directory for a URL |
| `-n, --dry-run` | inspect and report, write nothing |
| `-q, --quiet` | only the summary |
| `-h, --help` | |

The output is checked as it is written: an entry whose bytes do not match their CRC stops the
run with its name, and an encrypted entry is refused rather than copied without its key data.
`unzip -t course.normalized.h5p` is an independent check.

## From code

```js
import { normalizeArchive, formatBytes } from '@missing-elements/h5p-normalize'

const report = await normalizeArchive({
  input: 'course.h5p',
  output: 'course.normalized.h5p', // omit for a dry run
  onEntry: (result) => console.log(result.name, result.action)
})
```

`normalizeArchive` reads and writes files on disk; it runs on Node, not in a browser.

## Why

A deflated video cannot be read from the middle: every byte before the one a player seeks to has
to be downloaded and inflated first. If the mp4 also keeps its index at the end, nothing plays
until the last byte has arrived. The demo site's
[normalize page](https://github.com/missing-elements/h5p-offline-player/blob/main/apps/demo/demo/normalize.html)
explains it with a diagram, and the repository's
[`AGENTS.md`](https://github.com/missing-elements/h5p-offline-player/blob/main/AGENTS.md#the-normalizer)
records what the tool does and does not change.

## Licence

MIT. Its one dependency, [zip.js](https://github.com/gildas-lormeau/zip.js), is BSD-3-Clause and
is installed alongside it, not bundled.
