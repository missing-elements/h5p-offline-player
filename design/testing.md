# Tests and CI

How the repository is tested: the engines, CI's browsers, the owner's rule on what is tested, the fixtures, and the content-type sweep.

## Engines, CI and what is tested

The `browser` project runs in Chromium unless `H5P_TEST_BROWSER` names `firefox` or `webkit`, and
`pnpm test:engine` runs it alone, which is what CI does for those two (the `engines` job, one
engine per job; the `test` job covers Chromium). One engine per run, never a list: the dev
server's switches — a host's outage, the worker version it serves — are shared, and two engines
running one file at once flipped them under each other. `browser-emulated` stays on Chromium,
since CDP is Chromium's. Added on 2026-10-13, after Safari had only ever been checked by hand;
the first runs found the three engine differences under *A body that streams holds its fetch
event open*, *An untrusted package plays as data* (the worker's own script in its policy) and *A
downloaded archive is read back before it is reported done*. Playwright's WebKit is WebKit's
desktop port and not iOS Safari: the app's menu filled an iPhone's screen in Safari on 2026-10-13
and drew correctly in Playwright's WebKit at every phone size.

CI installs Chromium and Firefox without their system packages (#73, 2026-10-23): the runner image
ships both browsers, so the libraries they link against are there, and what `--with-deps` adds —
fonts, Xvfb, FFmpeg's codecs — a headless suite that decodes no video does not use. WebKit needs
its packages, GStreamer and GTK 4 among them, 117 MB from Ubuntu's mirror, and the `engines` job
keeps them in the Actions cache (#77): `/var/cache/apt/archives`, keyed by ISO week with any
earlier week as the fallback, and `apt-get autoclean` after the install so one version of each
package stays. Measured that morning: `azure.archive.ubuntu.com` served the package lists at
12 MB/s and the packages at 40 kB/s — 115 MB in 47 minutes, in three runs of three, against 30 to
60 seconds in the eight `main` runs before. The image's apt failover (actions/runner-images#14594)
fires on a stall, not on a trickle, which is actions/runner-images#14823, open; the cache restores
from GitHub's storage instead, 111 MB in 3 seconds, and the install then took 26 seconds. A cache
saved by a pull request's run is that pull request's: `main`'s first run after the merge fills the
one every later pull request reads.

**What is tested, by the owner's rule of 2026-10-17: the packages and their source, and of the
demo app only the installable app.** The demo's pages — the player page, the examples, `/embed`,
the cmi5 page, the code blocks, the shared markup — have no tests and are checked by hand, the
cmi5 page also against CATAPULT (`pnpm cmi5:catapult`). Where a page's test was the only one of a
package's behaviour, the test moved into the package: the embed page asking before it plays a
package that needs its own code, and `resizer.js` answering a frame that loaded before it, are in
`packages/embed/tests/site.test.ts`; the cmi5 page's were already in `packages/cmi5/tests/`.
The skills are source too, tested from `apps/skills`, a project of their own (2026-10-23, the
owner's choice): what they tell an agent to write builds and plays. For h5p-to-scorm (#159) that is
its commands, run as it writes them, and their zips, played as a learner under a stand-in LMS with
real content; that is how a presentation without questions, the example `--completion-score` gave,
was found never to finish (#160). h5p-author's own code is the author package's since #100, tested
with it. Its tests were first in the demo, which had the pack and zip.js installed, and in the
verifier's tests, and the playback test played the quiz through the installable app. It plays it in
the verifier's preview now, the page the skill hands a person to review it in, and in Chromium
only, where in the demo the `engines` job ran it in Firefox and WebKit too; the player's own suite
covers the engines.

The app's tests follow the same variable (`apps/demo/tests/engine.ts`; `tests/harness.ts`
starts the dev server and the second-origin package host and waits on the element for all of
them, since 2026-10-15), and `pnpm test:engine` runs them after the player's suite, so the
`engines` job covers the app too. Added on 2026-10-14, when they also covered the embed and
cmi5 pages; the first runs found one bug, under *The frame is navigated in place*, and four
differences: WebKit, as Safari does by default, passes over buttons on Tab and reaches them on
Option-Tab; WebKit's private profile — the one Playwright gives a page, and a Safari private
window — refuses a `File` in IndexedDB, so the app keeps no copy of a file there and asks for it
again, and the test of the copy runs in a profile on disk; Firefox's own Back passes over a step a
page wrote before anyone interacted with it, which is home when a link opens the app, so its Back
leaves the app where the bar's Back, from script, goes home — the test goes back from script, as
the bar does; and Firefox closes a top-level page Playwright opened when cmi5's Exit asks, which
Chromium does not. Three app tests are Chromium's alone: file handles, and the private profile
that keeps a reference to a file rather than its bytes.

## Testing

Unit tests cover the pure logic: name normalisation, range parsing, chunk arithmetic, strategy
selection, the CSP and the generated frame document in the player, the writer, remux and
policy in `packages/normalize`, and the content upgrade, the content check, the translations'
rules and the choice of language in `packages/runtime`, that package's only tests. They are fast and are where a rule belongs. Both test
tsconfigs have `allowJs`, so tests can import the `.mjs` scripts; those are typed through JSDoc
and not checked. The player's browser suite no longer has an `index.html` behind its dev server
— the pages moved to the demo — so a missing file is a `404` there, not the SPA fallback's page;
the "page instead of an archive" case is the generated `html-page.h5p` fixture.

Browser tests drive the real element in Chromium, and in CI in Firefox and WebKit too (see
*Commands*). They are the only place the interesting parts
exist at all — a worker serving a `206` assembled out of cache chunks has no meaningful behaviour
outside a browser. Two things to know when writing them:

- **The test page is not controlled by the worker.** Its scope is `/src/h5p/` and the test page is
  not under it, exactly as a host page is not. A `fetch` of a virtual URL from the test realm goes
  to the network and 404s. Use `frameFetch(player, url)` from `tests/browser/utils.ts`, which
  fetches through the frame — the client the worker actually controls.
- **State carries between tests.** Caches and the `packages` table survive; `play()` replaces the
  document body, which disconnects the previous element and terminates its Jobs worker mid-job. A
  test that needs a cold load must call `clearPackageCaches()`.

`segmented.h5p` is `large-deflated.h5p` with media that does not compress: 20 MB of zeros deflate
to 20 kB, which is never fetched in segments, so only this archive takes `segmentedStream` end to
end. The slow-link test in `tests/browser-emulated/` throttles the browser to 1 MB/s and expects
the first bytes of it inside eight seconds.

`/compressing/<fixture>` is the dev server standing in for GitHub Pages: `Range` honoured, CORS
open, and the archive gzipped — ranges included, cut from the gzipped copy — whenever the request
accepts gzip, which a browser's plain `GET` does and its ranged requests do not. In the suite it is
same-origin, so every header is readable and the probe never needs its size fallback there; the
browser test pins the two lengths the same archive answers with, and the unit test covers the
fallback against headers filtered the way CORS filters them.

`/counted/<fixture>?log=<id>` is a host that honours `Range` and writes down the `Range` header of
every request it takes; `/counted/__log?log=<id>` answers them in order. `range-requests.test.ts`
counts what a load costs with it, so the requests an index read takes cannot creep back up (#133):
the id makes each load a package of its own and keeps cases apart.

`/stalling/<fixture>?rate=<bytes per second>` is a host with an outage switch: `Range` honoured, the
body paced, and `/stalling/__outage?ms=<n>&mode=silent|reset` takes it away for a while — every
response in flight goes quiet and new requests wait, or every response in flight is destroyed and
new requests get a `503`. It is how the browser suite drives an extraction across a link that
drops, without CDP, so it runs in the ordinary `browser` project — where files run in parallel,
so each file names a host of its own with `&host=<name>` on the archive URL and on the switch.
Until 2026-10-10 the switch was one timer for the whole server, and `playback.test.ts`'s `ms=0`
cleanup ended `stalling-host.test.ts`'s 35-second outage early whenever the two overlapped.

`large-deflated.h5p` carries `content/media/unused.bin`, large and deflated and referenced by
nothing. It is the only way to tell a prefetch from a demand fetch: the fixture's own
`big.bin` is rendered as a video by the test library, so the runtime requests it either way.

Fixtures are generated (`scripts/build-fixtures.mjs`) rather than committed, because two of them
need entries no ordinary zip tool will write — a path traversal, and 20 MB of media to take the
slice and chunk paths. The script also writes `public/fixtures/pack/`, a library pack of three split by
the real `splitPack` — the fixture content type at 1.2 with its upgrade steps, which append each
version they pass to the message, its sub-content type at 1.1 and the extra library — and
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
library pack — 55 on 2026-10-14, the hub's 53 content types and two the pack carries as options of
others — as a content-only export against the pack, untrusted and trusted, and fails on one that
does not reach `ready` or throws while booting. Built on 2026-10-14, after the `finished` rule had
been measured on four content types: the hub serves no example content, and h5p.org's examples
carry licences of their own and old versions, so each package is made here. 110 plays take about
three minutes locally, five on CI.

- **Content is generated from the content type's own `semantics.json`** by the author package's
  generator, run lenient with the sweep's fill (`lib/sweep-content.mjs`; one copy since #100,
  checked byte for byte on all 55 types when it moved), as H5P's editor saves a form: every default, and for a required field
  without one the smallest value the content check accepts — a label as text, the first sample a
  pattern accepts, the minimum number, the first option, a list as long as its `min` or
  `defaultNum`, the sample image, video or audio. A group's own default is its whole value; a group
  of one field is saved as that field; an optional group nobody wrote holds its defaults only and
  booleans false, as the editor saves one left closed — Personality Quiz reads `image.file` from an
  optional group without looking, and the first cut, which filled such groups with samples, drew
  every answer as an image. A library field takes the first option the pack has that is not one of
  its own parents, filled the same way, or the content its default names (Interactive Video's
  summary task). The media are a grey PNG, a second of silence and the demo's Big Buck Bunny clip.
  `tests/sweep-content.test.ts` holds the rules.
- **`apps/demo/sweep/<machineName>.json` says what generation cannot know**, and only that:
  `params` is walked with the semantics, so every field it leaves out is filled in, sub-content it
  names gets its own library's defaults, a list is as long as written and `null` removes a field.
  Four content types need one to play at all — which drop zone an item belongs in, a crossword's
  words that cross, a branching scenario whose nodes reach its end, a game map's stage — and six
  containers and questions have one so that the report shows a real result. `attributes` are the
  element's (`reporting`, which gives Interactive Book its submit button). `pnpm sweep --semantics
  <machineName>` prints a content type's fields for writing one.
- **What a content type sends is reported, not judged.** After `ready` the generic walk answers
  what one click answers and presses check, submit, finish and next, each button at most three
  times, and the report lists the statements and `finished` each type sent. The first cut also
  had per-type steps (`click`, `drag`, `fill`, timed pauses — thirteen files on the libraries' own
  selectors) and failed a play whose last `finished` was not the one its file named; Game Map's
  seven-click finish passed four runs here and failed both modes on the first CI run, so that went
  the same day. The measurements it made once are under *`finished` is the content's result*.
- **It plays in Chrome where it can**: Playwright's Chromium cannot decode the H.264 clip. One
  browser context, so the pack is downloaded once; four plays at a time.
- **It runs in CI** (`.github/workflows/content-types.yml`) on a change to the player's source,
  the runtime, the pack or the sweep, and every Monday, with the report as the run's summary and the
  packages and screenshots as an artifact; and the pack's weekly refresh runs it against the new
  pack and puts the report in its pull request, which CI does not start on.

Not covered: any content a type can hold beyond the one generated or written, every engine but
Chromium, and whether a type's result is right, which the report shows and nothing checks.
