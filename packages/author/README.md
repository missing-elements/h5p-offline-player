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
Built /work/rivers.h5p: H5P.Blanks, 9 libraries from the library pack 1.0.0.
H5P.Blanks 1.14: interface texts from its translation language/de.json.
Not verified: run npx @missing-elements/h5p-verify@latest on it and look at its screenshot before handing it over.
```

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
The build does what those widgets do: it lays out a Course Presentation slide's elements, places
Interactive Video interactions, joins Game Map stages and sets their ids, numbers Branching
Scenario end screens, and names untitled Question Set questions. It refuses what they would not
let pass: a scenario path with no end, a map with no start, a hotspot question with no right area.

A source with problems writes nothing and lists every problem by its path at once:

```
h5p-author: The source has 2 problems:
  params.correct: "yes" is not an option; the options are "true", "false"
  params.behaviour.sideways: is not a field here; the fields are enableRetry, enableSolutionsButton, …
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

## Options

- `--libraries <folder>`: another copy of the pack's `parts/` folder, in place of the pinned one.

## API

```js
import { buildPackage, schemaOf, SourceError } from '@missing-elements/h5p-author'

const { output, manifest, content, libraries, translations, notes, media } =
  await buildPackage(source, 'rivers.h5p', { base: process.cwd() })
```

`buildPackage(source, output, { libraries, base, fetch })` refuses an existing output, and throws a
`SourceError` whose `problems` are `{ path, message }`. `schemaOf(machineName, { markdown, all,
libraries })` returns the field list. `ContentGenerator` is the engine underneath, also run by the
repository's sweep of every content type.

## What it does not do

It checks structure, not pedagogy: whether the answers are right, the questions fair, or the
pictures placed well is for a person to judge, in
[h5p-verify](https://www.npmjs.com/package/@missing-elements/h5p-verify)'s `--preview`. It does not
edit an existing package. The licence of each library is in the pack's `libraries.txt`.

MIT.
