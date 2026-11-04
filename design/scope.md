# Scope

What differs from the original architecture document, and what is not built yet. The document and the setup guide were removed on 2026-10-10, the first superseded by `AGENTS.md`, now with `design/`, and the second folded into the README and `docs/`; both are in git history (`git show 4d7bcdc:h5p-offline-player-architecture.md`).

## Where this differs from the original design

The architecture document, removed on 2026-10-10 and in git history, predates the code. These are
deliberate additions to it, not drift:

- A `resize` event, and the element follows the content's height by default. H5P content sizes
  itself, and without these every host page has to reimplement the same listener. Following was
  opt-in as `auto-resize` until 2026-09-30, when every snippet in the repository was found to
  set it; now `auto-resize="off"` is the opt-out, for a host that sizes the element itself, and
  a bare `auto-resize` is still accepted and means the default.
- A `statechange` event, so a host can mirror `state` without polling.
- A `runtime` error after `ready` does not move the state to `error`. The design's state machine
  has one `error` state; a content type that throws once after booting is not that.
- A chunked entry requested with no `Range` header is answered `200` with its true length and a
  body that follows the extraction. Chrome's first request for a media resource carries no
  `Range`, and the design's original `503` there kept a cold video from ever starting. The `503`
  with `Retry-After: 1` survives only for an entry whose extraction has produced no bytes at all
  within the stall window.
- A host that ignores `Range` no longer means "download everything, then index". The archive is
  still downloaded whole — the design's `chunked` adapter — but it is indexed from its local
  headers as it arrives, and the frame boots as soon as the runtime's libraries are present.
- Eviction is lock-aware across tabs, not only "never the package currently being served". The
  design's rule protected the package doing the writing; a Web Lock under `h5p:<pkgId>:` — held
  by a writing job or a playing element anywhere on the origin — now protects any package in use.
- Generated types live in `types/`, not `dist/index.d.ts`.
- A normalizer script. The design leaves the package's layout to whoever built it; the script
  is how they get the layout the player streams best.
- A verifier command. The design has the player play packages; the command has it judge them,
  headless, for whoever produces packages by machine.
- A VS Code extension. The design has the player on websites; the extension plays a package in
  the editor, from a server on the author's own computer.
- A SCORM package. The design emits results and stores none; `h5p-embed --scorm` puts one package
  in an LMS, which records its score, result, time and the learner's place; since #122 a page on
  the written site, and on the demo, builds the same zip in the browser.
- The libraries are warmed into the cache before the frame boots on a `Range` host. The design
  reads every entry on demand; on a high-latency host that made the boot a matter of minutes.
- A library source that cannot be reached falls back to a bundle downloaded whole from the same
  URL before. The design has no notion of playing without the network beyond a picked file.
- Statements carry `context.revision` and `context.platform`. The design emits xAPI untouched;
  a compliance audit needs to know which build each completion came from.
- An installable app, on the demo site at `/app/`: the design's "offline management" is still out
  of scope, but the player itself now starts with no network, through the single-worker setup.
- Save and resume, behind a `resume` attribute. The design lists it as out of scope for v1 and
  the element as storing nothing; with the attribute the content's own state is kept on the
  device, or handed to the host, and nothing else changes.
- The runtime is a package of its own. The design has one package with the frame assets inside
  it; the GPL on the H5P core made that `(MIT AND GPL-3.0-only)`, and from 0.5 the runtime and
  the frame's boot script are `@missing-elements/h5p-runtime` so the player can be MIT alone.
- The runtime is the H5P core vendored from h5p-php-library at a commit, and the worker says what
  the frame loads. The design runs h5p-standalone in the frame, with its copy of the core and its
  loader; #37 replaced both, keeping its load order.
- A published library bundle, and `libraries` as an ordered list. The design has `hub` or one
  URL; the hub's move put a bundle the project controls first, and since 0.6 the hub is not asked
  at all (`hub` meant the pack until it went before 1.0). Since 0.10 the pack is split, a package downloads only
  the parts it needs, and the pack's newer versions play in place of the older ones a package
  carries: the design plays what a package carries.
- Content written for a newer minor than any source has plays at the newest older one, once every
  source has been tried. The design refuses what is not reachable.
- Content written for an older minor than the one served is upgraded in the frame with the
  libraries' own steps. The design serves what a package carries; a bundle that serves newer
  minors needs the step the platforms take when they install one.
- The core's own strings follow the content's language, the one its `h5p.json` names, and the
  element's for a package that names none, from translations the runtime carries. The design's
  frame is English throughout.
- A package can be played `untrusted`, with library code only from the host's bundle and its
  content checked against the libraries' semantics, as the CMS plugins check it. The design runs
  whatever a package carries.

## Not built yet

Deliberately out of scope for v1, per the original architecture document: the editor, offline management
(save, library, delete), results storage, persistent file handles. xAPI is emitted as events and
stored nowhere. Save-and-resume was on that list and is built; see below.

**Demand-paced extraction.** Considered on 2026-09-25 against a real package and deferred; the
design is recorded here so it does not have to be rediscovered. Since then extractions run one at
a time in demand order (see *Extractions run one at a time, and the order is the policy*, in [storage.md](storage.md)), which takes care of the *contention*
between videos; what follows is about the bytes a single job pulls that nobody watches. Today the first request for a
deflated entry starts a job that inflates the whole file, because a deflate stream cannot be
restarted in the middle. Measured: an 80 MB deflated mp4 (ratio 0.937, faststart; H5P.Video creates
its `<video>` with `preload="metadata"`, so the header is asked for the moment the content renders)
pulled 26 MB from GitHub Pages in the first 15 s with the video paused, and the whole 81 MB from a
local host, whether or not play was pressed. Interactive Video's icon fonts and SVGs, which the
browser requests only once their CSS applies, then queued behind four 4 MB segments: 1.3–1.8 s
each against 52 ms on the idle link. That is the "UI still loading while the video already plays"
a user sees. Two things were tried and ruled out: priority hints on the segment fetches change
nothing on that host (240–306 ms per small read under load, hint or no hint), and smaller segments
only slow the video — the contest is for bandwidth, and only pulling fewer bytes wins it. Random
access into the stream is not an option either: a checkpoint index would need a bit-level
inflater and could only cover the part already inflated, which the chunk store serves anyway.

A deflate stream cannot be restarted, but it can be paused: the inflater's state is a few tens of
kilobytes in the Jobs worker, and `segmentedStream` already stops opening requests when its output
is not consumed. The design:

- The Service Worker's streaming path announces consumption on the watermark channel, the way it
  announces liveness today: entry, and the position read up to.
- The chunk writer gates its writes at the highest announced position plus a read-ahead of one or
  two segments, and waits for the next notice.
- Prefetch (`preload`) announces unbounded demand; running ahead is its point.
- A forward seek announces its position, and the job runs at full speed until it gets there.

It buys a few megabytes at boot instead of the whole file, nothing on the network while paused,
and icon contention of a couple of seconds on a slow link instead of the whole load. It does not
change what deflate costs: a seek past the watermark still waits for the transfer of everything in
between, and the cache then holds what was watched rather than the whole file, so replaying an
unwatched part is a network cost again. The delicate part is `waitForWatermark`: a job paused for
lack of demand must not read as a dead one, so either the pause is visible on the channel or the
stall clock starts only once demand has been announced. Roughly 150 lines across the chunk
writer, the channel, `mount.ts` and the Jobs worker, plus tests. Deferred because the package-side
fix exists — `pnpm normalize` stores the video, after which the media element drives every byte
and the same boot pulled 1.4 MB instead of 81 — and because it is not yet known how often the
player is handed a deflated video nobody can normalize: the h5p.com export analysed above stored
everything, while this one and the sodix.de one deflated everything.

**Content checked against `semantics.json` — built** on 2026-10-13, after the content upgrade
rather than before it as first planned here; see the invariant *An untrusted package plays as
data*. Not done: upstream's `extraAttributes`, which it keeps unchecked and so does the port.
Addons were on this list, and are built; see *Addons are added as the platforms add them*.

**Offline app shell (PWA) — built**, as `/app/` on the demo site, library pack included; see
*The hosted demo*. The list of recent files it left open is built too (2026-10-12), with file
handles where installed from Chrome or Edge and a kept copy elsewhere.
Installing works in Safari and on iOS, and the iOS app plays offline (2026-10-11).

**Version proof on xAPI statements — built**; see the invariant *Every statement names the build
it came from*. Open: an element property is all a host has for its own records today; whether the
`finished` event should also carry the revision at top level, for hosts that do not read
statements, has not been asked for.

**Accessibility statement — started.** `ACCESSIBILITY.md` is the statement: whose part is
whose, what the player does, what a host should do, and a keyboard-only run on 2026-09-29 over
seven content types in Chromium — no focus trap anywhere, every task doable by keys. The run
found one thing on the player's side, the fixed frame title, and the element now names the
frame after `h5p.json`'s title (the `indexed` reply's `title`; "H5P content" before a load and
for a package without one; `playback.test.ts` pins both paths, including the early boot on a
host without `Range`). Two lessons from writing that run, for the next one: read focus along
the real path — page, the element's shadow root, the iframe, its document — since a frame
document's `activeElement` is its `<body>` when it does not have focus, and matching that
body's text "found" every control on the first Tab; and a focus indicator can be a border or
a background, so an outline-and-box-shadow check is only a hint. Repeated on 2026-10-02 in Playwright's Firefox and WebKit: the same
results, no trap; WebKit needs Option+Tab, as Safari does by default, and Firefox adds a stop
for the frame's document and for a `<video>`. Still open: a real screen reader (NVDA, JAWS,
VoiceOver), Safari itself and iOS, zoom and contrast.

The original note, raised in the same comment: Section 508 conformance is judged on
the whole package, the player and the H5P content types together, and a content type that traps
keyboard focus is a non-starter for compliance audiences. The player's own surface is small —
the element renders one iframe and no controls — so the work is a keyboard-only and
screen-reader pass and a page stating what the player handles and what depends on the content
type. What remains on the player's side: an `error` reaches assistive technology only if the
host page renders it, so the demo pages put the message into a live region that is on the page
from the start — a region that appears together with its text is announced by some screen
readers and not by others — and `ACCESSIBILITY.md` tells a host to do the same. The
content-type side is H5P's own per-type accessibility list, linked rather than restated.

**Save and resume — built** on 2026-09-30, behind `resume`; the invariant *The saved state never
leaves the page* has the shape and the reasons it differs from the design first recorded here.
Raised on 2026-09-28 comparing the player with Lumi, whose server stores learner state so a
learner comes back where they left off. What the build changed in what the documentation may
claim, and the reason the wording was gone over: "nothing is stored" is true of the element as
shipped and false the moment a host sets `resume` — then the content's own state, which for a
quiz includes the answers given, sits in the browser's storage for that origin, on that device,
and the demo's app sets it, with a Start over button. Statements are not stored in either case,
and nothing is sent. Still open: `setFinished` (h5p-standalone's `setFinishedUrl`), which xAPI's
`completed` already carries; sub-content that saves under a data type other than `state`, which
the store keeps by data type without reading. Round-tripped in the built app on 2026-09-30
with a Question Set (answer given, intro skipped on return), the h5p-cli Course Presentation
(second slide) and the demo's Interactive Video (position 9.3 s): each came back where it was,
Start over put each back to the beginning and left the store empty. Core's own timers, unload
handler and reset dialog are pinned by `resume.test.ts` through the fixture content type.
