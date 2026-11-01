# Worked scenario quiz: inbox decisions

[The source JSON](../assets/phishing-scenarios.json) is a more complete example than
the two-question starter. It builds eight text-only questions: four single-answer
and four multiple-answer, each with four options and explanatory feedback.
The pass threshold is 80%, with a message for each outcome. It exercises multiline
prompts, quotes, ampersands, answer shuffling, question navigation, the result page,
and retry.

## Authoring brief

Audience: new employees practising an explicit response procedure.
Objective: choose an independent verification route, recognize requests to bypass
normal checks, and report suspected exposure without sharing authentication secrets.

The following is an **illustrative policy for this example**, not an assertion
about the user's organization or a substitute for its incident-response procedure:

1. Open account services through a known bookmark or official app, not an
   unexpected message's link or QR code.
2. Credential requests and pressure to bypass checks are warning signs. A logo or
   correct spelling alone neither establishes authenticity nor proves fraud.
3. Confirm payment-detail changes using the supplier's number already held in the
   approved vendor record, not a new number supplied in the request.
4. Reject sign-in approvals you did not initiate and report them through the
   established security channel.
5. After suspected password exposure, report promptly and change the exposed
   password through the genuine service's established route.
6. Confirm unusual purchasing requests using contact details already held in the
   staff directory.
7. An incident report should say when and where the message arrived and what you
   did. Do not include passwords or one-time codes.

Each question repeats the rule it tests so the activity is answerable without
this file. The answers are based on these rules; no claim of expert, legal, or
organization-specific review is implied.

## Build and verify

```bash
npx @missing-elements/h5p-author@latest build "<skill>/assets/phishing-scenarios.json" phishing-scenarios.h5p
npx @missing-elements/h5p-verify@latest phishing-scenarios.h5p
```

Use Node 22 or later. `<skill>` is the installed `h5p-author` directory. Inspect the
report and screenshot. Existing output is not replaced: use a new filename when
rebuilding.

## Interaction checks

Answers are shuffled, so identify them by their text rather than their displayed
position. The answer key below refers to their order in the source JSON.

| Question | Correct source options | Maximum points |
|---|---|---|
| 1. An urgent benefits deadline | 3 | 1 |
| 2. Evidence, not appearance | 1 and 4 | 2 |
| 3. A supplier changes bank details | 1 | 1 |
| 4. A sign-in approval you did not request | 2 and 3 | 2 |
| 5. The QR-code shortcut | 4 | 1 |
| 6. After entering a password | 1 and 3 | 2 |
| 7. A sender name is not a verification method | 2 | 1 |
| 8. A useful incident report | 3 and 4 | 2 |

With the current pack's normal Multiple Choice scoring, the total is **12 points**:
multiple-answer questions award one point per correct selection and subtract one
per incorrect selection, with a floor of zero per question.

Test two complete attempts:

- Answer questions 1-6 correctly, choose the wrong first option in question 7, and
  choose the two wrong options in question 8: **9/12 (75%), fail** at the 80%
  threshold. Inspect the feedback and the result, then press Retry.
- Answer questions 1-7 correctly and choose the two wrong options in question 8:
  **10/12 (83.3%), pass**, the lowest attainable passing score. Press Retry again.
- Answer all eight correctly: **12/12 (100%), pass**. Inspect Show solution,
  navigation, and retry, and confirm that `finished` is the Question Set's result,
  not an individual question's.

The result page shows the score, not the pass or fail message: the current Question
Set does not draw it yet (see [the input format](./quiz-format.md)), and a screen
reader announces it.

The repository's app playback tests perform these attempts in both trusted and
untrusted mode, and check that each message is announced. The regular verifier still
checks startup only; the interaction test is separate evidence, not a new verifier
capability.
