# cmi5

`@missing-elements/h5p-cmi5`, the demo's cmi5 page on it, and the check against ADL's CATAPULT.

- **cmi5 is `@missing-elements/h5p-cmi5`, `/demo/cmi5.html` is a page on it, and the element
  knows nothing about either.** A host installs the package instead of copying the wiring; the
  demo aliases the package's name to its source, as it does the element's, and the page keeps
  only the log, the status line and the simulated LMS, which it passes as `client`. cmi5 was
  chosen over SCORM and LTI because the package stays on a static host, the AU can demand its own
  window (`launchMethod="OwnWindow"`), the token is per launch instead of LRS credentials in page
  code, and `context.revision` survives to the LRS.
  The package has no dependencies. `@xapi/cmi5` did the protocol once, but its browser build
  carried its own copies of axios, `@xapi/xapi`, uuid and deepmerge (90 kB, against 12.6 kB for
  the demo page's whole chunk) for a token `POST`, two reads and statement `POST`s. `src/client.ts`
  replaced it and sends what it sent. It reads the learner preferences, because CATAPULT
  requires it (11.0.0.0-3, the AU MUST retrieve them on startup), and hands them to the host for
  the audio preference the element cannot apply.
  `tests/requirements.test.ts` reads ADL's own requirement list, `@cmi5/requirements` (a dev
  dependency, the list CATAPULT checks against), selects every requirement whose subject is not
  plainly the LMS, and fails unless each is answered: `tested`, with its number in a comment
  beside the test that shows it, or `catapult`, `host`, `design`, `course`, `gap`, `n/a`, `lms`
  or `umbrella` with a reason. The filter must not keep only requirements that name the AU: the
  rules on the verbs and the result properties never do ("Verbs MUST NOT be duplicated").
  What the list fixed in the client, and what holds now:
  - The context template wins over the statement's own context (10.2.1.0-7).
  - `completed` carries the score only when the launch has a mastery score; only `passed` and
    `failed` may carry it otherwise (9.5.1.0-2). Without a mastery score nothing could send
    `passed`, so the content's own `success` decides (`judge`); otherwise a course with
    `moveOn="Passed"` could never be satisfied.
  - The client never sends a second `failed` in a session (9.3.0.0-3).
  - `completed` and `passed` are sent once per registration, not once per launch (9.3.0.0-6 to
    9.3.0.0-8). In a Normal launch, `initialize` asks the LRS for this registration's
    `completed` and `passed` about this AU — two statements queries, `limit=1` — and `moveOn`
    sends neither again, nor `failed` after `passed`. An LRS that refuses the read leaves the
    session counting for itself and raises `registration-unread`. CATAPULT's proxy passes a `GET`
    on statements through, and `pnpm cmi5:catapult` launches the registration a second time, with
    `reg` and `launchMode: 'Normal'` (it defaults to Review once satisfied), and expects
    `initialized` and `terminated` and nothing else from it.
  - A score on `passed` carries `min` and `max` beside `raw` (9.5.1.0-3), which H5P's scores
    lack, so the page adds `min: 0`.
  - Relayed statements get an `id`, which the player checks for.

  `OwnWindow` is not required: the examples leave it out and the LMS chooses (`AnyWindow`,
  cmi5's default), as do `demo/cmi5-course.zip` and the CATAPULT course; players framed by an LMS
  work. It stays documented for an LMS on plain `http` and an LMS iframe without
  `allow="fullscreen"`. Exit in a frame follows 10.2.6.0-1, "the current browser window or
  frame", to `returnURL`; with none, `exit()` closes only a top-level window, and the demo page
  says to go back to the course.
  The client keeps the shape `@xapi/cmi5` had, so a simulated LMS can stand in for it, and three
  things about that shape matter: `sendXapiStatement` sends what it is given, so
  `allowedStatement` builds allowed statements — the launch actor, the registration, the
  context template merged in, lists in `contextActivities` joined, and no cmi5 category, which
  would mark the statement as cmi5-defined; `moveOn` sends `passed`/`failed` by the mastery
  score and `completed` in one call, and `terminated` too unless `disableSendTerminated`, which
  `startCmi5` sets so the learner can keep going until Exit; and `passed` or `failed` are judged
  only when the launch data's mastery score is truthy.
  There is no `terminated` on unload: a page cannot tell a reload from a closed tab, and one sent
  on a reload ended the session the reloaded page went on using, every statement after it refused
  with 8.1.2.0-2. A tab closed without Exit is the LMS's to record as `abandoned`. The page
  listens to the element before the handshake, because the package loads meanwhile, and holds
  what the content emits until `initialized` has gone out. `returnURL` comes from the launch
  data only, where cmi5 puts it, and is followed only as an `http` or `https` address, since a
  `javascript:` value would run in the page on Exit. The `storage` option is for a trusted AU on
  a trusted origin only: H5P content scripts share the origin and can read browser storage. The
  `fetch` URL answers once, so the default keeps its token only in memory; a kept record is found
  by the `fetch` URL and names the `endpoint`, `registration` and `activityId` it was made under,
  and one that names others is ignored, so a token is never sent to an endpoint other than its
  own. The page shows the LMS's stated reason for a refused statement, not only the status.
  **Proven against ADL's CATAPULT player** — the reference launching
  system, which validates each statement against the numbered requirements and rejects a
  breach naming it — by `pnpm cmi5:catapult` (`apps/demo/scripts/cmi5-catapult.mjs`,
  `apps/demo/cmi5-catapult/docker-compose.yml`): adlnet/CATAPULT fetched at a pinned commit
  (`CATAPULT_COMMIT`), its player built from source beside MySQL and Yet Analytics' SQL LRS
  pinned at v0.9.8, the published ports on `127.0.0.1` only, a tenant and token through the
  player's API, the course structure imported as `text/xml` with an absolute AU URL, a launch
  URL from `POST /course/{id}/launch-url/0`, the page driven headless — one question of the
  real quiz answered so H5P's own `interacted` and `answered` go through the player's
  validation, the finish dispatched as the element's `finished` event, Exit — and the session
  and the LRS's statements read back. It was chosen over SCORM Cloud because it is open, local,
  scriptable, and says which requirement a wrong statement broke. What the setup needs:
  - Upstream's Dockerfile runs `npm ci --only=production`, which the npm in `node:18` refuses,
    and its lockfile is out of step with its `package.json`, so the compose file builds the
    player from an inline Dockerfile with `npm install --omit=dev`.
  - The player answers no preflight and puts no CORS header on its fetch route, since CATAPULT
    expects an nginx that serves player and content from one host. So an nginx `gateway` sits in
    front of the player, answers `OPTIONS` itself and adds the headers to every response, and
    the player is reached only through it.
  - The player forwards the browser's `Origin` header to the LRS, whose own CORS policy answers
    a plain-text 403 for an origin it was not told about, so the SQL LRS runs with
    `LRSQL_ALLOW_ALL_ORIGINS`. The way to tell that 403 from the player's is that the player's
    errors are JSON with a `violatedReqId`.
  - The player returns a session's columns in camel case (`isInitialized`), not the snake case of
    its tables.

  The deployed page can be launched from the local player (`--au`) under a `connect-src` widened
  to `http://localhost:*` for the run: Chrome's Local Network Access prompt ("Access other apps
  and services on this device") has to be answered first, since a public site is reaching a local
  address. Learners see that prompt only when a public page's LMS, LRS or package is on a private
  network. The CTS and LTS parts of CATAPULT are not used: the CTS adds a UI, accounts and nginx
  over the same player, and the LTS tests the LMS side.
