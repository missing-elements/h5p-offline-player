---
name: h5p-author
description: Create H5P content as a playable .h5p from a prompt, a lesson or supplied material, or change an .h5p the user has, such as adding questions to it - quizzes, fill in the blanks, drag the words, flash cards, presentations, interactive books, branching scenarios, interactive video, image hotspots, memory games and more. Use when asked to generate, author or build H5P content or an .h5p file with AI, and whenever the user gives an .h5p to add to, fix or change; never edit or zip one by hand. The content type is chosen with the user first; a short JSON source holds only what differs from its defaults. No H5P server or provider API needed.
license: MIT
---

# Author H5P content

You write a short source: the content type and only what its defaults cannot know.
`@missing-elements/h5p-author` fills in the rest from the libraries, copies them, and checks
every field. Only it writes the `.h5p`: never put one together yourself from `h5p.json` and
`content.json`, since one made by hand carries no libraries and nothing checks it. Keep
[LICENSE](./LICENSE) with the skill.

Work fast. Ask the user one thing at most, the content type. Read the files you need together,
and put commands that wait on nothing between them into one command line. Never end with commands
for the user to run: step 3 always finds a way to build.

To change an `.h5p` the user has, follow [Change a package](./references/change.md) in place of
steps 1 and 2: the package names its type, so ask nothing.

## 1. Choose the content type with the user

Read [the brief](./references/authoring.md). Unless the user named a type from the table below,
propose one or two that fit the material and objective, a sentence each on why, ask them to
choose, and wait: "a quiz" or "flash cards" says what they want, not which type.

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

For a type not listed, say it has no notes here, and read its fields with the build tool:
`npx @missing-elements/h5p-author@latest schema <Type>` where npm reaches its registry; otherwise,
beside the tool and its libraries as route 1 or 3 of step 3 gets them,
`node h5p-author.mjs schema <Type> --libraries parts`. Never read a library's semantics or code
yourself: the type file and `schema` say what a source may write, and an agent that works it out
from the library spends two to three times as much for the same package.

## 2. Write the source

Read the type's file, `references/types/<Type>.md`: notes, an example, its fields, and what every
source names beside them. Parts other content holds have files too: H5P.AdvancedText, H5P.Image,
H5P.Video, H5P.Text.

```json
{
  "type": "H5P.Blanks", "title": "Rivers", "language": "en", "license": "CC BY",
  "authors": [{ "name": "Ann Author", "role": "Author" }],
  "params": { "questions": ["The *Danube* flows into the Black Sea."] }
}
```

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

## 3. Build

Where a command runs here, work in a folder of your own, not the one the user named, with the
source as `source.json`. Whether npm reaches its registry picks the route, and later whether the
verifier runs. With no code tool it does not. Otherwise run this once, early, beside the files you
read, since it waits on nothing. It prints a version, or gives up within ten seconds.

```bash
npm view @missing-elements/h5p-author version --fetch-timeout=10000 --fetch-retries=0
```

Take the first route that holds, read its file and follow it; where its build fails, take the
next. Tell the user which you take.

1. The user attached the build archive, `h5p-author-build.tar.gz`, to a message or to this chat's
   files, and Node runs here: [route 1](./references/build/archive.md).
2. npm reaches its registry: [route 2](./references/build/npm.md).
3. Node runs here: [route 3](./references/build/two-files.md), which fetches two files from the
   web. Try it even where your tools say this sandbox has no internet, or npm gave up: such a
   sandbox has fetched them.
4. Anything else: [route 4](./references/build/browser.md), the user's browser.

## 4. Verify and hand over

A package built here, by route 1, 2 or 3, is verified and handed over as
[After a build here](./references/build/built-here.md) says. Route 4's file is its own hand-over.
