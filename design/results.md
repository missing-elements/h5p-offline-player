# Results and saved state

What reaches the host from the content: statements and the build they name, `finished`, and the saved state `resume` keeps. The code: `packages/player/src/shared/revision.ts`, `src/user-data-store.ts`, the element's statements and user data, and `packages/runtime/src/finished.ts`.

## Invariants

- **Every statement names the build it came from.** For compliance training the completion record
  is the audit trail, and it has to prove *which version* of the `.h5p` each learner completed. The
  element fills in the two fields xAPI defines for it on every `xapi` and `finished` statement,
  just before dispatching (`withProvenance` in `src/shared/revision.ts`): `context.revision`,
  "revision of the learning activity associated with this Statement. Format is free", and
  `context.platform`, `h5p-offline-player <version>`. They are not a `context.extensions` value
  under an IRI of ours: every xAPI tool understands `revision`, and an extension means nothing
  without a profile documenting it. H5P core sets neither; a value the content set itself is kept,
  and a statement whose object is not an Activity is left alone, since the spec allows both fields
  only there. The revision is `indexFingerprint`: SHA-256 over the central directory's records in
  archive order, each the raw name's length and bytes, the CRC, both sizes as u64 and the method,
  little-endian. `PackageReader.open` computes it and returns it on the `indexed` reply, with each
  attached bundle's after it (`sha256:…; libraries sha256:…`), because the hub changes what a
  stripped export plays against; for several attached archives, the parts of the pack a package
  used, one `librariesFingerprint` over theirs (see the split pack's invariant). It covers the
  index rather than the whole file, because the index is read anyway and a range-read package never
  is. CRC-32 can be forged on purpose, so the revision identifies a build and does not seal one:
  the kept `.h5p` is what an audit recomputes it from. Dates, comments and extra fields stay out;
  order is in. On a host without `Range` the frame boots from the forward index, before there is a
  central directory, so `emitStatement` holds statements until the index answers and releases them
  in order, and on any end of the load (`abortLoad`), or when the page is hidden (`pagehide`, or
  `visibilitychange` to hidden, the one mobile browsers fire reliably), with no revision if none
  came, rather than lose a learner's record with the tab. `@missing-elements/h5p-cmi5` relays such
  a statement too, requiring `context.platform` only.

  The old content can still send a statement as the next load starts, when `internalPkgId` is null
  and the message filter lets it through: `previousStamp` stamps such a straggler with its own
  package's revision instead of holding it for the next one's, and `playback.test.ts` clicks the
  old frame's button mid-load to pin it. The frame is emptied with `location.replace` (*The frame
  is navigated in place*), which navigates the document away, and a statement the old document
  sent just before then arrives with `event.source` null. So a null-source `xapi` or `finished`
  naming `previousStamp`'s package is accepted ahead of the source check, and nothing else from a
  document that is gone; a null source proves no more than a same-origin sender, and same-origin
  script can dispatch an `xapi` event on the element directly anyway. `clear()` drops the revision
  with the `pkgId`, so a host never reads one package's id beside another's build.
  `packages/normalize/lib/fingerprint.mjs` is the same recipe for Node, and the normalizer prints
  the output's revision, the line a publisher records at release; `revision.test.ts` checks both
  against one vector, which is why the player's `tsconfig.test.json` has `rootDir: ".."`.

  *When* a build was current is deliberately not here: nothing in a package can record that it has
  been replaced. xAPI says a major change takes a new Activity id and `revision` is for minor
  fixes, cmi5 and SCORM define no version dates, SCORM Cloud keeps every uploaded version with
  registrations tied to one, and 21 CFR Part 11 LMSs keep version history as a requirement. So that
  record is the organisation's (LRS, LMS or document control), and a major change served at a new
  URL gets a new Activity id under H5P's own scheme, whose id is the content URL.
- **`finished` is the content's result: H5P's own rule, and the core's mark on sub-content.** The
  core's `xAPICompletedListener`, which the CMS plugins record a result through (`setFinished`),
  takes a `completed` or `answered` statement with no `context.contextActivities.parent`: from the
  content itself, not from a part inside it. `isResult` in the runtime's `src/finished.ts` is that
  rule, with the boot script as its one caller; the element only relays, so an older player gets
  it with the runtime. Without it a single Multiple Choice, which says only `answered`, never
  finishes, and a Question Set inside a Column finishes twice, for the inner set and then for the
  Column; cmi5 records the first `finished` of a registration, so it would complete on the wrong
  one. A question checked again says `answered` again, so `finished` can come more than once in a
  load; the last is the result, as with `setFinished`. `finished.test.ts` plays `finished.h5p`, the
  fixture content type with an Answer button, a child of itself as a part, and another child run
  without a parent, and fails on the first rule for the part and for the answer, and on H5P's rule
  for the part without a parent.

  Some content types create their parts without a parent, so a part's result passes H5P's rule and
  the core's `setFinished` records it as the content's: Interactive Book 1.15 creates each chapter
  with `parent: self`, which in that scope is the window, so a chapter's `completed` is parentless;
  Game Map 1.5's exercise in a stage sends its `answered` with no parent; Virtual Tour 0.5 runs its
  interactions the same way. cmi5 would complete a unit holding a book or a map on its first part.
  So `isResult` also refuses a statement whose object carries
  `http://h5p.org/x-api/h5p-subContentId`, which the core's `setObject` writes for every instance
  with a `subContentId` and never for the content's own, parent or not. A part saved without a
  `subContentId` (content from before H5P's editor wrote one, or written by hand or by a tool that
  writes none) carries no mark and still counts as the content, as under H5P's rule. The departure
  from `setFinished` is deliberate: the parent stands in for "from the content itself", and the
  mark says it. The content's own `completed` comes after, on finishing; Interactive Book's only
  with `reporting`, which gives its summary page the submit button. A content type that reports
  nothing of its own never finishes: a book without `reporting`, a Virtual Tour. Of the pack's 55
  content types, 32 end with a result of their own and 19 send none.
- **The saved state never leaves the page, and never meets the Service Worker.** `resume` is
  H5P's own save-and-resume — core asks each instance for `getCurrentState()` every `saveFreq`
  seconds, three seconds after a `completed` or `progressed` statement and as the document goes
  away, and hands `previousState` to the constructor — wired to the element instead of a site's
  `contentUserData` endpoint. The worker does not answer a `userdata` route or inline the state
  into the frame document. Core refuses to save at all without a signed-in `H5PIntegration.user`,
  and a user rewrites the actor of every xAPI statement, so the AJAX path cannot be used as it is;
  the frame's boot script replaces `H5P.getUserData`, `setUserData` and `deleteUserData` with
  versions that talk to the element by `postMessage`, keeping what core relies on: a value handed
  over synchronously, a save sent only when it differs from the last, `null` in a preload meaning
  "another build", which core answers with its own "content has changed, starting over" dialog and
  a delete. The store is a database of the page's own (`user-data-store.ts`,
  `USER_DATA_DB_NAME`), not a second object store in the worker's: the worker holds a long-lived
  connection at `DB_VERSION`, and a page that bumped the version would leave a worker still running
  the older code unable to open it. The element already owns the host-facing surface:
  `resume="host"` hands every save to the host as a `userdata` event and takes `userData` back,
  with nothing stored, so the worker's statelessness is untouched. Consequences: the frame's boot
  script asks the element for the state *before* it loads the runtime (`?resume=1` on the frame URL
  says to), because core registers its unload-time save while loading, on the `saveFreq` it sees
  then; and the boot script initialises the runtime itself, the core's `preventInit` holding the
  init back between loading the scripts and `H5P.init()`. A save is authenticated by a token the
  element handed that document, not by `event.source`: the last save is posted as the document
  unloads, and by the time the element handles it the sender is gone and `source` is null.
  `clearUserData()` withdraws the token, so the document still running, and that last save, sent
  when the next load replaces it, cannot bring back what the host just cleared. Rows are stamped
  with the build's `revision`; on a host without `Range` the frame boots before the index can say,
  so such a row is written with `null` and stamped once the index answers (`adoptRevision`), and
  while the build is unknown a saved state is handed over unchecked, since the package id already
  separates builds on any host that sends a validator. The mode is read once per load
  (`loadResumeMode`) and again latched with the frame's save session (`userDataMode`): `resume`
  takes effect on the next load, since reading it live let a host that switched it mid-lesson drop
  the running frame's next save, or leave an early save on a host without `Range` unstamped.
  `save-interval` is the `saveFreq` the frame is handed, ten seconds by default, read once per load
  the same way; the CMS plugins default to thirty and make it a setting. `resume.test.ts` drives
  all of it through the fixture content type, which counts presses of Complete.
  **The content's id is the same on every load of a package** (#127), as a site's row number is: a
  number made from the package's id, twelve of its hex digits (`contentIdOf` in the boot script),
  so that it names what the saved state is kept under. Content types keep places by it:
  Interactive Book stores its chapter under it, in its state and in the page's address
  (`urlFragments`, `h5pbookid`), and takes it back only when the id matches; Cornell Notes keeps a
  copy of its notes in `localStorage` under it, read only for a number (`typeof … === 'number'`,
  which is why the id is one, and why it has twelve digits, which a double holds exactly: the core
  reads it back through jQuery's `.data()`, which turns a string of digits into a number). A random
  id would reopen every book on its first chapter, with its answers, in any `resume` mode and in
  the SCORM zip. One consequence: two players of one book on one page share the address's chapter
  and turn pages together, as two copies of one content do on a site.
