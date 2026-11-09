# The author package

`@missing-elements/h5p-author` builds a playable package of any content type in the pack from a
source of only what an author would write: `{ type, title, language, license, authors, params }`,
`params` holding the fields that differ from their defaults. Built on 2026-11-01 for #100, the
owner's design: the content type chosen with the user first, a file per type in the h5p-author
skill so no agent works out how a type is built, a short skill, one package for the whole pack. It
replaced the skill's bundled `scripts/build-quiz.mjs`, which built Multiple Choice and Question Set
alone, and its quiz format stays a source the build takes (`lib/quiz.mjs` maps it), so nothing
written in it broke. The skill stopped describing it on 2026-11-01 (#102), when an agent given a
quiz was found reading both it and the two type files: every type is written from its type file,
a quiz from H5P.QuestionSet's and H5P.MultiChoice's, and the format's two examples are the tests'
fixtures. The skill runs the verifier once, trusted (the owner's call, the same day): the build
already holds text to the content check's rules, from the pack an untrusted check plays, and
`apps/skills` plays every example untrusted too. Measured on a five-question quiz, at four
characters a token: `content.json` was about 3,470 tokens to write by hand, after reading 3,900 to
9,500 of a type's semantics; the source is 1,000 to 1,800 tokens, written from a type file of 200
to 3,000. Twelve things the code does not say by itself:

- **One generator, three ways to run it.** The third, `saved`, checks content as H5P stores it
  (*Saved content is checked as the build checks what it writes*, below). `ContentGenerator` was the sweep's
  (`apps/demo/scripts/lib/sweep-content.mjs`), and moved here so there is one copy; the sweep runs
  it `lenient`, keeping what its files write as written and filling every required field from its
  own samples, and its 55 types came out byte for byte the same after the move. Authoring checks
  every written value as H5P's editor would let an author save it, and reports every problem with
  its path, all at once, so a fix is one round: a field the semantics do not name, a select's
  unknown option, a number out of range or with decimals the editor's number field refuses, a list
  too short or long, a required field with neither a value nor a default, sub-content of a library
  the field does not take. What the editor does is the rule, read from h5p-editor-php-library's
  widgets at a pinned commit (*The editor is pinned* below): a new list starts with `defaultNum`,
  `min` or one item, and a list such an item needs writing in is reported as one missing list; a
  field its `showWhen` rule hides is not asked for (Multimedia Choice's poster, wanted only for
  audio), the rule's `../` climbing a level for each group and each list, as the editor's
  `findField` climbs from widget to parent; media fields, which the editor
  never asks for, are required where the semantics say so, and optional where a type plays without
  them (H5P.Video's poster); a library default nobody opened, Interactive Video's summary task, is
  left as the editor leaves it, asking nothing.
- **Text is stored as the platforms store it.** A plain field is escaped as `htmlspecialchars`
  does, existing entities kept, and a tag in it is noted, since a learner sees it as written. A
  field with `tags` takes markup with the tags the content check keeps for it (its own, `div`,
  `span`, `p`, `br`, and what they imply), checked here rather than filtered later: any other tag,
  an event handler, a style the field does not allow, a script address or a comment is a problem
  by name. Plain text written into such a field is wrapped as the editor wraps typing: in `<p>`
  where the field's `enterMode` is `p` or its tags offer headings, `pre`, `p` or `div`, in `<div>`
  otherwise. Every plain default is escaped too, English or translated, and a `null` default (Course
  Presentation's colours) is left out, which the content check would otherwise turn into a
  warning. Every type file's example plays untrusted with no warning, which is the test of this.
- **Some types need what their editor widget does.** Course Presentation, Interactive Video, Game
  Map and Branching Scenario are edited on a slide, a video, a map and a tree of their own, which set
  fields the form hides (`widget: "none"`). `lib/types.mjs` does each one's work on the generated
  content, wherever the type appears: a slide's unplaced elements stacked, text as tall as its lines
  as CP 1.27's stylesheet draws them, pictures shrunk in shape, a question in what is left, with a
  note when a slide holds too much. Text is measured at the sizes CP draws, a paragraph at 10.8 px
  per 640 in lines of 1.25em (`SLIDE_TEXT`), and on a slide with room and no question it is set
  larger, in steps up to twice, as large as fits with its pictures whole (#145): measured at the
  slide's 16 px before, a text box was twice as tall as its text, and a slide of text alone showed
  small text in its top part. The size goes on each block, not on a span inside, since CP gives a
  paragraph's lines in em and a span would inherit them as a length, so its lines would overlap;
  and it is written as the content check writes a style, so an untrusted play changes nothing.
  Text whose source sets a size keeps it. Interactions placed apart, clear of what shows at the same
  time, and named by their library; a poster sized by what it holds, in IV's em (a 16:9 video is
  40 by 22.5): a picture in its shape, as the editor's own widget does, a text as wide as keeps
  it short, a question 17 by 16. The editor starts every interaction at 10 by 10 and leaves the
  rest to the author's mouse, and seen in Chrome, 10 by 10 showed two answers of four and hid the
  Check button behind a scroll (#100's review); on a phone IV shows posters as buttons. Stages
  given ids and types, neighbours named by label made indices both ways; end screens numbered. It
  checks what those widgets would not let pass: a scenario node with no next, a link to no node, a
  loop no path leaves; a map with no start; a hotspot question with no right area. A hidden field
  nothing set is reported. Lists such a widget draws start empty. All of that runs on content in
  the form H5P stores it, in `checkContent`, so it holds saved content too; only a layout's
  `before`, Game Map's, works on the source, turning its numbers and labels into the stored text.
- **Media are copied and described.** A file is `{ path }`, beside the source or an `http(s)`
  address, downloaded at build time; it lands under `content/images|videos|audios|files/` with its
  MIME type, an image's size read from its header (PNG, JPEG, GIF, BMP; a JPEG's segments walked to
  its frame header, which a colour profile can put past the first 64 kB, where the first cut
  stopped and refused the picture), and its copyright, on H5P's own list of types (no SVG, no
  WebP). A download is given up after a minute with no byte, not after a fixed time: the first cut
  allowed two minutes in all, which a large video over a slow link outlasts. A YouTube, Vimeo,
  Panopto or Echo360 address stays, as the editor embeds it, and only one H5P.Video plays: it
  chooses a player by its own pattern for each host, and an address none matches goes to its
  HTML5 player, which cannot play a page. So the build takes an address only where that pattern
  does too, a Short's or a live stream's written as its video's watch address, and refuses
  another on those hosts, naming the form; `build.test.ts` holds each accepted address to the
  patterns read from H5P.Video's scripts in the pack. The first cut took `youtube.com/shorts/`,
  `player.vimeo.com` and any `panopto.com` address, which built and then did not play, and knew
  no Echo360 (found in the PR's own review). A package with media goes through the
  normalizer's `normalizeArchive`, so it is stored and laid out to stream, an mp4's index first.
  An addon whose pattern the text matches, H5P.MathDisplay for LaTeX, is carried as a site with
  it installed exports it.
- **The pack is pinned.** The dependency is `workspace:*`, published as the exact version
  packages/libraries has, so a release builds with the libraries it was tested with and one command
  needs no project set up; `--libraries` names another `parts/` folder. Each part is checked
  against the index's SHA-256 before it is read. `prepublishOnly` refuses while that version is not
  on npm with this checkout's index (`scripts/check-pack-published.mjs`, which checks the player it
  pins too, next bullet, and the normalizer's `./crc32`, *A page builds too*), as the player's does.
- **The player's library rules, not copies of them** (2026-11-02, #106, the owner's rule: reuse what
  another package has, and extend it where needed). Which libraries content names, an addon's
  patterns and what they match, and which parts of the pack a package needs are the player's: the
  build plans what a package carries with `planPack` from the player's `./plan`, for a package that
  carries nothing yet, so a package carries the parts the player would take from the pack for it.
  Two things stay here. A check that every library the content and the parts name was planned,
  since the plan leaves a gap without a word. And the order: depth first from the content type, as
  the closure the plan replaced listed them, which `h5p.json` and the zip's folders follow, because
  the runtime keeps that order between libraries that do not depend on each other and so decides
  whose stylesheet comes later; `build.test.ts` holds a build's `h5p.json` to it, derived from the
  parts' own `library.json` files. All 32 type files' examples came out with the libraries, order,
  folders and notes of the build before. The old closure also followed `dynamicDependencies`, which
  no library in the pack has (checked the same day). `./plan` is not covered by
  docs/compatibility.md, so the dependency is `workspace:*`, the player's exact version, published
  first: `scripts/check-pack-published.mjs` refuses to publish until the pinned version is on npm
  and exports `./plan`, since a player published before it existed would install and fail on the
  first import. A tool beside the build takes what the build loads (`openPack`, and `loadLibraries` over
  any source with the pack's members), its rules for text, and since #107 the check it runs last
  (next bullet). The runtime's library-name parser, content check and content upgrade stay out:
  they are GPL-3.0-only.
- **Saved content is checked as the build checks what it writes** (2026-11-02, #107). A tool that
  changes a saved package, the agent toolset's `apply` in embed-my/creator, could not take the
  build's check, which reads a source: it refused every saved file (`mime`, `width`, `height`), every
  part's metadata, a Game Map's stored stages and a field only an older minor has, and gave every
  part a new `subContentId`, which the core names a part's statements by, so after each edit an LRS
  would have counted every question as new. `checkContent` runs the generator `saved`: files and
  metadata taken as saved and held to what the platforms keep of them (H5PContentValidator's
  `_validateFilelike` and `validateLibrary`, and the licences the core's copyright dialog looks up
  without a check, `lib/metadata.mjs`); each part's id kept, unless H5P would not keep it or an
  earlier part has it, which copy and paste in the editor leaves; a markup field's text not wrapped
  again. Then the layouts' `after`, the titles and the hidden fields nothing set, all moved out of
  the build into it, and Game Map's checks with them, its `before` keeping only the conversion of a
  source's numbers and labels. The build runs it last, on what it writes, and adds what it finds
  except where the source has that problem already or the generator refused what was written
  there, so the two hold content to one set of rules. The semantics, the owner's call the same day:
  the package's own where it carries a library's major (`packageLibraries`, over the player's
  `ownLibraries`), the pack's otherwise; where the content names another minor than the one checked
  against, a field only that minor has is noted and kept, since the player upgrades it as it plays
  (steps the runtime runs, GPL, in its frame) or plays newer content without it. Every type file's
  example, built and then checked against its own libraries and against the pack, comes back with
  nothing reported and nothing changed (`apps/skills`); the demo's packages report nothing but
  `markup.h5p`'s markup, which it carries to be removed. Content written without its defaults, as
  the demo's is, comes back with them, as the editor saves it. Run over the 88 real packages of the
  owner's corpus, 61 report nothing; the others hold what their editor let an author save and the
  build does not, a required alt text or scenario title left empty, keys an older editor wrote
  (Drag and Drop's `dropZones[].type`, Branching Scenario's `contentId`), styles pasted from Word,
  so a tool that changes one part keeps the problems under the paths it changed. Three things the
  editor saves for an author who never touched them are taken as such, found on that corpus: an
  optional group holding nothing an author has to write, empty texts in it included (Interactive
  Video's adaptivity); the item it starts an optional list with (its subtitle track); and an
  optional select at its empty choice (`goto.type: ""`). A group that is sub-content now gets an id
  in a build too, as the editor's `initSubContent` gives one: Summary's statements and Single Choice
  Set's choices had none, and Summary names a statement's statements by it.
- **A page builds too** (2026-11-02, #108). embed-my/creator builds content in a page and in a Tauri
  window, on the generator it copied from the sweep on 2026-10-18, without the form's checks, the
  problem paths and the translated defaults; and a paste mode for any content type needs the whole
  build there. So the package has three entries: `.` for Node, `./core` for what needs neither Node
  nor a page, and `./browser`, the core and a page's `openPack` and `buildPackage`. They are
  subpaths and not the `browser` condition, which TypeScript ignores unless a project sets
  `customConditions`: a page importing `.` would get the page's code typed with Node's declarations,
  and the two `buildPackage`s take different arguments. One build: everything but where the pack's
  bytes, a source's files and the package are is `build.mjs`'s and runs in both, and `node.mjs` is
  the only module that imports `node:`, which `page.test.ts` holds the entries' imports to. Three
  things follow:
  - **A part is read whole and hashed with `crypto.subtle`, in Node too.** The reader by range Node
    had went: the largest part, MathDisplay's, is 2.8 MB, and the hash read every byte anyway. A
    page cannot read by range in any case: SHA-256 needs every byte and `crypto.subtle.digest`
    takes no stream, ranges fetched after the check are other responses, whose bytes nobody
    checked, and jsDelivr cuts a range from its compressed copy.
  - **What a page names the pack by.** The `pack` export is taken as the page's bundler emitted it.
    The address of a copy of `parts/` has its `index.json` held to the player's shape by
    `packLibrariesIn`, which `./plan` exports for this. That is http(s) only, as the player reads
    a copy, so a Tauri window on macOS, whose own files are `tauri://`, gives the export.
  - **Media are given as `File`s, by the names the source gives them, and stored with their sizes and
    CRC in their local headers**, passed through as embed's SCORM writer has stored its entries since
    #92, so that the player reads each one's size off its header on a host without `Range`. The CRC
    is the normalizer's, which a page imports through `./crc32`, so embed's copy went. An mp4 is not
    moved to start before it has arrived whole: that is the normalizer's, which runs in Node.

  A page needs a secure context for `crypto.subtle` and `crypto.randomUUID`, which the generator
  now takes from `globalThis.crypto`, and fetches media named by web address under CORS, which most
  image hosts refuse; the build says which, where it can. The page's build, run in Node, writes
  H5P.Blanks file for file as Node's build does (`page.test.ts`). The Chromium test
  (`tests/browser/page.test.ts`) builds H5P.Blanks and a Question Set with a picture drawn on a
  canvas, 0.9 and 1.3 MB, and hands the bytes to Node through a Vitest command, where the verifier
  plays each untrusted: a pass, no warning, nothing changed by the content check. Of what #108
  listed for the core, `translateDefaults`, `quizSource` and `quizProblems` stay internal:
  `loadLibraries` gives the translated defaults, and `buildPackage` takes the quiz format itself.
- **The skill's type files are partly generated.** `skills/h5p-author/references/types/<Type>.md`
  holds hand-written notes, an example, and the type's fields between two markers, written by
  `schemaOf(…, { markdown: true })`: names, kinds, defaults, options, list sizes, a markup field's
  tags, the sub-content the pack has, the syntax the editor's `important` box explains, `showWhen`
  conditions; interface texts and the fields a layout sets left out. The weekly pack refresh runs
  `sync:skill`; `apps/skills`' test fails on a file out of date, and builds and plays every
  example. 28 content types have files, and the parts other content holds (Text, Image, Video);
  any other type's fields are one `h5p-author schema` away.
- **The editor is pinned, and not watched** (2026-11-01, the owner's choice, as for the content
  check). Nothing the editor does decides whether a package plays: the libraries and the platforms'
  validator do, both pinned here too. A change in the editor makes a build differ from what the
  editor now saves, in the rule that changed, and no more. A change in a library can matter, and
  reaches the author with the weekly pack refresh, which since #100's review runs the author's
  tests and `apps/skills`' against the new pack and says in its pull request whether every
  example still builds and plays: a renamed field, a new required one or a new hidden one fails
  there by name. The rules were read from h5p-editor-php-library at 3bec259 (2026-10-08), whose
  `master` had not moved since, and H5PEditor.ShowWhen 1.0.9; the layouts' from the editors the
  pack's content types name in `editorDependencies`, each at the newest release of the minor named,
  which GitHub's default branch is not always: H5PEditor.InteractiveVideo 1.26.3,
  H5PEditor.BranchingScenario 1.5.13 (its `main` is 1.6) and H5PEditor.GameMap 1.2.5 (1.5).
  `generator.mjs` and `types.mjs` name the commits and where they depart from the editor, and each
  rule the script it follows. To move to a newer editor by hand: diff those scripts between the
  pinned commit and `master`, or between the pinned release and the one a refreshed pack names;
  port what changed; move the commits named in the two files; and run the author's tests and
  `apps/skills`'. Pinning found three things the first cut had wrong: a number's steps were
  counted from `min`, where the editor's `value % step` counts from 0; a `showWhen` path skipped
  the level the editor gives a list and a group of one field, which only Advent Calendar's door
  cover reached (`../../modeDoorImage`, from a list's item, optional either way; the pack's other
  98 rules resolve alike); and two comments said the editor sets what it does not, a Branching
  Question's own `nextContentId`, which it deletes, and a Game Map stage's `type`, which it keeps
  out of the content. Both fields are still written, being hidden and required, and the runtime
  ignores the first and works the second out again. One departure since (#162): a multiple of a
  fractional step is taken within a rounding error, where the editor's `%` refuses 0.3 in steps
  of 0.1; no library in the pack has such a step, and the content check checks none.

- **A package installs on an H5P site** (2026-11-06, #146). H5P core's upload check wants every
  library a package carries to have its preloaded, dynamic and editor dependencies with it at the
  exact major.minor, or installed on the site; the hub's bundles and the platforms' exports carry
  the editor libraries for that, and the pack did not, so a Moodle with no library installed
  refused 28 of the 32 type files' examples (*The pack carries what an H5P site's upload check
  wants* in libraries.md has the measurement). The owner's call: always carry them, since a `.h5p`
  a fresh Moodle refuses is broken, and a platform's export is as big. `lib/install.mjs` walks from
  the selected parts over the pack's index at exact versions, through what each added library
  names in turn (`installClosure`), and `writePackage` copies them after the content and the media,
  where nothing reads them as the package plays, in a page's build too (#162: it wrote them before
  the media); `h5p.json` lists what plays, as the platforms' exports write it.
  A package with media then goes through the normalizer, told to write the run after the media
  (`last`, #148), so with or without media a host without `Range` boots before the run arrives;
  over one with `Range` the player's warm takes only what `h5p.json` declares, and so leaves the
  run out too. Measured on the 35
  packages of the Moodle check, with real files: a Question Set gains 123 kB, most types under
  50 kB, and the three containers much more, because their editors preload every type they can
  hold: Interactive Video 2.4 → 5.1 MB, Course Presentation 1.2 → 4.8 MB (64 libraries, as
  LMSable's and a Moodle export's), Branching Scenario 2.2 → 7.3 MB. All 35 then pass a fresh
  Moodle as an admin and still play. `missingForInstall` is the rule as a check, for `apps/skills`
  over every example and for a tool beside the build. In Node the pack is read from
  `parts/index.json`, which names the `installOnly` parts the `pack` export leaves out; a page
  gives `@missing-elements/h5p-libraries/install`'s, and a build from a pack without them is
  refused naming the first library and where the pack with them is, rather than writing a package
  a site refuses.
- **Where `npx` cannot install, a page builds** (2026-11-09). The owner tried the skill in the
  ChatGPT app, on a free account, and the build could not install: ChatGPT's sandbox reaches npm
  only through OpenAI's own mirror, reported refusing every install from July 2026 (503, then
  404), and the public registry not at all. Nothing in the skill can fix that, and a backend the
  model calls would need a custom GPT or connector, which a free account cannot add. So the skill
  hands over the source and a link to a build page, `https://embed-my.github.io/build`, where the
  user's browser runs the page build (*A page builds too*), plays the package and downloads it.
  The link carries the source in its fragment, raw-deflated and base64url, which no server sees.
  The page lives in embed-my/embed-my.github.io, not in this repository's demo: the owner wanted
  an authoring tool's public address without "H5P" in it, and that origin already serves the
  player and the pack. It builds from `@missing-elements/h5p-libraries/install` at the version
  the author package pins, so the page plays with the pack it built from.

Not built: editing an existing package, which a tool beside it does with `checkContent` as its
check; layout for Drag and Drop and Crossword; and any judgement of whether content is right, which
stays the person's, in the verifier's preview.
