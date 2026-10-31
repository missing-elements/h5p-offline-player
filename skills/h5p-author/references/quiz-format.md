# Quiz source format

The helper accepts this small authoring format, not raw H5P `content.json`.
Unknown fields and wrong types fail with a path; nothing is silently dropped.
All authored text is plain text. `<script>` and other markup display as text.

| Field | Required | Meaning |
|---|---|---|
| `kind` | yes | `multiple-choice` (exactly one question) or `question-set` |
| `title` | yes | Non-empty activity title, at most 255 characters |
| `language` | yes | BCP 47 tag, e.g. `en` or `de-AT`; also picks the libraries' translation of their interface texts (see below) |
| `license` | yes | H5P code: `U`, `CC BY`, `CC BY-SA`, `CC BY-ND`, `CC BY-NC`, `CC BY-NC-SA`, `CC BY-NC-ND`, `CC0 1.0`, `PD`, or `C` |
| `authors` | yes | Non-empty list of `{ "name": "...", "role": "Author" }` |
| `passPercentage` | no | Integer 0-100; defaults to the library's value (100 for Multiple Choice, 50 for Question Set in the current pack) |
| `passedFeedback` | no | Plain text for a learner who reached `passPercentage`. Set it with `failedFeedback` and an explicit `passPercentage` |
| `failedFeedback` | no | Plain text for a learner below `passPercentage`; say what to do next |
| `questions` | yes | Non-empty list of questions |

`passedFeedback` and `failedFeedback` become the activity's overall feedback: two
score ranges split at the pass mark, which the library matches exactly as it decides
the `success` an LMS records. A standalone Multiple Choice shows the message under
the answers after Check. A Question Set in the current pack (1.21) does not draw it
on its result page yet, an H5P bug ([h5p/h5p-question-set#183](https://github.com/h5p/h5p-question-set/issues/183)):
screen readers announce it, and it appears once H5P's fix reaches the pack. Until
then a learner sees the score and not the pass mark, so they need to learn the pass
mark another way.

`language` also picks the content types' interface texts: Start, Check, Retry,
Finish, the result screen, and their screen-reader labels. Each library carries
translations of them in `language/<code>.json`, and the helper takes the first one
that matches the tag and translates anything. `de-AT` takes `de`, and `pt-BR` takes
`pt-br`. Chinese goes by script, and `no` takes `nb`. A text stays English where the
translation has none, has the English text, or leaves out a placeholder the library
fills in, such as `@finals`. A library with no translation for the language stays
English throughout. The helper prints the texts that stay English.

In the current pack, Multiple Choice is fully translated into many languages,
German and Spanish among them. Question Set's navigation and result screen
("Previous", "Next", "Results", "@finals of @totals correct", "Score") are English
in all but one or two of its 48 translations. The player's own strings, such as
Fullscreen, follow `language` as well.

Each question:

| Field | Required | Meaning |
|---|---|---|
| `title` | no | Short title for the question, which a Question Set's result screen lists it by; defaults to the set's own label and number, `Question N` in English |
| `prompt` | yes | Non-empty question text |
| `multipleAnswers` | no | Boolean, default false; true means at least one correct answer, otherwise exactly one |
| `answers` | yes | At least two `{ "text": "...", "correct": true/false, "feedback": "..." }` objects |

`text` and the boolean `correct` are required on every answer. `feedback` is
optional for the helper, but the authoring workflow should supply it for every
answer. It is shown when that answer is chosen. These questions use the library's
normal retry, solution, and answer-shuffling defaults.

For a standalone question, copy the first question from the
[worked example](../assets/quiz.json), set `kind` to `multiple-choice`, and keep
exactly one item in `questions`. The helper sets the main library accordingly;
standalone questions are not wrapped in a Question Set.

The generated package includes only the selected libraries and their runtime
dependencies from `@missing-elements/h5p-libraries`. No external media, generated
JavaScript, editor libraries, or custom scripts are accepted by this format.
Each part's SHA-256 must match the installed pack index; a damaged or modified part
fails the build rather than being copied unchecked. Reinstall the pack to restore it.
