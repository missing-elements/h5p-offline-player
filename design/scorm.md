# The SCORM package

`npx @missing-elements/h5p-embed --scorm course.h5p` writes `course.scorm.zip`, SCORM 1.2 unless
`--scorm-version 2004` asks for 2004 4th Edition. It holds the package as `package.h5p`, the
player's three files, the runtime as `frame-assets/`, `embed.css` and the launch page with its
bridge, for a package that does not carry its libraries the library pack's parts it needs in
`libraries/`, and `imsmanifest.xml` lists every file. It is for teachers who hand students links
and want results; the LMS keeps the results and nothing of ours runs a server. The embed README's
*Supported LMSs* table sums up the per-LMS bullets below, one row each; an LMS added here gets a
row there.

- **The worker registers under the package's own path in the LMS.** Moodle serves a package from
  `pluginfile.php/<context>/mod_scorm/content/<revision>/`, on its own origin, so the element's
  default `h5p-sw.js` beside it registers with that folder as its scope, which no other page of the
  LMS is in. Each new revision of the activity is a new scope; the old worker stays registered,
  which is harmless.
- **Trusted, and the pack's parts for what the package does not carry.** SCORM content runs on the
  LMS's origin by design, so the package's own code runs, as any SCORM package's does. An export
  without its libraries, from h5p.com or h5p.org, gets the parts of the pack it needs, in the zip.
  The writer runs the player's own planner as the launch page has the element run it, filling gaps
  only: `planPack` from the player's `./plan` with `refresh` off and nothing provided, over
  `ownLibraries`, `dependenciesIn` and `librariesNamedIn` from the same module. Embed pins the
  player exactly, as h5p-author does, and `scripts/check-published.mjs` refuses to publish until the
  pinned version is on npm with `./plan`. The writer puts the parts into `libraries/`, with an
  `index.json` that lists only them, and the page names the folder with `libraries="pack"`,
  `pack-base` and `refresh-libraries="off"`. The element then plans the same parts and finds each in
  the zip, and plays a package's own libraries as exported. Because the index lists only what the
  zip carries, a plan that came out different could only fall short: a gap the element refuses by
  name, or an addon left out, never a request for a part the zip lacks. What neither the package
  nor the pack supplies is refused when the zip is written, by the walk the player makes
  (`walkDependencies` over `reachableFolder`, the same functions `PackageReader.checkDependencies`
  runs), run over the package without the folders a part replaces and over the parts. The walk
  starts from the sub-content the parameters name as well, and finds at index only where a source
  has the library's major. So a gap shows up when the teacher writes the zip, not when a learner
  opens it.
- **What the bridge reports.** On a first launch, `LMSInitialize` and `lesson_status`
  `incomplete`. On each `finished`:
  - the score out of 100, as `score.raw` with `min` 0 and `max` 100, from `scaled`, else from
    `raw` over `max`;
  - `passed` or `failed` by the content's `success`, else `completed`;
  - the session time, then `LMSCommit`.

  The last `finished` counts, as `setFinished` does on an H5P site. On `beforeunload` it sets the
  session time and `cmi.core.exit` (`suspend` unless finished) and commits; on `pagehide` it sets
  both again and calls `LMSFinish`.
  **Each answer goes into `cmi.interactions`**: every `answered` statement the element relays, by
  the part's `subContentId`, with an id a person reads, since 1.2 has no description field and the
  id is what a report shows. The id is the question's number (its index from 1) and its first
  words, as text (markup out, character references read), 40 characters cut at a word, or at the
  40th where the first word runs longer, in letters, digits and `_` alone, as in
  `Q3_which_rivers_cross_germany`; the number alone where the words have no Latin letters. 1.2
  calls a `CMIIdentifier` alphanumeric, and an LMS that holds it to that refuses a colon or a slash,
  so no fallback is a URL. The number keeps two questions with the same words apart; in content
  answered out of order, a Course Presentation or a book, it follows the order of answering, as the
  index does. Then the xAPI type as 1.2 names it (`long-fill-in` as `fill-in`, `other` and an
  unknown type left out), and the pattern and the response cut to 255 (`CMIFeedback`) **only where
  they are the learner's own text or number, `fill-in` and `numeric`**: 1.2 holds a choice,
  true-false, matching or sequencing answer to single characters, which H5P's `0[,]2` and `true`,
  written in 2004's notation, are not. A strict LMS refuses them and LMSs read 1.2's form
  differently, so those answers carry their result alone: a conformance fix, as
  `docs/compatibility.md` names one. The two that keep theirs are written as a person reads them
  (`scorm12Answer`): the right answer without the `{case_matters=…}`, `{lang=…}` it opens with, a
  fill-in's blanks listed with commas in place of `[,]`, so `stored, Range`; and a numeric only
  where it is a number, 1.2's `CMIDecimal`, not 2004's range `1[:]5`. 2004 keeps the notation, its
  own. Then `correct` or `wrong` from `success`, or from the score where the content says nothing,
  as Fill in the Blanks does not (full marks, none, or the marks themselves, a number 1.2 takes
  there), `neutral` with neither, the marks as `weighting`, `result.duration` as `latency`, the
  time of day. **One index per question, written over on a retry**: Moodle's interactions report
  has one column per index for every learner (`get_scorm_question_count` takes the highest index
  found), so an entry per attempt would set one learner's columns against another's. Written over
  in 1.2, a response or a right answer the new answer has none of is emptied, not left, since 1.2
  keeps a field nothing writes again. The index and the id come from the questions kept with the
  state (`questions` in `suspend_data`, a `[key, id]` per index, so that a question keeps its id in
  a later session, and one an older zip kept keeps the id that zip gave it), after
  `cmi.interactions._count`, which 1.2 lets a SCO read and Moodle reloads from the attempt's
  tracks; an attempt the LMS started over counts none, and they start again. The count is read
  once, at launch: read on every answer, an LMS whose count does not follow what is written in the
  session would have every new question written over the one before. The state is written and
  committed with each answer as well as with each of the content's saves, since content that keeps
  no state of its own sends no `userdata`, and its questions would otherwise take a new index in
  every session; where the state cannot be written, the answer is still committed. The fields are
  write-only; the reports read them. The commit is ILIAS's (under *ILIAS plays it too*), and only a
  commit: the content's last save comes after it, and the learner may stay. Moodle's API sends with
  `navigator.sendBeacon` while unloading. Content with no result of its own stays `incomplete`.
  Moodle takes `score.raw` as the grade, against the activity's maximum grade (`grademax` is its
  `maxgrade` in `scorm_grade_item_update`), so the README says to leave that at 100, Moodle's
  default.
- **Resume through `cmi.suspend_data`.** The element plays with `resume="host"`. Every `userdata`
  event rewrites `{ build, entries, questions }` into `suspend_data`, compressed with lz-string's
  `compressToBase64` (ASCII, as 1.2's `CMIString4096` asks, and synchronous, so the content's last
  save on `beforeunload` still lands, where the browser's `CompressionStream` is asynchronous and
  could lose it), and commits. A state that begins with `{`, written plain by a zip up to embed 1.4,
  is read as it is, so a learner's place survives the upgrade. A launch hands `userData` back before
  `src` when the stamp matches. The stamp is the first 16 hex digits of the package's SHA-256, or,
  with parts of the pack, of one over the package's and theirs, written into the page's
  `<meta name="h5p-package-build">`. So a teacher who replaces the zip with another package does not
  hand learners state saved against the old one, and a zip written with other parts starts them
  over, as a refreshed package does in the player. SCORM 1.2 keeps 4,096 characters; a larger state
  is not written, and the last one that fitted stays. The page says so once, under the content
  (`#saving`), and in the console, as it does when the LMS refuses the write, which the bridge
  checks `LMSSetValue`'s answer for. `#saving` and the launch page's error, `#notice`, each sit in a
  live region that is on the page from the start, empty (`role="status"`, `role="alert"`), as
  `ACCESSIBILITY.md` asks of a host, since a region that appears with its text is not announced by
  every screen reader. Moodle takes 64,000 when its administrator turns "SCORM 1.2 standard mode"
  off (`scormstandard` in `public/mod/scorm/datamodels/scorm_12.php`). Typical states are far under
  the limit (an Interactive Book up to about 1,000 characters compressed); a state under about 150
  characters comes out longer compressed, base64 costing a third. Interactive Book takes its saved
  place (`urlFragments`, with `h5pbookid`) back only when that id is the content id (*The saved
  state never leaves the page*), so a book reopens on its last chapter. Interactive Book 1.3 keeps
  no state at all.
- **Outside an LMS** the page finds no API, plays the package and reports nothing.
- **Frappe LMS plays it too, and records less.** Frappe unpacks the zip under
  `/scorm/<course>/<chapter>/` on its own origin and frames the launch page without a sandbox, so
  the worker registers with that folder's `h5p/` as its scope, beside Frappe's own worker. Its file
  server answers a range with the whole file and a `200`, so the element reads the package as
  `chunked`, downloaded whole. Its API keeps less than Moodle's (`SCORMChapter.vue`): the lesson is
  completed on SCORM 1.2's `lesson_status` `passed` alone, so `failed` and `completed` leave it
  "Partially Complete"; the score is never sent, since `saveProgress` carries only completion and
  `suspend_data`; and `suspend_data` is kept and handed back, so resume works.
- **ILIAS plays it too, once Learning Progress is on.** A module opens in a new tab, with the
  launch page as the `sahs_content` frame of ILIAS's player, served from
  `/data/default/lm_data/lm_<obj>/`, where the worker registers; ILIAS keeps a worker of its own at
  `/`, so the element's `_ping` probe logs a 404 there, harmless. **Nothing but `suspend_data` is
  recorded until Learning Progress is on**: a fresh ILIAS has it off (Administration → Learning
  Progress), and a module's own mode has to be "Collection of SCORM Items" (6) with its SCO
  selected; otherwise the player runs the SCO in `no-credit` mode and `SCORM1_2standard.js:590`
  drops every score and status write without a word. A result with no `success` is recorded
  `completed`, which ILIAS counts as done, where Frappe does not.
  **A session the learner ends by closing the tab keeps its time only through the commit on
  `beforeunload`**. ILIAS's API (`basisAPI.js`, `useSendBeacon`) sends with a beacon only in
  Chrome, by user agent, and only while the content frame's current event is `unload`,
  `beforeunload` or `click`; on `pagehide` it opens a synchronous request, which Chrome refuses
  while a page is being dismissed, and since `IliasCommit` empties its queue before sending, what
  it held is gone. A bridge that finished on `pagehide` alone left no `session_time`, `total_time`
  or `exit`. ILIAS takes `total_time` as the time at launch plus the latest `session_time`
  (`c_storeSessionTime` `s`, its default), so a second commit counts nothing twice; nor does Moodle
  or SCORM Cloud. Moodle's `request.js` switches to the beacon on its own page's `beforeunload`,
  `unload` and `pagehide`, and sends with it again when the synchronous request throws. Why only a
  commit: with nested same-origin documents `beforeunload` fires top-down, a message the innermost
  frame posts from its handler reaches its parent before any `pagehide`, and `pagehide` then fires
  top-down too. The core saves the content's state for the last time on its frame's
  `beforeunload`, which comes after the launch page's, so a session finished on `beforeunload`
  would refuse that save in every LMS; and a learner asked whether to leave may stay, with the
  session open. The listener is added only once the LMS has accepted the session, so a page played
  outside an LMS has none.
- **OpenOLAT plays it too; two of its defaults need changing.** In the default display ("Show only
  module") the element runs in an iframe holding a second OpenOLAT page, which carries the API
  (scorm-again 1.5.x with `asyncCommit`; OpenOLAT's copy raises `CMIString4096` to 1 MB, and the
  bridge still stops at 4,096); the launch page is served from `/m/<mapper>/index.html`, the worker
  registers under `/m/<mapper>/h5p/`, and the package is read `range-http`. OpenOLAT, Java too,
  unpacks a zip whose stored entries carry data descriptors, so not every Java LMS refuses them.
  Two defaults change what a teacher sees. **Grading** transfers the score with "Score needed to
  pass" 0, so a failed quiz showed as passed, score 0; with 50 it showed as failed, and a pass as
  passed; "Transfer passed value" took `failed` as not passed and kept no score. **The learning
  path** marks an element done on "Confirmation by participant", and a mandatory element in the
  default sequential order locks the ones after it; with "Passed" as the criterion, a passed
  element was fully assessed.
- **Chamilo 3.0 plays it too.** The Learning paths tool's Import takes the zips (PHP). An imported
  learning path starts as a draft (`resource_link` visibility 0), which a teacher publishes.
  Students open a path in the new runtime, `/resources/lp/171/<lp>/runtime`, which frames the
  launch page from `/learning-path/scorm/<course>/<session>/<group>/<lp>/<item>/index.html`, where
  the worker registers, and saves through `/api/learning_paths/<lp>/runtime/scorm/commit` and
  `/sync`. The file route answers no `Range`, so the package is read `chunked`; Chamilo keeps a
  worker of its own at `/`, so the `_ping` probe logs a 404, harmless. Closing the tab mid-quiz
  keeps the time and the place, and `core_exit` `suspend` only through the commit on
  `beforeunload`. The old address, `main/lp/lp_controller.php?action=view`, answers 500 to a
  student in 3.0.1 and on `master` (`LpAdvancedAccessHelper` is constructed with one argument where
  the constructor takes two); the course's list links to the runtime, so no learner reaches it.
  Chamilo 1.11, still maintained, is not tested.
- **A stored entry carries its sizes in its local header** (#92). zip.js writing into a stream puts
  a data descriptor, general purpose bit 3, on every entry, and a Java `ZipInputStream` refuses a
  stored entry that has one, since nothing says where its data ends. SCORM Cloud failed such zips
  with "IO Error processing zip", the fingerprint of that reader, while Moodle (PHP) and Frappe
  (Python) read the central directory and never noticed. The package, the fonts and the pack's
  parts are stored, so each goes in passed through with `compressionMethod: 0`, its size and its
  CRC (`fileCrc32`, a second read of the file, by the normalizer's `crc32` from its `./crc32`:
  zlib's from Node 22.2 and a table before, since the floor is 22 and a named import of a missing
  builtin export fails the whole module at link time), which zip.js writes as a complete local
  header and still streams: writing a 433 MB package peaks at 170 to 230 MB resident, nowhere near
  the package held whole. zip.js computes nothing for a passed-through entry, so the test holds the
  header's CRC to one computed over the data. Deflated entries keep their descriptors, which Java
  reads. SCORM Cloud opens the content in its pop-up from
  `cloud.scorm.com/content/courses/<app>/<course>/<version>/`, where the worker registers, and
  reads the package by ranges.
- **The same zip is built in a page, with nothing uploaded.** The people who need a SCORM package,
  designers and teachers with Canvas, Moodle or Blackboard, do not run `npx`, and no converter ran
  in the browser. So `scorm.mjs` is split as h5p-author's build is. `scorm-core.mjs` reads the
  package, plans the parts, lays out the entries and writes them, and imports no Node; `scorm.mjs`
  is the Node side, the files from the installed packages and the zip to a path;
  `scorm-browser.mjs`, `./scorm/browser`, is the page's, `buildScormInPage()`: the package a
  `File`, the player's files, the runtime and the pack fetched from the site the page is on (`base`,
  `pack` or `packBase`, or `assets` for a page that bundles the launch page, the bridge, the
  compressor, the stylesheet and the licence list; a page that gives the launch page and not the
  compressor gets the one at `base` or a zip without it, whose page names none and whose bridge
  writes the state plain, rather than an export that fails for a file it never had to serve), each
  part checked against the index's SHA-256 since it came over the network, and the zip a `Blob`, in
  two steps: `planScormInPage` reads and plans, and the plan's `write` fetches and writes (below).
  The runtime's files are named by a list, `RUNTIME_FILES`, plus the fonts from its
  `MANIFEST.json`, since a folder on a server cannot be listed; `scorm-browser.test.ts` runs the
  builder in Node, which has `fetch`, `File` and `crypto.subtle`, against a written site and holds
  its zip to the command's entry for entry, so a file the runtime adds shows up there.
  `site/scorm-page.js` is the page's script, `startScormPage()`, which reads `#file`, `#status`,
  `#download` and `#notice`, a `#state` badge where the page has one, and `#files` and `#build`
  where it works in steps (below); the written site loads it as `scripts/build.mjs` bundles it with
  zip.js and the player's `./plan` (`dist/scorm-page.js`, zip.js's licence in its header, since the
  site has no bundler), from `scorm.html`, with the launch page and the bridge copied beside it as
  `scorm-launch.html`, `scorm.js` and `lz-string.js` and the player's and the pack's versions in
  `config.js`. The demo reuses the source at `/demo/scorm.html` in the site's own design: the
  pack's parts as Vite emits them, the four files as `?raw` strings, the player's version from a
  `define`, and the player's built files from the site root, which a dev middleware serves from the
  player's `dist/` (`playerDistPlugin`). The page's builder imports the player's `./plan`, which is
  its built `dist/h5p-plan.js`, so the demo's build makes that file first, as `pnpm dev` does, and
  CI builds the demo straight after the install, as Vercel does. The demo aliases nothing to the
  player's source: the plan would then share modules with the element, and the build would split
  them into a chunk `h5p-player.js` imports, a file the page's zip carries alone. Scope: SCORM 1.2
  by default, H5P's result rule kept, the tested LMSs the supported ones. Canvas, the audience's
  LMS, runs its SCORM on Rustici's SCORM Cloud by all accounts and cannot be tested here, since
  Canvas Free-for-Teacher has no SCORM upload.
- **The page works in steps, and the title is the teacher's.** A page shows what a zip will hold
  before anything is written, from the plan the build then uses: `planScormInPage` reads the
  package and plans its parts, and returns the facts, the main library with the version its
  `preloadedDependencies` give it (`mainLibraryOf`), the title, the size, the parts and their size
  from the pack's index, with `write`, which fetches the files and writes the zip, as often as
  asked, hashing the package for the build stamp on the first write only, since the package and its
  parts are the same for every write; `buildScormInPage` is the two at once, and a `title` given to
  the plan is the plan's and its writes' default. A refusal comes at planning, by name, before
  anything but the pack's index is fetched. **The title** is `title` on both builders and `--title`
  on the command, cleaned by `scormTitle` as `h5p.json`'s is, an empty one leaving the package's; it
  goes into the manifest's organisation and item, which the LMS lists, and the launch page's
  `<title>`, and not into the build stamp, so a zip written again under another title keeps
  learners' places, nor into the package, which goes in as exported. **The page** works in steps
  where it holds `#files`, a list, and `#build`, a button, as both pages here do: ① choose, ②
  review, ③ download, each step the closest `[data-step]` around them, shown once it can be
  reached. A file chosen or dropped gets a row (the same file twice, by name, size and date, is
  one), during a build too, since a drop lands anywhere on the page: it is read at once and waits
  for the next Build. Its facts sit in a live region (`role="status"`) from the moment the row
  appears, so that what the reading found is announced. Every row is drawn again on any change, a
  key typed in a title among them, so the page writes a region's text, and `#status`'s, only when it
  changes: written again as it was, a region may be read out again. `#build` writes the rows one
  after another, a failure shown in its row while the others go on; `#download` is then the zip,
  or, for several, one zip holding them all, each stored as it is with its sizes and CRC in its
  local header (`addStored`), while each row links its own; a title changed after a build takes that
  zip back. A page with only the four elements of before builds the first file at once and shows a
  refusal in `#notice`, since `startScormPage` and its page are covered by docs/compatibility.md and
  a host's own page has to keep working. Not taken from the University of Tennessee's converter: a
  contents list, a SCORM Cloud link, an export of the settings, switches for playing offline and
  for resume, since every zip here carries all it plays and always resumes, and an accessibility
  check, which would need knowledge of each content type.
- **SCORM 2004, a pass mark and completion as 100, each an option.** Options, page-wide on the page
  and a flag each on the command (`--scorm-version 2004`, `--pass-mark`, `--completion-score`),
  the defaults unchanged, and each offered for the LMSs it was checked in. A zip written with none
  has the manifest, launch page and notice of a zip written before the options existed; only the
  bridge is new code, which plays a page that names no option as it did. The bridge learns the
  options from the launch page: a `<meta>` after the build's for each one set
  (`h5p-scorm-version`, `h5p-scorm-pass-mark`, `h5p-scorm-completion-score`), none otherwise. A
  template that has no place for them (`%SCORM%`), as a page that bundled 1.5's launch files has,
  is refused with an option set, since its bridge would play a 2004 zip as 1.2. `scormOptions`
  checks them once for both writers: 1.2 or 2004, a mark from 0 to 100 kept to the hundredth.
  - **SCORM 2004 4th Edition.** The manifest in the 2004 namespaces (`imscp_v1p1`, `adlcp_v1p3`,
    `imsss`), `schemaversion` `2004 4th Edition`, `adlcp:scormType`. The bridge finds
    `API_1484_11` where it finds 1.2's `API`, and speaks the same steps through one set of calls:
    `cmi.completion_status` and `cmi.success_status` apart, a result that says nothing of a pass
    leaving success `unknown`; `cmi.score.scaled` beside `raw`, `min` and `max`; the session time
    and each answer's latency as ISO 8601 durations to the hundredth; each answer with its words in
    `description` (250 characters, as text, the character references a question writes read), an id
    that is a URI as 2004 asks, `urn:uuid:` and the part's id, the type before the pattern and
    `learner_response`, which 2004 refuses without one (408), so an answer whose statement names no
    type has neither, `incorrect` where 1.2 says `wrong`, `timestamp` in UTC, and `long-fill-in`
    and `other` kept as themselves; `suspend_data` up to 64,000 characters, compressed as in 1.2.
    **A 2004 session always ends `suspend`**, finished or not, where 1.2 ends a finished one with
    nothing. With `normal` after a finish, Moodle gave the next launch an empty data model within
    the same attempt (`entry` `ab-initio`, completion `unknown`, no state), so the `incomplete` the
    bridge writes at launch replaced the `completed` Moodle kept, and the content started over.
    Suspended, the relaunch resumes: completed and passed kept, the content back on its result, and
    a retry counted, as on an H5P site.
  - **A pass mark.** In 1.2 the item's `adlcp:masteryscore`; in 2004 its primary objective
    (`objectiveID="primary"`, `satisfiedByMeasure`, `minNormalizedMeasure` the mark over 100 to the
    ten-thousandth), from which the LMS sets `cmi.scaled_passing_score`. The bridge reads the LMS's
    mark at launch, `cmi.student_data.mastery_score` or `cmi.scaled_passing_score`, which an
    administrator may change, else the page's, for an LMS that reads none from the manifest, and
    holds the score as written to it, so 66.67 passes a mark of 66.67 as the LMS judges it. A
    result with no score gets no verdict from the mark, and keeps the content's own. A zip written
    without a mark reads none, so an LMS's own mastery score never changes a default zip's status.
  - **Completion as 100.** A result with no score, neither `scaled` nor `raw` over a `max` above 0,
    as a questionnaire or a branching scenario without scoring finishes, is reported as 100
    (`scaled` 1) beside completed, and passes a mark. H5P invents no score, so this is off unless
    asked; content that never finishes, an Accordion or a Virtual Tour, stays incomplete. So does a
    presentation or book with no questions in it: Course Presentation 1.27 and Interactive Book 1.15
    send their `completed` from a summary page they show only when they hold tasks. In 2004 it
    leaves success `unknown` without a mark, which a test holds. It has run in no real LMS.

  `scorm-page.test.ts` drives the written site's page in Chromium (rows, Build, the download, several
  files with a refusal in its row, titles, dropped files, and a page with only the four elements);
  `scorm-browser.test.ts` holds the plan's facts and the page builder's zip to the command's, entry
  for entry, and a plan's writes to one hash of the package.

- **`skills/h5p-to-scorm/SKILL.md` is the contract with an agent**, as `skills/h5p-verify/SKILL.md`
  is the verifier's: what to ask first (the LMS, then a pass mark, completion as 100 and 2004 only
  where they matter), the check that plays a package as the zip plays it
  (`--libraries pack --no-refresh-libraries --no-downgrade-libraries`), the command and its
  refusals, the *Supported LMSs* table with the setting each LMS needs, and what to tell the user.
  It names only options on npm, since a skill is installed from `main`.
  `apps/skills/tests/to-scorm.test.ts` runs its commands as it writes them on packages h5p-author
  builds, plays their zips under a stand-in LMS as a learner (a quiz over two sessions in 1.2,
  where its mark of 80 fails the 66.67 the quiz's own 50% passes; a questionnaire, a branching
  scenario without scoring and a presentation without questions in 2004 with completion as 100),
  holds the content it names as keeping the learner's place or starting over to the pack's
  libraries (the player saves what `getCurrentState()` returns, and a type without it starts over,
  `docs/resume.md`), and holds its table to the README's, so an LMS checked later is added to both.

`tests/scorm.test.ts` checks the zip, the parts it carries, its stored entries' local headers and
its refusals in Node. In Chromium it plays the unpacked zip under a page that holds the API and
frames the launch page, as Moodle's player does. It covers:

- results (passed, failed, none), the end of the session, resume, state saved by another build
  refused, and a zip up to 1.4's plain state read;
- interactions: the quiz's four answers, and through dispatched `xapi` events the ids, the type
  map, the 255 cut, the result, the commit with each answer, one index per question across a retry
  and a second session, an attempt started over, and an LMS whose count stays at what it loaded;
- a state that fits only compressed, one that does not fit and the notice said once, the live
  regions, a write the LMS refuses, and a launch page without the compressor;
- the commit on `beforeunload` and the finish on `pagehide`, by the event the launch page was
  dispatching when it called, which is what ILIAS goes by, and a leave the learner stays from;
- the formulas export played from the zip's parts, compared with those the writer planned;
- the options: none written unless asked, a pass mark in 1.2 and 2004, refusals, an LMS's own mark
  winning over the zip's, completion as 100, and under `API_1484_11` the quiz played to the end in
  2004 (suspend and resume, a state past 4,096 characters, the type written before the pattern);
- playing with no LMS.

Not covered:

- any LMS but Moodle 4.5, Frappe LMS, SCORM Cloud, ILIAS 11, OpenOLAT 21.1 and Chamilo 3.0, and
  SCORM 2004 and the grading options in any but Moodle 4.5 and SCORM Cloud;
- content that finishes without a score, in a real LMS: it has played to its end only under the
  skill's stand-in;
- SCORM Cloud's launch in a frame of its player page, where it launched in its pop-up;
- Firefox and Safari;
- Moodle with `slasharguments` off, its popup window and its mobile app;
- untrusted packages, whose every library would then come from the pack.
