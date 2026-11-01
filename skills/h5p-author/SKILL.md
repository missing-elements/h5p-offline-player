---
name: h5p-author
description: Create H5P content from a prompt, a lesson or supplied material, as a playable .h5p - quizzes, fill in the blanks, drag the words, flash cards, presentations, interactive books, branching scenarios, interactive video, image hotspots, memory games and more. Use when asked to generate, author or build H5P content or an .h5p file with AI. The content type is chosen with the user first; a short JSON source holds only what differs from its defaults. No H5P server or provider API needed.
license: MIT
---

# Author H5P content

You write a short source: the content type and only what its defaults cannot know.
`@missing-elements/h5p-author` fills in the rest from the libraries, copies them, and checks
every field. Needs Node 22 and a shell; nothing to install. Keep [LICENSE](./LICENSE) with
the skill.

## 1. Choose the content type with the user

Read [the brief](./references/authoring.md) once. If the user named no type, propose one or
two that fit the material and objective, a sentence each on why, and wait for their choice.

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
`npx @missing-elements/h5p-author@latest schema <Type>` and say it has no notes here. Never
read a library's semantics or code yourself.

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

- `params` holds only fields that differ from their defaults. Never interface texts (Check,
  Retry…): they come from the libraries' translations for `language`.
- Text is plain, or markup with only the tags a field marked `html` lists.
- A file is `{ "path": "photo.jpg" }`, beside the source or a web address, with `copyright`
  when known.
- Sub-content is `{ "library": "H5P.MultiChoice", "params": { … }, "metadata": { "title": "…" } }`.

## 3. Build

```bash
npx @missing-elements/h5p-author@latest build source.json course.h5p
```

It writes nothing until the whole source is right, listing every problem by its path, and
never overwrites a file. Fix and build to a new name. Pass its notes on to the user: texts
left in English, a slide that holds too much.

## 4. Verify

```bash
npx @missing-elements/h5p-verify@latest course.h5p
```

Read `report.json` and look at `screenshot.png`: layout mistakes raise no error. Follow the
`h5p-verify` skill's loop if it is installed. Fix the source, never by removing what fails.
Without a browser, say the package is **unverified**.

## 5. Review and hand over

Check answers and feedback against the material. Then let the user play it in their browser:

```bash
npx @missing-elements/h5p-verify@latest course.h5p --preview
```

Run it in the background; it ends once its tab has closed. Ask the user to work through all of
it, wrong answers included; its Download button saves a copy. With browser tools of your own,
add `--no-open` and play the address yourself. Where the command does not run on the user's
computer, hand over the file and the command.

Deliver the `.h5p`, the source, the report, screenshot and full `revision`, the preview
command, and any notes. A pass means it starts and draws, not that it is accurate, accessible
or right for every LMS. The package carries H5P's libraries, each under its own licence, most
MIT, listed in the pack's [`libraries.txt`](https://github.com/missing-elements/h5p-offline-player/blob/main/packages/libraries/libraries.txt):
tell the user, so they check those terms before they distribute it. The H5P Preview extension (`MissingElements.h5p-preview`) plays it in
VS Code, Cursor or VSCodium; `h5p-player-setup` puts it on a website.
