---
name: h5p-author
description: Create H5P content from a prompt, a lesson or supplied material, as a playable .h5p - quizzes, fill in the blanks, drag the words, flash cards, presentations, interactive books, branching scenarios, interactive video, image hotspots, memory games and more. Use when asked to generate, author or build H5P content or an .h5p file with AI. The content type is chosen with the user first; a short JSON source holds only what differs from its defaults. No H5P server or provider API needed.
license: MIT
---

# Author H5P content

You write a short source: the content type and only what its defaults cannot know.
`@missing-elements/h5p-author` fills in the rest from the libraries, copies them, and checks
every field. Needs Node 22 and a shell; nothing to install. Where `npx` cannot install, it builds
from two downloaded files, or a page in the user's browser builds it (step 3), so never end with
commands for the user to run.
Keep [LICENSE](./LICENSE) with the skill.

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
read a library's semantics or code yourself: the type file and `schema` say what a source may
write, and an agent that works it out from the library spends two to three times as much for
the same package.

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

Build in a working folder of your own, not in the folder the user named:

```bash
npx @missing-elements/h5p-author@latest build source.json course.h5p
```

**If it cannot install here, build from files instead.** No network for npm (`EAI_AGAIN`,
`ENOTFOUND`, a registry's 403, 404 or 503, as in ChatGPT): do not retry, try another way to
install it, or end with commands for the user to run once npm works. Where Node runs and you can
fetch a file (in ChatGPT, open each address with the browsing tool, then download it), fetch the
build tool and the content type's bundle, the libraries a build of that type reads, named by the
type's machine name:

```
https://embed-my.github.io/bundles/h5p-author.mjs
https://embed-my.github.io/bundles/H5P.QuestionSet.zip
```

```bash
unzip -q H5P.QuestionSet.zip   # or: python3 -m zipfile -e H5P.QuestionSet.zip .
node h5p-author.mjs build source.json course.h5p --libraries parts
```

A build that stops at a part `parts/` lacks names it (an addon: H5P.MathDisplay, where the text
holds math): fetch that part into `parts/`, such as
`https://embed-my.github.io/bundles/parts/H5P.MathDisplay-1.0.h5p`, and build again. The verifier
cannot run there either: hand the package over **unverified**, with the build page's link below
for the user to play it before using it.

**Where nothing can be fetched or run, the build page builds it.** No shell, no Node, or no
download: [the build page](https://embed-my.github.io/build) builds the same package in the user's
browser from the source alone, with no install. Give them a link that carries the source, written
with Node or Python, which need no network:

```bash
node -e "console.log('https://embed-my.github.io/build#source=' + require('zlib').deflateRawSync(require('fs').readFileSync('source.json')).toString('base64url'))"
python3 -c "import base64,zlib;c=zlib.compressobj(9,zlib.DEFLATED,-15);d=c.compress(open('source.json','rb').read())+c.flush();print('https://embed-my.github.io/build#source='+base64.urlsafe_b64encode(d).decode().rstrip('='))"
```

With neither, give the source for them to paste there. The page lists every problem by its path,
with a button that copies them for the chat: fix them all and give a new link. A source that names
files of its own waits for the user to choose them there. Steps 4 and 5 are then the user's, on
that page: the package is **unverified** until they have played it there, and they download it
from there.

A source with a problem writes nothing: the build lists every problem by its path, so fix them
all and run it again under the same name. Once a build has written its file it never writes
over it, so a later build takes a new name (`course-2.h5p`). Copy the one you hand over to the
name the user asked for without writing over a file already there (`cp -n`). If that name is
taken, ask, or where you cannot ask, take a new name and say so. Never delete or overwrite a file
to free a name. Pass the build's notes on to the user: texts left in English, a slide that holds
too much.

## 4. Verify

```bash
npx @missing-elements/h5p-verify@latest course.h5p
```

It writes `course.verify/report.json` and `course.verify/screenshot.png` beside the package
(`--out <folder>` puts them elsewhere). Read the report's `verdict`, `reasons`, `errors` and
`warnings`: a run that fails may say why only in `reasons`, such as content that never reached
ready or drew nothing. Look at the screenshot too: layout mistakes raise no error. One run is
enough: the build already writes what an H5P site's content check keeps, so `--untrusted` finds
nothing more. Follow the `h5p-verify` skill's loop if it is installed. Fix the source, never by
removing what fails. Without a browser, say the package is **unverified**.

## 5. Review and hand over

Check answers and feedback against the material. Then let the user play it in their browser:

```bash
npx @missing-elements/h5p-verify@latest course.h5p --preview
```

Run it in the background; it ends once its tab has closed. Ask the user to work through all of
it, wrong answers included; its Download button saves a copy. Where the command does not run on
the user's computer, hand over the file and the command. If you already have a browser tool,
add `--no-open` and play the address it prints with that tool. Do not write a browser script to
do it: the person's own play is the check, and a script of your own costs more than the build.

Deliver:

- the `.h5p` and the source;
- `report.json`, `screenshot.png` and the report's full `revision`, from the run that passed;
  where it could not run, no report and call the package **unverified**; where it ran but failed,
  give its report and reasons and say the package **failed verification**;
- the preview command, and the build's notes;
- what a pass means: it starts and draws, not that it is accurate, accessible or right for
  every LMS;
- that it carries the editor libraries an H5P site's upload check asks for, so a Moodle with no
  library installed accepts it (the one site tried);
- that it carries H5P's libraries, each under its own licence, most MIT, listed in the pack's
  [`libraries.txt`](https://github.com/missing-elements/h5p-offline-player/blob/main/packages/libraries/libraries.txt),
  so the user checks those terms before they distribute it;
- where it goes next: the H5P Preview extension (`MissingElements.h5p-preview`) plays it in
  VS Code, Cursor or VSCodium, `h5p-player-setup` puts it on a website, and `h5p-to-scorm`
  makes it a SCORM zip for an LMS.
