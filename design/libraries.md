# Libraries

Which libraries a package plays with: the check that it has them, the sources in `libraries` and their order, the library pack and its parts, the refresh to the pack's newer versions, the older minor for content that names a newer one, addons, and the manifest the runtime is served. The code: `packages/player/src/sw/pack-plan.ts`, `src/shared/` (`library-folders.ts`, `content-libraries.ts`, `pack.ts`, `pack-index.ts`), `src/plan.ts`, the element's `index()`, and `packages/libraries/`.

## Invariants

- **A package is refused at index time if it does not carry its own libraries.** `h5p.json`
  declares `preloadedDependencies`; each one must appear as `<name>-<major>.<minor>/library.json`
  or `<name>/library.json`. This is not a nicety: exports from h5p.com and h5p.org routinely
  contain nothing but `h5p.json` and `content/`, because the site they came from already has the
  libraries. Without the check, h5p-standalone, the loader until #37, asked for
  `<MainLibrary>/library.json`, took the 404 as "these folders are unversioned", asked again
  without the version, took a second 404 and failed with nothing anyone could act on. `findMissingLibraries` is pure and unit-tested; the
  end-to-end case is the `content-only.h5p` fixture.
  **The libraries' own dependencies are checked too, once their files are at hand** (2026-10-13).
  A platform's export lists the whole tree in `h5p.json`, but an old one can name a version its
  own libraries have moved past: h5p.org's Impressive Presentation carries Font Awesome 4.3 where
  six of its libraries ask for 4.5, and h5p-standalone, which follows every `library.json`'s
  `preloadedDependencies`, read the 404 as JSON and ended the boot with "Unexpected end of JSON
  input". `PackageReader.missingDependencies` walks the same tree over the manifest the runtime
  is served, a level at a time, and what nothing reachable provides is refused like a missing
  top-level library — so the element asks the `libraries` sources for it, and that package plays
  with the pack. The element asks for it with `deep` on `index`: at once for a picked file or a
  downloaded archive, and on a host with `Range` only after the warm, reading each `library.json`
  from the cache, since before it each would be a ranged request (two before the block cache, in
  *Small reads over HTTP go through a block cache*). `needs-dependency.h5p` is
  the fixture, laid out as an export is: its library folder first, media last.
  On a host without `Range` the deep check waits for the end of the download, and the frame can
  boot before then from the forward index, so the same walk decides that too (`bootsEarly` in
  `mount.ts`, on the partial reader): a dependency absent so far keeps the frame waiting for the
  download, where the deep check attaches a bundle or refuses the package. Found on 2026-10-14,
  when the merge of 0.9.1 failed once in WebKit on CI: `bootReady` checked only what `h5p.json`
  declares, the frame booted while the media was arriving, and the runtime's request for the
  missing `library.json` got its 404 before the bundle was attached. The fixture then ended with
  its library folder, which left the race a few milliseconds wide; paced through `?throttle=`
  with its media last, it failed every time in Chromium. While a dependency is absent, every
  progress report walks the tree again, a few local reads each.
  The element boots early only on `ready: true`, never on its absence. The last progress
  report's `index` can reach the worker after the download is whole, and the worker then answers
  from the central directory: no `ready`, since only a partial index has one, and no walk, since
  that is the final `deep` index's. Up to 0.9.3 the element booted unless `ready` was `false`, so
  on an unpaced download it booted on that answer every time, measured, and the runtime raced
  the bundle's attachment for the missing `library.json`; WebKit lost the race in 1 or 2 plays of
  30, Chromium in none, and CI caught it once more on 2026-10-14. A content-only export was never
  exposed: the plain index refuses a package missing a library `h5p.json` declares, so there is no
  answer to boot on. `libraries.test.ts` pins the states such a load goes through, `indexing`
  between the package's download and the bundle's.
- **A package may be served from more than one archive.** `PackageReader.get()` returns a
  `LocatedEntry` — the entry *and* the reader it came from — because `libraries` can attach a
  second archive to fill the gaps in a stripped export. Extracted bytes are cached against the
  owning archive's `pkgId`, not the package being played, so one library bundle is inflated once
  and shared by every package that uses it. Two consequences worth remembering: a job is always
  addressed at the archive that owns the entry, and a bundle registered with `role: 'libraries'`
  is never held to its own manifest.
- **When a bundle is attached, `h5p.json` is synthesized, not served.** A content-only export
  strips `preloadedDependencies` down to the main library as well as dropping the folders, so the
  runtime would load Interactive Video and none of the interaction types inside it — "Unable to
  find constructor for: H5P.Text". `mergedManifest()` lists, in this order: the content's own
  dependencies; every sub-content library `content/content.json` names (`librariesNamedIn`,
  objects whose `library` is `"<machineName> <major>.<minor>"`), which is what a full export's
  `h5p.json` would have listed; and the bundle's own dependencies. Each is kept only if it is
  reachable — its folder exactly, or a compatible newer minor by the rule `get()` serves with — and
  as the content wrote it, since the file server maps the folder. The middle step is not a
  refinement: it was found on 2026-09-29 building the app's library pack, whose `h5p.json` lists
  nothing, when three of four stripped demo exports booted and then threw on their sub-content.
  Until then only the hub had been attached, and a hub bundle's manifest happens to list its
  content type's usual set, which covered for it. `merged-manifest.test.ts` pins all three.
- **Addons are added as the platforms add them** (2026-10-13). An addon is a library whose
  `library.json` names, under `addTo.content.types[].text.regex`, the content it goes with:
  `H5P.MathDisplay`, for text holding LaTeX, is the one there is. The hub does not serve it; a
  site's administrator uploads it, and from then on `H5PCore::filterParameters` adds it as a
  dependency to every content whose parameters have a string matching the pattern
  (`textAddonMatches`). A content-only export loses it with the rest of the list, and played
  `untrusted`, a full export from a site that had it lists it and was refused against a pack
  without it. So the pack carries it — MathDisplay 1.0.50 from h5p.org, MathJax 4.1 in its own
  folder, 3 MB of the pack's 13.7 — and `mergedManifest()` adds, last, every addon an attached
  bundle carries (`PackageReader.addons`, the newest version of each, read once per bundle) whose
  pattern matches a string in `content.json` (`addonPatterns` turns PHP's `/…/flags` into a
  `RegExp`, leaving out what it cannot; `textMatches` walks the parameters). The bundle stands in
  for the platform's installed libraries, so nothing is added to a package played trusted with no
  bundle attached: one that carries its libraries and does not list MathDisplay shows raw LaTeX,
  as it would on a site without the addon. With the split pack (2026-10-18) the planner adds the
  addon's part from the index's `addTo` when the pack refreshes or fills anything, and the merged
  manifest then finds it as before. Checked in Chromium on the demo page with a
  content-only Accordion holding `\(…\)` and `$$…$$`: two formulas rendered, untrusted, no
  policy violation (`'self'` covers the fonts and the speech worker MathJax loads from the
  folder).
- **An unreachable library source falls back to a bundle downloaded from it before.** When the
  probe of `libraries`' URL fails — offline, the hub down, a 5xx — the element asks the worker
  (`find-downloaded-libraries`) for the newest `role: 'libraries'` row with the same URL whose
  archive is complete in the chunk store, and attaches that instead of failing. Complete, not
  just registered: a row outlives an eviction and a cut-short download. The URL, not the
  `pkgId`, is the key, because the id hashes the host's validator as well, which the failed
  probe never got. Online the probe still runs first, so a bundle the hub has changed is
  downloaded again under its new id. The question gets three seconds, not the control channel's
  thirty, and silence counts as "none": a worker older than the element — an `h5p-sw.js` copied
  before an update — does not know the message and never answers it. This is what lets the
  installable app play a stripped
  export offline; the fallback lives in the element, so any host gets it. Its tests in
  `libraries.test.ts` take the bundle host down with `/stalling/`'s `reset` outage, and give each
  play a content URL of its own — the worker keeps a package's reader with its bundle attached,
  and a replay would never need the libraries again.
- **`libraries="pack"` is the library pack the release pins, and the H5P hub is not asked.**
  Decided on 2026-10-10. H5P Group moved the hub from `api.h5p.org` to `hub-api.h5p.org` in 2026,
  with a newer catalogue behind it; the new host sends no `Access-Control-Allow-Origin` header, so
  a browser cannot read it, and the old one, which answers `*`, serves the catalogue of October
  2025. Rebuilding the pack from the new host on 2026-10-10 showed how far apart they were: almost
  every library newer, Question Set 1.21, Course Presentation 1.27 and Interactive Video 1.28
  against 1.20, 1.26 and 1.27, and `H5P.Components` new. So `hub` could not supply what a current
  h5p.com export needs, and it tied the element to a host H5P Group is replacing and to CORS it
  never promised. `pack` is `@missing-elements/h5p-libraries` on jsDelivr at `LIBRARY_PACK_VERSION`
  (its parts under `LIBRARY_PACK_BASE` since 2026-10-18, next invariant but two), which
  `sync-h5p-assets` stamps from `packages/libraries/package.json`;
  `hub` was read as `pack`, with a console note, from 0.6 to 0.10, and went before 1.0
  (2026-10-18, #44): an alias kept would have had to stay through 1.x, and a page still writing it
  now fails on the address `hub`, named in the error, rather than playing something it did not
  name. Pinned rather than `@0`, so a player release always plays against the same
  libraries, and `check-library-pack.mjs` in the player's `prepublishOnly` refuses a version not
  on npm, or one whose `parts/index.json` on jsDelivr is not this checkout's: the weekly refresh
  (`.github/workflows/libraries.yml`) bumps the pack on a branch and stamps the player — version
  and `pack-index.ts` — in the same change, and a player published after merging it but before
  the pack would send every stripped export to a 404, or have every part refused for its hash.
  The build scripts still read the hub's new host, from Node, which needs no CORS. `pnpm libraries`
  was broken from the code-smell scan of 2026-10-15 (e68f33e) until 2026-10-18: its loop ran as
  the module loaded, before the helpers below it were declared, and it named an undeclared `HUB`
  — the same fault `build-demo-content.mjs` had, found the same week. Until 2026-10-18 the pack
  was downloaded whole, about 14 MB, on first use; range-reading it was ruled out on 2026-10-11,
  since neither public CDN serves its ranges correctly — jsDelivr cuts them from a compressed copy
  (next invariant), unpkg ignores `Range` — and splitting it was what came of that.
- **jsDelivr cuts ranges from a compressed copy.** Found on 2026-10-10: a ranged request for the
  pack answers `206` with bytes from a brotli-sized copy of the file — `Content-Range: bytes
  0-3/9215927` for a 10,286,146-byte file, the bytes not starting `PK`, no `Content-Encoding` —
  from curl and from Chromium alike, and 0.1.0 the same (8.8 MB claimed for 9.95). `bytes=0-`
  returns the whole, correct file under the wrong `Content-Range`. A library bundle survives it
  because it is never range-read: the probe's size is wrong, but the download stores what
  arrives and the chunk writer records the bytes written as the size. The progress `fraction` is
  capped at 1 for this reason. A *package* served from jsDelivr would be range-read and break, so
  do not recommend jsDelivr for packages.
- **A library bundle is downloaded, never range-read.** It is read exhaustively — every library's
  JSON, scripts and styles — so the element registers it as `chunked` even when the host honours
  `Range`. Against the real H5P hub this was the difference between 76 and 7 seconds. A part of
  the pack is downloaded the same way.
- **The pack is split, a package downloads the parts it needs, and the pack's newer versions play
  in place of a package's older ones** (2026-10-18, issue #40). `packages/libraries/parts/` holds
  one archive per library folder, each with a minimal `h5p.json` of its own, which the reader
  requires, its entries copied from the pack as they are (zip.js `passThrough`), so a part's bytes
  change only when its library does and the weekly refresh commits only those; `parts/index.json`
  says each library's full version, dependencies and addon patterns and its archive's size and
  SHA-256. Every entry of the pack and its parts carries `FIXED_DATE` (`scripts/parts.mjs`), built
  from local fields, since a zip records a wall-clock time and zip.js reads the Date's local ones:
  built from UTC fields, it wrote 02:00 where the pack was built at UTC+2 and 00:00 on CI, whose
  first refresh after the split rewrote all 106 archives with no library changed (#48, closed
  unmerged; #51). `tests/unit/pack-bytes.test.ts` in the player builds in four zones, and the
  workflow stops with an error when the files change and no library's line in `libraries.txt`
  does. A library whose files are unchanged keeps its entries from the committed pack, order
  and compressed bytes included (`writePack`, #116): the build takes each library from the first
  hub bundle that carries its newest version, in that bundle's order, and the refresh of
  2026-11-02 (#111) rewrote 30 parts with no library changed, because the hub had rebuilt Branching
  Scenario's bundle, the first to carry them, with their files in another order. The workflow
  also stops when a part changes and its library's line does not, and the test holds both cases.
  Measured on the demo's packages: 2 to 16 parts, 0.04 to 1.5 MB, 4.0 MB for formulas
  (MathDisplay is 2.8 MB), against 14 MB whole. **Planning is the worker's** (`planFromPack` in
  `mount.ts`, the rules in `sw/pack-plan.ts`): an `index` that offers the pack (`pack` on the
  message: `{ pinned: true }` for `LIBRARY_PACK_BASE`, whose index the worker carries compiled in
  as `PACK_INDEX`, else the index of a copy the element hands over, from `pack-base` or the `pack`
  property) is answered with a `plan` when the pack has parts to supply, and nothing else; the
  element downloads them all at once (`runPartDownloads`, one `libraries` progress), registers
  each as a `role: 'libraries'` archive, indexes it, attaches them with `attach-libraries`
  (`parts`, added to the load's `parts`, and `superseded`), and indexes again. The library check
  moved out of opening the archive into `index` for this (`playable`): an index that offers the
  pack plans what is missing before anything is held to it. **The refresh rule**, on by default
  wherever the source is the pack, `refresh-libraries="off"` to turn it off: a library the package
  carries plays at the pack's version when the pack has the same major at a higher minor, or the
  same minor at a higher patch; equal, older or only another major keeps the package's own, with
  nothing downloaded. So does a library that a bundle listed before the pack already has at that
  major: the bundle would answer for the folder withheld, under the part's own folder name, which
  then is never planned, or at a lower minor, which a request resolves to first. Until #58 it did:
  the bundle's version played, and the pack's was reported. The rule needs each own
  `library.json` for the patch, so on a host with `Range` it waits for the deep index after the
  warm, where they are cached (before it, names give
  major and minor and nothing is refreshed). Only the folders the content reaches are read, from
  what it asks for at its top through each one's `preloadedDependencies`
  (`PackageReader.ownLibraries`, 2026-11-07, #148): a library nothing plays, an editor library or an
  older minor carried for an H5P site's upload check, keeps its name's version and is not
  refreshed. The warm leaves those folders out, so reading them would be a request each, and
  refreshing them downloaded parts nothing played: the demo's video fetched `H5P.SingleChoiceSet`
  1.11, 180 kB, and Image Sequencing the pack's `H5P.Audio` 1.5 for the 1.2 beside its own 1.5.
  A refreshed folder is withheld from the package's own
  index whole (`superseded`, as `untrusted` withholds), so requests for it resolve to the part's
  folder by the compatible-version rule `get()` already applies — exact for a patch, the newer
  minor otherwise — and the content upgrade sees the newer version and runs its steps, as for a
  content-only export; the runtime is untouched. Newest-per-major satisfies every dependency on
  both sides, since each side's requests are met by its own versions. A part's own dependencies
  always come from the pack, fill or not, and an older minor the package carries gives way to the
  version a part needs (`supersede` in the planner). **What the pack fills**: what the package
  lacks, from the start when `pack` is the first source and otherwise once the sources before it
  have been tried (`fill` on the offer); a `.h5p` URL keeps its old meaning, gaps only, no refresh,
  since knowing what is newer needs an index. Addons are planned when the pack refreshes or fills
  anything, as the pack stands in for a site's installed libraries. **On a host without `Range`**
  a partial reader plans once `bootReady` holds (untrusted: once `h5p.json` and the content have
  arrived), so the parts land while the media is still arriving and the frame boots early with
  them; the element asks again at once after attaching (`again` in `tryBoot`), since a small
  archive may send no further progress report, which the first cut waited for — the browser test
  of states caught it. After an early boot, the final index refreshes nothing: a folder the
  runtime has read is not replaced under it. **Integrity**: each part is checked by the Jobs
  worker against the index's SHA-256 once downloaded (`checkHash`, read back from the store whole,
  bounded by the largest part, a few MB) and refused, its cache dropped, on a mismatch; a part's
  id is its hash (`partPkgId`), so a part kept before is used with no request, by any package,
  online or not, and needs no probe. A match is recorded on the part (`ChunkMeta.checked`), and
  complete without it is not enough: a Jobs worker stopped between the last write and the check
  left a part whole and unchecked, which every later load took as checked (#58). A part without
  the mark — that, or one a player from before kept — is checked on its next use and downloaded
  again if it fails. The pinned index is in the worker script, so jsDelivr cannot
  change the code a host runs; a host's own copy is the host's choice. **Failure**: a refresh that
  cannot be had — a part that will not download, or does not match — is given up and the package
  plays as exported, never failing a load that would have played; a part needed for a gap that
  fails fails the load, naming the gap and the reason. A `pack-base` index is kept in the Cache API
  (`PACK_INDEX_CACHE`) as last read, for planning offline. **Padding**: Vite inlines an asset under
  4 kB as a `data:` URL, webpack's asset modules under 8 kB, and a page's `connect-src` refuses to
  fetch one — the demo build first emitted 100 parts of 105 — so `splitPack` pads a smaller part to
  8 kB + 1 with the archive's comment (13 parts, about 50 kB). **Revision**: with several archives
  attached, `libraries sha256:` is `librariesFingerprint`, SHA-256 over their fingerprints sorted,
  a line each (`settleRevision`, after the last `use()`); one archive's is its own, as before. So a
  refreshed package is another build, and a learner's state saved against the build before starts
  over once (the owner chose the reset, 2026-10-18); a pack release that touches none of a
  package's libraries changes nothing for it, where the whole pack's fingerprint changed every
  package's. The element holds the `playing` lock on every attached archive, a part or a bundle,
  as on the package: until then a bundle in use had none. Costs measured on the build: the element
  +1.7 kB gzipped, the Service Worker +10 kB gzipped, mostly the compiled index. Scope, decided by
  the owner on 2026-10-18: refresh applies only where `libraries` names the pack, so a site that
  names no source reaches no third party it did not choose, and the README's promise holds.
- **`libraries` is a list, tried in order.** Decided on 2026-10-08: `index()` re-indexes after
  each attach and hands the next source what is still missing. The worker keeps one
  `libraryPkgId` per package, so a later `.h5p` source *replaces* the earlier bundle rather than
  stacking on it; parts of the pack are added beside it and consulted first. The pack refreshes
  from the first index whatever its place in the list, and fills only once the sources before it
  have been tried. `/embed`'s `libraries=pack` is the site's own copy (`pack-base`, or `pack` for
  the demo's bundled page), or the element's `pack` on a site built with `--no-libraries` where
  jsDelivr is allowed. A source that fails outright is passed over while another remains; only
  the last one's failure is the load's.
- **Content written for a newer minor than any source has plays at the newest older one**
  (2026-10-29, #85). H5P Group's October release put library minors on h5p.com weeks before the
  hub served them, and the pack follows the hub, so content made there can name a version nothing
  here has. Measured that day with the demo's quiz relabelled: a content-only export was refused
  naming its main library; one whose sub-content was newer booted and died with "Cannot read
  properties of undefined (reading 'on')", nothing drawn and no library named, since nothing checks
  sub-content before the boot; an untrusted export carrying its own newer copy was refused with
  `carried`. The owner's rule: what can play, plays. So `resolveLibraryFolder` takes `downgrade`,
  and with it a dependency nothing satisfies is served from the newest older minor of the same
  major, never across a major. Four choices in it. **Strict first**: `index()` in the element tries
  every source for the version named, as before, and only when the last leaves something missing
  does it switch the load, with an `attach-libraries` carrying `downgrade: true`, and index again,
  offering the pack with `downgrade` so that `planPack` supplies its older part (unless the package
  carries, or a source provides, one at least as new). So a later source with the version named
  wins over an earlier one with an older version, which `pack.test.ts` holds with a bundle at 1.0
  before the pack at 1.2. **Kept with the load**: the switch is `LoadSettings.downgrade`, so a
  worker started again serves the folders the frame booted with; the next load starts strict.
  **Never while arriving**: a partial reader ignores it (`downgrades`), since a package on a host
  without `Range` may still be bringing its own copy, and a frame booted early on the older one
  would keep it. **From the parameters too**: the deep index's walk (`checkDependencies`) starts
  from the sub-content `content.json` names as well as from the manifest, wherever a source has
  that library's major: an attached archive, or the pack on offer. A stripped export's `h5p.json`
  names its main library alone and the merged manifest drops what nothing answers for, so the
  first cut, which walked the manifest only, never saw a question newer than the pack. It played
  the main library and left the question's library unloaded: the demo's formulas quiz with
  MultiChoice 1.17 still died as above, which the player page's check by hand found. Missing there
  now, it goes to the next source and then to the older minor; `newer-child.h5p` in
  `pack.test.ts` is that shape. A library no source has at its major still plays as before,
  dropped from the manifest, its sub-content removed by the content check when untrusted, so an
  old export's retired question type is not refused for it. The walk names each dependency
  served from a versioned folder below the minor asked. The element keeps them as the load's
  `downgradedLibraries`, in the `ready` detail too, and warns in the console; the verifier makes
  each a warning and `report.downgraded` (`--no-downgrade-libraries` refuses instead), the
  player page and the VS Code extension's bar show them, the player page with an Older if needed
  switch, and the embed page passes `&downgrade-libraries=off` through and posts the list in its
  report. The list is the load's because the older copy may be the package's own, with no bundle
  attached: an export whose `h5p.json` names a newer minor than its folder, or h5p.org's
  Impressive Presentation, whose libraries ask for Font Awesome 4.5 beside the 4.3 it carries.
  The first cut put it on `libraryBundle`, which is `null` there, so only the console said so,
  and the verifier passed such a package without a warning where it had failed before; the
  branch's own review found it. One thing follows for the
  pages that ask before a package's own code runs: untrusted, a package carrying a newer minor than
  the pack's now plays on the pack's, so they ask only for a library no source has at its major, or
  with the switch off. The embed's `site.test.ts` plays its Question Set 1.99 package both ways.
  The runtime needed nothing: the content upgrade runs steps only upward (`isUpgrade`), so the
  parameters play as written, the main library is named at the version served, and a
  sub-content's string keeps the version it names, which the worker answers from the older folder.
  What it costs, counted over the pack the same day: 119 of the 469 minor bumps in its libraries'
  history came with an upgrade step, a change of shape the older code does not read; the others
  only add. Not done: the SCORM writer stays strict, refusing such a package when the zip is
  written; and a sub-content library no source has at any minor of its major still fails at
  runtime, unnamed, when played trusted. `downgrade-libraries="off"` refuses as before, and now
  names a newer question's library too, where it booted without it.
- **The pack carries what an H5P site's upload check wants, and the player never serves it**
  (2026-11-06, #146). H5P core's validator, which Moodle, WordPress and Drupal run on an upload
  (`H5PValidator::getMissingLibraries`), accepts a package only if every library it carries has
  its preloaded, dynamic and editor dependencies in the package at the exact major.minor, or
  installed on the site at that version. The hub's bundles carry the editor libraries for that,
  and so does a platform's export (a Course Presentation from Moodle: 63 folders, 18 of them
  `H5PEditor.*`), but the pack dropped `H5PEditor.*` and kept one minor per major, so every
  h5p-author package lacked them: a Moodle 4.5 with no library installed, as a new site is until
  its monthly hub task has run, refused 28 of the 32 type files' examples as an admin, naming the
  editor libraries, and Image Sequencing for `H5P.Audio 1.2` beside the pack's 1.5. A teacher's
  upload never reads a package's libraries, so it needs the site's, and passed everything once
  the task had run; the harness is in notes/moodle-upload. The owner's call: always carry them.
  So `build-libraries.mjs` keeps, with the newest minor of each major, the closure the upload rule
  wants of them, 37 `H5PEditor.*` libraries and four older minors (`H5P.Audio` 1.2, `H5P.DragNBar`
  1.4, `H5P.Question` 1.4, `H5P.ImageHotspots` 1.10), 41 parts and 1.9 MB more (`libraries.h5p`,
  which a host may attach whole, grows 13.7 to 15.5 MB), each at the exact
  version named, and stops when a bundle lacks one; every one declares MIT or has it in its
  repository (`UNDECLARED`). `splitPack` marks them `installOnly` by a rule read off the pack
  alone, an editor library or an older minor of a major the pack has a newer minor of, and writes
  `editorDependencies` and `dynamicDependencies` into the index beside `preloadedDependencies`.
  Three things keep the player as it was. `planPack` plans over the entries without the mark, so
  the pack still holds one version per major for it, which *newest-per-major satisfies every
  dependency on both sides* rests on; `packLibrariesIn` keeps the mark and the two lists, since
  the author's page build reads a parts copy's index through it; and the pinned `PACK_INDEX` is
  stamped without them (`sync-h5p-assets`), the worker never needing them. The `pack` export of
  `index.js` lists what the player serves, as before, so a bundler emits only those parts, the
  installable app precaches 105 and not 146, and the VS Code extension copies the served ones
  with an index of them (`scripts/build.mjs`); `install.js` exports the whole pack, for a page
  that writes packages with the author's browser build. What it costs the player, since #148
  nothing at boot: over a host with `Range` the warm takes only the folders `h5p.json` declares,
  which leaves the run out as it leaves out a platform export's editor libraries (*the libraries
  `h5p.json` declares are pulled whole* in serving.md), and the plan reads and refreshes only the
  folders the content reaches (*The refresh rule* above), so it neither reads the run nor refreshes
  an older minor in it. `range-requests.test.ts` checks that `installable.h5p`'s run is never
  asked for, with the pack offered and without. Over a host without `Range` the frame boots
  before the run arrives: the author writes it after the content, and a package with media goes
  through the normalizer, which the author's Node build and the demo's script tell to write it
  after the media (`last`). Before #148 the run sorted before `content.json` there, the warm
  pulled it and the plan refreshed it: the demo's video, 5.2 MB with it, was ready at 4.5 s from
  a host paced to 1 MB/s either way, where it is now 1.9 s with `Range` and 2.3 s without.
