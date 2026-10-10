# @missing-elements/h5p-verify

Plays an `.h5p` package in a headless browser through
[h5p-offline-player](https://github.com/missing-elements/h5p-offline-player) and reports whether
it works.

```bash
npx @missing-elements/h5p-verify course.h5p
```

```
pass  course.h5p  ready in 0.37 s  revision sha256:872ee6f732e6a4b7…
  screenshot: course.verify/screenshot.png
```

```
fail  course.h5p  state error
  bad-archive: This package contains no libraries, only content. … Missing: H5P.QuestionSet-1.20
  fix: add the library folders (H5P.QuestionSet-1.20), or --libraries hub if the destination site supplies libraries
```

Exit code 0: it plays (possibly with warnings); 1: it does not; 2: the check could not run.
`report.json` and `screenshot.png` land in `<package>.verify/`.

It checks that the archive indexes and carries the libraries it declares, that the runtime
reaches `ready`, that nothing throws while booting (an error after `ready` is a warning), that the
content drew something, and it lists failed requests, CSP blocks and the build's `revision`. It
does not judge correctness, suitability, accessibility or licensing: look at the screenshot.

## Options

| | |
|---|---|
| `--libraries hub\|<url>` | supply libraries for a package exported without them |
| `--out <dir>` | where the report and screenshot go |
| `--browser <path>` | a Chromium-based browser; otherwise Chrome, then Edge, then Playwright's Chromium |
| `--ready <s>` | time allowed to reach `ready`, default 60 |
| `--settle <s>` | time watched after `ready` for late errors, default 3 |
| `--json` | the report as JSON on stdout |
| `-q`, `--quiet` | the verdict line only |
| `-h`, `--help` | |

Needs Node 20 or later and a Chromium-based browser; without Chrome or Edge, run
`npx playwright install chromium`.

## From code

```js
import { verifyPackage, summarize } from '@missing-elements/h5p-verify'

const report = await verifyPackage({ file: 'course.h5p', out: 'report/' })
console.log(summarize(report))
if (report.verdict !== 'pass') process.exit(1)
```

An [agent skill](https://agentskills.io) for it ships in the repository:
`npx skills add missing-elements/h5p-offline-player --skill h5p-verify`.

## Licence

MIT. It runs the player, whose H5P runtime is GPL-3.0; see the player's
[NOTICE.md](https://github.com/missing-elements/h5p-offline-player/blob/main/packages/player/NOTICE.md).
