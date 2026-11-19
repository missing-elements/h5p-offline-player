# Tests and CI

How the repository is tested: the engines, CI's browsers, the owner's rule on what is tested, the fixtures, and the content-type sweep.

## Engines, CI and what is tested

**CI tests what a change reaches, in Chromium.** A pull request or a push to main tests the
packages it changes and those that depend on them, as pnpm's `...[<commit>]` filter reads the
change. A change under `skills/` adds the author package and `apps/skills`. Any other file outside
the packages (the lockfile, a workflow, the root's `package.json`) tests every package, unless it
is one of the docs below. The player, the verifier, the skills and the embed package take most of
the time, so each tests in a job of its own, side by side, and the rest in one more. Every package
that has a `typecheck` script runs it whatever the change, since each package's check writes the
types the next one reads. A change to `design/`, `docs/`, a root `.md` or `LICENSE` alone starts
no run. The `scope` job in `ci.yml` decides.

**The costly checks run weekly and by hand.** These are Firefox and WebKit, the player's browser
files that wait out real time, the content-type sweep, and the VS Code extension in a real editor,
which also runs when `packages/vscode` changes. The slow files are `stalling-host`,
`worker-update` and `large-media`, named in the player's `vite.config.ts` and dropped under
`H5P_TEST_SKIP_SLOW`. A bug that shows only there reaches main and is found on Monday, so before
publishing the player, run CI by hand on main (`gh workflow run ci.yml`) and publish once it is
green.

The `browser` project runs in Chromium unless `H5P_TEST_BROWSER` names `firefox` or `webkit`.
`pnpm test:engine` runs it, then the app's tests, which is what the `engines` job does in those two.
One engine per run, never a list: the dev server's switches (a host's outage, the worker version it
serves) are shared, and two engines running one file at once flipped them under each other.
`browser-emulated` stays on Chromium, since CDP is Chromium's. Playwright's WebKit is WebKit's
desktop port, not iOS Safari.

CI installs Chromium and Firefox without their system packages. The runner image has what they
link against, and `--with-deps` adds fonts, Xvfb and codecs that a headless suite does not use,
from a mirror some runners reach at 40 kB/s. WebKit needs its 117 MB of packages, which the
`engines` job keeps in the Actions cache, keyed by ISO week, running `apt-get autoclean` after the
install. A pull request's cache is its own; main's runs, the weekly one among them, fill the one
pull requests read.

**What is tested, by the owner's rule of 2026-10-17: the packages and their source, and of the
demo app only the installable app.** The demo's pages (the player page, the examples, `/embed`,
the cmi5 page, the code blocks, the shared markup) have no tests and are checked by hand, the
cmi5 page also against CATAPULT (`pnpm cmi5:catapult`). Where a page's test was the only one of a
package's behaviour, the test lives in the package: the embed page asking before it plays a
package that needs its own code, and `resizer.js` answering a frame that loaded before it, are in
`packages/embed/tests/site.test.ts`; the cmi5 page's are in `packages/cmi5/tests/`.
The skills are source too, tested from `apps/skills`, a project of their own: what they tell an
agent to write builds and plays. For h5p-to-scorm that is its commands, run as it writes them, and
their zips, played as a learner under a stand-in LMS with real content. h5p-author's own code is
the author package's, tested with it. The playback test plays the quiz in the verifier's preview,
the page the skill hands a person to review it in, in Chromium only; the player's own suite covers
the engines. Each skill's front matter is held to what a YAML parser reads, and its name and
description to the Agent Skills limits (`front-matter.test.ts`): one that does not parse is a
skill skills.sh and a chat's upload do not list.

The app's tests follow the same variable (`apps/demo/tests/engine.ts`; `tests/harness.ts`
starts the dev server and the second-origin package host and waits on the element for all of
them), and `pnpm test:engine` runs them after the player's suite, so the `engines` job covers the
app too. Four differences between engines are built into them: WebKit, as Safari does by default,
passes over buttons on Tab and reaches them on Option-Tab; WebKit's private profile (the one
Playwright gives a page, and a Safari private window) refuses a `File` in IndexedDB, so the app
keeps no copy of a file there and asks for it again, and the test of the copy runs in a profile on
disk; Firefox's own Back passes over a step a page wrote before anyone interacted with it, which is
home when a link opens the app, so the test goes back from script, as the bar does; and Firefox
closes a top-level page Playwright opened when cmi5's Exit asks, which Chromium does not. Three app
tests are Chromium's alone: file handles, and the private profile that keeps a reference to a file
rather than its bytes.

## Testing

Unit tests cover the pure logic: name normalisation, range parsing, chunk arithmetic, strategy
selection, the CSP and the generated frame document in the player, the writer, remux and
policy in `packages/normalize`, and the content upgrade, the content check, the translations'
rules and the choice of language in `packages/runtime`, that package's only tests. They are fast
and are where a rule belongs. Both test tsconfigs have `allowJs`, so tests can import the `.mjs`
scripts; those are typed through JSDoc and not checked. The player's browser suite has no
`index.html` behind its dev server (the pages live in the demo), so a missing file is a `404`
there, not the SPA fallback's page; the "page instead of an archive" case is the generated
`html-page.h5p` fixture.

Browser tests drive the real element in Chromium, and in CI in Firefox and WebKit too (see
*Commands*). They are the only place the interesting parts
exist at all: a worker serving a `206` assembled out of cache chunks has no meaningful behaviour
outside a browser. Two things to know when writing them:

- **The test page is not controlled by the worker.** Its scope is `/src/h5p/` and the test page is
  not under it, exactly as a host page is not. A `fetch` of a virtual URL from the test realm goes
  to the network and 404s. Use `frameFetch(player, url)` from `tests/browser/utils.ts`, which
  fetches through the frame, the client the worker actually controls.
- **State carries between tests.** Caches and the `packages` table survive; `play()` replaces the
  document body, which disconnects the previous element and terminates its Jobs worker mid-job. A
  test that needs a cold load must call `clearPackageCaches()`.

`segmented.h5p` is `large-deflated.h5p` with media that does not compress: 20 MB of zeros deflate
to 20 kB, which is never fetched in segments, so only this archive takes `segmentedStream` end to
end. The slow-link test in `tests/browser-emulated/` throttles the browser to 1 MB/s and expects
the first bytes of it inside eight seconds.

`/compressing/<fixture>` is the dev server standing in for GitHub Pages: `Range` honoured, CORS
open, and the archive gzipped (ranges included, cut from the gzipped copy) whenever the request
accepts gzip, which a browser's plain `GET` does and its ranged requests do not. In the suite it is
same-origin, so every header is readable and the probe never needs its size fallback there; the
browser test pins the two lengths the same archive answers with, and the unit test covers the
fallback against headers filtered the way CORS filters them.

`/counted/<fixture>?log=<id>` is a host that honours `Range` and writes down the `Range` header of
every request it takes; `/counted/__log?log=<id>` answers them in order. `range-requests.test.ts`
counts what a load costs with it, so the requests an index read takes cannot creep back up: the id
makes each load a package of its own and keeps cases apart.

`/stalling/<fixture>?rate=<bytes per second>` is a host with an outage switch: `Range` honoured, the
body paced, and `/stalling/__outage?ms=<n>&mode=silent|reset` takes it away for a while: every
response in flight goes quiet and new requests wait, or every response in flight is destroyed and
new requests get a `503`. It is how the browser suite drives an extraction across a link that
drops, without CDP, so it runs in the ordinary `browser` project, where files run in parallel, so
each file names a host of its own with `&host=<name>` on the archive URL and on the switch (the
switch is per host, not one timer for the server).

`large-deflated.h5p` carries `content/media/unused.bin`, large and deflated and referenced by
nothing. It is the only way to tell a prefetch from a demand fetch: the fixture's own
`big.bin` is rendered as a video by the test library, so the runtime requests it either way.

Fixtures are generated (`scripts/build-fixtures.mjs`) rather than committed, because two of them
need entries no ordinary zip tool will write: a path traversal, and 20 MB of media to take the
slice and chunk paths. The script also writes `public/fixtures/pack/`, a library pack of three split
by the real `splitPack` (the fixture content type at 1.2 with its upgrade steps, which append each
version they pass to the message, its sub-content type at 1.1 and the extra library) and
`pack-tampered/`, the same with one hash wrong in its index; `tests/browser/pack.test.ts` plays
against them through `pack-base`. jsDelivr's copy, the element's default, is never reached from
the suite. The script clears only the archives it owns, so a real `.h5p` dropped into
`public/fixtures/` to try against the demo survives `pnpm dev`.

For a manual check against a real, fully bundled package (eight libraries, a genuine H5P content
type), the h5p-standalone repo ships one:

```bash
curl -sL -o packages/player/public/fixtures/real.h5p \
  https://raw.githubusercontent.com/tunapanda/h5p-standalone/master/test/h5p-test.h5p
```

## The content-type sweep

`pnpm sweep` (`apps/demo/scripts/sweep-content-types.mjs`) plays every runnable library in the
library pack (the hub's 53 content types and two the pack carries as options of others) as a
content-only export against the pack, untrusted and trusted, and fails on one that does not reach
`ready` or throws while booting. The hub serves no example content, and h5p.org's examples carry
licences of their own and old versions, so each package is made here. 110 plays take about three
minutes locally, five on CI.

- **Content is generated from the content type's own `semantics.json`** by the author package's
  generator, run lenient with the sweep's fill (`lib/sweep-content.mjs`), as H5P's editor saves a
  form: every default, and for a required field without one the smallest value the content check
  accepts: a label as text, the first sample a pattern accepts, the minimum number, the first
  option, a list as long as its `min` or `defaultNum`, the sample image, video or audio. A group's
  own default is its whole value; a group of one field is saved as that field; an optional group
  nobody wrote holds its defaults only and booleans false, as the editor saves one left closed
  (Personality Quiz reads `image.file` from an optional group without looking). A library field
  takes the first option the pack has that is not one of its own parents, filled the same way, or
  the content its default names (Interactive Video's summary task). The media are a grey PNG, a
  second of silence and the demo's Big Buck Bunny clip. `tests/sweep-content.test.ts` holds the
  rules.
- **`apps/demo/sweep/<machineName>.json` says what generation cannot know**, and only that:
  `params` is walked with the semantics, so every field it leaves out is filled in, sub-content it
  names gets its own library's defaults, a list is as long as written and `null` removes a field.
  Some content types need one to play at all (which drop zone an item belongs in, a crossword's
  words that cross, a branching scenario whose nodes reach its end, a game map's stage), and some
  containers and questions have one so that the report shows a real result. `attributes` are the
  element's (`reporting`, which gives Interactive Book its submit button). `pnpm sweep --semantics
  <machineName>` prints a content type's fields for writing one.
- **What a content type sends is reported, not judged.** After `ready` the generic walk answers
  what one click answers and presses check, submit, finish and next, each button at most three
  times, and the report lists the statements and `finished` each type sent. There are no per-type
  steps and no failure on a type's last `finished`. What was measured of it is under
  *`finished` is the content's result*.
- **It plays in Chrome where it can**: Playwright's Chromium cannot decode the H.264 clip. One
  browser context, so the pack is downloaded once; four plays at a time.
- **It runs in CI** (`.github/workflows/content-types.yml`) every Monday and by hand, with the
  report as the run's summary and the packages and screenshots as an artifact; and the pack's
  weekly refresh runs it against the new pack and puts the report in its pull request, which CI
  does not start on.

Not covered: any content a type can hold beyond the one generated or written, every engine but
Chromium, and whether a type's result is right, which the report shows and nothing checks.
