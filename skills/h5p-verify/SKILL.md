---
name: h5p-verify
description: Check that an H5P package (.h5p) actually plays before handing it over. Use after generating, editing or repackaging an H5P file, and before claiming any H5P package works. Plays it in a real H5P runtime in a headless browser and reports start-up, errors, missing libraries and a screenshot, then opens it in the user's own browser for them to play.
license: MIT
---

# Verify an H5P package

A zip that opens and JSON that parses prove nothing: most broken packages are valid zips that
fail in the H5P runtime, or start and draw the wrong thing. Do not report a package as working
until this passes and you have looked at the screenshot.

## Run it

    npx @missing-elements/h5p-verify@latest package.h5p

Needs Node 22+ and a Chromium-based browser. Chrome or Edge on the machine is used if present;
otherwise run `npx playwright install chromium` once (about 150 MB). Headless, no display. Keep
`@latest` in the command: without it, npm on an older Node quietly installs the last version that
supported it.

- `--untrusted` — play it the way a site plays a package it did not make: none of its own code
  runs, the libraries come only from the pack, and the content is checked against each library's
  `semantics.json`. Use it when the package goes to a site that accepts uploads or links from
  others, an LMS or an embed site among them; when unsure, run it both ways.
- `--libraries pack` — for a package without library folders (what h5p.com and h5p.org export),
  played against the library pack, the way a site with `libraries="pack"` supplies them. A library
  the package carries then plays at the pack's newer version, as on that site, and the summary
  says `refreshed from the pack: <library> <from> → <to>`; `--no-refresh-libraries` plays the
  package's own as exported. `--libraries <url>` for another bundle, `--libraries <path>` for one
  on disk or for a copy of the pack's `parts/` folder.
- `--out <dir>` — where `report.json` and `screenshot.png` go; default `<package>.verify/`.
- `--json` — the report as JSON instead of the summary.
- `--browser <path>` — a Chromium executable, for CI or a sandbox where none is found.
- `--ready <seconds>` — time allowed to reach `ready`, default 60; raise it for a large package
  on a slow link before reading a timeout as a failure.
- `--settle <seconds>` — time watched after `ready` for late errors, default 3.
- `-q` — the verdict line only.
- `--preview` — open the package in the user's browser for them to play, instead of checking it;
  see *Let the user play it*.

Exit 0: it plays (possibly with warnings). Exit 1: it does not; the summary says why.
Exit 2: the check could not run (no browser, no such file).

## Read the result

| It says | Usual cause | What to do |
|---|---|---|
| `bad-archive` … `Missing: <folders>` | no library folders, not the versions `content.json` names, or a version one of the package's own libraries asks for in its `library.json` and the package does not carry | add the library folders; or rerun with `--libraries pack` if the destination supplies libraries |
| `bad-archive` otherwise | no `h5p.json`, bad entry names, not a zip | fix the packaging |
| `runtime: …` with `state: error` | the runtime threw before the content came up: a script of a library it needed failed, or `content.json` breaks the content type at start | same fixes as the next row; the message names what threw |
| `N uncaught errors while booting: …` | a library script threw as it loaded: a dependency listed that is not a runtime library (`H5PEditor is not defined`), or `content.json` missing a field the content type reads at start | for a manifest problem, list only runtime libraries in `preloadedDependencies`; for a content problem, compare `content.json` with `<Library-x.y>/semantics.json` inside the package and fill in the fields it expects |
| `did not reach ready` | the runtime waited for something that never came | check `failedRequests` in the report, then the manifest |
| `drew nothing` | started, empty frame | usually empty or wrongly nested parameters |
| warning: `runtime error after ready` | often a harmless resize exception; sometimes a broken sub-content | check the screenshot; fix only if something is missing |
| warning: `request failed: content/…` | a media file `content.json` references is not in the archive | add it or fix the path |
| warning: `blocked by the frame's CSP` | content loading from an outside origin | put the asset in the package |
| warning: `content check: <field>: markup removed: …` (with `--untrusted`) | the field holds tags, attributes or styles its library does not allow; the site will strip them | write the field in what `semantics.json` allows for it (its `tags` and `font`), or accept the loss if the text still reads right |
| warning: `content check: <field>: removed`, `… became …` | a field the semantics do not name, or a value outside its options or range; or the libraries' upgrade moved it, when the pack is newer than what the content was written for | match the field to `semantics.json`, or build against the pack's versions |
| `bad-archive` with `fix: the package carries … itself, but played untrusted …` | built against a library newer than the pack | build against the pack's versions, or the site must play it trusted |
| `refreshed from the pack: <library> <from> → <to>` (with `--libraries pack` or a copy of it) | the package carries an older version of these libraries than the pack; a site with the pack plays the pack's, and so did the check | nothing to fix: the content was checked as that site will play it. Export against the current versions to ship them, or rerun with `--no-refresh-libraries` to see the package as exported |

## Look at the screenshot

Layout mistakes raise no error: sizes in the wrong unit, elements overlapping or off-canvas, an
empty slide. If it looks wrong, it is wrong. The screenshot shows the state after start-up; for
a multi-slide or multi-chapter package it shows the first one. The rest is for the user to see in
the preview, below.

## Loop

Fix one thing, rerun. Never make it pass by removing the part that fails, simplifying the
content, or switching content type; if you cannot make something work, say so.

## When it passes

Say what was checked: the package starts and renders in the H5P runtime. Do not imply more.
The tool does not check that the answers are right, the level fits, the text is any good, the
media are licensed, or the content is accessible; those are the user's to review. Played as it is,
it does not check library versions: a package built against newer library versions than the H5P
hub carries (h5p-cli builds from GitHub `master`) plays here and is refused by h5p.com and by the
offline app's library pack; if the destination is one of those, build against the hub's versions,
and `--untrusted` checks against the pack's. A pass is not a trust decision either: played as it
is, the package's scripts ran in a headless browser on this machine, with its network, and a
package that behaves at start-up can still read and send what other packages saved on a site that
plays it. Run the tool only on packages you would open yourself, or with `--untrusted`, which runs
none of the package's own scripts.

Give the user the `revision` with the file — it is the build identifier every xAPI statement
from this package will carry. Take it from `report.json` (or `--json`): the summary line shows
only its first characters, ending in `…`.

## Let the user play it

The check proves that the package starts, not that it is right. After it passes, open the package
for the user to play in the real player, in their own browser:

    npx @missing-elements/h5p-verify@latest package.h5p --preview

Pass the same `--untrusted` and `--libraries` as the check, so that they play what was checked. It
checks nothing and works for every content type; a large video starts at once. Start it in the
background: it serves the package from this machine and ends about ten seconds after its last tab
closes. Then tell the user what to try, such as a wrong answer and a right one for each question,
every branch of a scenario, or the interactions at a video's timestamps. Tell them too that the
Download button beside the file's name saves a copy of the package.

- `--no-open` prints the address instead of opening their default browser, for when you drive a
  browser yourself or none opens.
- The address is `127.0.0.1` on the machine that runs the command. If that is not the user's
  computer, as in a cloud sandbox, they cannot reach it: hand over the file and the command for
  them to run.
- Exit 2: the preview could not start, and the message says why.
