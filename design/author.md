# The author package

`@missing-elements/h5p-author` builds a playable package of any content type in the pack from a
source of only what an author would write: `{ type, title, language, license, authors, params }`,
`params` holding the fields that differ from their defaults. The owner's design (#100): the
content type is chosen with the user first, the h5p-author skill has a file per type so no agent
works out how a type is built, the skill is short, and one package covers the whole pack. A
source is 1,000 to 1,800 tokens where a `content.json` written by hand was about 3,500, after
reading 3,900 to 9,500 of a type's semantics. The first skill's quiz format is still a source the
build takes (`lib/quiz.mjs`). The skill runs the verifier once, trusted: the build already holds
text to the content check's rules, and `apps/skills` plays every example untrusted.

- **One generator, three ways to run it.** `ContentGenerator` runs `lenient` for the sweep
  (`apps/demo/scripts/lib/sweep-content.mjs`), keeping what its files write and filling every
  required field from samples; authoring, checking every written value as H5P's editor would let an
  author save it and reporting every problem with its path at once, so a fix is one round; and
  `saved` (*Saved content is checked as the build checks what it writes*). Authoring refuses a
  field the semantics do not name, an unknown option, a number out of range or with decimals the
  editor refuses, a list too short or long, a required field with no value or default, and
  sub-content of a library the field does not take. The editor is the rule (*The editor is
  pinned*): a new list starts with `defaultNum`, `min` or one item; a field its `showWhen` hides
  is not asked for, the rule's `../` climbing a level for each group and list as `findField`
  does; media are required where the semantics say so and optional where a type plays without
  them (H5P.Video's poster); a library default nobody opened, Interactive Video's summary task,
  is left as the editor leaves it.
- **Text is stored as the platforms store it.** A plain field is escaped as `htmlspecialchars`
  does, existing entities kept, and a tag in it is noted, since a learner sees it as written. A
  field the editor gives its rich-text widget (`widget: "html"`, or a ShowWhen that draws one) takes
  the markup the content check keeps for it (its tags, `div`, `span`, `p`, `br`, and what they
  imply), checked here rather than filtered later: any other tag, an event handler, a style the
  field does not allow, a script address, a comment, or a quote a tag leaves open, read as a
  browser reads its attributes, is a problem by name. The last is what a `>` inside an attribute
  makes: the content check ends the tag there, while a browser reads on and loses the text in
  between (#222). Plain text in such a field is wrapped as the widget wraps typing: in `<p>` where
  `enterMode` is `p` or the tags offer headings, `pre`, `p` or `div`, in `<div>` otherwise. Every
  plain default is escaped too, and a `null` default (Course Presentation's colours) is left out,
  which the content check would otherwise warn about. Every type file's example plays untrusted
  with no warning, which is the test of this.
- **`tags` say what the check keeps, the widget what an author writes.** `takesMarkup` is the
  rule, in the build, its messages and the type files. Five of Question Set 1.21's fields list
  `tags` but are plain boxes in the editor (`ns.Text`, which stores `htmlspecialchars(value)`):
  the intro title, the result message, the progress text and the two old greetings, the only text
  fields in the pack where the two disagree. The set draws the first two as `textContent`, so
  markup there showed as tags. Defaults still go by `tags`, since the editor puts a default in
  unescaped and the server filters it by `tags`; saved content is checked by `tags`, as the
  content check keeps it. One departure, the owner's call: in a plain box whose field lists `tags`,
  an apostrophe is stored as typed, since H5P.Components shows the editor's `&#039;` as written and
  the content check keeps an apostrophe there. A `"` stays `&quot;`, since the editor puts a stored
  value back into its box unescaped (`ns.createText`); `&`, `<` and `>` stay escaped and are
  noted. Letters are stored as typed everywhere.
- **Some types need what their editor widget does.** Course Presentation, Interactive Video, Game
  Map and Branching Scenario are edited on a slide, a video, a map and a tree, which set fields the
  form hides (`widget: "none"`). `lib/types.mjs` does each one's work on the generated content,
  wherever the type appears:
  - A slide's unplaced elements are stacked: text as tall as its lines as CP 1.27's stylesheet
    draws them (10.8 px per 640 in lines of 1.25em, `SLIDE_TEXT`), pictures shrunk in shape, a
    question in what is left, with a note when a slide holds too much. On a slide with room and no
    question, text is set larger, in steps up to twice, as large as fits with its pictures whole
    (#145). The size goes on each block, not a span inside, since CP gives a paragraph's lines in
    em and a span would inherit them as a length; it is written as the content check writes a
    style, so an untrusted play changes nothing. A size the source sets is kept.
  - Interactive Video's interactions are placed apart, clear of what shows at the same time, and
    named by their library; a poster is sized by what it holds, in IV's em (a 16:9 video is 40 by
    22.5): a picture in its shape, a text as wide as keeps it short, a question 17 by 16. The
    editor's 10 by 10 hid a question's Check button behind a scroll.
  - Stages get ids and types, neighbours named by label become indices both ways, and end screens
    are numbered.
  - It checks what those widgets would not let pass: a scenario node with no next, a link to no
    node, a loop no path leaves; a map with no start; a hotspot question with no right area; a
    hidden field nothing set. Lists such a widget draws start empty.

  All of it runs on content in the form H5P stores it, in `checkContent`, so it holds saved
  content too; only Game Map's `before` works on the source, turning its numbers and labels into
  the stored text.
- **Media are copied and described.** A file is `{ path }`, beside the source or an `http(s)`
  address downloaded at build time. It lands under `content/images|videos|audios|files/` with its
  MIME type, an image's size read from its header (PNG, JPEG, GIF, BMP; a JPEG's segments walked
  to its frame header, which a colour profile can push past 64 kB), and its copyright, on H5P's
  own list of types (no SVG, no WebP). A video's or a recording's container is read: an mp4 or an
  m4a by its index, after `ftyp` or, as in an older file, `moov`, `mdat`, `free` or `wide`, any
  other by its first bytes. One its field does
  not take is refused (a video takes MP4, WebM and Ogg; a recording MP3, M4A, WAV, Ogg and WebM):
  a web page at an address that ends `.mp4`, as a wiki's file page or a share link answers, built
  and passed the verifier before (#218). An mp4's index is read through the normalizer's
  `mp4Info`, the walk its faststart uses, in Node and on a page alike. No index to read is a
  problem. Where the index lists tracks, no sound or no picture is a note, a silent video being
  one an author can mean, and so is HEVC. Where it gives a length, that holds an Interactive
  Video's times (`videoTimes`): a start, a bookmark or an end screen past the end is refused, an
  interaction that ends past it is not, since it shows to the end. No time is named in a list
  where an item was refused, since the list's indices no longer match the source's. A download
  is given up after a minute with no byte, not after a fixed time. A YouTube, Vimeo, Panopto or
  Echo360 address stays an address, as the editor
  embeds it, and only where H5P.Video's own pattern for that host takes it, since an address none
  matches goes to its HTML5 player, which cannot play a page: a Short or a live stream is written
  as its video's watch address, and another form on those hosts is refused by name.
  `build.test.ts` holds each accepted form to the patterns in H5P.Video's scripts. A package with
  media goes through the normalizer's `normalizeArchive`, stored and laid out to stream. An addon
  whose pattern the text matches, H5P.MathDisplay for LaTeX, is carried as a site with it
  installed exports it.
- **A build that acts on what a model wrote can be confined** (#220, for the local MCP server of
  #219). The command line reads any path a source names and fetches any address, which is right
  for a person's own command.
  - `within` is a list of the folders the output and every local file a source names must be in,
    judged on real paths, so `..` and a link out are refused; one folder given as a string is
    refused, since it would be read letter by letter. It is judged before the file is looked for,
    and a confined build's problems name no path but the one written, so a model cannot map the
    disk around the folders or read the user's name in a path. A file the build cannot read is a
    problem of the source's, found where the file is looked for.
  - `check` (`build --check`) runs a build's checks, `checkContent` being `composePackage`'s, and
    writes no package; a media file named by web address is still downloaded, to a temporary
    folder removed after, and a video on the four hosts stays an address.
  - `publicFetch`, passed as `fetch`, refuses every network that is not the public internet on
    every hop, through `net.BlockList`, which matches an IPv4 address however IPv6 writes it
    (`[::ffff:7f00:1]` is loopback). The local IPv4 ranges are refused behind NAT64 and 6to4 too,
    and so are the IPv6 ranges no web host is on. A name that does not resolve gets the words a
    local one gets, so a refusal does not tell which names a local network has. A redirect to
    another origin drops `Authorization`, `Proxy-Authorization` and `Cookie`, and the signal stops
    a lookup.
  - Limits: it resolves a name and then asks, so it guards against a model's mistake or a planted
    address, not a hostile network; and `within` is no guard against another process swapping a
    path for a link between the check and the use, since Node has no directory handles.
- **The outline is the content for a review, read through the semantics** (#220). Every result has
  `outline`, made when it is first read. `outlineOf(libraries, content)` takes its arguments as
  `checkContent` does, refuses them the other way round, and cuts at a `limit` only where one is
  given. It writes the text fields a learner reads that hold more than their default, which in
  loaded semantics is the content language's, so interface texts drop out in any language; a rich
  text's blocks apart by ` / `, a tag inside a word taken out with nothing in its place
  (`H<sub>2</sub>O`); a ✓ on a `correct` item, a `correct` select's answer, a score range before
  its feedback. Settings are left out, and with them a group or a list the editor does not draw
  and a text no label names, which a widget of the type's own sets (found by a scan of the pack).
  What a few types say only by position or number is one table, `TYPES`: Single Choice Set's and
  Summary's first item is the right one; slides, chapters, questions and a scenario's content are
  numbered; a question title the build gave (`questionTitle`) is not written; a scenario's links
  name those numbers; an Interactive Video's interactions and bookmarks start with their times.
  The tags a text holds are taken out by `stripTags` in `text.mjs`, one function for the
  generator, the layouts, `schema` and the outline, reading markup in the content check's pieces
  (`PIECE`): a tag runs from a `<` before a letter, `/` or `!` to the first `>`, and each becomes a
  space, never nothing, as CodeQL asks of a tag remover. The outline splits rich text at its tags
  (`tagsIn`) and plain text at its line breaks before it reads entities, so no encoded text can pass
  for a break.
- **The pack is pinned.** The dependency is `workspace:*`, published as the exact version
  packages/libraries has, so a release builds with the libraries it was tested with and one command
  needs no project set up; `--libraries` names another `parts/` folder. Each part is checked against
  the index's SHA-256 before it is read. `prepublishOnly` refuses while that version is not on npm
  with this checkout's index (`scripts/check-pack-published.mjs`, which checks the player it pins
  and the normalizer's `./crc32` too).
- **The player's library rules, not copies of them** (#106, the owner's rule: reuse what another
  package has). Which libraries content names, an addon's patterns and which parts of the pack a
  package needs are the player's: the build plans with `planPack` from the player's `./plan`. Two
  things stay here: a check that every library the content and the parts name was planned, since
  the plan leaves a gap without a word; and the order, depth first from the content type, which
  `h5p.json` and the zip's folders follow, because the runtime keeps that order between libraries
  that do not depend on each other and so decides whose stylesheet comes later (`build.test.ts`
  holds it). `./plan` is not covered by docs/compatibility.md, so the player is pinned exactly and
  published first, and `check-pack-published.mjs` refuses to publish until it is on npm and exports
  `./plan`. A tool beside the build takes what the build loads (`openPack`, `loadLibraries`), its
  text rules and `checkContent`. The runtime's library-name parser, content check and content
  upgrade stay out: they are GPL-3.0-only.
- **Saved content is checked as the build checks what it writes** (#107). `checkContent` runs the
  generator `saved`, for a tool that changes a saved package: files and metadata taken as saved
  and held to what the platforms keep of them (H5PContentValidator's `_validateFilelike` and
  `validateLibrary`, and the licences the core's copyright dialog looks up, `lib/metadata.mjs`);
  each part's `subContentId` kept unless H5P would not keep it or an earlier part has it, since the
  core names a part's statements by it and an LRS would otherwise count every question as new; a
  markup field's text not wrapped again. Then the layouts' `after`, the titles and the hidden
  fields nothing set. The build runs it last, on what it writes, and adds what it finds except
  where the source has that problem already or the generator refused what was written there, so
  the two hold content to one set of rules. The semantics are the package's own where it carries a
  library's major (`packageLibraries`, over the player's `ownLibraries`), the pack's otherwise; a
  field only another minor has is noted and kept, since the player upgrades content as it plays.
  Content written without its defaults comes back with them, as the editor saves it. Three things
  the editor saves for an author who never touched them are taken as such: an optional group
  holding nothing an author has to write, empty texts included; the item an optional list starts
  with; an optional select at its empty choice. A group that is sub-content gets an id in a build
  too, as the editor's `initSubContent` gives one, since Summary names a statement's statements by
  it. Of the owner's 88 real packages, 61 report nothing; the others hold what their editor let an
  author save, such as an empty alt text or styles pasted from Word.
- **A package reads back into a source, by the generator's own rules walked back** (#236, step 3
  of #219). `readPackage` and `h5p-author read` write the source a build would take to make the
  package again, its media beside it at the paths the source names them by.
  - Its own fields are `h5p.json`'s; a package with no author reads as "Unknown". `params` are
    `content.json` as `checkContent` returns it, less what a build fills in, worked out by
    `ContentGenerator.written`: of each field, what the generator writes there with nothing
    written, at the field's own level with the saved values beside it taken as written, so a
    `showWhen` reads them as it reads a source. The libraries are loaded in the content's
    language, so an interface text equal to its translation drops out as any default does.
  - Left out besides: a part's id, and its metadata but its title; a title the build gives, its
    content type's or Question Set's own (the layout's `read`); and what H5P's editor saves for an
    author who never touched it, as `checkContent` takes it: an empty text or choice, a list it
    started whose items are only an item's defaults (Interactive Video's text track with no file),
    and a default's content nobody opened (its summary task). Markup that is only the blocks a
    build wraps typing in is written as the typing (`unwrapText`, held by `wrapText`); Game Map's
    neighbours go back to numbers. Positions and sizes are kept as written.
  - The source is then built in memory, the package's files standing for themselves, and held to
    the content as checked: a text, a number, a flag or a title that comes back otherwise is
    written as stored, anything else is a note, and so is what a build of it would refuse.
  - Only content for the pack's major.minor of every library it names is read; any other is
    refused with both versions named, since moving it is the library's own upgrade, the runtime's
    (GPL). Of the owner's 88 real packages, 58 were refused so, mostly Interactive Video 1.27 and
    Course Presentation 1.25 and 1.26. Of the other 30, 27 build as read; 3 need what their notes
    name: pictures missing from the package, styles pasted from Word, and a question with one
    answer.
  - What a source has no field for is said and left out: the author's comments, the change log,
    the licence's extra terms, and a part's own licence or authors, a build giving every part the
    source's.
  - An archive is untrusted: only the media the content names are written, under the folder, each
    path checked before anything is made, so that a link in the folder leading out of it stops the
    read; a file named by a path that could lead out is left out of the source, which so names no
    file outside its folder; one whose entry leads out of its folders is not read. Nothing is
    written over, and nothing at all where a name is taken; a read that fails takes away what it
    made. Every type file's example, built, read and built again, is the same content and media
    but for the ids, with no note (`read.test.ts`).
- **A page builds too** (#108). The package has three entries: `.` for Node, `./core` for what
  needs neither Node nor a page, and `./browser`, the core and a page's `openPack` and
  `buildPackage`. They are subpaths and not the `browser` condition, which TypeScript ignores
  unless a project sets `customConditions`. One build: everything but where the pack's bytes, a
  source's files and the package are is `build.mjs`'s, and `node.mjs` is the only module that
  imports `node:`, which `page.test.ts` holds the entries' imports to.
  - **A part is read whole and hashed with `crypto.subtle`, in Node too.** SHA-256 needs every
    byte, `crypto.subtle.digest` takes no stream, and ranges fetched after the check would be
    bytes nobody checked.
  - **What a page names the pack by.** The `pack` export as the page's bundler emitted it, or the
    address of a copy of `parts/`, whose `index.json` is held to the player's shape by
    `packLibrariesIn` from `./plan`; http(s) only, as the player reads a copy.
  - **Media are given as `File`s, by the names the source gives them, and stored with their sizes
    and CRC in their local headers**, so the player reads each one's size off its header on a
    host without `Range`. The CRC is the normalizer's, through `./crc32`. An mp4 is not moved to
    start in a page: that is the normalizer's, in Node.

  A page needs a secure context for `crypto.subtle` and `crypto.randomUUID`, and fetches media
  named by web address under CORS, which most image hosts refuse; the build says which where it
  can. `page.test.ts` holds the page's build to Node's file for file, and the Chromium test plays
  what a page built through the verifier, untrusted, with no warning.
- **The skill's type files are partly generated.** `skills/h5p-author/references/types/<Type>.md`
  holds hand-written notes, an example, and the type's fields between two markers, written by
  `schemaOf(…, { markdown: true })`: names, kinds, defaults, options, list sizes, a markup field's
  tags, the sub-content the pack has, the editor's `important` syntax, `showWhen` conditions;
  interface texts and the fields a layout sets are left out. The weekly pack refresh runs
  `sync:skill`, and `apps/skills`' test fails on a file out of date and builds and plays every
  example. 28 content types have files, and so do the parts other content holds (Text,
  AdvancedText, Image, Video); any other type's fields are one `h5p-author schema` away. Where
  npm cannot install, `SKILL.md` names the one-file tool's command, `node h5p-author.mjs schema
  <Type> --libraries parts`: given only the `npx` form, Haiku ran the tool without `--libraries`
  and failed.
- **The editor is pinned, and not watched** (the owner's choice, as for the content check).
  Nothing the editor does decides whether a package plays: the libraries and the platforms'
  validator do, both pinned here too. A change in a library reaches the author with the weekly
  pack refresh, which runs the author's tests and `apps/skills`' against the new pack, so a renamed
  field, a new required one or a new hidden one fails there by name. The rules were read from
  h5p-editor-php-library at 3bec259 and H5PEditor.ShowWhen 1.0.9; the layouts' from the editors
  the pack's types name in `editorDependencies`, at the newest release of the minor named:
  H5PEditor.InteractiveVideo 1.26.3, H5PEditor.BranchingScenario 1.5.13 and H5PEditor.GameMap
  1.2.5. `generator.mjs` and `types.mjs` name the commits, where they depart from the editor, and
  each rule's script. To move to a newer editor: diff those scripts between the pinned version and
  the new one, port what changed, move the commits named in the two files, and run the author's
  tests and `apps/skills`'. One departure (#162): a multiple of a fractional step is taken within a
  rounding error, where the editor's `%` refuses 0.3 in steps of 0.1. Two more (#242), for what
  H5P.com's own editor writes, H5P's content check keeps and the library plays: H5P.Row's column
  widths take two decimals, and a row's column may be left empty, a spacer (a layout's `decimals`
  and `optional`); the owner's package from H5P.com builds again after a read.
- **A package installs on an H5P site** (#146). H5P core's upload check wants every library a
  package carries to have its preloaded, dynamic and editor dependencies with it at the exact
  major.minor, or installed on the site; a fresh Moodle refused 28 of 32 examples without them (see
  *The pack carries what an H5P site's upload check wants* in libraries.md). The owner's call:
  always carry them. `lib/install.mjs` walks from the selected parts over the pack's index at
  exact versions (`installClosure`), and `writePackage` writes them after the content and the
  media, where nothing reads them as the package plays; `h5p.json` lists what plays, as the
  platforms' exports do. A package with media then goes through the normalizer told to write that
  run last (`last`, #148), so a host without `Range` boots before it arrives. A Question Set gains
  123 kB; the containers gain most, since their editors preload every type they can hold
  (Interactive Video 2.4 to 5.1 MB, Course Presentation 1.2 to 4.8). `missingForInstall` is the
  rule as a check. In Node the pack is read from `parts/index.json`, which names the
  `installOnly` parts the `pack` export leaves out; a page gives
  `@missing-elements/h5p-libraries/install`'s, and a build from a pack without them is refused,
  naming the first library and where the full pack is.
- **A build says the H5P core a site needs** (#245). The upload check also refuses a package if
  a library in it asks for a newer `coreApi` than the site's core, and its message names that
  library. With pack 1.1.0, 50 of the 57 runnable libraries need 1.28: 31 ask for it themselves,
  and the rest carry a library that does, such as H5P.JoubelUI 1.3 or H5P.Question 1.5. As checked
  on 2026-11-19, Moodle has 1.28 from 4.5.11, 5.0.7 and 5.1.4 (2026-04-16), and the WordPress
  plugin from 1.17. `coreApiOf` takes the newest over the parts a package carries. A build from
  the command line (not `build --check`, which writes no package) and `h5p_build` print
  `coreApiLine`, which names those releases for 1.28 and only the version for any other.
- **Where `npx` cannot install, a page builds.** ChatGPT's sandbox reaches npm only through
  OpenAI's mirror, which refuses or hangs, and nothing in the skill can fix that. So the skill
  hands over the source for the build page, `https://missing-elements.github.io/h5p/build/`,
  where the user's browser builds the package (*A page builds too*), plays it and downloads it.
  The page lives on the organisation's own site, not in this repository's demo: a domain that
  names its owner, with "H5P" only in the path, as the trademark policy allows. embed-my's
  `/build` redirects there. It builds from `@missing-elements/h5p-libraries/install` at the
  version the author package pins. It still reads a `#source=` link, which installed copies of
  the skill up to 0.10.2 print. An install that hangs counts as one that fails. Neither an
  uploaded plugin nor ChatGPT's download tool is a way round the registry: a plugin's files never
  reach its code, and the tool refused the build tool and the bundles by content type.
- **A bundle per content type, where the pack cannot be installed** (#166). The skill chooses
  the content type first, so the unit is the type. `bundleLibraries` is the build's own rules over
  the most a source of the type can name: the type and every library its library fields offer or
  default to, theirs in turn; `planPack` over all of them; `installClosure` over that. Both only
  add for more roots, so one source's libraries are within its type's bundle. `writeBundle` zips
  them as `parts/` with `libraries.txt`. A bundle carries the pack's whole index, so a build from
  it plans as from the pack and writes the same package, or names the part it lacks. No addon is
  in a bundle: H5P.MathDisplay, 2.8 MB, is fetched where text holds math. With pack 1.1.0 a
  question type's bundle is 0.6 to 1.5 MB, a Question Set's 2.6, a container's 4.3 to 8.4, and
  the 55 types' 99 MB in all, more than jsDelivr's 50 MB cap, so the organisation's site serves
  them at `/h5p/bundles/`. The build tool beside them is the command line as one file, 756 kB,
  which builds from an unzipped bundle with nothing installed. Its version is an import the
  bundler writes into the file; where the packages are installed their `package.json` files are
  read first, since Node before 22.12 warns on a JSON import, and a `package.json` above the one
  file that is not this package's is passed over.
- **This package builds the one-file tool, and the site serves it as shipped** (#247). `prepack`
  runs `scripts/build-tool.mjs`. It bundles the command line and everything it imports with Vite
  into `dist/h5p-author.mjs`, writes `dist/h5p-author-LICENSES.txt` beside it, and checks that its
  `--version` names this package's and its pack's. Both are exported by those paths. The site's
  own Vite has built the file so far, so the site's build tools and their updates are in the path
  of every byte route 3 runs, and nothing published covers them. From the first release that ships
  the two files, the site's pin copies them instead, and the npm package covers them, with its
  provenance once publishing moves to CI (#246). Packing runs Vite 8 and needs the workspace's
  Node, 22.12 or later, and says so on an older one; the package's `engines` stays `>=22`, since
  installing it runs none of this. The skill names no hash of the file: checking one would add a command to
  every run of route 3, and copies of the skill installed earlier would stop at each release.
- **A preview inside Claude is the desktop app's browser panel, not a card.** A connector's card
  in Claude is an iframe under Claude's policy: it can register no worker, and Claude drops
  `frameDomains`, so neither the player's page nor a YouTube frame opens in it. The desktop app's
  browser panel is a real browser, where the verifier's preview runs as it is. The owner chose the
  panel, and the card was not built.
- **A problem says what to write, and what is in the wrong place is checked all the same** (#172).
  A chat with the skill's text alone learns a type's shape from the build's problems, and what
  costs it rounds is a type's levels: sub-content in the place of the group that holds it, a field
  a level above its group, a book's chapter with no H5P.Column around it. So the generator says
  each such thing once, by its path and with what to write there, shown whole (`write
  params.content[0] as { "content": … }`); then puts what was written where it belongs and checks
  it, naming what is wrong inside by where the source has it (`moved`). The one library a field
  takes is loaded whether or not a source names it. What the last check says of a list with a
  refused item is left out (`shortened`). A field that takes several libraries names them all, a
  scenario question with no alternatives is reported as that and not as a loop too, and a list of
  fields names those an author writes, the interface texts as one. Only an object or a list, a
  text, a number or a flag whose name one group below has, in a field an author writes that takes
  such a value, is taken to belong there; an interface text never is, and an object goes to a
  group only where it writes one of the group's fields (a Game Map's `map` is not `behaviour.map`).
- **The package carries the skill's type files** (#172, #178). With its type file handed back
  beside the first problems, a weak model writes any type right by the second round, and the
  build page, which has the package and no skill, can hand it back. So `prepack` copies all of the
  skill's `references/` (`types/`, `build/`, `authoring.md`, `change.md`) and `SKILL.md` into the
  package, each an export. They stay the skill's at the repository's root, where `npx skills add`
  looks; the copy is not in git, and `build.test.ts` holds it to the skill file for file.
- **The skill says where a container holds its sub-content.** The one thing in `SKILL.md` that
  repeats a type file, for a chat that cannot read one: an item of H5P.Column's `content` is
  `{ "content": <sub-content> }`, a slide's element is `{ "action": <sub-content> }` in
  `presentation.slides[].elements`, and a book's chapter is an H5P.Column. Without it no first
  reply for a book, a page or slides built (0 of 9); with it all 9 did.
- **A source's own fields do not hide its content, and its outer shape is taken as it is meant**
  (#174). A build reads a source with the pack's names (`sourceOf`) and takes what can only be
  meant: the content type under `contentType` or `library`, or named loosely as `type`, the same
  letters and digits in any case with or without `H5P.` (`names.mjs`); the source's own fields in
  `metadata`, and in no other object, since Question Set's `introPage` has a title too; the
  content's fields beside `type`. Each is a problem said once with what to write, and the content
  is still generated and checked in the same build, with a stand-in for what is missing. A name
  that is no type has the nearest offered: those its letters are part of, and those they end
  with, not those they begin with. A title ("Multiple Choice") is not tried, since the pack's
  index has none and reading them means fetching every part. Sub-content that names its library
  under `type` or `contentType` is taken the same way, and the loader loads that library, so what
  is written for it is checked against its fields. A title beside the parameters that is no field
  of the library is the sub-content's `metadata.title`. `readSource` keeps its contract.
  `sourceType(source, names)` is exported (#176) so the build page hands back the type the build
  took and keeps no copy of the rule.
- **A source's own fields are declared once, as `sourceSchema`** (#230). `sourceOf` takes the list
  of fields from it, holds each field to it and says its message where the field was written; it is
  the `Source` type, it takes no other field, as a build does not, and it is exported so that a
  model can be shown the shape before writing a source, as the MCP server shows it for
  `h5p_build`'s source. What one field cannot say alone stays in `sourceOf`: the content type
  named loosely, a licence written with its version, a version for a licence that takes none, and
  fields in the wrong place. Every problem of an author is said at once, and an author written as
  a name alone is said with the object to write. It is zod/mini, 23 kB minified, since a build
  runs in a page too, where zod's chained API takes 93 kB; JSON Schema is made where it is shown.
- **The skill is installed, and its page lists what step 3 fetches.** A chat with a place for
  skills or plugins installs the skill from a zip, and one with neither reads the zip attached to a
  message; reading it by its link was dropped (missing-elements.github.io#42). Since the 0.10.0 pin the organisation's site serves the
  skill only as zips (missing-elements.github.io#52). Its page at `/h5p/skill/` lists the build
  tool and every bundle at full address, by the author package's `contentTypes`, because route 3
  (`references/build/two-files.md`) fetches "at the addresses
  `https://missing-elements.github.io/h5p/skill/` lists": a fetch tool that opens only addresses it
  has seen whole refuses one put together from a pattern. So the page must keep the bundles.
  Copies at 0.9.7 or older, which read the skill's text from that page, find no file there now.
- **The organisation's guide goes by what a chat has, not by its name**
  (missing-elements.github.io#80): a place for skills, plugins, projects, code that runs. What one
  chat does changes within weeks, as Grok's place for skills did in two days, so no page says what
  a product does or lacks, and each step says what to do with a thing and without it. The skill's
  routes already go by what its sandbox can do.
- **A text's own marks are said where a chat reads, and what a library cannot take apart is a
  problem** (#187). In Fill in the Blanks a gap's first colon starts its tip and what is before it
  is split at every slash (`parseSolution`, H5P.Blanks 1.14), so `*10:30*` is the answer 10 with
  the tip 30 and `*km/h*` takes km or h. In Drag the Words `lex` (H5P.DragText 1.10) takes a gap's
  tips out with one `replace` of them all, which with two takes out none. Both libraries decode an
  answer's entities, so `*10&#58;30*` and `*km&#47;h*` play as written. So:
  - `SKILL.md` says what a gap's `/` and `:` are and how an answer holds one, and that a CC BY
    licence's version is a field of its own (`CC0 1.0` is one code); the two type files say it with
    their own examples.
  - A CC BY licence written with its version is a problem that names where the version goes.
  - A backslash before a slash or a colon in a gap's answers is a problem, the gap written out as
    the library takes it (`LAYOUTS['H5P.Blanks']`); an answer that is a backslash alone is left.
  - A gap of Drag the Words whose tip or feedback pattern matches twice is a problem, with the
    word as the library would leave it (`LAYOUTS['H5P.DragText']`). A colon in the tip is none, and
    nor is one after `\+` or `\-` with no tip before it, which a build cannot tell from a colon
    meant for the feedback; the type file says feedback holds no colon.

  `*10:30*` as written is not refused: it is a tip to the library and may be one to its author.
  Over the 94 real packages of the owner's corpus and the demo, the two checks report nothing.
- **What builds and is almost surely a mistake is a note** (#241, item 4 of #219). H5P allows
  each, so none is a problem, and nothing is judged: no answer marked correct (Multiple Choice's
  answers, Multimedia Choice's options; Find the Hotspot's areas are refused already), two
  answers or statements alike as a learner reads them, without tags or entities and in any case
  (Multiple Choice, a Single Choice Set question, a Summary set), a text with no gap (Fill in the
  Blanks, Drag the Words, Mark the Words), and a picture with no alt text where its field is
  optional (`ALT_TEXTS`, held to the pack's fields by `build.test.ts`; H5P.Image's is required).
  Each says what to write. `lib/mistakes.mjs` runs in `checkContent`, so a build says them and so
  does a check of saved content, and every type file's example says none. Of the owner's 88 real
  packages, the 79 checked against their own libraries give 36 notes of a picture with no alt
  text in 8 packages, and 4 of answers alike in one, a test whose answers all read "Test"; no
  question with no answer marked correct, and no text with no gap.
- **The hand-over carries the source and one web address, the build page's plain one** (#190,
  #215, the owner's calls). Beside the package, the hand-over gives the source as a file named
  after the package with `.source.json`, and one fixed line saying to open that file on the build
  page under "Or open a file" and press Build: there the user plays the package in any browser,
  changes the source, builds it again, and says how it went at the foot of the page. The page's
  plain address in that line is the reply's one web address. No link carries the source: a model
  that copies one into its reply loses characters (Grok, ChatGPT and Haiku all did), and one wrong
  character leaves the page nothing to build. A weak model drops what it is asked to write itself,
  so the line is fixed text to copy, not an item in a list. A source that names files is asked for
  them on the page.
- **Only the build tool writes the `.h5p`.** The skill's opening says so: a chat that could not
  install the tool zipped an `h5p.json` and a `content.json` it had written, with no library in it.
- **Where nothing downloads, the person attaches the build archive** (#200). ChatGPT's sandbox
  runs Node, but nothing reaches it from outside except a file the person attaches. So the
  organisation's site writes one archive for every type, `/h5p/bundles/h5p-author-build.tar.gz`
  (missing-elements.github.io#47): the tool, every part of the pack with its index, and
  `libraries.txt`, laid out as a build from a bundle reads them, 14.9 MB with pack 1.1.0 and the
  same bytes on every rebuild. One file for every type, because the person downloads it before a
  type is chosen; a `.tar.gz`, because ChatGPT reads an attached `.zip` as a plugin. Nothing passes
  through a server of the organisation's this way, which is what the guide leads with: privacy
  first. Step 3 builds from an attached archive first. The offer of the archive
  is one fixed line in the route, but a weak model drops some of what it is asked to write, so the
  organisation's guide, not the skill, tells people whose chat hands over the source to attach it,
  or to keep it in a project where the chat has projects (missing-elements.github.io#49, #80).
  There a `path` names a file in the sandbox, since a web address cannot be downloaded.
  - **The archive kept in a chat's project builds too**, without an upload per message: seen in a
    ChatGPT Project, and in no other chat's yet.
  - **The verifier is asked for, not waited for** (#202). Step 4 asks npm for the verifier's
    version first (`npm view … --fetch-timeout=10000 --fetch-retries=0 &&`) and runs it only
    where npm answers: against a registry that never answers, it gives up after 10.5 seconds.
- **Each build route is a file of its own, every fact is written once, and one question at most
  is asked** (#204, the owner's calls). `SKILL.md` is the flow:
  - The content type, the one question the user is asked. The author and the licence are not
    asked: what the user gave stays, a name not given is the one the model knows them by or
    "Unknown", a licence not given is `U`, and the reply says which. That rule and the licence
    codes are written once, in `SOURCE_FIELDS`, under every content type's fields, since every
    chat reads its type's file before it writes a source. Only the six CC BY codes take a
    version, and a licence no code stands for, such as MIT, is `U`. A type file's example is
    `type` and `params` alone, since a name in an example is copied as the author.
  - The source, written by the brief, which keeps what the model chooses and says it chose (the
    material, who it is for, the size, the language) and asks nothing.
  - Step 3 finds one answer once, used by the route and the verifier: whether npm reaches its
    registry. With no code tool it does not; otherwise `npm view … --fetch-timeout=10000
    --fetch-retries=0` answers, run beside the first file reads. Then the first route that holds:
    the build archive attached (route 1, `references/build/archive.md`), npm (route 2, `npm.md`),
    Node (route 3, `two-files.md`), anything else (route 4, `browser.md`). Routes 1 to 3 hand over
    by `built-here.md`: the build's problems, the verifier where npm answered, and the hand-over.
  - A package the user has is changed by `references/change.md` (#242), in place of steps 1 and 2,
    asking nothing: read by the tool of the first route that holds (route 3 fetches the bundle of
    the type the package's `h5p.json` names; route 4 cannot read one), the source changed as asked,
    built by the same route from the read folder, and handed over as any build. The description
    names it in its first sentence. Given a quiz.h5p and the build archive and asked for two
    harder questions, Haiku in Claude Code opened the skill in 1 of 3 runs with "or change an
    .h5p" at the description's end, and in the other 2 edited `content.json` and zipped it by
    hand; with it in the first sentence, and "never edit or zip one by hand", in 3 of 3, each
    reading, changing and building with the tool, at about $0.014 a run.

  A chat reads `SKILL.md` and its route's file, where every chat read all four routes, 18.9 KB,
  before.
- **Route 4 hands over the source as a `json` block or a file, with the build page's plain
  address** (#206, #208, the owner's calls). The reply holds the whole source once, in one `json`
  code block, which a chat's copy button copies exactly, and the line that says to paste it on the
  build page in place of the sample and press *Build*, the page asking for any files the source
  names. Where a code tool runs, it also gives the source as a `.source.json` file and the line
  offering the build archive; outside a chat the file stands in for the block. No link carries the
  source. A page the chat wrote to make the link worked but showed the person a block of HTML to
  preview; a link the model wrote as readable JSON broke in ChatGPT, whose model wrote spaces raw
  and whose renderer drops the `<…>` form that allows them. The build page still reads
  `#source={…}`, leniently, for links already written.
- **A code tool that says it has no internet still tries the two files** (#211). Nothing decides
  "no internet" but having no code tool: npm is checked wherever one runs, and route 3 holds
  wherever Node runs, whatever the tools say or npm answered. Grok's code tool, documented as
  having no external network, fetched the build tool and built. A sandbox that reaches nothing
  loses the ten-second check and one failed fetch before route 4. The skill's check takes an
  answer from npm's cache, and route 2 then builds from that cache. To measure a route, the lab
  cuts npm for real: a run root with a `package.json`, an `.npmrc` naming a dead or hanging
  registry, and a cache of its own; without them npm answers from this computer's cache or reaches
  the real registry.
- **The skill names no product** (the owner's call). Its routes say what each needs: a shell that
  reaches the npm registry, Node and a download where npm cannot install, or nothing that runs or
  fetches. What a product's name carried is kept as what an agent can observe: the registry's
  errors, a sandbox that downloads only what a browsing tool has opened, a code tool that can be
  unavailable for hours.

Not built: changing a package in place, which a tool beside it does with `checkContent` as its
check (a package is changed by reading it into a source and building that); reading content made
for another version of a library than the pack's; layout for Drag and Drop and Crossword; and any
judgement of whether content is right beyond those notes, which stays the person's, in the
verifier's preview.
