# Results and saved state

What reaches the host from the content: statements and the build they name, `finished`, and the saved state `resume` keeps. The code: `packages/player/src/shared/revision.ts`, `src/user-data-store.ts`, the element's statements and user data, and `packages/runtime/src/finished.ts`.

## Invariants

- **Every statement names the build it came from.** Raised on 2026-09-26 from a
  compliance-training perspective: the completion record is the audit trail, and it has to prove
  *which version* of the `.h5p` each learner completed. The element fills in the two fields xAPI
  defines for it on every `xapi` and `finished` statement, just before dispatching
  (`withProvenance` in `src/shared/revision.ts`): `context.revision`, "revision of the learning
  activity associated with this Statement. Format is free", and `context.platform`,
  `h5p-offline-player <version>`. Not a `context.extensions` value under an IRI of ours, as first
  planned: every xAPI tool understands `revision`, and an extension means nothing without a
  profile documenting it. H5P core sets neither (checked in `frame.bundle.js`); a value the content
  set itself is kept, and a statement whose object is not an Activity is left alone, since the
  spec allows both fields only there. The revision is `indexFingerprint` — SHA-256 over the
  central directory's records in archive order, each the raw name's length and bytes, the CRC, both
  sizes as u64 and the method, little-endian — computed by `PackageReader.open` and returned on the
  `indexed` reply, with each attached bundle's after it (`sha256:…; libraries sha256:…`), because
  the hub changes what a stripped export plays against; for several attached archives, the parts
  of the pack a package used, one `librariesFingerprint` over theirs (see the split pack's
  invariant). The index rather than the whole file,
  because it is read anyway and a range-read package never is; decided on 2026-09-28 knowing that
  CRC-32 can be forged on purpose, so it identifies a build and does not seal one — the kept `.h5p`
  is what an audit recomputes it from. Dates, comments and extra fields stay out; order is in. On a
  host without `Range` the frame boots from the forward index, before there is a central directory,
  so `emitStatement` holds statements until the index answers and releases them in order — and on
  any end of the load (`abortLoad`), or when the page is hidden (`pagehide`, or `visibilitychange`
  to hidden, the one mobile browsers fire reliably), with no revision if none came, rather than
  lose a learner's record with the tab. `@missing-elements/h5p-cmi5` relays such a statement too, requiring
  `context.platform` only (2026-10-10); until then it dropped it for the missing revision. The old content can still send a statement as the next
  load starts, when `internalPkgId` is null and the message filter lets it through:
  `previousStamp` stamps such a straggler with its own package's revision instead of holding it
  for the next one's — found in review, and `playback.test.ts` clicks the old frame's button
  mid-load to pin it. This file once said removing the iframe's `src` does not unload the document;
  in Chromium it navigates the frame to `about:blank`, and a statement the old document sent just
  before then arrives with `event.source` null, which the source check dropped. The frame is
  emptied with `location.replace` now (*The frame is navigated in place*), which unloads it the
  same way. Found on 2026-10-10: the test failed on CI, and run alone it failed 14 times in 15 —
  it had passed only when the message happened to be handled before the navigation committed. So
  a null-source
  `xapi` or `finished` naming `previousStamp`'s package is accepted ahead of the source check, and
  nothing else from a document that is gone; a null source proves no more than a same-origin
  sender, and same-origin script can dispatch an `xapi` event on the element directly anyway. `clear()` drops
  the revision with the `pkgId`, so a host never reads one package's id beside another's build. `packages/normalize/lib/fingerprint.mjs` is the same recipe for Node, and the normalizer
  prints the output's revision, the line a publisher records at release; `revision.test.ts` checks
  both against one vector, which is why the player's `tsconfig.test.json` has `rootDir: ".."`.
  *When* a build was current is deliberately not here: nothing in a package can record that it has
  been replaced. Researched the same day, prompted by a follow-up comment asking for a manifest of
  hashes to versions and dates: xAPI says a major change takes a new Activity id and `revision` is
  for minor fixes, cmi5 and SCORM define no version dates, SCORM Cloud keeps every uploaded version
  with registrations tied to one, and 21 CFR Part 11 LMSs keep version history as a requirement. So
  that record is the organisation's — LRS, LMS or document control — and a major change served at a
  new URL gets a new Activity id under H5P's own scheme, whose id is the content URL.
- **`finished` is the content's result: H5P's own rule, and the core's mark on sub-content.** The core's `xAPICompletedListener`,
  which the CMS plugins record a result through (`setFinished`), takes a `completed` or `answered`
  statement with no `context.contextActivities.parent`: from the content itself, not from a part
  inside it. Up to runtime 0.2.1 the boot script posted `finished` on any `completed`, parent or
  not, and never on `answered`. Measured on 2026-10-13 with packages built from the demo quiz and
  played against the pack: a single Multiple Choice says only `answered`, so it never finished; a
  Question Set inside a Column finished twice, first for the inner set with its own score, then for
  the Column. cmi5 records the first `finished` of a registration, so a single-question unit never
  completed and a unit holding a quiz as a part completed on that part. `isResult` in the runtime's
  `src/finished.ts` is the rule now, with the boot script as its one caller; the element only
  relays, so an older player gets it with the runtime. A question checked again says `answered`
  again, so `finished` can come more than once in a load; the last is the result, as with
  `setFinished`. `finished.test.ts` plays `finished.h5p` — the fixture content type with an Answer
  button, a child of itself as a part, and another child run without a parent — and fails on the
  first rule for the part and for the answer, and on H5P's rule for the part without a parent.
  Measured across the pack on 2026-10-14 with the sweep's first cut, which worked each type
  through by hand-written steps (*The content-type sweep* says why those went): 32 of the 55
  content types end with a result of their own — `answered` from 19 question types,
  `completed` from 13 sets, containers and games, Image Pair and Questionnaire among them — 19 send
  none, and 4 cannot be worked through headless. Two create their parts without a parent, so a
  part's result passes H5P's rule, and the core's `setFinished` records it as the content's:
  Interactive Book 1.15 creates each chapter with `parent: self`, which in that scope is the window,
  so a chapter's `completed` is parentless (twice, for a chapter holding one question); and Game
  Map 1.5's exercise in a stage sends its `answered` with no parent. Virtual Tour 0.5 runs its
  interactions the same way, read in its code, since the sweep cannot open a scene. Up to runtime
  0.2.2 the element did as the core does, and cmi5, which records the first `finished`, completed a
  unit holding a book or a map on its first part. So `isResult` also refuses a statement whose
  object carries `http://h5p.org/x-api/h5p-subContentId`, which the core's `setObject` writes for
  every instance with a `subContentId` and never for the content's own, parent or not; measured the
  same day, every chapter and exercise statement carries it, and so does every statement with a
  parent that the sweep reached. A part saved without a `subContentId` — content from before H5P's
  editor wrote one, or written by hand or by a tool that writes none — carries no mark and still
  counts as the content, as under H5P's rule. The departure from
  `setFinished` is deliberate: the parent stands in for "from the content itself", and the mark
  says it. The content's own `completed` comes after, on finishing — Interactive Book's only with
  `reporting`, which gives its summary page the submit button. A content type that reports nothing
  of its own never finishes: a book without `reporting`, a Virtual Tour.
- **The saved state never leaves the page, and never meets the Service Worker.** `resume` is
  H5P's own save-and-resume — core asks each instance for `getCurrentState()` every `saveFreq`
  seconds, three seconds after a `completed` or `progressed` statement and as the document goes
  away, and hands `previousState` to the constructor — wired to the element instead of a site's
  `contentUserData` endpoint. Built on 2026-09-30, not as the design under *Not built yet* had
  it: that had the worker answer a `userdata` route and inline the state into the frame
  document. Three things decided otherwise. Core refuses to save at all without a signed-in
  `H5PIntegration.user`, and a user rewrites the actor of every xAPI statement, so the AJAX
  path cannot be used as it is; the frame's boot script replaces `H5P.getUserData`,
  `setUserData` and `deleteUserData` with versions that talk to the element by `postMessage`,
  keeping what core relies on — a value handed over synchronously, a save sent only when it
  differs from the last, `null` in a preload meaning "another build", which core answers with
  its own "content has changed, starting over" dialog and a delete. The store is a database of
  the page's own (`user-data-store.ts`, `USER_DATA_DB_NAME`), not a second object store in the
  worker's: the worker holds a long-lived connection at `DB_VERSION`, and a page that bumped
  the version would leave a worker still running the older code unable to open it. And the
  element already owns the host-facing surface — `resume="host"` hands every save to the host
  as a `userdata` event and takes `userData` back, with nothing stored — so the worker's
  statelessness is untouched. Consequences: the frame's boot script asks the element for the
  state *before* it loads the runtime (`?resume=1` on the frame URL says to), because core
  registers its unload-time save while loading, on the `saveFreq` it sees then; and the boot
  script initialises the runtime itself, the core's `preventInit` holding the init back between
  loading the scripts and `H5P.init()` (h5p-standalone's inverted `preventH5PInit: false` until
  #37). A save is authenticated by a token the
  element handed that document, not by `event.source`: the last save is posted as the document
  unloads, and by the time the element handles it the sender is gone and `source` is null.
  `clearUserData()` withdraws the token, so the document still running — and that last save,
  sent when the next load replaces it — cannot bring back what the host just cleared. Rows are
  stamped with the build's `revision`; on a host without `Range` the frame boots before the
  index can say, so such a row is written with `null` and stamped once the index answers
  (`adoptRevision`), and while the build is unknown a saved state is handed over unchecked — the
  package id already separates builds on any host that sends a validator. The mode is read
  once per load (`loadResumeMode`) and again latched with the frame's save session
  (`userDataMode`, PR #1, 2026-10-04): `resume` takes effect on the next load, and reading it
  live let a host that switched it mid-lesson drop the running frame's next save, or leave an
  early save on a host without `Range` unstamped. `save-interval` (2026-10-13) is the
  `saveFreq` the frame is handed, ten seconds by default, read once per load the same way; the
  CMS plugins default to thirty and make it a setting. `resume.test.ts`
  drives all of it through the fixture content type, which counts presses of Complete.
  **The content's id is the same on every load of a package** (#127, 2026-11-04), as a site's row
  number is: a number made from the package's id, twelve of its hex digits (`contentIdOf` in the
  boot script), so that it names what the saved state is kept under. Content types keep places by
  it: Interactive Book stores its chapter under it, in its state and in the page's address
  (`urlFragments`, `h5pbookid`), and takes it back only when the id matches; Cornell Notes keeps a
  copy of its notes in `localStorage` under it, read only for a number (`typeof … === 'number'`,
  which is why the id is one, and why it has twelve digits, which a double holds exactly: the core
  reads it back through jQuery's `.data()`, which turns a string of digits into a number). Until
  then it was random, as h5p-standalone gave it, so every book reopened on its first chapter, with
  its answers, in any `resume` mode and in the SCORM zip, measured in Moodle and in the player.
  One consequence: two players of one book on one page share the address's chapter and turn
  pages together, as two copies of one content do on a site.
