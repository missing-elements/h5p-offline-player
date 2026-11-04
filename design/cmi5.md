# cmi5

`@missing-elements/h5p-cmi5`, the demo's cmi5 page on it, and the check against ADL's CATAPULT.

- **cmi5 is `@missing-elements/h5p-cmi5`, `/demo/cmi5.html` is a page on it, and the element
  knows nothing about either.** The wiring was the demo page's until 2026-10-01, when it moved
  into the package so a host installs it instead of copying it; the demo aliases the package's
  name to its source, as it does the element's, and the page keeps only the log, the status
  line and the simulated LMS, which it passes as `client`. The package has no dependencies:
  `@xapi/cmi5` 1.4.0 did the protocol until 2026-10-01, and its browser build carried its own
  copies of axios, `@xapi/xapi`, uuid and deepmerge — 90 kB, against 12.6 kB for the demo page's
  whole chunk now — for a token `POST`, two reads and statement `POST`s, while its declared
  dependencies installed a deprecated uuid nobody loaded. `src/client.ts` replaced it, sending
  what it sent; dropping the learner-preferences read on the way, since nothing uses them, was
  refused by CATAPULT at once — 11.0.0.0-3, the AU MUST retrieve them on startup — so they are
  read, and handed to the host for the audio preference the element cannot apply.
  `tests/requirements.test.ts` reads ADL's own requirement list, `@cmi5/requirements` (a dev
  dependency, the list CATAPULT checks against), selects every requirement whose subject is not
  plainly the LMS, and fails unless each is answered: `tested`, with its number in a comment
  beside the test that shows it, or `catapult`, `host`, `design`, `course`, `gap`, `n/a`, `lms`
  or `umbrella` with a reason. The filter once kept only requirements that name the AU, and so
  missed every rule on the verbs and the result properties, which never do ("Verbs MUST NOT be
  duplicated"). Going through the list found four things, all fixed on 2026-10-01: the context
  template was spread *under* the statement's own context, so a statement could overwrite a
  template value (10.2.1.0-7), and the template wins now; `completed` carried the score when the
  launch had no mastery score, as `@xapi/cmi5` did, which only `passed` and `failed` may
  (9.5.1.0-2) — CATAPULT never saw it because the demo course has one — and without a mastery
  score nothing could send `passed`, so a course with `moveOn="Passed"` could never be
  satisfied, and the content's own `success` now decides (`judge`); the client alone would send
  a second `failed` in a session if asked twice (9.3.0.0-3); and `completed` and `passed` were
  kept once per launch, where cmi5 wants once per registration (9.3.0.0-6 to 9.3.0.0-8).
  For the last, `initialize` asks the LRS, in a Normal launch, for this registration's
  `completed` and `passed` about this AU — two statements queries, `limit=1` — and `moveOn`
  sends neither again, nor `failed` after `passed`; an LRS that refuses the read leaves the
  session counting for itself and raises `registration-unread`. CATAPULT's proxy passes a `GET`
  on statements through, and `pnpm cmi5:catapult` launches the registration a second time, with
  `reg` and `launchMode: 'Normal'` (it defaults to Review once satisfied), and expects
  `initialized` and `terminated` and nothing else from it. What follows was learned while the
  wiring was the page's.
  Chosen on 2026-09-30 over SCORM and LTI: the package stays on a static host, the AU can
  demand its own window (`launchMethod="OwnWindow"`), the token is per launch instead of LRS
  credentials in page code, and `context.revision` survives to the LRS. `OwnWindow` was then
  taken to be required, to keep the player out of a cross-origin iframe and the Safari gap it
  was believed to have; with framed players measured working on 2026-10-03, the examples
  dropped it on 2026-10-04 and the LMS chooses (`AnyWindow`, cmi5's default), as do
  `demo/cmi5-course.zip` and the CATAPULT course — SCORM Cloud launched the demo course framed
  that day and recorded the quiz. It stays documented for an LMS on plain `http` and an LMS
  iframe without `allow="fullscreen"`.
  Exit in a frame follows 10.2.6.0-1, "the current browser window or frame", to `returnURL`;
  with none, `exit()` closes only a top-level window, and the demo page says to go back to the
  course.
  The client keeps the shape `@xapi/cmi5` had, so a simulated LMS can stand in for it, and three
  things about that shape matter: `sendXapiStatement` sends what it is given, so
  `allowedStatement` builds allowed statements — the launch actor, the registration, the
  context template merged in, lists in `contextActivities` joined, and no cmi5 category, which
  would mark the statement as cmi5-defined; `moveOn` sends `passed`/`failed` by the mastery
  score and `completed` in one call, and `terminated` too unless `disableSendTerminated`, which
  `startCmi5` sets so the learner can keep going until Exit; and `passed` or `failed` are judged
  only when the launch data's mastery score is truthy. There
  is no `terminated` on unload: a page cannot tell a reload from a closed tab, and one sent on a
  reload ended the session the reloaded page went on using, every statement after it refused
  with 8.1.2.0-2 — found in review on 2026-10-01 and reproduced against CATAPULT. A tab closed
  without Exit is the LMS's to record as `abandoned`, which is what that verb is for. The page
  listens to the element before the handshake, because the package loads meanwhile, and holds
  what the content emits until `initialized` has gone out; it once attached its listeners after
  the handshake, and anything emitted in between was lost. `returnURL` comes from the launch
  data only, where cmi5 puts it, and is followed only as an `http` or `https` address — it was
  once also read from the query string, on an article's word, and a `javascript:` value would
  have run in the page on Exit. Until the demo's tests went on 2026-10-17, one ran the page
  against a mock LMS and LRS and pinned the order and the merge, `revision` included, a rejected
  second fetch after reload, a statement emitted before the handshake, and a `returnURL` that
  is not followed. **Proven against ADL's CATAPULT player** — the reference launching
  system, which validates each statement against the numbered requirements and rejects a
  breach naming it — by `pnpm cmi5:catapult` (`apps/demo/scripts/cmi5-catapult.mjs`,
  `apps/demo/cmi5-catapult/docker-compose.yml`): adlnet/CATAPULT fetched at a pinned commit
  (`CATAPULT_COMMIT`, 2026-01-20), its player built from source beside MySQL and Yet Analytics'
  SQL LRS pinned at v0.9.8, the published ports on `127.0.0.1` only, a tenant and token through the
  player's API, the course structure imported as `text/xml` with an absolute AU URL, a launch
  URL from `POST /course/{id}/launch-url/0`, the page driven headless — one question of the
  real quiz answered so H5P's own `interacted` and `answered` go through
  the player's validation, the finish dispatched as the element's `finished` event, Exit — and
  the session and the LRS's statements read back. Chosen over SCORM Cloud on 2026-10-01:
  open, local, scriptable, and it says which requirement a wrong statement broke. SCORM Cloud
  launched the hosted page from `demo/cmi5-course.zip` the same day and recorded it, on the
  `@xapi/cmi5` build. Passed on 2026-10-01. What it took to
  get there, in the order it was found: upstream's Dockerfile runs `npm ci --only=production`,
  which the npm in `node:18` refuses, and its lockfile is out of step with its `package.json`,
  so the compose file builds the player from an inline Dockerfile with `npm install --omit=dev`;
  the player answers no preflight and puts no CORS header on its fetch route, since CATAPULT
  expects an nginx that serves player and content from one host, so the stack has an nginx
  `gateway` in front of the player that answers `OPTIONS` itself and adds the headers to every
  response, and the player is reached only through it; the player forwards the browser's
  `Origin` header to the LRS, whose own CORS policy answers a plain-text 403 for an origin it
  was not told about, so the SQL LRS runs with `LRSQL_ALLOW_ALL_ORIGINS` — the 403 that looks
  like the player's is the LRS's, and the way to tell is that the player's errors are JSON with
  a `violatedReqId`; and a score on `passed` must carry `min` and `max` beside `raw`
  (requirement 9.5.1.0-3), which H5P's scores lack, so the page adds `min: 0`. Two things it
  had already made the page do: relayed statements get an `id`, which the player checks for;
  and the `fetch` URL answers once, so the default keeps its token only in memory. The
  `storage` option is for a trusted AU on a trusted origin only: H5P content scripts share the
  origin and can read browser storage. A kept record is found by the `fetch` URL and names the
  `endpoint`, `registration` and `activityId` it was made under; one that names others is
  ignored, so a token is never sent to an endpoint other than its own (2026-10-04). The page shows the LMS's stated reason for a refused
  statement, not only the
  status. The deployed page was launched from the local player once (`--au`), on 2026-10-01,
  under a `connect-src` widened to `http://localhost:*` for the run and narrowed again after:
  it worked, with Chrome's Local Network Access prompt ("Access other apps and services on this
  device") to answer first, since a public site was reaching a local address. Learners see that
  prompt only when a public page's LMS, LRS or package is on a private network; a public LMS
  prompts no one. The CTS and LTS parts of
  CATAPULT are not used: the CTS adds a UI, accounts and nginx over the same player, and the
  LTS tests the LMS side. The player returns a session's columns in camel case
  (`isInitialized`), not the snake case of its tables; `--open` once waited on the snake-case
  names and never returned.
