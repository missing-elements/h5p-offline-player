---
name: h5p-verify
description: Check that an H5P package (.h5p) actually plays before handing it over. Use after generating, editing or repackaging an H5P file, and before claiming any H5P package works. Plays it in a real H5P runtime in a headless browser and reports start-up, errors, missing libraries and a screenshot.
license: MIT
---

# Verify an H5P package

A zip that opens and JSON that parses prove nothing: most broken packages are valid zips that
fail in the H5P runtime, or start and draw the wrong thing. Do not report a package as working
until this passes and you have looked at the screenshot.

## Run it

    npx @missing-elements/h5p-verify package.h5p

Needs Node 20+ and a Chromium-based browser. Chrome or Edge on the machine is used if present;
otherwise run `npx playwright install chromium` once (about 150 MB). Headless, no display.

- `--libraries pack` — for a package without library folders (what h5p.com and h5p.org export),
  played against the library pack, the way a site with `libraries="pack"` supplies them.
  `--libraries <url>` for another bundle.
- `--out <dir>` — where `report.json` and `screenshot.png` go; default `<package>.verify/`.
- `--json` — the report as JSON instead of the summary.
- `--browser <path>` — a Chromium executable, for CI or a sandbox where none is found.
- `--ready <seconds>` — time allowed to reach `ready`, default 60; raise it for a large package
  on a slow link before reading a timeout as a failure.
- `--settle <seconds>` — time watched after `ready` for late errors, default 3.
- `-q` — the verdict line only.

Exit 0: it plays (possibly with warnings). Exit 1: it does not; the summary says why.
Exit 2: the check could not run (no browser, no such file).

## Read the result

| It says | Usual cause | What to do |
|---|---|---|
| `bad-archive` … `Missing: <folders>` | no library folders, or not the versions `content.json` names | add the library folders; or rerun with `--libraries pack` if the destination supplies libraries |
| `bad-archive` otherwise | no `h5p.json`, bad entry names, not a zip | fix the packaging |
| `runtime: …` with `state: error` | the runtime threw before the content came up: a script of a library it needed failed, or `content.json` breaks the content type at start | same fixes as the next row; the message names what threw |
| `N uncaught errors while booting: …` | a library script threw as it loaded: a dependency listed that is not a runtime library (`H5PEditor is not defined`), or `content.json` missing a field the content type reads at start | for a manifest problem, list only runtime libraries in `preloadedDependencies`; for a content problem, compare `content.json` with `<Library-x.y>/semantics.json` inside the package and fill in the fields it expects |
| `did not reach ready` | the runtime waited for something that never came | check `failedRequests` in the report, then the manifest |
| `drew nothing` | started, empty frame | usually empty or wrongly nested parameters |
| warning: `runtime error after ready` | often a harmless resize exception; sometimes a broken sub-content | check the screenshot; fix only if something is missing |
| warning: `request failed: content/…` | a media file `content.json` references is not in the archive | add it or fix the path |
| warning: `blocked by the frame's CSP` | content loading from an outside origin | put the asset in the package |

## Look at the screenshot

Layout mistakes raise no error: sizes in the wrong unit, elements overlapping or off-canvas, an
empty slide. If it looks wrong, it is wrong. The screenshot shows the state after start-up; for
a multi-slide or multi-chapter package it shows the first one.

## Loop

Fix one thing, rerun. Never make it pass by removing the part that fails, simplifying the
content, or switching content type; if you cannot make something work, say so.

## When it passes

Say what was checked: the package starts and renders in the H5P runtime. Do not imply more.
The tool does not check that the answers are right, the level fits, the text is any good, the
media are licensed, or the content is accessible; those are the user's to review. It also does
not check library versions: a package built against newer library versions than the H5P hub
carries (h5p-cli builds from GitHub `master`) plays here and is refused by h5p.com and by the
offline app's library pack; if the destination is one of those, build against the hub's versions.
A pass is not a trust decision either: the package's scripts ran in a headless browser on this
machine, with its network, and a package that behaves at start-up can still read and send what
other packages saved on a site that plays it. Run the tool only on packages you would open
yourself.

Give the user the `revision` from the report with the file — it is the build identifier every
xAPI statement from this package will carry.
