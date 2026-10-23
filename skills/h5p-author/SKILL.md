---
name: h5p-author
description: Create an H5P quiz from a prompt, lesson, or supplied source material. Use when asked to generate, author, or build a playable .h5p Multiple Choice question or Question Set with AI. Includes a portable packaging helper, a quiz example, and the authoring-and-verification loop; no H5P server or provider API needed.
license: MIT
---

# Author and verify an H5P quiz

Turn source material into a playable `.h5p`, not just JSON that looks plausible.
This first workflow supports **text-only H5P.MultiChoice and H5P.QuestionSet**.
It does not implement other content types, media, or a general H5P editor. Do not
quietly substitute a quiz if the user requested another kind of activity.

Works with Claude Code and other agents that can read skills, write files, and run
Node commands. Ordinary chat without filesystem and command access cannot run the
workflow by itself. No AI provider SDK, API key, MCP server, or repository checkout
is required. Model calls are made by the user's agent, not by the player.
Keep [LICENSE](./LICENSE) with the installed skill and helper. Each sample's
content license is declared separately in its source JSON.

## 1. Establish the brief

Use what the user already supplied. Clarify missing essentials: source material,
audience, learning objective, question count, single- or multiple-answer questions,
language, authorship/license, and destination. Do not invent factual source material,
claim expert review, or assign a license the user has not authorized. Use `U`
(undisclosed) when the license is unknown, and ask for the author's name.

Read [the input format](./references/quiz-format.md) and
[the worked quiz](./assets/quiz.json). Write a source JSON file in the user's
project. These strings are **plain text**, not HTML. The helper escapes them.
For a fuller example, read [the eight-scenario brief and answer key](./references/scenario-quiz.md)
with [its source JSON](./assets/phishing-scenarios.json): mixed answer modes,
explanatory feedback, an 80% threshold, and complete fail/retry/pass checks.

For each question:

- Test the stated objective with an answer supported by the supplied material.
- Write plausible distractors and explanatory feedback for every answer.
- Mark exactly one correct answer unless `multipleAnswers` is true.
- For multiple answers, say "Select all that apply" and mark at least one correct.
- Keep the source JSON as the editable deliverable; do not edit generated archives.

The library defaults, including their Check/Retry/result labels, are English.
`language` records the content language; it does not translate those defaults.
For a localized interface or a feature this helper does not support, explain the
limit rather than delivering an English interface as a translated activity.

## 2. Prepare the project

Needs **Node 22 or later**. Run from a writable project directory with a
`package.json` (create one with the project's package manager if needed):

```bash
npm install --save-dev @missing-elements/h5p-libraries@^1 @zip.js/zip.js@^2.24
```

Use the project's existing package manager if different, and keep its lockfile:
the installed library pack determines the exact library versions in the output.
If either package is already installed at an older version, the helper stops and
prints this command.
The pack contains third-party libraries under their own licenses; preserve their
files/notices and review those terms before distribution.

Resolve `<skill>` below to **this installed skill's directory**, not a path in the
player's repository. Quote paths that contain spaces. Dependencies are resolved
from the project's current working directory, so a globally installed skill works
too. The helper reads the installed pack locally; no hub or CDN is contacted.

## 3. Build

```bash
node "<skill>/scripts/build-quiz.mjs" quiz.json course.h5p
```

The helper validates the source, reads defaults from the installed libraries'
`semantics.json`, assigns each sub-question a UUID, and writes a self-contained
archive with the required runtime dependency closure, not the entire pack. Library
parts are checked against the pack index's SHA-256 before being copied; a mismatch
stops the build and names the part. Library folders stay together before `content/`.
Existing output is never overwritten; use a new filename for a revision.

There is no media in this workflow, so no normalization step is needed. If a later
workflow adds media, use `h5p-normalize` and verify the final rewritten file.

## 4. Verify the actual output

```bash
npx @missing-elements/h5p-verify@latest course.h5p
```

Needs Chrome/Edge or Playwright Chromium (`npx playwright install chromium`).
Keep `@latest`: an older Node can otherwise select an old verifier silently.
For a destination that plays uploads untrusted against its pack, also run:

```bash
npx @missing-elements/h5p-verify@latest course.h5p --untrusted --libraries pack
```

Use `--libraries /path/to/parts` to check offline against a specific local pack.
Read `report.json` and open `screenshot.png` in the reported output folder. An exit
code of zero is not enough: read warnings and check the picture. The screenshot
shows startup, not every question or the final result.

If `h5p-verify` is installed as a skill, follow its detailed troubleshooting loop.
Fix the source or helper, rebuild to a new output path, and verify again. Never
make verification pass by removing a question, changing the learning objective,
or hiding an error. If a browser cannot run, report the package as **unverified**.

## 5. Review and hand over

- Check the answer key and feedback against the source, not the verifier's verdict.
- Open the activity in the intended player, answer every question, and inspect
  feedback, navigation, score, retry, and completion. With browser tools, record
  this evidence; without them, explicitly leave this check to the user.
- A verifier pass means startup/rendering only. Do not claim pedagogical accuracy,
  accessibility conformance, full interaction testing, or compatibility with every
  LMS. The pack's versions may be newer than those installed in the destination.
- Deliver the `.h5p`, source JSON, the verification report and screenshot, and the
  **full `revision` from the report**, with any remaining warnings and limits.
- For a web preview, use `h5p-player-setup`. Prefer `untrusted` with a host-chosen
  pack on sites with accounts or packages from other authors. No player page,
  deployment, results collection, or AI calls are added by this helper.
