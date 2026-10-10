# @missing-elements/h5p-normalize

Rewrites an `.h5p` package once, where it is published, so that it streams well through
[h5p-offline-player](https://github.com/missing-elements/h5p-offline-player). Only the zip
container changes: media is stored rather than deflated, an mp4 with its index at the end is
remuxed (not re-encoded) to put it first, content media goes last, and stored scripts, styles and
JSON are deflated. Everything else is copied byte for byte.

## Usage

Needs Node 20 or later.

```bash
npx @missing-elements/h5p-normalize course.h5p               # writes course.normalized.h5p
npx @missing-elements/h5p-normalize course.h5p --dry-run     # report only
npx @missing-elements/h5p-normalize https://host.example/course.h5p -o course.h5p
```

Installed (`npm install --save-dev @missing-elements/h5p-normalize`), the command is
`h5p-normalize`.

| Option | |
|---|---|
| `-o, --output <file>` | default `<name>.normalized.h5p` beside the input, or in the current directory for a URL |
| `-n, --dry-run` | inspect and report, write nothing |
| `-q, --quiet` | only the summary |
| `-h, --help` | |

An entry whose bytes do not match their CRC stops the run with its name; an encrypted entry is
refused. `unzip -t` is an independent check of the output.

The summary's `revision` line is what the player puts in `context.revision` on every xAPI
statement for the written file (for a dry run, the input). Record it at release.
`archiveFingerprint(path)` returns the same from code.

## From code

```js
import { normalizeArchive, formatBytes } from '@missing-elements/h5p-normalize'

const report = await normalizeArchive({
  input: 'course.h5p',
  output: 'course.normalized.h5p', // omit for a dry run
  onEntry: (result) => console.log(result.name, result.action)
})
```

Node only, not a browser. Why deflated video cannot stream: the demo's
[normalize page](https://github.com/missing-elements/h5p-offline-player/blob/main/apps/demo/demo/normalize.html).

## Licence

MIT. Its one dependency, [zip.js](https://github.com/gildas-lormeau/zip.js), is BSD-3-Clause and
is installed alongside it, not bundled.
