# @missing-elements/h5p-author

Builds a playable `.h5p` of any content type in the H5P hub from a short JSON source: the content
type, and only the fields that differ from its defaults. The rest comes from the libraries' own
`semantics.json` and their translations for the content's language; the libraries come from
[@missing-elements/h5p-libraries](https://www.npmjs.com/package/@missing-elements/h5p-libraries),
the pack this release pins, each checked against the pack's SHA-256 index. No H5P server, no
editor, no network but for media named by web address, and no telemetry: a build reads the
source, the files it names and the pack, and writes the package. `read` turns a package
back into its source, to change it and build it again. Needs Node 22 or later; write `@latest`,
since without it npm on an older Node quietly installs an older release.

```bash
npx @missing-elements/h5p-author@latest build rivers.json rivers.h5p
```

```json
{
  "type": "H5P.Blanks",
  "title": "Rivers of Europe",
  "language": "de",
  "license": "CC BY",
  "authors": [{ "name": "Ann Author", "role": "Author" }],
  "params": {
    "questions": ["Die *Donau* fließt ins Schwarze Meer.", "Paris liegt an der *Seine*."]
  }
}
```

```
Built /work/rivers.h5p: H5P.Blanks, 9 libraries from the library pack 1.1.0, 3 more for installing on an H5P site.
Needs H5P core 1.28 or newer on a site it is uploaded to: Moodle 4.5.11, 5.0.7 or 5.1.4 and later, or the WordPress H5P plugin 1.17 and later. An older site refuses it.
Its source, naming H5P.Blanks 1.14 as what it was built with, is /work/rivers.source.json: hand it over with the package.
H5P.Blanks 1.14: interface texts from its translation language/de.json.
Not verified: run npx @missing-elements/h5p-verify@latest on it and look at its screenshot before handing it over.
```

The package plays in the player and carries the editor libraries an H5P site's upload check asks
for, which the player never reads: a Moodle 4.5.15 with no library installed accepts
every type's example (Moodle was the one site tried; WordPress and Drupal run the same check). A
Question Set gains 120 kB by them; a Course Presentation or a Branching Scenario several MB, as
the same package exported from Moodle has, because their editors bring every type they can hold.
A site also refuses a package if a library in it asks for a newer H5P core than the site has. The
build's second line says which core that is: with pack 1.1.0, 1.28 for nearly every type.

Beside the package the command writes the source again, as `rivers.source.json`, with one field
more: `builtWith`, the content type and the pack's version of it. A source is built again later,
often with a newer pack, and a build of one that names another version of its type says so: as a
note where it builds, and with the problems where it does not, since a field may have changed
since. That file is never written over either, but where it is the file being built, which is
kept up to date. A quiz in the quiz format has no such field: built to a new name, it is kept
beside the package as the source it was built as, and built from that file itself, the file
stays as written.

It is written for an AI agent and its tokens: the agent writes what only an author can know, and
code writes everything that can be derived. The
[h5p-author skill](https://github.com/missing-elements/h5p-toolkit/tree/main/skills/h5p-author)
is the workflow around it: choosing the content type with the user, a file per type with notes,
an example and the fields, then the check and the preview.

## The source

| Field | Meaning |
|---|---|
| `type` | The content type's machine name, such as `H5P.Blanks`; the pack's newest version is used |
| `title` | The title, at most 255 characters |
| `language` | A BCP 47 tag, `en`, `de-AT`; it picks the libraries' translation of their interface texts |
| `license` | An H5P licence code: `U` (undisclosed), `CC BY`, `CC BY-SA`, `CC BY-ND`, `CC BY-NC`, `CC BY-NC-SA`, `CC BY-NC-ND`, `CC0 1.0`, `CC PDM`, `GNU GPL`, `PD`, `ODC PDDL`, `C`; `licenseVersion` for a CC BY one |
| `authors` | `[{ "name": "…", "role": "Author" }]`, the role one of Author, Editor, Licensee, Originator |
| `params` | The content type's fields that differ from their defaults |
| `builtWith` | Written by a build, never by hand: the content type and its version when the source was last built, `H5P.Blanks 1.14` |

What `params` takes is what H5P's editor would let an author save in the same form:

- **Text**: plain text in a plain field, stored escaped as the platforms store it; in a field with
  tags, markup with those tags only, or plain text, which is wrapped in paragraphs as the editor
  wraps typing. A tag the field does not take, an event handler or a script address is refused.
- **Choices, numbers, lists**: a select's options, a number's range, a list's size, all checked.
  A field the semantics do not name is refused, so a misspelt one is never dropped in silence.
- **Sub-content**: `{ "library": "H5P.MultiChoice", "params": { … }, "metadata": { "title": "…" } }`,
  filled in the same way, at the pack's version.
- **Files**: `{ "path": "photo.jpg" }`, a file beside the source or an `http(s)` address, with an
  optional `copyright`. Each is copied into the package with its type and, for a picture, its size.
  A video or a recording is read from its first bytes, and one that is not what its field takes, a
  web page at a file's address among them, is refused; an mp4's index says whether it has sound
  and, where it gives one, its length, past which an Interactive Video's times are refused. The
  package is then laid out to stream, media stored and an mp4's index first. A YouTube, Vimeo,
  Panopto or Echo360 address stays where it is, if it is one H5P.Video plays: a Short's is taken
  as its video's, and another address on those sites is refused. A YouTube or Vimeo video is
  asked of the site's oEmbed, which is sent the video's address: one the site has no video at is
  refused, one YouTube says is private is a note, as is its 401, taken to mean that embedding is
  turned off (not seen yet), and with no answer of the site's own in ten seconds, behind a proxy
  that answers for it or with no network, the build goes on without one. A download is given up once
  nothing has arrived for a minute, however long it runs.
- **Interface texts** (Check, Retry…): leave them out; they come from the libraries' translations,
  and the command lists what stayed English. A source may still set one by name.

Some content types have a widget of their own in the editor, which sets fields the form hides.
The build does what those widgets do: it lays out a Course Presentation slide's elements, setting
the text larger where a slide has room and no question, places Interactive Video interactions,
joins Game Map stages and sets their ids, numbers Branching Scenario end screens, and names
untitled Question Set questions. It refuses what they would not let pass: a scenario path with no
end, a map with no start, a hotspot question with no right area.

A source with problems writes nothing and lists every problem by its path at once:

```
h5p-author: The source has 2 problems:
  params.correct: "yes" is not an option; the options are "true", "false"
  params.behaviour.sideways: is not a field here; the fields are enableRetry, enableSolutionsButton, …
```

What is written in the wrong place is said once, with what to write, and still checked, so that
what is wrong inside it comes in the same round:

```
h5p-author: The source has 3 problems:
  params.slides: is a field of presentation, not of this level: write params.presentation.slides
  params.slides[0].elements[0]: is sub-content, but here it goes inside an object, in its field action: write params.slides[0].elements[0] as { "action": { "library": "H5P.AdvancedText", "params": { … } } }
  params.slides[0].elements[0].params.text: has <h1>, which this field does not take; it takes <a> <br> …
```

A source's own fields are read the same way, for a chat that wrote one with no skill beside it.
What its outer shape plainly means is taken and said once, and the content is checked in the same
round: the content type under `contentType` or `library`, or named as it is spoken of
(`"interactive-book"`, `"Question Set"`), the title, language, licence and authors in `metadata`,
the content's fields beside `type`.

```
h5p-author: The source has 4 problems:
  contentType: is not a field of a source: the content type is its type: write "type": "H5P.InteractiveBook"
  metadata: is not a field of a source: title, license, authors are written beside type, not in an object: write "title": …, "license": …, "authors": … at the top
  language: expected a BCP 47 language tag, such as "en" or "de-AT"
  params.chapters[0]: is the params of sub-content, without the sub-content around them: write params.chapters[0] as { "library": "H5P.Column", "metadata": { "title": … }, "params": { "content": … } }
```

The quiz format the h5p-author skill published first (`{ "kind": "question-set", "questions": [ … ] }`)
is still taken, for a Multiple Choice question or a Question Set of them.

## A content type's fields

```bash
npx @missing-elements/h5p-author@latest schema H5P.TrueFalse
```

```
H5P.TrueFalse 1.8: True/False Question
- `media` group — Media
  - `type` sub-content: H5P.Image | H5P.Video | H5P.Audio — Type: Optional media to display above the question.
- `question` html: strong em sub sup h2 h3 pre code, required — Question
- `correct` one of "true" | "false" = "true" — Correct answer
…
```

`--all` adds the interface texts; `--markdown` prints the section the skill's type files carry.
An unknown name lists the pack's content types.

The package carries those type files too, as the release has them:
`@missing-elements/h5p-author/references/types/H5P.TrueFalse.md` is the type's notes, an example and
these fields. A page that builds for a chat with no skill beside it hands them over with a source's
problems, as the [build page](https://missing-elements.github.io/h5p/build/) does. The skill's text
travels with them, `@missing-elements/h5p-author/SKILL.md`, its brief,
`references/authoring.md`, and its build routes, `references/build/<route>.md`, so a site can
serve the skill from the release it pins:
[missing-elements.github.io](https://missing-elements.github.io/h5p/create-with-ai/#install)
packs them as the zips chat apps install, and lists the build tool and each bundle that the
skill's route 3, from two files, fetches at
[missing-elements.github.io/h5p/skill/](https://missing-elements.github.io/h5p/skill/). The build
tool is in the package too: `dist/h5p-author.mjs` is the command line as one file, everything it
imports bundled in, and `dist/h5p-author-LICENSES.txt` lists those packages' licences. Both are
exported by those paths.

## A package back to its source

```bash
npx @missing-elements/h5p-author@latest read rivers.h5p rivers
```

```
Read /work/rivers.h5p: H5P.Blanks. Wrote its source to /work/rivers/rivers.source.json.
Change it, then build it again: h5p-author build rivers/rivers.source.json <output.h5p>
```

The source holds what a build takes to make the package again: the content type and the metadata
from its `h5p.json`, and of its content only what differs from the defaults, interface texts in the
content's language included. Its pictures, videos and other files go beside the source, at the
paths it names them by. Positions and sizes are kept, so a slide or a video keeps its layout. Each
part gets a new id when it is built again.

It reads content made for the pack's versions of its libraries, and refuses any other, naming both
versions. H5P moves content to a newer version as it plays it, so a package saved again on a site
that has the pack's versions reads. What a source has no field for, or no form of, is said and left
out: the author's comments, the change log, a part's own licence or authors (a build gives every
part the source's), a file's licence that H5P does not list. The source is built again in memory
before it is written, and what would not come back as it is, or what a build would refuse, such as
styles pasted from Word, is said, to fix before building. It never writes over a file. An archive
is untrusted: only the files its content names are written, only under the folder, and a file
named by a path that could lead out of it is left out of the source.

## A content type's bundle

```bash
npx @missing-elements/h5p-author@latest bundle H5P.QuestionSet H5P.QuestionSet.zip
```

```
Bundled H5P.QuestionSet 1.21 in /work/H5P.QuestionSet.zip: 33 parts from the library pack 1.1.0, 2.6 MB. Unzip it beside a source and build with --libraries parts.
```

The libraries a build of one content type reads, for a build where the pack cannot be installed,
such as a chat's sandbox that reaches no npm registry: everything the type can hold, with the
editor libraries an H5P site's upload check asks for. The zip holds `parts/`, the pack's whole
index with those parts, and `libraries.txt`, the licences they are used under. A build from it
writes the package the pack would. An addon is not in it: where a source's text calls for one,
H5P.MathDisplay for math, the build stops and names the missing part, to copy into `parts/` from
the pack's own `parts/` folder. With pack 1.1.0 a question type's bundle is about 1 MB, a Question
Set's 2.6 MB, a container's up to 8.4 MB. `--all <folder>` writes one per content type,
`<machine name>.zip`: 55, 99 MB in all. If one fails, none is left behind.

## Options

- `--libraries <folder>` or `--libraries=<folder>`: another copy of the pack's `parts/` folder, in
  place of the pinned one.
- `build --check <source.json>`: the problems and notes of a source, with no package written.
- `-h`, `--help`; `-v`, `--version`: this package's version and the pack's.

## API

```js
import { buildPackage, schemaOf, SourceError } from '@missing-elements/h5p-author'

const { output, source: built, builtWith, manifest, content, libraries, install, coreApi, translations, notes, media, outline } =
  await buildPackage(source, 'rivers.h5p', { base: process.cwd() })
```

`buildPackage(source, output, { libraries, base, fetch, within, check })` refuses an existing output,
and throws a `SourceError` whose `problems` are `{ path, message }`; with `check` it builds and
writes no package and takes no output (`buildPackage(source, undefined, { check: true })`), though a
media file named by web address is still downloaded, to a temporary folder removed after; a video on
YouTube, Vimeo, Panopto or Echo360 stays an address, as in a build, a YouTube or Vimeo one asked
of the site with the same `fetch`. For a build run
on what a model wrote: `within` is a list of the folders the output and every local file the source
names must be inside, on their real paths, and its problems then name no path but the one the
source wrote. It does not cover a file named by web address, which is downloaded with the `fetch`
given, the global one by default: pass `fetch: publicFetch`, a `fetch` that refuses an address on a
local network however it is written, redirects included. A result's `outline` is the content as
plain lines for a review, made when it is first read: what the author wrote, the right answers
marked, slides, chapters and questions numbered, a scenario's links and a video's times written,
interface texts and settings left out. `outlineOf(libraries, content, { limit })` makes one from
what `loadLibraries` loaded for a content and the content, `{ type, params }`, as `checkContent`
takes them, cut at `limit` lines where one is given. `await inside(path, folders)` is the
confinement `within` applies, for a tool beside the build that reads files of its own: whether a
path, links followed, is in one of the folders.

```js
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { buildPackage, publicFetch } from '@missing-elements/h5p-author'

// A build run on what a model wrote: files only from `folder`, nothing from a local network.
const folder = resolve('work')
const source = JSON.parse(await readFile(join(folder, 'rivers.json'), 'utf8'))
const { outline } = await buildPackage(source, join(folder, 'rivers.h5p'), { base: folder, within: [folder], fetch: publicFetch })
```

`readPackage(file, folder, { libraries, within })` reads a package back into its source, as
`h5p-author read` does, and returns `{ output, source, files, notes }`: the source's path, the
source, the media written beside it by the paths it names them by, and what was left out or would
not come back as it is, each `{ path, message }`. With `within`, the package and the folder must be
inside those folders, on their real paths.

A result's `builtWith` is the content type and the pack's version of it, `H5P.Blanks 1.14`, and
its `source` the source as built, naming it: what to keep with the package, as the command line
writes it beside one; `buildPackage` writes the package alone. A result's `libraries` are the
folders the package plays with, `install` those carried for an H5P site's upload check, and `coreApi` the newest H5P
core they ask for, `{ majorVersion, minorVersion }`, which a site needs to take the package;
`coreApiLine(coreApi)` says it as the command line does. `missingForInstall(libraries)`
is that check, over a package's `library.json` files: what a site with no library installed would
refuse it for, empty for a build. `schemaOf(machineName, { markdown, all,
libraries })` returns the field list. `writeBundle(type, output, { libraries })` and
`writeBundles(folder, { libraries })` write bundles, each `{ output, type, parts, size }`;
`bundleLibraries(pack, type)` returns a bundle's parts, and `contentTypes(pack)` the pack's content
types. `sourceType(source, names)` is the content type a source is written in, as a build reads it,
of the machine names given: its `type`, as it is or loosely (`"interactive-book"`), or where it has
none the one name under `contentType` or `library`; `null` where none can be meant, and for a quiz
in the published format (`{ "kind": … }`), which the build reads as a Question Set or a Multiple
Choice by rules of its own. A page that hands a chat a type's notes with a source's problems asks
it, and hands over the type the build took. `sourceSchema` is a source's own fields, `type`,
`title`, `language`, `license`, `authors` and the rest, as the zod/mini schema a build holds them to,
and no other field. To show a model the shape of a source before it writes one, turn it into JSON
Schema with `toJSONSchema(sourceSchema, { io: 'input' })` from zod 4.2 or later, installed as a
dependency of your own, since the author package's copy is not yours to import. A build reads a
source more loosely than the schema, and says what to write: check one with
`buildPackage(source, undefined, { check: true })`, not with the schema alone. `ContentGenerator`
is the engine underneath, also run by
the repository's sweep of every content type.

A tool beside the build takes the libraries as the build loads them, the generator, and the
build's rules for text:

```js
import { ContentGenerator, loadLibraries, markupText, openPack } from '@missing-elements/h5p-author'

const params = { questions: ['Die *Donau* mündet ins Schwarze Meer.'] }
const pack = await openPack()
try {
  const { entries, main, translations } = await loadLibraries(pack, { type: 'H5P.Blanks', language: 'de', params })
  const content = new ContentGenerator(entries).generate(main, params)
} finally {
  await pack.close()
}
```

`openPack(libraries)` opens the pinned pack, or another copy's `parts/` folder. `loadLibraries`
loads what the content brings in: the content type, every library its parameters name and each
library field's default, with their semantics in the language and marked as the layouts need them.
`entries` is the map `ContentGenerator` takes, every other library of the pack in it without its
semantics. It takes any object with `libraries`, `newest`, `open` and `translation`.
`markupText(value, field, report)`, `plainText(value, note)` and `allowedTags(field)` are the
build's rules for one text value against its field.

A tool that changes a saved package checks what it is about to write with the check the build runs
last on what it writes:

```js
import { checkContent, loadLibraries, openPack, packageLibraries } from '@missing-elements/h5p-author'

// `names`, the package's entry names; `read(name)`, an entry's text: from zip.js, or any reader.
const manifest = JSON.parse(await read('h5p.json'))
const main = manifest.preloadedDependencies.find((each) => each.machineName === manifest.mainLibrary)
const params = edited(JSON.parse(await read('content/content.json')))
const content = { type: `${main.machineName} ${main.majorVersion}.${main.minorVersion}`, language: manifest.language, params }
const pack = await openPack()
try {
  const libraries = await loadLibraries(await packageLibraries({ names, read }, pack), content)
  const { params: checked, problems, notes } = checkContent(libraries, content)
} finally {
  await pack.close()
}
```

`packageLibraries(files, pack)` serves the package's own libraries where it carries a major of one,
and the pack's for the rest: content is in the shape of the version it was saved with. `checkContent`
checks every value against its field, as the build does, and takes what H5P saves as it is: files and
sub-content metadata, held to what the platforms keep of them, and each part's `subContentId`, which
the core names the part's statements by, so a learner's record stays the part's after an edit; a part
without one, or with another part's, gets a new one. It places what nobody placed and checks what a
content type's editor would, as the build does, notes what is almost surely a mistake, and returns
the content as checked with `problems` and `notes`, each `{ path, message }`. Where the content names an older minor of a library than the
one it is checked against, a field only that minor has is a note: the player upgrades such content as
it plays. Content saved by the platforms can hold what their editor let an author save and the build
does not, such as a required text left empty; a tool that changes one part keeps the problems under
the paths it changed.

## In a page

`@missing-elements/h5p-author/browser` is the same build in a page, or in a Tauri window: the
source checked, filled in, laid out and checked as above, every problem listed at once. Three
things differ. The libraries come from a pack the page can reach. A source's files are `File`s or
`Blob`s the page was given. And the package comes back as a `Blob`.

```js
import { pack } from '@missing-elements/h5p-libraries/install'
import { buildPackage, openPack, SourceError } from '@missing-elements/h5p-author/browser'

const libraries = await openPack(pack) // once, for the page's builds
const { blob, notes } = await buildPackage(source, { libraries, files: { 'volga.png': input.files[0] } })
```

- `openPack(pack)` takes either of two things:
  - the `pack` export of `@missing-elements/h5p-libraries/install`, its parts emitted by the
    page's bundler: the one with the libraries an H5P site's upload check wants, which the
    package's `pack` export leaves out, so a build from that one is refused naming the first;
  - the address of a copy of the pack's `parts/` folder, as a site serves it to `<h5p-player>`'s
    `pack-base`. Its `index.json` is read from there and held to the shape the player holds it to.

  Each part is fetched whole when a build first needs it, and checked against the index's SHA-256,
  as in Node. `close()` the pack when the page is done with it.
- `buildPackage(source, { libraries, files, fetch })` throws a `SourceError` as in Node, and returns
  `{ blob, source, builtWith, manifest, content, libraries, install, coreApi, translations, notes, media }`, as in Node. Its options:
  - `libraries`: a pack `openPack` opened, or what to open one from for this build alone.
  - `files`: an object or a `Map` of the files a source names, by the names it gives them:
    `{ "path": "volga.png" }` takes `files['volga.png']`.
  - `fetch`: for media named by web address.
- Media go in after the content and stored, each with its size and CRC in the header in front of
  it, as the player reads them on a host without `Range`; the libraries carried for an H5P site's
  upload check come after them, as in Node. An mp4's or an m4a's index is moved to the front, as
  the normalizer moves it in Node, so that it starts before the whole file has arrived: the file is
  made of slices of the one given and the rewritten index, and the media are never copied.

A page has two limits that Node does not:

- It needs a secure context, https, `localhost` or a Tauri window, for `crypto.subtle` and
  `crypto.randomUUID`. Elsewhere `openPack` and `buildPackage` refuse, and say so.
- It fetches a file named by web address itself, and gets another site's only where that site
  allows it (CORS). Most image hosts do not, so give the file itself instead, or a `fetch` that may
  fetch it, such as Tauri's HTTP plugin's.

`@missing-elements/h5p-author/core` is the part of the package that needs neither Node nor a page:
the generator, `loadLibraries` and `packageLibraries`, `checkContent` and the rules for text, as
the package's main export has them. A tool beside a build in either imports it from there.

## What it does not do

It checks structure, not pedagogy. In the content types where it looks for them, it notes what H5P
allows and is almost surely a mistake: no answer marked correct, two answers or statements alike, a
text with no gap, an optional alt text left blank beside a picture. Whether
the answers are right, the questions fair, or the pictures placed well is for a person to judge, in
[h5p-verify](https://www.npmjs.com/package/@missing-elements/h5p-verify)'s `--preview`. It changes an
existing package only by way of its source, read and built again; `checkContent` is the check for a
tool that changes one in place. The licence of each library is in the pack's `libraries.txt`.

MIT.
