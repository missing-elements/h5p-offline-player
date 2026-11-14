---
name: h5p-author
description: Create H5P content from a prompt, a lesson or supplied material, as a playable .h5p - quizzes, fill in the blanks, drag the words, flash cards, presentations, interactive books, branching scenarios, interactive video, image hotspots, memory games and more. Use when asked to generate, author or build H5P content or an .h5p file with AI. The content type is chosen with the user first; a short JSON source holds only what differs from its defaults. No H5P server or provider API needed.
license: MIT
---

# Author H5P content

You write a short source: the content type and only what its defaults cannot know.
`@missing-elements/h5p-author` fills in the rest from the libraries, copies them, and checks
every field. Needs Node 22 and a shell; nothing to install. Where `npx` cannot install, it builds
from the build archive the user attaches, or from two downloaded files, or a page in the user's
browser builds it (step 3), so never end with commands for the user to run. Only it writes the
`.h5p`: never put one together yourself from `h5p.json` and `content.json`, since one made by
hand carries no libraries and nothing checks it. Keep [LICENSE](./LICENSE) with the skill.

Work in this order, one question at a time: the content type, chosen with the user; then the
author and licence, which they give or skip; then the source; then the build, the best way this
environment allows.

## 1. Choose the content type, then the author and licence, with the user

Read [the brief](./references/authoring.md) once. Unless the user named a type from the table
below, propose one or two that fit the material and objective, a sentence each on why, ask them
to choose, and wait: "a quiz" or "flash cards" says what they want, not which type. Ask nothing
else in that message.

Once they have chosen, ask in a message of its own for the author's name and the licence, only
for what they have not given yet, and say they may skip; then wait. What they gave stays as they
gave it. A name they skip is the one you know them by, or "Unknown"; a licence they skip is `U`
(undisclosed). Every source names its author and the build refuses one without, but never write
a name made up for them.

| Type | Use it for |
|---|---|
| H5P.MultiChoice | one question, one or several right answers |
| H5P.QuestionSet | a quiz: questions in turn, then a score |
| H5P.TrueFalse | one statement, true or false |
| H5P.Blanks | typing the missing words of a text |
| H5P.DragText | dragging words into the gaps of a text |
| H5P.MarkTheWords | clicking the words of a text that fit a rule |
| H5P.SingleChoiceSet | quick questions, one right answer each |
| H5P.Summary | building a summary from true statements |
| H5P.SortParagraphs | putting paragraphs in order |
| H5P.Essay | free text, scored by keywords |
| H5P.Dialogcards | flash cards, not scored |
| H5P.Accordion | reference text in panels, not scored |
| H5P.Column | a page of text, media and questions |
| H5P.Questionnaire | a survey, no right answers |
| H5P.InteractiveBook | chapters of pages, with a summary |
| H5P.CoursePresentation | slides with text, pictures and questions |
| H5P.BranchingScenario | a story whose choices lead to different ends |
| H5P.Timeline | events along a time line |
| H5P.InteractiveVideo | questions and text over a video (needs a video) |
| H5P.ImageHotspots | a picture with spots that open text (a picture) |
| H5P.ImageHotspotQuestion | clicking the right area of a picture (a picture) |
| H5P.MultiMediaChoice | a question with pictures as answers (pictures) |
| H5P.MemoryGame | finding pairs of cards (pictures) |
| H5P.ImagePair | matching pictures to pictures (pictures) |
| H5P.ImageSequencing | putting pictures in order (pictures) |
| H5P.Dictation | hearing sentences and typing them (recordings) |
| H5P.Audio | an audio player (a recording) |
| H5P.GameMap | stages on a map, each with exercises (a map) |

Media come from the user; never invent them. For a type not listed, run
`npx @missing-elements/h5p-author@latest schema <Type>` and say it has no notes here. Where npx
cannot install, fetch the build tool and that type's bundle as
[the two files' route](./references/build/two-files.md) says, unzip the bundle, and run
`node h5p-author.mjs schema <Type> --libraries parts` instead. Never read a library's semantics
or code yourself: the type file and `schema` say what a source may write, and an agent that works
it out from the library spends two to three times as much for the same package.

## 2. Write the source

Read the type's file, `references/types/<Type>.md`: notes, an example, its fields. Parts other
content holds have files too: H5P.AdvancedText, H5P.Image, H5P.Video, H5P.Text.

```json
{
  "type": "H5P.Blanks", "title": "Rivers", "language": "en", "license": "CC BY",
  "authors": [{ "name": "Ann Author", "role": "Author" }],
  "params": { "questions": ["The *Danube* flows into the Black Sea."] }
}
```

- Every source names its own `title`, `language`, `license` and `authors` beside `type` and
  `params`, as above, whatever a type file's example leaves out; the author and licence are the
  ones step 1 settled. A CC BY licence's version, CC BY-SA's and the others' too, is a field of
  its own, written where the user gave one: "CC BY 4.0" is
  `"license": "CC BY", "licenseVersion": "4.0"`. `CC0 1.0` is one code, as it stands.
- `params` holds only fields that differ from their defaults. Never interface texts (Check,
  Retry…): they come from the libraries' translations for `language`.
- Text is plain, or markup with only the tags a field marked `html` lists.
- In a gap of H5P.Blanks `/` separates answers and `:` starts a tip, and in a gap of
  H5P.DragText `:` starts a tip. Where one belongs to the answer itself, write `&#47;` for `/`
  and `&#58;` for `:`: `*10&#58;30*` takes 10:30, where `*10:30*` is the answer 10 with the
  tip 30. A backslash escapes nothing.
- A file is `{ "path": "photo.jpg" }`, beside the source or a web address, with `copyright`
  when known.
- Sub-content is `{ "library": "H5P.MultiChoice", "params": { … }, "metadata": { "title": "…" } }`.
  Where it sits is the type file's to say, a level deeper than a guess puts it: an item of
  H5P.Column's `content` is `{ "content": <sub-content> }`, a slide's element
  `{ "action": <sub-content> }` in `presentation.slides[].elements`, a book's chapter an H5P.Column.
- Check answers and feedback against the material before you build.

## 3. Build, by the first route whose check holds

Go down these checks in order and take the first that holds. Read only that route's file and
follow it to its end: it says how to build and what to hand over. Where its build fails, as its
file says, take the next route. Tell the user which you take. Where you cannot run a command
here, only the last check holds: take it with no attempt here first.

1. **The user attached the build archive, `h5p-author-build.tar.gz`, to a message or to this
   chat's files, and Node runs here.** Where they did not, look for nothing.
   → [From the build archive](./references/build/archive.md)
2. **npm reaches its registry here.** This prints a version within ten seconds:
   `npm view @missing-elements/h5p-author version --fetch-timeout=10000 --fetch-retries=0`.
   → [With npm](./references/build/npm.md)
3. **Node runs here and can fetch a file from the web.**
   → [From two files](./references/build/two-files.md)
4. **Anything else**: nothing runs here, nothing can be fetched, or no route above built.
   → [In the user's browser](./references/build/browser.md)

Build in a working folder of your own, not in the folder the user named.
