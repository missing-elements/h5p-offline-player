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
to 3,000. Twenty-seven things the code does not say by itself:

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
  field the editor gives its rich-text widget (`widget: "html"`, or a ShowWhen that draws one) takes
  markup with the tags the content check keeps for it (its own, `div`, `span`, `p`, `br`, and what
  they imply), checked here rather than filtered later: any other tag, an event handler, a style
  the field does not allow, a script address or a comment is a problem by name. Plain text written
  into such a field is wrapped as that widget wraps typing: in `<p>` where the field's `enterMode`
  is `p` or its tags offer headings, `pre`, `p` or `div`, in `<div>` otherwise. Every plain default
  is escaped too, English or translated, and a `null` default (Course Presentation's colours) is
  left out, which the content check would otherwise turn into a warning. Every type file's example
  plays untrusted with no warning, which is the test of this.
- **`tags` say what the check keeps, the widget what an author writes** (2026-11-09). Up to author
  0.5.0 any field that listed `tags` took markup, and plain text in it was wrapped. Five of
  Question Set 1.21's fields list `tags` but are plain text boxes in the editor (`ns.Text`, which
  stores `htmlspecialchars(value)` and wraps nothing, at the pinned commit): the intro title, the
  result message, the progress text and the two old greetings. The set draws the first two with
  H5P.Components' `textContent`, so a quiz from ChatGPT showed `<div>World War II: Five Historic
  Events</div>` on its cover, and the type file had told the model both fields take HTML.
  `takesMarkup` is now the rule, in the build, in its messages and in the type files; saved
  content is still checked by `tags`, as the content check keeps it. Of the pack's 2,361 fields,
  1,252 are of type `text`, whatever widget draws them, and these five were the only ones of those
  that differed: the other 1,096 plain boxes and the 96 rich-text fields (Speak the Words Set's
  ShowWhen among them) were stored as their widgets store them, and so were the 38 drawn as colour
  selectors, the 6 text areas, the one date and the 10 hidden. The editor puts a default in
  unescaped, and the server filters it by `tags`, so defaults still go by `tags`. One rule differs
  from the editor, the owner's call the same day: in a plain box whose field lists `tags`
  (`plainText`'s `filtered`), an apostrophe is stored as typed. The editor's box writes `&#039;`,
  and H5P.Components 1.0.101 (upstream's newest) shows that as written, `Germany&#039;s`, on every
  H5P site; the content check filters such a field as markup, which keeps an apostrophe, so a site
  changes nothing. A `"` stays `&quot;`, since the editor puts a stored value back into its box as
  `value="…"` unescaped (`ns.createText`), where a bare one would cut the text short; `&`, `<` and
  `>` stay escaped, as the filter would escape them, and are noted, with "and" and “ ” as the way
  round. Umlauts, ß and every other letter are stored as typed everywhere: neither the editor nor
  the platforms escape them.
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
  any other type's fields are one `h5p-author schema` away. Where npm cannot install, SKILL.md
  names that command for the one-file tool with the type's bundle, `node h5p-author.mjs schema
  <Type> --libraries parts` (2026-11-12): given only the npx form, Haiku reading the skill by its
  link with no registry ran the tool without `--libraries` in 4 of 4 runs and met Node's "Cannot
  find package '@missing-elements/h5p-libraries'", and one of them gave the tool up and wrote a
  Crossword from memory; given the command, 4 of 4 had the fields at once and built a package
  the verifier passed (Crossword and Find the Words, two runs each).
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
  hands over the source and a link to a build page, `https://missing-elements.github.io/h5p/build/`,
  where the user's browser runs the page build (*A page builds too*), plays the package and
  downloads it.
  The link carries the source in its fragment, raw-deflated and base64url, which no server sees.
  The page lives on the organisation's own site, missing-elements/missing-elements.github.io, not
  in this repository's demo, and in that site's look. It was first on embed-my.github.io, since
  the owner wanted an authoring tool's domain without "H5P" in it, and moved on 2026-11-10, where
  the owner found it fits better (that repository's #7). The domain still has no "H5P" in it: the
  word is only in the path, under a domain that names its owner, as the trademark policy's
  approved h5p.terrisblog.com does. embed-my's `/build` redirects there with the fragment, so a
  link already written still builds. It builds from `@missing-elements/h5p-libraries/install` at the version
  the author package pins, so the page plays with the pack it built from. A chat with no tool to
  run at all, as ChatGPT on a free account once its data-analysis quota is spent (for hours, the
  owner's test of 2026-11-09), cannot write the link: the skill has it put the whole source in its
  reply, since that test's chat gave the page's bare address, which builds nothing. Since
  2026-11-14 a chat writes a page that makes the link, with or without a tool (*In a chat that
  built nothing, a page the chat writes makes the link*, below), and a source goes over in a
  `json` block only where it names files.
  A link is only what a command printed (2026-11-11). A link ChatGPT gave the owner carried 3,167
  characters that were no deflate stream, its table broken at byte 82 of 2,375: the chat had
  typed them itself, made up or copied wrong, and the page built nothing. So the skill says it
  outright: a link is what one of its two commands printed there, handed over whole, and where no
  command ran there is none. Haiku with the skill's text and no tool gave the source as a `json`
  block and no link under the old text and the new (12 replies, half of them asked for a link to
  click), so the rule costs that position nothing, and what it changes in ChatGPT is not
  measured. No rule reaches a link copied wrong between the command's output and the reply.
  An install that hangs is one that fails (2026-11-13): ChatGPT, asked why it had built nothing,
  said its `npx` had timed out, and step 3's list named only errors. Haiku in a terminal whose
  registry took each connection and never answered went on to the two files under the old text
  and the new, 2 of 2 runs each, and built, so the words are for a model that reads the list to
  the letter. An uploaded plugin is no way round the registry: a ChatGPT plugin that carried the
  one-file tool and the whole pack, 15.6 MB, uploaded, and its code's `find /` found no file of
  it, so the zips the organisation's site offers to install (missing-elements.github.io#40)
  carry the skill's text and files only. Nor is ChatGPT's own download tool, on the owner's free
  account the same day, asked step by step: its web tool opened the site's text, JSON and
  Markdown, `SKILL.md` whole, and refused the build tool, a bundle and a `.h5p` by their content
  type (`text/javascript`, `application/x-zip-compressed`, `application/octet-stream`), and its
  `container.download` saved none of eleven files, four from other sites among them, Simon
  Willison's own test file too, which he had downloaded with it in January 2026. So in ChatGPT
  the build page is the route, whatever type the site serves a file as.
- **A bundle per content type, where the pack cannot be installed** (2026-11-09, #166). The page
  leaves the last steps to the user, but ChatGPT's sandbox runs Node and fetches a file its
  browsing tool has opened: given the libraries as files, a chat builds and fixes its source
  itself. Grok's sandbox did so on 2026-11-13; ChatGPT's, on the owner's account that day, did not
  (*Where `npx` cannot install, a page builds*). The skill chooses the content type first, so the
  unit is the type. `bundleLibraries` is the build's own rules over the most a source of the type
  can name: the type and every library its library fields offer or give as their default, theirs in
  turn; `planPack` over all of them as roots, as `closure` in `build.mjs` plans one package;
  `installClosure` over what that plans. Both only ever add for more roots, so one source's
  libraries are within its type's bundle. `writeBundle` zips them as `parts/`, with
  `libraries.txt`, without which the parts are not handed
  on. The bundle carries the pack's whole index, not its own entries: a build from it plans as it
  would from the pack, so it writes the same package (the skill's 32 examples were built both ways
  and matched, but for the ids a build draws) or stops and names the part it lacks, where a cut-down
  index would build a source with math without its addon and say nothing. No addon is in a
  bundle: H5P.MathDisplay, 2.8 MB, joins wherever text holds math, and would more than double most
  bundles, so a source that calls for it fetches that one part. A bundle rather than the parts,
  since ChatGPT's download tool costs two calls a file, opened and then fetched: a Question Set's
  33 parts would be 66. With pack 1.1.0 a question type's is 0.6 to 1.5 MB, a Question Set's
  2.6 MB, a container's 4.3 to 8.4 MB, and the 55 content types' 99 MB in all, which is why a
  site serves them rather than the libraries package on jsDelivr, whose cap is 50 MB: since
  2026-11-10 missing-elements.github.io, under `/h5p/bundles/` beside the build page, and before
  that embed-my.github.io (embed-my/embed-my.github.io#14), whose `/bundles/` stays until the next
  pack release for copies of the skill installed earlier. The build tool beside them is the
  command line as one file, which the site's Vite bundles: 575 kB, and it builds from an unzipped
  bundle with nothing installed. Its `--version` read this package's `package.json` and the
  pack's as files, neither of them beside it, and crashed (found by ChatGPT's plugin creator,
  2026-11-13). Each version is now an import too, which the bundler writes into the file, about
  9 kB; the files are read first where the packages are installed, since Node before 22.12 warns
  on a JSON import, and a `package.json` above the one file that is not this package's is passed
  over.
- **A preview inside Claude is the desktop app's browser panel, not a card** (2026-11-10). A
  connector's card in Claude is an iframe under Claude's policy, measured that day in Claude
  Desktop 4.23118.1 with a probe server: it fetches from the hosts the server declares, grows to
  what it asks for, and played a one-document copy of a quiz (the core, the libraries and their
  files inline) 70 ms after its frame loaded, but it can register no worker, and Claude drops
  `frameDomains`, so neither the player's own page nor a YouTube frame opens in it, and a media
  file reaches it only dropped in by hand. Claude's desktop app has a browser panel at its side
  where the verifier's preview opens: a real browser, in which the player runs as it is, video
  included. The owner chose the panel, with media to come, and the card was not built.

- **A problem says what to write, and what is in the wrong place is checked all the same**
  (2026-11-10, #172). The owner gave the skill to Gemini in Chrome, which could not build a simple
  Interactive Book and quoted `params.chapters: has 0 items; it takes at least 1`. A chat there has
  the skill's text, no type file and nothing to run, so it learns a type's shape from the build's
  problems alone. Measured that way with the weakest Claude model, Haiku 5.5: SKILL.md's text, each
  reply built as the build page builds it, its problems pasted back in the page's words, up to four
  rounds; an Interactive Book, a Course Presentation, a Column, a Question Set and a Branching
  Scenario, three runs each, the same 15 first replies under each set of messages. With 0.6.0's
  messages 3 built at once, the Question Sets, 8 by the second round, 12 by the third, 13 by the
  fourth, and two scenarios never. What cost the rounds was a type's levels, not its fields:
  - Sub-content in the place of the group that holds it, `{ "library", "params" }` where a
    Column's item is `{ "content": { … } }`, a slide's element `{ "action": { … } }` and a
    scenario's node `{ "type": { … } }`: 9 of the 24 failed rounds, three or four problems an item,
    one of them a list of 35 libraries, none saying what to write.
  - A field a level above its group, `params.slides` for `params.presentation.slides`: the build
    said it was no field there and checked nothing of what was written in it, so the next round
    found what was wrong inside, an `<h1>` a slide's text does not take.
  - A book's chapters written as pages, `{ "title", "content": [ … ] }`, with no H5P.Column around
    them, in two of three books: "expected sub-content", and then "has 0 items", which the last
    check counted after the generator had refused the chapters and which was not so.
  - "expected sub-content, { "library": "H5P.BranchingQuestion" … }" for a field that takes seven
    libraries: the first read as the one to write, and a scenario's texts came back as questions.

  So the generator says each such thing once, by its path and with what to write there, then puts
  what was written where it belongs and checks it, naming what is wrong inside by where the source
  has it (`moved`, by which the build's last check names what it finds too). The one library a
  field takes is loaded whether or not a source names it, which is what reads a chapter without
  its Column as the Column's parameters. What the last check says of a list an item of which was
  refused is left out, the list being another than the one written (`shortened`). A field that
  takes several libraries names them all. A scenario's question with no alternatives is reported
  as that and not as a loop besides. And a problem's list of fields names those an author writes,
  the interface texts as one: a book's was 39 names long. With these messages the same first
  replies built 12 by the second round and all 15 by the third, and every package built under
  either set plays (h5p-verify). The first wording, "is sub-content, which goes in the field
  content here", did worse than the three problems it replaced: a Column's list and its items'
  field are both `content`, one run sent the same source again and one made the list an object.
  So the problem names the item and shows it whole, `write params.content[0] as { "content": … }`.
  Only an object or a list, a text, a number or a flag whose name one group below has, in a field
  an author writes that takes such a value, is taken to belong there; an interface text is none,
  since a question's text sent to a label of its name would build and read wrong. And an object
  goes to a group only where it writes one of the group's fields, not one of its interface texts:
  a Game Map's `map`, written for the picture, was first sent to `behaviour.map`, the map's labels
  and fog, a name and no more, and an object that holds only a group's `l10n` is no proof of it.
- **The package carries the skill's type files** (2026-11-10, #172). In the same measurement, what
  did most was no message: with the type files pasted back beside the first problems, the content
  type's and those of the libraries the source names, all 15 built by the second round, in two
  runs of the twelve that had failed. A chat with the skill has those files; one in a browser has
  the build page, which has the package and no skill. So `prepack` copies
  `skills/h5p-author/references/types/*.md` into the package, `references/types/<Type>.md`, each
  an export, for the page to hand over with a source's problems. They stay the skill's, at the
  repository's root where `npx skills add` looks, written by `sync:skill` as before; the copy is
  not in git, and `build.test.ts` holds it to the skill's files, file for file. Since #178 the
  skill's text travels with them, `SKILL.md` and `references/authoring.md`, each an export too:
  the Claude app, given a link to the skill on GitHub, answered that GitHub's rate limit kept it
  out, since GitHub limits anonymous requests per address and a chat app's are shared. The
  organisation's site serves the skill from the release its build page pins, at
  `https://missing-elements.github.io/h5p/skill/`, a page that writes out each file's full address,
  since a chat's fetch tool may open only addresses it has seen whole and `SKILL.md`'s relative
  links are not (missing-elements.github.io#15). Step 3 takes the build tool's and the bundles'
  addresses from that page (*The skill is installed, and its page lists what step 3 fetches*,
  below), not from raw.githubusercontent.com. Installing the skill is the way: nothing is fetched
  while the chat works.

  The same test on the 23 other content types the skill lists says how far each thing reaches:
  two runs each, 46 first replies, each built package checked against what its task asked for.
  16 were right at once. By the fourth round 35 were right under 0.6.0's messages and 36 under
  the new ones, which is no difference: there a weak model does not misplace what it knows, it
  does not know a type's names (`options`, `sequenceImages`, `questionnaireElements`) or its rules
  (the right answer first, a card a pair), and a problem gives it one level's names a round. 9
  and 7 packages built and were not what was asked, a question's feedback left out once no field
  took it. With the type files handed back, 42 were right by the second round and 43 by the third,
  and none stayed unbuilt; three had built at once and wrong, with no problem to hand a file back
  with, and one source named a type the pack has not, which no file answers until the next round
  names a real one. With the type's file before the first reply, one run of each of the 28 types,
  all 28 were right at once and play. So the messages are for a type's levels, and the type's file
  is what lets a weak model write any type: the page hands it back, the skill gives its address.
- **The skill says where a container holds its sub-content** (2026-11-10, #172). The one thing in
  SKILL.md that repeats a type file, for the chat that cannot read one. Its line on sub-content
  names the three commonest places: an item of H5P.Column's `content` is
  `{ "content": <sub-content> }`, a slide's element `{ "action": <sub-content> }` in
  `presentation.slides[].elements`, a book's chapter an H5P.Column. In the measurement above no
  first reply for a book, a page or slides built, 0 of 9; with that sentence in the skill's text
  all 9 built at once and play. A scenario, which it does not name, still took a round of
  problems, and so do the six other listed types that hold content (Accordion, Questionnaire,
  Interactive Video, Image Hotspots, Image Choice, Game Map): of 12 first replies 2 were right at
  once with the sentence and 2 without, the Accordions. The skill gives a chat that has its text
  and can open a link the type files' addresses too, on the organisation's site since #178.
- **A source's own fields do not hide its content, and its outer shape is taken as it is meant**
  (2026-11-10, #174). Gemini in Chrome, given a link to the skill's folder, which shows a chat the
  file names and none of the text, wrote a book its own way: `contentType` for `type`, and the
  title, licence and authors in a `metadata` object, as H5P keeps them. The build checked a
  source's own fields, then the type's name, then the content, and stopped at each: seven
  problems of the outer shape, then thirty of the content, and a package at the third try.
  Measured on Haiku in that position, the request as it was worded and no skill text, six content
  types, two runs each, the build page's copy pasted back: with 0.7.0 none was right at once, 3
  by the second round, 8 of 12 by the fourth, and four never. All twelve first sources had the
  content's fields beside `type` with no `params`, nine named the type as it is spoken of, and six
  of the nine second rounds were one problem, `the library pack has no content type
  interactive-book`, with no name offered: the next guesses were `book` and `flashcards`.

  So a build reads a source with the pack's names (`sourceOf`), and takes what can only be meant:
  the content type under `contentType` or `library`, or named loosely as `type`, the same letters
  and digits in any case with or without `H5P.` (`names.mjs`); the source's own fields in
  `metadata`, and in no other object, since Question Set's `introPage` has a title too; the
  content's fields beside `type`. Each is a problem, said once with what to write, and the content
  is generated and checked in the same build wherever the type is known, with a stand-in for what
  is missing. A name that is no type has the nearest offered: those its letters are part of, and
  those they end with, not one they begin with, since the "image" of "image choice" is no lead.
  A title is not tried, "Multiple Choice" or "Image Choice": the pack's index has none, and
  reading them means fetching every part, 147 of them and some 15 MB, to name one type. A number
  with no point is no version: "Question Set 2" is no Question Set. Sub-content that names its
  library under `type` or `contentType` is taken the same way, its parameters in `params` or
  beside the name, where one of the two names a library the field takes, at the major written
  where the field takes it, and the loader loads that library, so what is written for it is
  checked against its fields and not against none. No other key: in the 328 sources the tests
  stored, every name found under another one was a text that reads like one, a card's answer
  "table" six times, `main: "Question"` three times, `title` and `libraryTitle` "Text". A title beside the
  parameters that is no field of the library is the sub-content's own, its `metadata.title`, in a
  library field's place or in its group's, which had been two problems a chapter.

  With it 10 of the 12 were right by the second round and all 12 by the third, and every one
  plays. Of the 263 sources the earlier tests stored, written with the skill's text, 259 have the
  same problems, the other four being books whose chapters had a title beside them, 13 problems
  now 7, and none builds with one build and not the other; the 36 sources of the type
  files and the quiz format build the same package. `readSource` keeps its contract, a source's
  own problems thrown, without the pack's names. What the build page must do with it is its own:
  hand the type's file back for a type that is named loosely, which its rule, the source's `type`
  as written, does not. `sourceType(source, names)` is the build's reading of a source's type,
  exported for it (#176), so that the page hands over the type the build took and keeps no copy
  of the rule: on the 328 stored sources it names what `sourceOf` does in every one.
- **The skill is installed, and its page lists what step 3 fetches** (2026-11-10, #180;
  2026-11-13). An outside review of the skill, by a model given its link, found that `SKILL.md`
  gave such a chat addresses to put together: the brief as a relative link, a type's file as
  `…/h5p/build/types/<Type>.md`, a bundle as `…/h5p/bundles/<type>.zip`; its own fetch tool refused
  `…/bundles/H5P.Blanks.zip` put together from the last. `/h5p/skill/` wrote out the skill's files
  whole for this (*The package carries the skill's type files*, above), but `SKILL.md` never named
  it and it listed no bundle. So `SKILL.md` sends a chat that has its text alone to the page first,
  to take every address from it, and the page lists the build tool and every bundle too, named by
  the author package's `contentTypes`, the list `writeBundles` writes from
  (missing-elements.github.io#17). The patterns stay in step 3, for a chat whose tool takes them.
  Measured on Haiku in a stand-in for such a chat, a fetch tool that opens only addresses seen
  whole and npm cut off, asked for a three-question Question Set: with 0.9.0's text both runs were
  refused the brief, the type file and the bundle, chose an author and a licence the user had not
  given, which the brief they could not open says never to do, and ended with a build page link.
  With the new text all six opened the page, the brief and both type files, nothing refused; of
  the three given the build tool as it is served, two built from the bundle at once, packages that
  play, and the third reached npm and built with it. The first three had the tool swapped for a
  stand-in that logged its runs, and each refused to run it, as it should: a test serves the file
  as it is.
  On 2026-11-13 the owner dropped reading the skill by its link as a way to give it to a chat, and
  the organisation's site stopped offering it (missing-elements.github.io#42): no app tested
  needed it. Claude and ChatGPT take the skill as a zip, and Grok takes Claude's, under Skills,
  then Import; Gemini opens no address, and a chat whose only web tool is a search gets snippets.
  So `SKILL.md` no longer tells a chat with its text alone to open the page first. The page stays,
  and step 3 still takes the build tool's and the bundles' addresses from it: installed copies of
  the skill name it, and Grok, its `npx` timed out, built from those two files that day, the
  first app seen to. Measured on Haiku in the chat stand-in above, the user's message giving the
  page's address as the old prompt did, three runs each way: under either text all six opened the
  page, the brief and the type files, fetched the tool and the bundle, and built a package the
  verifier plays, since the page itself says to read `SKILL.md` first and lists every address.
  With the skill installed and npm cut off, both runs handed over the link and the source file,
  and one dropped two characters of the link while writing its reply, as ChatGPT had: the first
  time on Haiku, and the source file still builds.
- **A source's own fields are written where a chat reads, and the author is asked for**
  (2026-11-11, #182). The owner's run in ChatGPT on 0.9.1 wrote a quiz with no `authors`. Each
  of the 28 content types the skill lists refuses a source without `title`, `language`,
  `license` or `authors` (each built with `params` alone), and each type's own required fields
  are marked in its file's Fields section; but every type file's example is `type` and `params`,
  and since #180 a chat reads it. Of the four, only the author has nothing to fall back on: the
  language comes from the request, the licence is `U`. The owner's flow, the same day: the
  content type, chosen with the user; then the author and licence, asked once the type is chosen,
  which the user gives or skips, each on its own: a name they skip is the one the model knows
  them by, or "Unknown", a licence they skip `U`, what they gave stays, and never a name made
  up; then the source; then the build the environment allows best, said to the user. So
  `SKILL.md` names that order before step 1, step 1 asks for the type and then the author and
  licence, step 2's first point says every source names the four, step 3
  opens with the three ways to build and what each needs (npm here, two files here, the build
  page in the user's browser, with no attempt here first where nothing runs or fetches), and
  `schemaMarkdown` writes the same under each content type's Fields heading
  (`SOURCE_FIELDS`; not a part's, which is sub-content), for a chat that has the type file
  alone, as the build page hands it over. It says the example is `type` and `params` alone rather
  than the example holding the four: a name written in an example would be copied as the author
  and build, where the model is to ask. Measured on Haiku in the chat stand-in (a fetch tool
  that opens only whole addresses, npm cut off, a scripted user who answers when asked): with
  0.9.1's text and a Question Set named, two of three runs asked for the author, from the brief's
  list, and the third wrote "Quiz author" and built. With the flow, a quiz asked for and neither
  type nor author named: until step 1 said that "a quiz" names no type, four of six runs chose
  the Question Set themselves, three of them asking for the author in the same message; since,
  all four proposed two types and waited, then asked for the author and licence on their own,
  and wrote the name given or, on a skip, "Unknown" and `U`. Every package plays. The skip was
  first written for both at once ("a skip takes the name you know them by, or "Unknown", and
  the licence `U`"), which cubic's review of #183 read as replacing a name the user gave when
  they skip only the licence. Haiku did not read it so: three runs on that text (a name and no
  licence, a licence and no name, the author named in the request and the licence skipped) kept
  what was given. It is written out all the same, each on its own and only what is missing asked
  for, so that no reader has to guess: on the new text five of five runs (those three, both
  skipped, both given) wrote what was given and the default for what was skipped, and the run
  with the author named in the request asked for the licence alone. Those eight packages play
  too.
- **A text's own marks are said where a chat reads, and what a library cannot take apart is a
  problem** (2026-11-12, #187). Haiku with a shell and the skill built each of the 32 content
  types that need no media twice: 64 packages, all built, all passing the verifier with no
  warning, and four played wrong with no word from either. Two were Drag and Drop, which has no
  type file here. The other two were a text's marks:
  - Fill in the Blanks, asked for the answers 1/2, 10:30 and km/h: `*10:30*` is the answer 10
    with the tip 30 and `*km/h*` takes km or h, since a gap's first colon starts its tip and
    what is before it is split at every slash (`parseSolution`, H5P.Blanks 1.14).
  - Drag the Words with a colon in a gap's feedback: the feedback ends there, what follows is a
    second tip, and `lex` (H5P.DragText 1.10) takes a gap's tips out of its word with one
    `replace` of all of them, which with two takes out none: the learner drags
    "hablo:primera persona: termina en -o.".

  Measured where it costs most, Haiku as a chat with the skill's text and no tool, the type, the
  author and "licence CC BY 4.0" given, each reply built, played, and the library's own key
  (`getXAPIData`) held against what was asked for. With 0.9.3's text, of 30 first replies:
  - none wrote the licence's version in its own field: 27 wrote `"license": "CC BY 4.0"`, which
    the build refused with the list of names, and 3 wrote `CC BY` alone. `licenseVersion` was
    named in the brief only. Pasted back, the list of names had all 12 replies drop the version.
  - Fill in the Blanks: all 5 with `SKILL.md` alone wrote the answers as asked, and with the type
    file 2 of 5 wrote `*1\/2*`, an escape nothing reads, and the other 3 other answers than
    those asked for.
  - Drag the Words: 2 of 5 with the type file wrote a colon in feedback.

  What the library does take in an answer is an entity: `parseSolution` decodes each answer's
  entities, and `&#58;` holds no colon as the gap is split. Played, `*10&#58;30*`,
  `*km&#47;h*` and `*1&#47;2*` gave the key 10:30, km/h and 1/2, the four answers typed scored
  4 of 4, and "10" was wrong. In Drag the Words a word written `7&#58;45` is drawn 7:45 and
  scores, and feedback with `&#58;` shows a colon; the key in its xAPI statement keeps the
  entity as written. In Mark the Words neither character is a mark. So:
  - `SKILL.md` says a CC BY licence's version is a field of its own, `CC0 1.0` being one code
    as it stands (cubic's review), and says of a
    gap's `/` and `:` what they are and how an answer holds one; the two type files say it
    with their own examples. The version is in the sentence and not in the example: with it in
    the example, 3 of 7 replies gave a licence the user had named without a version one of 4.0,
    and without, none of 5.
  - A CC BY licence written with its version is a problem that names the licence it read and
    where the version goes (`sourceOf`), the SPDX spelling too.
  - A backslash before a slash or a colon in a gap's answers is a problem, the gap written out
    as the library takes it (`LAYOUTS['H5P.Blanks']`). An answer that is a backslash and no
    more is left alone.
  - A gap of Drag the Words whose tip or feedback pattern matches twice is a problem, with the
    word as the library would leave it (`LAYOUTS['H5P.DragText']`). A colon in the tip is
    none: the tip runs on over it. Nor is one after `\+` or `\-` with no tip before it,
    though it cuts the feedback there (cubic's review): `*habla\+Bien.:tercera persona*`
    plays with the feedback "Bien." and the tip "tercera persona", a tip written after the
    feedback, and a build cannot tell that from a colon meant for the feedback. The type file
    says feedback holds no colon.

  With them, of the first replies that wrote a source, in the same position: Fill in the Blanks
  took the three answers as asked in 23 of 23, with the type file or without; Drag the Words
  with its type file drew its words whole in 9 of 9, and without it in 9 of 12, the other three
  refused for a field of their own making or `distractors` written as a list, and none built
  and wrong; the version was in its own field in 47 of 47, and a licence skipped was `U` in 5 of
  5. Three Mark the Words kept a sentence with 10:30 and km/h in it word for word, its words
  marked as they stand; each was refused for the task description, which a chat without the
  type file does not know the type requires. Over the
  replies that had gone wrong, the build's problems pasted back in the build page's words: 8 of
  8 right in one round, the Blanks with the answers asked for, where the first wording, which
  told a chat to word the sentence another way, had two of four make two gaps of each answer.

  `*10:30*` as written is not refused: it is a tip to the library, may be one to its author,
  and a build cannot tell which. A note saying how each such gap was read, left to the chat,
  did nothing: of 5 replies two sent the same source again, one wrote `\:`, one look-alike
  characters, one asked. The type file handed back beside the licence's problem had 1 of 3
  write the entities. A problem in the build's form saying which gap its author did not mean,
  as a page could copy once they had looked, had 4 of 4; that page is not built. Run over the
  94 real packages of the owner's corpus and the demo, 53 of these two types in them with 266
  gaps, the two checks report nothing; over the 524 distinct sources these tests stored, 199 of
  the two types with 765 gaps, only the 14 known to play wrong. Not tried: a text edited afterwards in H5P's own editor, whose rich-text
  widget may write an entity back as its character.
- **The hand-over carries the source and one web address, the build page's link** (2026-11-12,
  #190; cut to one address the same evening, the owner's call). The owner wants people to try
  the skill and to hear from them. The build page asks how it went at its foot, by email first,
  since a teacher may have no GitHub account, or in a GitHub discussion; but a chat that builds
  the package itself hands it over in the chat, and its user sees that page only if the reply
  sends them there. So step 5 hands over, beside the package, the source as a file under the
  package's name with `.source.json`, which the page opens too, and the link step 3's command
  prints, which carries the source: where the user plays the package in any browser, changes the
  source and builds it again, and says how it went at the foot of the page. It is the reply's one
  web address.

  0.9.5 handed over a second line, printed by the same command under the link: `How did it go?
  Say so by email or on GitHub: https://missing-elements.github.io/h5p/build/#feedback-heading`.
  With it and the rest of step 5's list, a finished reply held two or three web addresses beside
  the package's files, the link, that line and the pack's `libraries.txt` on GitHub, and with them
  the preview command, three tools to go to next and, where the verifier ran, its report and
  revision. The owner found that too many links and kept the link alone: the libraries' licences
  stay a sentence, the preview command goes over only where there is no link, the screenshot
  without the report. The page keeps the id `feedback-heading`, whose address installed copies of
  0.9.5 print; that fragment has no `source`, so it builds nothing (`sourceFromFragment` reads
  `source` alone).

  Measured on Haiku in Claude Code's place (the skill, a shell, npm, the verifier left out), a
  three-question Question Set with the author and licence given. With 0.9.4's text, 2 of 3 runs
  handed the source over as a file, unasked, and none a link. With 0.9.5's, all 14 runs handed
  over the source file and a link that decodes to the source byte for byte, 1,230 to 1,460
  characters for three questions, and the feedback line, printed by the command, reached 5 of 5
  replies once step 5 said it goes in every case; as an item of step 5's list it had reached 3 of
  6, since a weak model shortens the list as it writes it out. With the one address, 3 of 3 runs
  handed over the source file and the link, exact, as the reply's only web address, and none the
  feedback line, the `libraries.txt` link, the next tools or the preview command; the replies ran
  2,250 to 2,737 characters, against 3,146 and 3,724. None of the three said to tell how it went
  at the page's foot: what step 5 asks a chat to write itself is what a weak model drops, so
  feedback on a package built in a chat now rests on its user scrolling the page.

  A link carries the text of a source and not the files it names (cubic's review): the page asks
  for those by name once it has the source, and a picture at a web address reaches it only where
  its host lets another site fetch it. So for a source that names a file, by any `path`, the
  commands print why there is no link instead (`No link: the source names files, which a link
  cannot carry.`), and in the build page's route such a source goes over whole, to be pasted, its
  files chosen on the page. It is decided by the source and not by its type: nearly every type
  takes media, Multiple Choice, Question Set, Column, a book and slides among them, and most
  sources name none. The source file goes over as before, the files it names said by name, since a
  build reads them beside it; they are not copied, a video being large. 0.9.5's commands printed
  the feedback line alone for such a source, since a reason printed above that line had cost the
  address in 3 of 3 runs; with no address left to lose, the reason is printed. With the
  one-address text, 2 of 2 runs with a picture gave no web address, and handed over the source
  file and the preview command, the one way left there to play it.

  Where nothing is built in the chat, step 3's build page route is the whole hand-over (cubic's
  review of #193): the link a command printed or, where none was, the whole source in a `json`
  block and the page's address, then the reply's one web address. Step 5 opens by saying so, and
  step 3's paragraph for that case names the address and holds only where nothing is built: read
  alone, step 5's list, which gives no other web address and the preview command where there is
  no link, would take the page's address from a chat that has only the source, and hand it a
  command for a package that does not exist. Haiku as a chat with no tools, the skill's text and
  the type's file pasted in, had done right before: 5 of 5 replies, three Question Sets and two
  Multiple Choice questions naming the user's picture, gave the source in one `json` block beside
  the page's address, no link and no preview command, and named the picture to choose on the
  page; with the change, 5 of 5 again. It is for a model that reads step 5's list to the letter.
  In Claude Code's place it changed nothing: 2 of 2 Question Sets handed over the exact link
  alone, and the picture run no address and the preview command.

  In that route the source goes over as a file too, where the chat can give one (2026-11-13).
  ChatGPT with the skill as a plugin ran the link command and wrote its output out itself: 2 of
  its 3 links broke, one with 43 characters of its own in place of 37 near its start, one at a
  length base64 never has, while the `.source.json` it gave built at once on the page, which
  since missing-elements.github.io#39 says a damaged link is damaged and offers to open that
  file. Haiku in a sandbox told it had no network and could give files handed the file over
  under the old text already, in 5 of 6 runs, as under the new; every link it gave was exact
  and the reply's one web address.

  Since 2026-11-14 a chat that built nothing hands the source over in a page that makes the
  link, and the link a command prints is for a reply read outside a chat and for a package built
  here (*In a chat that built nothing, a page the chat writes makes the link*, below).
- **Only the build tool writes the `.h5p`** (2026-11-13). ChatGPT, asked to prove it could make
  the file where it could not install the tool, zipped an `h5p.json` and a `content.json` it had
  written: no library in it, and the content wrapped in a `params` key. The verifier fails it
  for its missing libraries, and given the pack's it plays and draws "No question has been
  added". Gemini, given the skill as an uploaded skill, said it held no steps to put a package
  together. So the skill's opening says that only the tool writes one. With that sentence in a
  test plugin, ChatGPT answered that it had written no `.h5p` and made none up: one run each
  way. Haiku made none by hand under either text, 0 of 6 runs whose user asked for the file
  itself, so the weak model shows no gain. It shows where the sentence leads: told its sandbox
  had no network, 3 of 6 Haiku runs with it ran `npx` anyway, against 0 of 6 without, and built,
  since this computer's npm answered. With npm cut off, 5 of 6 handed over the exact link and
  the source file; the sixth, whose user wanted "not a link and not JSON", ended with the `npx`
  command for the user, as one run of the old text had.
- **Where nothing downloads, the person attaches the build archive** (2026-11-13, #200). ChatGPT's
  sandbox runs Node 22.16, but nothing reaches it from outside. npm goes through OpenAI's mirror,
  which fails or hangs. Its download tool saved none of eleven files on the owner's free account
  that day, from the organisation's site or any other. An installed plugin's files never reach
  its code. A file the person attaches does: the owner attached the one-file tool and a Question
  Set's libraries as a `.tar.gz`, with a prompt that named the commands, and ChatGPT built a
  Question Set that the verifier passes. The owner played it, and Claude and Grok built from the
  same archive. The same files as a `.zip` were refused, read as a plugin to install ("Plugin
  archive must contain …").

  So the organisation's site writes one archive for every type,
  `/h5p/bundles/h5p-author-build.tar.gz` (missing-elements.github.io#47), from the release it
  pins: the tool, every part of the pack with its index, and `libraries.txt`, laid out as a
  build from a bundle reads them. With pack 1.1.0 it is 14.9 MB, and the same bytes on every
  rebuild. Every type goes in one file, rather than the tool in each type's bundle, because the
  person downloads it before a type is chosen. A tool that still crashed on `--version` (#198)
  could send a model that checks it first off to the link, so the archive starts with 0.9.8.
  Nothing passes through a server of the organisation's this way either: the archive is the
  tool and the libraries, public already, and the chat's provider holds no more than the chat
  already gave it. That, with no MCP server, is what the guide and the plugin lead with, in the
  owner's words, privacy first.

  Step 3 builds from an attached archive first. Where Node runs and nothing installs or
  downloads, the build page's route carries one fixed line offering the archive. Measured on
  Haiku in a sandbox with no network:
  - **The archive attached:** 3 of 3 runs built from it under the old text and 3 of 3 under the
    new, and all six packages pass the verifier. So the route's words are for a model that needs
    the step written out, as ChatGPT's prompt wrote it out.
  - **No archive, the offer as a sentence:** 1 of 3 runs offered it with the exact address, as a
    last note that promised to verify too. One named the file without an address, and one said
    nothing.
  - **No archive, the offer as a line to copy as it is, right after the link:** 2 of 3 runs did
    so. The third left it out.
  - **Across both no-archive arms:** all six links were exact, and all six gave the source file.

  As with the feedback line before it, a weak model drops some of what it is asked to write. So
  the skill does not rest on the offer: the organisation's guide, not the skill, tells people
  using ChatGPT to attach the archive to the message where they ask
  (missing-elements.github.io#47).

  A source with media needs the network for them all the same: a `path` at a web address is
  downloaded as the package builds, which a sandbox that fetches nothing cannot do. So the archive
  route says that there a `path` names a file in the sandbox, such as one the person attached
  (cubic's review). A source that names files gets no link, so the offer's line follows the source
  where no link was printed. Neither change was run on Haiku: the six no-archive runs above named
  no file.

  **The archive kept in a ChatGPT Project builds too** (2026-11-14, the owner's free account). The
  owner put the archive into a Project and asked in a chat of it ("works in the gpt project, i
  attached tar file, file was created"): ChatGPT built a Question Set from it, 1.3 MB, which the
  verifier passes with no warning, run here on the file. So the organisation's guide tells people
  using ChatGPT to keep the archive in a Project and ask there (missing-elements.github.io#49), in
  place of an upload with every message, of which a free account has few a day. One run: a second
  chat of the same project was not tried. Python's index is closed there as npm's is: `pip download
  six` answered "from versions: none", so the archive as a PyPI package is no way in.

  **The verifier is asked for, not waited for** (the same run, #202). After that build ChatGPT ran
  step 4's `npx`, which cannot install there, waited until its tool gave up, and wrote "Unverified.
  The separate verification tool timed out". A build from the archive never tries npm, so nothing
  had told it that npm does not answer. Step 4's command now asks npm for the verifier's version
  first, `npm view … --fetch-timeout=10000 --fetch-retries=0 &&`, and runs the verifier only where
  it answers: against a registry that takes a connection and never answers, as that mirror does, it
  gives up after 10.5 seconds, measured. Haiku with the archive attached and such a registry, 2 of
  2: built from the archive, made one connection to the registry, and handed the package over
  unverified, with its files and the link its command printed. With npm working, 1 of 1 ran the
  verifier as before and handed over its pass.
- **In a chat that built nothing, a page the chat writes makes the link** (2026-11-14, #202). The
  link to the build page was the weak point of a chat that cannot build: compressed text that a
  command prints and the model copies into its reply. ChatGPT broke 2 of 3 on 2026-11-13 (*The
  hand-over carries the source and one web address*, above), and with its code tool unavailable, as
  on a free account for hours, no command runs and there is none. ChatGPT shows an `html` code
  block of a reply as a page, under Preview, on a free account too, at an address of its own
  (`https://codex-inline-visualization-<16 hex>.web-sandbox.oaiusercontent.com`). The owner opened
  two probe pages there, which ChatGPT was asked to give back as they were. A script in the page
  runs; `CompressionStream('deflate-raw')` deflates a source; a link the page writes opens the
  build page in a tab, with the right source, once ChatGPT has asked the user to allow it; a
  download from a `blob:` address saves. A module from jsDelivr loads, but `connect-src` refuses a
  fetch to the organisation's site and to jsDelivr, and `frame-src` refuses a frame on the build
  page. So such a page can make the link, and can neither build nor play: that would take the pack
  as scripts and a player without its worker.

  So where no package was built and the reply is read in a chat, step 3 has the chat write a page:
  the source in a `script` of type `application/json`, and a short fixed script that deflates it
  and writes the address into a link, *Build and play it*. Nothing compressed is typed or copied,
  no code tool is used, and the source is in the reply once. The reply tells the user to open the
  block with Preview and click the link, and, where their chat shows no Preview, to save the block
  as a file ending in `.html` and open it: the page makes the link from a `file:` address too,
  which is how the runs below opened it. A source that names files gets no page, as it gets no
  link: it goes over whole in a `json` block, its files chosen on the build page. The script calls
  its link `link`, since the preview's own scripts are reported to redefine `window.open` (Check
  Point Research, 2026-11-05).

  The words took six tries. Each was run on Haiku, two of them in ChatGPT on the owner's free
  account, and what each cost is why they read as they do:

  - **"Where no command runs here, a page you write makes the link, if the chat shows an `html`
    code block of yours as a page":** Haiku with no tools, 6 of 6. It left a chat whose code tool
    works printing the link by command, which is the chat that damages links.
  - **"Where the chat shows an `html` code block of yours as a page the user opens (a preview), a
    page you write makes the link, whether or not a command runs here":** Haiku with no tools, 3 of
    3. ChatGPT with it as a plugin gave a link a command had printed, a sound one that time, and
    asked afterwards, quoted the sentence back. A condition a model must judge about its own chat
    is one it passes over.
  - **"In a chat, hand the source over in a page that makes the link … Only where your reply is not
    read in a chat, as in a terminal, give a link instead":** no tools, 5 of 5, two of them told
    nothing of a Preview; a code tool with no network, 2 of 2. With npm working, the one run built
    and verified the package and then added the page to its reply, the source a second time.
  - **"Where no package was built here and your reply is read in a chat":** with npm working, the
    one run built with no page, and with no link either, and gave the preview command: the sentence
    that kept the link for a terminal had taken it from a package built in a chat.
  - **"A package built here is handed over as step 5 says, with the link a command prints and no
    page", and the link's sentence naming both its places:** no tools 1 of 1, a code tool with no
    network 1 of 1, and with npm working 1 of 1 with the package, the verifier's pass and the
    command's link, which decodes to the source file it delivered. ChatGPT with this text as a
    plugin tried npm and the two files, wrote the page, and Preview showed the link, which opened
    the build page with the right source. Its reply said to save the block as a file first and
    named Preview second.
  - **So the order is in the words, "first … only then":** no tools 2 of 2 and a code tool with no
    network 1 of 1, Preview first in each; and 2 of 2 sources naming the user's picture went over
    in a `json` block with the page's address and the picture named, with no page.

  Across the 31 Haiku replies, 24 wrote a page, and in all 24 the script was the one given, the
  link carried the page's source, and that source built a package the verifier passes with no
  warning: Question Sets in English and Ukrainian and Accordions with markup, links of 701 to 1,973
  characters. The other seven rightly wrote none: three built with npm, two from the archive, two
  named a picture. Haiku is a floor here, since it never damages a link: it shows that the words
  are followed, and what ChatGPT does with them is the owner's runs. Not measured: whether ChatGPT
  keeps the script as given for a long source (one run, whose link worked), and any other chat
  app's preview.
- **The skill names no product** (2026-11-12, the owner's call). Its routes were told apart by
  the apps they were measured in; they now say what each needs: a shell that reaches the npm
  registry, Node and a download where npm cannot install, or nothing that runs or fetches. What a
  name carried is kept as what an agent can observe: the registry's errors, a sandbox that
  downloads only what a browsing tool has opened, a code tool that can be unavailable for hours.
  This file keeps the apps' names where it records what was measured in them.

Not built: editing an existing package, which a tool beside it does with `checkContent` as its
check; layout for Drag and Drop and Crossword; and any judgement of whether content is right, which
stays the person's, in the verifier's preview.
