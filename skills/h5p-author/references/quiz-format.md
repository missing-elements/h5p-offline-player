# Quiz source format

The helper accepts this small authoring format, not raw H5P `content.json`.
Unknown fields and wrong types fail with a path; nothing is silently dropped.
All authored text is plain text. `<script>` and other markup display as text.

| Field | Required | Meaning |
|---|---|---|
| `kind` | yes | `multiple-choice` (exactly one question) or `question-set` |
| `title` | yes | Non-empty activity title, at most 255 characters |
| `language` | yes | BCP 47 tag, e.g. `en`; library UI defaults remain English |
| `license` | yes | H5P code: `U`, `CC BY`, `CC BY-SA`, `CC BY-ND`, `CC BY-NC`, `CC BY-NC-SA`, `CC BY-NC-ND`, `CC0 1.0`, `PD`, or `C` |
| `authors` | yes | Non-empty list of `{ "name": "...", "role": "Author" }` |
| `passPercentage` | no | Integer 0-100; defaults to the library's value (100 for Multiple Choice, 50 for Question Set in the current pack) |
| `questions` | yes | Non-empty list of questions |

Each question:

| Field | Required | Meaning |
|---|---|---|
| `title` | no | Short title for sub-content metadata; defaults to `Question N` |
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
