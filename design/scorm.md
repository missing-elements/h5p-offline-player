# The SCORM package

`npx @missing-elements/h5p-embed --scorm course.h5p` writes `course.scorm.zip`, SCORM 1.2 unless
`--scorm-version 2004` asks for 2004 4th Edition (#138, below). It holds
the package as `package.h5p`, the player's three files, the runtime as `frame-assets/`, `embed.css`
and the launch page with its bridge, for a package that does not carry its libraries the library
pack's parts it needs in `libraries/`, and `imsmanifest.xml` lists every file. Built on 2026-10-28
for teachers who hand students links and want results. A teacher's published notes chose this
player over Lumi Cloud and Digiquiz for everything but results, which only Lumi Cloud kept, and
French schools' platform, Éléa, is a Moodle that takes SCORM. The LMS keeps the results; nothing of
ours runs a server. The embed README's *Supported LMSs* table sums up the per-LMS bullets below,
one row each; an LMS added here gets a row there.

- **The worker registers under the package's own path in the LMS.** Moodle serves a package from
  `pluginfile.php/<context>/mod_scorm/content/<revision>/`, on its own origin, so the element's
  default `h5p-sw.js` beside it registers with that folder as its scope, which no other page of the
  LMS is in. Measured in Moodle 4.5.15 in Docker on 2026-10-28: the worker registered, and the
  package was read in six ranged requests, every one answered 206. Each new revision of the activity
  is a new scope; the old worker stays registered, which is harmless.
- **Trusted, and the pack's parts for what the package does not carry.** SCORM content runs on the
  LMS's origin by design, so the package's own code runs, as any SCORM package's does. An export
  without its libraries, from h5p.com or h5p.org, gets the parts of the pack it needs, in the zip
  (the owner's call, the same day: those exports are what many teachers have). The writer runs the
  player's own planner as the launch page has the element run it, filling gaps only: `planPack`
  from the player's `./plan` with `refresh` off and nothing provided, over `ownLibraries`,
  `dependenciesIn` and `librariesNamedIn` from the same module. Until #109 (2026-11-02) those were
  copies kept in step by hand, which nothing checked; since then embed pins the player exactly, as
  h5p-author does, and `scripts/check-published.mjs` refuses to publish until the pinned
  version is on npm with `./plan`.
  It writes those parts into `libraries/`, with an `index.json` that lists only them, and the page
  names the folder with `libraries="pack"`, `pack-base` and `refresh-libraries="off"`. The element
  then plans the same parts and finds each in the zip, and plays a package's own libraries as
  exported. Because the index lists only what the zip carries, a plan that ever came out different
  could only fall short: a gap the element refuses by name, or an addon left out, never a request
  for a part the zip lacks. What neither the package nor the pack supplies is refused when the zip
  is written, by the walk the player makes (`walkDependencies` over `reachableFolder`, the same
  functions `PackageReader.checkDependencies` runs), run over the package without the folders a
  part replaces and over the parts. The walk starts from the sub-content the parameters name as well, which the player found
  missing only when the runtime reached it until #85, and since then finds at index only where a
  source has the library's major. So a gap shows up when the teacher writes the zip,
  not when a learner opens it. Measured: the demo's formulas quiz, a stripped export, took 11 parts,
  4 MB, 2.8 MB of it MathDisplay; its full exports took none. In Moodle 4.5 the formulas zip
  reached `ready`, fetched exactly those 11 parts and the index, and typeset its LaTeX.
- **What the bridge reports.** On a first launch, `LMSInitialize` and `lesson_status`
  `incomplete`. On each `finished`:
  - the score out of 100, as `score.raw` with `min` 0 and `max` 100, from `scaled`, else from
    `raw` over `max`;
  - `passed` or `failed` by the content's `success`, else `completed`;
  - the session time, then `LMSCommit`.

  The last `finished` counts, as `setFinished` does on an H5P site. On `beforeunload` it sets the
  session time and `cmi.core.exit` (`suspend` unless finished) and commits; on `pagehide` it sets
  both again and calls `LMSFinish`.
  **Each answer goes into `cmi.interactions`** (#124, 2026-11-04, asked for by two of three
  commenters on the Reddit demand check): every `answered` statement the element relays, by the
  part's `subContentId`, with the question's words as the id, since 1.2 has no description field
  and the id is what a report shows (a slug in printable ASCII, which 1.2's `CMIIdentifier`
  allows and nothing else; the key for a question with no words; `-2` on a second question with
  the same words), the xAPI type as 1.2 names it (`long-fill-in` as `fill-in`, `other` and an
  unknown type left out), the pattern and the response cut to 255 (`CMIFeedback`; H5P's `0[,]2`
  goes in as it is, which Moodle takes), `correct` or `wrong` from `success`, or from the score
  where the content says nothing, as Fill in the Blanks does not (full marks, none, or the marks
  themselves, a number 1.2 takes there), `neutral` with neither, the marks as `weighting`,
  `result.duration` as `latency`, the time of day. **One index per question, written over on a
  retry**, read in Moodle's code: its interactions report has one column per index for every
  learner (`get_scorm_question_count` takes the highest index found), so an entry per attempt
  would set one learner's columns against another's. The index and the id come from the
  questions kept with the state (`questions` in `suspend_data`, a `[key, id]` per index, so that
  the second of two questions with the same words keeps its `-2` in a later session), after
  `cmi.interactions._count`, which 1.2 lets a SCO read and Moodle reloads from the attempt's
  tracks; an attempt the LMS started over counts none, and they start again. The count is read
  once, at launch, where an attempt starts over (#130): read on every answer, an LMS whose count
  does not follow what is written in the session would have had every new question written over
  the one before. Moodle counts as it is written, and kept one attempt's answers from two sessions
  on indexes 0 and 1 (checked 2026-11-04). The state is written
  and committed with each answer as well as with each of the content's saves, since content that
  keeps no state of its own sends no `userdata`, and its questions would otherwise take a new
  index in every session; where the state cannot be written, the answer is still committed (both
  found in #126's review). The fields are write-only; the reports read them. The commit is ILIAS's (#94, under *ILIAS plays it too*), and
  only a commit: the content's last save comes after it, and the learner may stay. Moodle's API
  sends with `navigator.sendBeacon` while unloading, and the `exit` it stored showed that the call
  arrived. Content with no result of its own stays `incomplete`. Moodle takes `score.raw` as the
  grade, against the activity's maximum grade (`grademax` is its `maxgrade` in
  `scorm_grade_item_update`), so the README says to leave that at 100, Moodle's default.
  Checked in Moodle 4.5.15 on 2026-11-04 with the demo quiz, three answers right: the four
  interactions in the attempt's tracks with the ids from the questions' words, the types, the
  patterns and responses, `correct` three times and `wrong` once, the weightings and latencies,
  `get_scorm_question_count` 4, and the interactions report with a Response column per index.
  Checked in SCORM Cloud the same day, through its v2 API, with a zip carrying the count read at
  launch: over two sessions of one registration, the second reopened on question 2 with
  `cmi.interactions._count` 1 at launch and put its answer on index 1, and the registration ended
  with the four interactions, their ids from the words, `correct` three times and `incorrect`
  (SCORM Cloud's word for 1.2's `wrong`), the weightings 1, 1, 4 and 3, passed at 66.67, and
  26.73 s over the two sessions.
- **Resume through `cmi.suspend_data`.** The element plays with `resume="host"`. Every `userdata`
  event rewrites `{ build, entries, questions }` into `suspend_data`, compressed with lz-string's
  `compressToBase64` since embed 1.5 (#124: ASCII, as 1.2's `CMIString4096` asks, and
  synchronous, so the content's last save on `beforeunload` still lands, where the browser's
  `CompressionStream` is asynchronous and could lose it), and commits. A state that begins with
  `{`, written plain by a zip up to 1.4, is read as it is, so a learner's place survives the
  upgrade. A launch hands `userData` back before `src` when the stamp matches. The stamp is the first 16 hex digits of the package's
  SHA-256, or, with parts of the pack, of one over the package's and theirs, written into the page's
  `<meta name="h5p-package-build">`. So a teacher who replaces the zip with another package does not
  hand learners state saved against the old one, and a zip written with other parts starts them
  over, as a refreshed package does in the player (the owner's rule of 2026-10-18). SCORM 1.2 keeps
  4,096 characters; a larger state is not written, and the last one that fitted stays. Until #124
  that was silent; now the page says so once, under the content (`#saving`), and in the console,
  as it does when the LMS refuses the write, which the bridge checks `LMSSetValue`'s answer for.
  `#saving` and the launch page's error, `#notice`, each sit in a live region that is on the page
  from the start, empty (`role="status"`, `role="alert"`), as `ACCESSIBILITY.md` asks of a host,
  since a region that appears with its text is not announced by every screen reader; until #126's
  review each was the region itself, hidden.
  Moodle takes 64,000 when its administrator turns "SCORM 1.2 standard mode" off
  (`scormstandard` in `public/mod/scorm/datamodels/scorm_12.php`). Checked in
  Moodle: a learner left after the first question, the next launch's `entry` was `resume`, and the
  quiz reopened on the second question; with the compressed state (220 characters) the same on
  2026-11-04, in standard mode. Measured that day on 23 packages of the corpus, the state as the
  bridge writes it after a generic click-through: a quiz 170 to 240 plain and 180 to 210
  compressed, Course Presentations 150 to 370 and 180 to 280, Interactive Books 630 to 2,330 and
  420 to 1,040, so nothing near the limit; a state under about 150 characters comes out longer
  compressed, base64 costing a third. The 12-chapter book read to its last chapter in Moodle wrote
  996 characters and came back with its chapters' state, and on its first chapter: Interactive
  Book takes its saved place (`urlFragments`, with `h5pbookid`) back only when that id is the
  content id, which the boot script drew at random on every load, so no book returned to its
  chapter in any `resume` mode, measured the same day in the plain player with `resume="device"`
  too. Fixed in the runtime by #127 (the content's id under *The saved state never leaves the
  page*): the book then reopened on its last chapter in Moodle, and in SCORM Cloud, which kept
  1,008 characters for it. Two corpus books carry Interactive Book 1.3, which keeps no state at
  all.
- **Outside an LMS** the page finds no API, plays the package and reports nothing.
- **Frappe LMS plays it too, and records less.** Checked on 2026-10-30 against Frappe LMS's
  `develop` branch in its own Docker setup, as an enrolled student in Chrome, with the demo's quiz,
  video and formulas export, each made a SCORM chapter through `upsert_chapter`, the call its
  chapter form makes. Frappe unpacks the zip under `/scorm/<course>/<chapter>/` on its own origin
  and frames the launch page without a sandbox, so the worker registered with that folder's `h5p/`
  as its scope, beside Frappe's own worker at `/assets/lms/frontend/`. Its file server answers a
  range with the whole file and a `200`, so the element read each package as `chunked`, downloaded
  whole. Its API keeps less than Moodle's (`SCORMChapter.vue`): the lesson is completed on SCORM
  1.2's `lesson_status` `passed` alone, so `failed` and `completed` leave it "Partially Complete";
  the score is never sent, since `saveProgress` carries only completion and `suspend_data`; and
  `suspend_data` is kept and handed back, so the quiz reopened on the second question. The
  formulas export played from the zip's parts and typeset its LaTeX. Running it took two changes
  to Frappe's compose setup: the bench image's MariaDB 11.8 client asks for TLS, which
  `mariadb:10.8` lacks (`skip-ssl` in `~/.my.cnf`), and `bench serve` binds 127.0.0.1 unless the
  Procfile says `--host 0.0.0.0`.
- **ILIAS plays it too, once Learning Progress is on.** Checked on 2026-10-30 against ILIAS 11.5
  (`srsolutions/ilias:11-php8.4-apache` with MariaDB 10.11 in Docker; the database has to be
  `utf8`, since `utf8mb4` fails ILIAS's setup with "Row size too large"), as root in Chrome, with
  the demo's quiz, video and formulas export uploaded as SCORM learning modules and the old
  writer's quiz zip beside them: both shapes import, ILIAS being PHP. A module opens in a new tab,
  with the launch page as the `sahs_content` frame of ILIAS's player, served from
  `/data/default/lm_data/lm_<obj>/`, where the worker registers; ILIAS keeps a worker of its own
  at `/`, so the element's `_ping` probe logs a 404 there, harmless. The quiz and the video were
  read whole (`chunked`), the small formulas package by ranges. **Nothing but `suspend_data` is
  recorded until Learning Progress is on**: a fresh ILIAS has it off (Administration → Learning
  Progress), and a module's own mode has to be "Collection of SCORM Items" (6) with its SCO
  selected; otherwise the player runs the SCO in `no-credit` mode and `SCORM1_2standard.js:590`
  drops every score and status write without a word. With that: resume reopened the quiz on its
  second question; a pass recorded 66.67 and Learning Progress completed at 100%; a fail 0 and
  failed; the formulas export played from the zip's parts, typeset, and passed at 50; and a result
  with no `success` was recorded `completed`, which ILIAS counts as done, where Frappe does not.
  **A session the learner ends by closing the tab keeps its time only through the commit on
  `beforeunload`** (#94). ILIAS's API (`basisAPI.js`, `useSendBeacon`) sends with a beacon only in
  Chrome, by user agent, and only while the content frame's current event is `unload`,
  `beforeunload` or `click`; on `pagehide` it opens a synchronous request, which Chrome refuses
  while a page is being dismissed, and since `IliasCommit` empties its queue before sending, what
  it held is gone. With the bridge that finished on `pagehide` alone (embed up to 1.3.0), two
  sessions closed mid-quiz left no `session_time`, `total_time` or `exit` in `scorm_tracking`,
  where the score, the status and `suspend_data`, committed while the content played, were there.
  With the commit on `beforeunload`, the same two left 8.84 s and 8.14 s, a total of 16.98, `exit`
  `suspend`, and the second resumed on the quiz's second question; ILIAS logged "use sendBeacon"
  for it beside its own unload request. ILIAS takes `total_time` as the time at launch plus the
  latest `session_time` (`c_storeSessionTime` `s`, its default), so a second commit counts nothing
  twice; nor did Moodle, whose total grew by 8.7 s for an 8-second session with either bridge,
  nor SCORM Cloud, by 8.65 s. Moodle's `request.js` switches to the beacon on its own page's
  `beforeunload`, `unload` and `pagehide`, and sends with it again when the synchronous request
  throws, which is why Moodle kept the time before. Why only a commit, measured the same day in
  Chromium, Firefox and WebKit with three nested same-origin documents, on a navigation and on a
  close: `beforeunload` fires top-down, a message the innermost frame posts from its handler
  reaches its parent before any `pagehide`, and `pagehide` then fires top-down too. The core saves
  the content's state for the last time on its frame's `beforeunload`, which comes after the launch
  page's, so a session finished on `beforeunload` would refuse that save in every LMS; and a
  learner asked whether to leave may stay, with the session open. The listener is added only once
  the LMS has accepted the session, so a page played outside an LMS has none.
- **OpenOLAT plays it too; two of its defaults need changing.** Checked on 2026-10-30 against
  OpenOLAT 21.1.1, the official WAR on the `tomcat:10.1-jdk17-temurin` image with PostgreSQL 17 in
  Docker (frentix's own image is 19.1.6, amd64 only and "for testing only"; `db.source=local`
  needs no JNDI, and Tomcat's connector needs `maxPartCount="-1"` for OpenOLAT's forms), as a
  student in Chrome. Its REST API imported the 1.3.0 quiz zip, whose stored entries carry data
  descriptors, as readily as 1.3.1's: OpenOLAT, Java too, unpacked both whole, so not every Java
  LMS refuses them. REST cannot add a SCORM element, so the
  course went through the editor, by the `o_sel_` selectors of OpenOLAT's own Selenium test
  (`AssessmentTest.scormCourseWithAssessment`). In the default display ("Show only module") the
  element runs in an iframe holding a second OpenOLAT page, which carries the API, scorm-again
  1.5.x with `asyncCommit` (OpenOLAT's copy raises `CMIString4096` to 1 MB; the bridge still
  stops at 4,096); the launch page is served from `/m/<mapper>/index.html`, the worker registers
  under `/m/<mapper>/h5p/`, and the package was read `range-http`. OpenOLAT keeps each SCO's data
  model as `item.xml`, with a copy per session, under `bcroot/scorm/<user>/<course>-<node>/`.
  Measured: resume reopened the quiz on its second question, after OpenOLAT's Back link, which
  blanks the SCO's frame itself and then reads the data model from its API (`o_unloadSCO`); a
  pass recorded 66.67 and `passed`; a fail 0 and `failed`; a result with no `success`
  `completed`; the formulas export played from the zip's parts, typeset 13 formulas, and passed
  at 50; every session's time was kept, and the total was their sum. Closing the tab mid-quiz
  kept the session's time and `exit` `suspend` with the 1.3.0 zip as with 1.3.1's. Two defaults
  change what a teacher sees. **Grading** transfers the score with "Score needed to pass" 0, so a
  failed quiz showed as passed, score 0; with 50 it showed as failed, and a pass as passed;
  "Transfer passed value" took `failed` as not passed and kept no score. **The learning path**
  marks an element done on "Confirmation by participant", and a mandatory element in the default
  sequential order locks the ones after it; with "Passed" as the criterion, a passed element was
  fully assessed. OpenOLAT's pages logged two errors of their own (`oobreadcrumb` and `resizable`
  "is not a function").
- **Chamilo 3.0 plays it too.** Checked on 2026-10-30 against Chamilo 3.0.1, the release zip on
  `php:8.3-apache` with the extensions its README lists and MariaDB 11.4 in Docker, installed
  through its web wizard, as a student in Chrome. The Learning paths tool's Import took the 1.3.0
  and 1.3.1 zips alike (PHP). An imported learning path starts as a draft (`resource_link`
  visibility 0), which a teacher publishes; Chamilo's own sample paths are published. Students
  open a path in the new runtime, `/resources/lp/171/<lp>/runtime`, which frames the launch page
  from `/learning-path/scorm/<course>/<session>/<group>/<lp>/<item>/index.html`, where the worker
  registers, and saves through `/api/learning_paths/<lp>/runtime/scorm/commit` and `/sync`. The
  file route answers no `Range`, so the package was read `chunked`; Chamilo keeps a worker of its
  own at `/`, so the `_ping` probe logs a 404, harmless. Measured in `c_lp_item_view`: resume
  reopened the quiz on its second question; a pass 66.67 of 100, `passed`; a fail 0, `failed`; a
  result with no `success` `completed`; the formulas export played from the zip's parts, typeset
  13 formulas, passed at 50; the time kept per session. Closing the tab mid-quiz kept the time and
  the place with either version, and `core_exit` `suspend` only with 1.3.1's commit on
  `beforeunload` (#94): with 1.3.0 the next launch's `entry` was `ab-initio`, yet Chamilo handed
  back `suspend_data` and the quiz reopened on its second question. The old address,
  `main/lp/lp_controller.php?action=view`, answers 500 to a student in 3.0.1 and on `master`: it
  constructs `LpAdvancedAccessHelper` with one argument where the constructor takes two since
  11a5f73 (2026-06-27, the Vue runtime). The course's list links to the runtime, so no learner
  reaches it that way;
  the harness first did, and passing `Container::getSettingsManager()` fixed it locally.
  Chamilo 1.11, still maintained, is not tested.
- **A stored entry carries its sizes in its local header** (#92). zip.js writing into a stream puts
  a data descriptor, general purpose bit 3, on every entry, and a Java `ZipInputStream` refuses a
  stored entry that has one, since nothing says where its data ends. Every zip from embed 1.2.0 to
  1.3.0 failed in SCORM Cloud with "IO Error processing zip", found on 2026-10-30, and the same
  files imported once the stored entries alone lost their descriptors — the fingerprint of that
  reader, on Rustici's Java engine, though its code is not public — while Moodle (PHP) and Frappe
  (Python) read the central directory and never noticed. The package, the fonts and the pack's
  parts are stored, so each goes in passed through with `compressionMethod: 0`, its size and its
  CRC (`fileCrc32`, a second read of the file, by the normalizer's `crc32` from its `./crc32`,
  zlib's from Node 22.2 and a table before, since the floor is 22 and a named import of a missing
  builtin export fails the whole module at link time; embed kept a copy of it until #108, when
  h5p-author's page build needed it too and the table became a module a page imports), which zip.js writes
  as a complete local header and still streams: writing a 433 MB package peaks between 170 and
  230 MB resident, run to run, as the writer before did (170 to 193 in two runs), nowhere near the
  package held whole. zip.js computes nothing for a passed-through entry, so the test holds the
  header's CRC to one computed over the data. Deflated entries keep
  their descriptors, which Java reads. Measured the same day in SCORM Cloud (a free account,
  through its v2 API) with zips the fixed writer wrote: the content opens in SCORM Cloud's pop-up
  from `cloud.scorm.com/content/courses/<app>/<course>/<version>/`, where the worker registers;
  the package is read by ranges; resume reopened the quiz on its second question; a pass recorded
  completed, passed and 66.67; the formulas export played from the zip's parts, typeset, and
  passed. With zips of the same shape, rewritten by zip.js with `dataDescriptor: false` on the
  stored entries: a fail recorded failed and 0, and a result with no `success` recorded completed,
  its success unknown. The pack, its parts, the demo packages (the normalizer's) and h5p-author's
  quiz have no stored entry with a descriptor, so nothing else needed the change.

- **The same zip is built in a page, with nothing uploaded** (#122, 2026-11-03). The people who
  need a SCORM package, designers and teachers with Canvas, Moodle or Blackboard, do not run `npx`:
  their route, H5P → Lumi → SCORM, which UBC, UFL, ISU, the University of Alberta and others
  publish guides for, has had Lumi's export broken since April 2026, and no converter ran in the
  browser. So `scorm.mjs` was split as #108 split h5p-author's build. `scorm-core.mjs` reads the
  package, plans the parts, lays out the entries and writes them, and imports no Node; `scorm.mjs`
  is the Node side, the files from the installed packages and the zip to a path, its API unchanged;
  `scorm-browser.mjs`, `./scorm/browser`, is the page's, `buildScormInPage()`: the package a
  `File`, the player's files, the runtime and the pack fetched from the site the page is on (`base`,
  `pack` or `packBase`, or `assets` for a page that bundles the launch page, the bridge, the
  compressor, the stylesheet and the licence list; a page that gives the launch page and not the
  compressor, as one bundled for 1.4 does, gets the one at `base` or a zip without it, whose page
  names none and whose bridge writes the state plain, rather than an export that fails for a file
  it never had to serve), each part checked against the index's SHA-256 since it came
  over the network, and the zip a `Blob`, in two steps since #137: `planScormInPage` reads and
  plans, and the plan's `write` fetches and writes (below). The runtime's files are named by a list,
  `RUNTIME_FILES`, plus the fonts from its `MANIFEST.json`, since a folder on a server cannot be
  listed; `scorm-browser.test.ts` runs the builder in Node, which has `fetch`, `File` and
  `crypto.subtle`, against a written site and holds its zip to the command's entry for entry, so a
  file the runtime adds shows up there. `site/scorm-page.js` is the page's script,
  `startScormPage()`, which reads `#file`, `#status`, `#download` and `#notice`, a `#state`
  badge where the page has one, and `#files` and `#build` where it works in steps (below); the
  written site loads it as `scripts/build.mjs` bundles it with
  zip.js and the player's `./plan` (`dist/scorm-page.js`, zip.js's licence in its header, since the
  site has no bundler), from `scorm.html`, with the launch page and the bridge copied beside it as
  `scorm-launch.html`, `scorm.js` and `lz-string.js` and the player's and the pack's versions in
  `config.js`. The
  demo reuses the source at `/demo/scorm.html` in the site's own design: the pack's parts as Vite
  emits them, the four files as `?raw` strings, the player's version from a `define`, and the
  player's built files from the site root, which a dev middleware serves from the player's `dist/`
  (`playerDistPlugin`). The page's builder imports the player's `./plan`, which is its built
  `dist/h5p-plan.js`, so the demo's build makes that file first, as `pnpm dev` does. The merge
  failed on Vercel without it, since the deploy builds no player and CI built the demo only after
  `pnpm build`; CI now builds the demo straight after the install, as Vercel does. Aliased to the
  player's source instead, as the element is, the plan shared its modules with the element, and
  the build split them into a chunk `h5p-player.js` imports, a file the page's zip carries alone.
  Decided with the owner that day, and amended on 2026-11-05 by #137 and #138, which made 2004, a
  pass mark and completion as 100 options and kept the defaults: SCORM 1.2 only, H5P's result
  rule kept, the tested LMSs the supported ones. Canvas, the audience's LMS, runs its SCORM on Rustici's
  SCORM Cloud by all accounts and cannot be tested here, since Canvas Free-for-Teacher has no SCORM
  upload.
- **The page works in steps, and the title is the teacher's** (#137, 2026-11-05). The University
  of Tennessee's in-browser converter (Nick Pook, MIT, h5p-standalone inside) reviews each package
  before it builds, lets the title be changed and takes several files; the owner asked for the
  same here, the build staying ours: their zips, measured on 2026-11-05 under a stand-in for an
  LMS and in SCORM Cloud, sent no score, no answers and no time, and never resumed. So a page
  shows what a zip will hold before anything is written, from the plan the build then uses:
  `planScormInPage` reads
  the package and plans its parts, and returns the facts, the main library with the version its
  `preloadedDependencies` give it (`mainLibraryOf`), the title, the size, the parts and their size
  from the pack's index, with `write`, which fetches the files and writes the zip, as often as
  asked, hashing the package for the build stamp on the first write only, since the package and
  its parts are the same for every write (#142); `buildScormInPage` is the two at once, and a
  `title` given to the plan is the plan's and its writes' default. A refusal comes at planning, by name, before
  anything but the pack's index is fetched. **The title** is `title` on both builders and
  `--title` on the command, cleaned by `scormTitle` as `h5p.json`'s is, an empty one leaving the
  package's; it goes into the manifest's organisation and item, which the LMS lists, and the
  launch page's `<title>`, and not into the build stamp, so a zip written again under another
  title keeps learners' places, nor into the package, which goes in as exported. **The page**
  works in steps where it holds `#files`, a list, and `#build`, a button, as both pages here do:
  ① choose, ② review, ③ download, each step the closest `[data-step]` around them, shown once it
  can be reached. A file chosen or dropped gets a row (the same file twice, by name, size and date,
  is one), during a build too, since a drop lands anywhere on the page: it is read at once and
  waits for the next Build, where it was dropped without a word until #142. Its facts sit in a
  live region (`role="status"`) from the moment the row appears, so
  that what the reading found is announced. Every row is drawn again on any change, a key typed
  in a title among them, so the page writes a region's text, and `#status`'s, only when it
  changes: written again as it was, a region may be read out again, and a test types a title key
  by key and counts no change to either. `#build` writes the rows one after another, a failure
  shown in its row while the others go on; `#download` is then the zip, or, for several, one zip
  holding them all, each stored as it is with its sizes and CRC in its local header (`addStored`,
  the package's way since #92), while each row links its own; a title changed after a build takes
  that zip back. A page with only the four elements of before builds the first file at once and
  shows a refusal in `#notice`, as up to 1.5, since `startScormPage` and its page are covered by
  docs/compatibility.md and a host's own page has to keep working. Not taken from their page: a
  contents list, a SCORM Cloud link, an export of the settings, switches for playing offline and
  for resume, since every zip here carries all it plays and always resumes, and an accessibility
  check, which would need knowledge of each content type. The SCORM version and the grading
  options are #138's, below.
- **SCORM 2004, a pass mark and completion as 100, each an option** (#138, 2026-11-05). The
  owner's call, after the same converter offered all three: options, page-wide on the page and a
  flag each on the command (`--scorm-version 2004`, `--pass-mark`, `--completion-score`), the
  defaults as they were, and each offered for the LMSs it was checked in. A zip written with none
  is the one written before them: its manifest, its launch page and its notice are byte for byte
  what main wrote, and only the bridge is new code, which plays a page that names no option as it
  did. The bridge learns the options from the launch page: a `<meta>` after the build's for each
  one set (`h5p-scorm-version`, `h5p-scorm-pass-mark`, `h5p-scorm-completion-score`), none
  otherwise. A template that has no place for them (`%SCORM%`), as a page that bundled 1.5's
  launch files has, is refused with an option set, since its bridge would play a 2004 zip as 1.2.
  `scormOptions` checks them once for both writers: 1.2 or 2004, a mark from 0 to 100 kept to the
  hundredth.
  - **SCORM 2004 4th Edition.** The manifest in the 2004 namespaces (`imscp_v1p1`, `adlcp_v1p3`,
    `imsss`), `schemaversion` `2004 4th Edition`, `adlcp:scormType`. The bridge finds
    `API_1484_11` where it finds 1.2's `API`, and speaks the same steps through one set of calls:
    `cmi.completion_status` and `cmi.success_status` apart, a result that says nothing of a pass
    leaving success `unknown`; `cmi.score.scaled` beside `raw`, `min` and `max`; the session time
    and each answer's latency as ISO 8601 durations to the hundredth; each answer with its
    words in `description` (250 characters, as text, the character references a question writes
    read: `&rsquo;` came through as itself in Moodle until then), an id that is a URI as 2004 asks,
    `urn:uuid:` and the part's id, the type before the pattern and `learner_response`, which 2004
    refuses without one (408), so an answer whose statement names no type has neither (#142),
    `incorrect` where 1.2 says `wrong`,
    `timestamp` in UTC, and `long-fill-in` and `other` kept as themselves; `suspend_data` up to
    64,000 characters, compressed as in 1.2. **A 2004 session always ends `suspend`**, finished
    or not, where 1.2 ends a finished one with nothing. Measured in Moodle 4.5 with `normal`
    after a finish: the next launch got an empty data model within the same attempt (`entry`
    `ab-initio`, completion `unknown`, no state), so the `incomplete` the bridge writes at
    launch replaced the `completed` Moodle kept, and the content started over. Suspended, the
    relaunch resumed: completed and passed kept, the content back on its result, and a retry
    counted, as on an H5P site.
  - **A pass mark.** In 1.2 the item's `adlcp:masteryscore`; in 2004 its primary objective
    (`objectiveID="primary"`, `satisfiedByMeasure`, `minNormalizedMeasure` the mark over 100 to
    the ten-thousandth), from which the LMS sets `cmi.scaled_passing_score`. The bridge reads the
    LMS's mark at launch, `cmi.student_data.mastery_score` or `cmi.scaled_passing_score`, which an
    administrator may change, else the page's, for an LMS that reads none from the manifest, and
    holds the score as written to it, so 66.67 passes a mark of 66.67 as the LMS judges it. A
    result with no score gets no verdict from the mark, and keeps the content's own. A zip
    written without a mark reads none, so an LMS's own mastery score never changes a default
    zip's status.
  - **Completion as 100.** A result with no score, neither `scaled` nor `raw` over a `max` above
    0, as a questionnaire or a branching scenario without scoring finishes, is reported as 100
    (`scaled` 1) beside completed, and passes a mark. H5P invents no score, so this is off unless
    asked; content that never finishes, an Accordion or a Virtual Tour, stays incomplete. So does a
    presentation or a book without questions, which the README and the command's help gave as the
    example until #160 (2026-11-08): Course Presentation 1.27 and Interactive Book 1.15 send their
    `completed` from a summary page they show only when they hold tasks. Played to its last slide,
    the presentation sent `progressed` alone; the book's chapters say `completed` as sub-content,
    which is not the book's result.
  - **Checked on 2026-11-05.** In Moodle 4.5.15 (Docker, `notes/scorm-spike`, the 2004 runs by
    `drive-options.mjs`): Moodle took the 2004 zips as `SCORM_1.3`, kept the objective (0.8,
    satisfied by measure) and the 1.2 mastery score (80). The quiz over two sessions resumed on
    its second question, finished completed and passed at 66.67 (scaled 0.6667), the gradebook
    66.67, the total time the two sessions' sum, the four answers with their ids and words; a
    launch after the finish resumed with the result kept. With a mark of 80, the same 66.67
    failed in 2004 and in 1.2, the gradebook still 66.67; with completion as 100 in a zip that
    also held the mark of 80, a finish with no score recorded 100 and passed in both, the
    gradebook 100. In SCORM Cloud, through its v2 API: both 2004 zips imported as
    `SCORM20044THEDITION` with no parser warnings; the same two sessions resumed on the second
    question, the registration completed and passed at 66.67, and a launch after the finish kept
    it; a mark of 80 failed at 66.67 with completion still completed, where 1.2 shows a failed
    attempt as incomplete; a finish with no score, in the zip with the mark of 80 and completion
    as 100, completed, passed and 100; and 1.2 with a mark of 80 failed at 66.67, the
    registration incomplete as for any failed 1.2 attempt there. The finishes with no score were
    the element's `finished` dispatched in the SCO's frame, as the tests do, since no package here
    finished without one; since #160 the h5p-to-scorm skill's test plays real ones under a stand-in
    LMS. Completion as 100 without a mark ran in no LMS: it gives `completed`
    and 100, and in 2004 leaves success `unknown`, which a test holds (#142).

  `scorm-page.test.ts` drives the written site's page in Chromium: a chosen file read into its row
  and built on Build, the download, which is the command's zip and plays unpacked; three files at
  once, a refusal in its row beside two that build, a title given, each row's zip and the zip of
  all, a row taken out, a title changed after the build; files dropped, the same one only once,
  and one dropped during a build, which waits for the next; and a page with only the four
  elements, which builds at once and refuses in `#notice`. `scorm-browser.test.ts` holds the
  plan's facts to the command's zip, two writes of one plan under two titles to the same zip but
  for the manifest and the page, a title given to the page's builder to the command's `--title`,
  entry for entry, and a title given to the plan to its writes, which hash the package once.

- **`skills/h5p-to-scorm/SKILL.md` is the contract with an agent** (#159, 2026-11-08), as
  `skills/h5p-verify/SKILL.md` is the verifier's: what to ask first (the LMS, then a pass mark,
  completion as 100 and 2004 only where they matter), the check that plays a package as the zip
  plays it (`--libraries pack --no-refresh-libraries --no-downgrade-libraries`), the command and
  its refusals, the *Supported LMSs* table with the setting each LMS needs, and what to tell the
  user. It names only options on npm, since a skill is installed from `main`.
  `apps/skills/tests/to-scorm.test.ts` runs its commands as it writes them on packages h5p-author
  builds, plays their zips under a stand-in LMS as a learner (a quiz over two sessions in 1.2,
  where its mark of 80 fails the 66.67 the quiz's own 50% passes; a questionnaire, a branching
  scenario without scoring and a presentation without questions in 2004 with completion as 100),
  holds the content it names as keeping the learner's place or starting over to the pack's
  libraries (the player saves what `getCurrentState()` returns, and a type without it starts
  over, `docs/resume.md`), and holds its table to the README's, so an LMS checked later is added
  to both.

`tests/scorm.test.ts` checks the zip, the parts it carries, its stored entries' local headers and
its refusals in Node. In Chromium it plays the unpacked zip under a page that holds the API and
frames the launch page, as Moodle's player does. It covers:

- a passed and a failed result, the end of the session, resume, and refusing state saved by
  another build, and reading one a zip up to 1.4 wrote plain;
- the quiz's four answers as interactions, and, through dispatched `xapi` events, the id from
  the words and from the key, the second id for the same words, kept in a later session, the
  type map, the 255 cut, the result from `success` and from the score, the questions written and
  committed with each answer, one index per question across a retry and a second session, an
  attempt started over at a launch, and an LMS whose count stays at what it loaded at launch;
- a state that fits only compressed, one that does not fit at all and the notice said once,
  both notices' live regions on the page from the start, a write the LMS refuses, and a launch
  page without the compressor, which writes the state plain;
- the commit on `beforeunload` and the finish on `pagehide`, by the event the launch page was
  dispatching when it called, which is what ILIAS goes by, and a leave the learner stays from;
- a result with no score, and a state past 4,096 characters, through the element's events
  dispatched as it dispatches them, since no package here reaches either headless;
- the formulas export played from the zip's parts: the parts the element fetched are compared
  with those the writer planned, and the test waits for the LaTeX to be typeset;
- the options (#138): none written unless asked; a pass mark as 1.2's mastery score and as 2004's
  objective; an option refused, by the function and by the command; a mark that fails the
  content's pass, and an LMS's own mark that wins over the zip's; completion as 100, passing a
  mark; and, under a page that holds `API_1484_11`, the quiz played to the end in 2004 with its
  answers, the session suspended and resumed with the result kept, a state past 4,096
  characters kept, a score held to the LMS's passing score, and an answer's type written before
  its pattern and response, and neither for an answer that names no type;
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
