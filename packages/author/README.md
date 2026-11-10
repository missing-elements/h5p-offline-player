# @missing-elements/h5p-author

Builds a playable `.h5p` of any content type in the H5P hub from a short JSON source: the content
type, and only the fields that differ from its defaults. The rest comes from the libraries' own
`semantics.json` and their translations for the content's language; the libraries come from
[@missing-elements/h5p-libraries](https://www.npmjs.com/package/@missing-elements/h5p-libraries),
the pack this release pins, each checked against the pack's SHA-256 index. No H5P server, no
editor, no network but for media named by web address. Needs Node 22 or later; write `@latest`,
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
H5P.Blanks 1.14: interface texts from its translation language/de.json.
Not verified: run npx @missing-elements/h5p-verify@latest on it and look at its screenshot before handing it over.
```

The package plays in the player and carries the editor libraries an H5P site's upload check asks
for, which the player never reads: a Moodle 4.5 with no library installed accepts
every type's example (Moodle was the one site tried; WordPress and Drupal run the same check). A
Question Set gains 120 kB by them; a Course Presentation or a Branching Scenario several MB, as
the same package exported from Moodle has, because their editors bring every type they can hold.

It is written for an AI agent and its tokens: the agent writes what only an author can know, and
code writes everything that can be derived. The
[h5p-author skill](https://github.com/missing-elements/h5p-offline-player/tree/main/skills/h5p-author)
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

What `params` takes is what H5P's editor would let an author save in the same form:

- **Text**: plain text in a plain field, stored escaped as the platforms store it; in a field with
  tags, markup with those tags only, or plain text, which is wrapped in paragraphs as the editor
  wraps typing. A tag the field does not take, an event handler or a script address is refused.
- **Choices, numbers, lists**: a select's options, a number's range, a list's size, all checked.
  A field the semantics do not name is refused, so a misspelt one is never dropped in silence.
- **Sub-content**: `{ "library": "H5P.MultiChoice", "params": { … }, "metadata": { "title": "…" } }`,
  filled in the same way, at the pack's version.
- **Files**: `{ "path": "photo.jpg" }`, a file beside the source or an `http(s)` address, with an
  optional `copyright`. Each is copied into the package with its type and, for a picture, its size;
  the package is then laid out to stream, media stored and an mp4's index first. A YouTube, Vimeo,
  Panopto or Echo360 address stays where it is, if it is one H5P.Video plays: a Short's is taken
  as its video's, and another address on those sites is refused. A download is given up once
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
problems, as the [build page](https://missing-elements.github.io/h5p/build/) does.

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
- `-h`, `--help`; `-v`, `--version`: this package's version and the pack's.

## API

```js
import { buildPackage, schemaOf, SourceError } from '@missing-elements/h5p-author'

const { output, manifest, content, libraries, install, translations, notes, media } =
  await buildPackage(source, 'rivers.h5p', { base: process.cwd() })
```

`buildPackage(source, output, { libraries, base, fetch })` refuses an existing output, and throws a
`SourceError` whose `problems` are `{ path, message }`; `libraries` are the folders the package
plays with, `install` those carried for an H5P site's upload check. `missingForInstall(libraries)`
is that check, over a package's `library.json` files: what a site with no library installed would
refuse it for, empty for a build. `schemaOf(machineName, { markdown, all,
libraries })` returns the field list. `writeBundle(type, output, { libraries })` and
`writeBundles(folder, { libraries })` write bundles, each `{ output, type, parts, size }`;
`bundleLibraries(pack, type)` returns a bundle's parts, and `contentTypes(pack)` the pack's content
types. `sourceType(source, names)` is the content type a source is written in, as a build reads it,
of the machine names given: its `type`, as it is or loosely (`"interactive-book"`), or where it has
none the one name under `contentType` or `library`; `null` where none can be meant, and for a quiz
in the published format (`{ "kind": … }`), which the build reads as a Question Set or a Multiple
Choice by rules of its own. A page that
hands a chat a type's notes with a source's problems asks it, and hands over the type the build
took. `ContentGenerator` is the engine underneath, also run by the repository's sweep of every
content type.

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
content type's editor would, as the build does, and returns the content as checked with `problems`
and `notes`, each `{ path, message }`. Where the content names an older minor of a library than the
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
  `{ blob, manifest, content, libraries, install, translations, notes, media }`, as in Node. Its options:
  - `libraries`: a pack `openPack` opened, or what to open one from for this build alone.
  - `files`: an object or a `Map` of the files a source names, by the names it gives them:
    `{ "path": "volga.png" }` takes `files['volga.png']`.
  - `fetch`: for media named by web address.
- Media go in after the content and stored, each with its size and CRC in the header in front of
  it, as the player reads them on a host without `Range`; the libraries carried for an H5P site's
  upload check come after them, as in Node. An mp4 goes in as it was given. Moving its index to the
  front, so that it starts before the whole file has arrived, is the normalizer's job, which runs
  in Node: `npx @missing-elements/h5p-normalize@latest course.h5p`.

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

It checks structure, not pedagogy: whether the answers are right, the questions fair, or the
pictures placed well is for a person to judge, in
[h5p-verify](https://www.npmjs.com/package/@missing-elements/h5p-verify)'s `--preview`. It does not
edit an existing package itself: `checkContent` is the check for a tool that does. The licence of
each library is in the pack's `libraries.txt`.

MIT.
