# @missing-elements/h5p-verify

Plays an `.h5p` package in a headless browser through
[h5p-offline-player](https://github.com/missing-elements/h5p-offline-player) and reports whether
it works. The last check before a package — generated, edited, repackaged — is handed to anyone.

A zip that opens and JSON that parses prove nothing: most broken packages are valid zips that
fail in the H5P runtime, or start and draw the wrong thing. This runs the real runtime, with no
server and no account, in a few seconds.

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

Exit code 0 means it plays (there may be warnings), 1 that it does not, 2 that the check could
not run. `report.json` and `screenshot.png` land in `<package>.verify/` beside the package.

## What it checks

| | |
|---|---|
| The archive | indexed by the player: `h5p.json`, entry names, the libraries it declares against the folders it carries |
| Libraries | missing ones are named; `--libraries hub` or `--libraries <url>` supplies them the way a host would |
| Boot | the runtime reaches `ready`, and how long that took |
| Errors | an uncaught error while booting fails the check even when the content comes up around it; one after `ready` is a warning, since content types throw non-fatal exceptions routinely |
| Rendering | the content drew something: the frame's root has a height and elements |
| Requests | anything the frame asked for and did not get, such as a media file `content.json` names that is not in the archive |
| CSP | an outside origin the frame's policy blocked |
| Provenance | the `revision` every xAPI statement from this build will carry |

What it does not check: whether the content is correct, suited to its learners, accessible, or
properly licensed. Look at the screenshot; a package can start cleanly and still be laid out
wrong.

## Options

| | |
|---|---|
| `--libraries hub\|<url>` | for a package exported without library folders, what h5p.com and h5p.org do by default |
| `--out <dir>` | where the report and screenshot go |
| `--browser <path>` | a Chromium-based browser; otherwise Chrome, then Edge, then Playwright's own Chromium |
| `--ready <s>` | time allowed to reach `ready`, default 60 |
| `--settle <s>` | time watched after `ready` for late errors, default 3 |
| `--json` | the report as JSON on stdout |
| `-q` | the verdict line only |

Needs Node 20 or later and a Chromium-based browser. Chrome or Edge on the machine is used
if there is one; otherwise `npx playwright install chromium` fetches one (about 150 MB, once).
Headless, so no display is needed.

## From code

```js
import { verifyPackage, summarize } from '@missing-elements/h5p-verify'

const report = await verifyPackage({ file: 'course.h5p', out: 'report/' })
console.log(summarize(report))
if (report.verdict !== 'pass') process.exit(1)
```

## For agents

The repository ships an [agent skill](https://agentskills.io), `skills/h5p-verify`, telling an AI
agent that generates H5P content when to run this and how to read what comes back:

```bash
npx skills add missing-elements/h5p-offline-player --skill h5p-verify
```

or copy the folder into your agent's skills directory.

## Licence

MIT. It runs the player, whose H5P runtime is GPL-3.0; see the player's
[NOTICE.md](https://github.com/missing-elements/h5p-offline-player/blob/main/packages/player/NOTICE.md).
