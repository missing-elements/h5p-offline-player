# The frame and the runtime

The document the H5P runtime runs in, and what it loads: the boot route and its load order, the runtime package and its vendored core, content upgrades, translations, h5p-standalone's options, and the frame's own markup and CSS. The code: `packages/player/src/sw/frame-document.ts` and `library-load.ts`, and `packages/runtime/`. The frame's policy is in [security.md](security.md).

## Invariants

- **Content written for an older minor is upgraded before the runtime reads it.** Found on
  2026-10-11, comparing the player with the CMS plugins. The file server answers for a library at
  1.20 from a folder at 1.21 when that is what is reachable, and the pack keeps one minor per
  major, so a stripped export written before the pack's versions ran newer code on parameters
  that code no longer reads. A library's `upgrades.js` holds a step for each minor that changed
  the shape of its parameters, which the platforms run when they install a newer minor; 21 of the
  pack's 47 have a step at their own minor. Question Set 1.21's step 21 moves `backgroundImage` to
  `override.backgroundImage`: a 1.20 quiz with a background played against the pack showed none
  until this, and shows it now — measured with a red background beside a control declared 1.21.
  `content-upgrade.ts` in the runtime package runs the steps by the rules of h5p-php-library's
  `h5p-content-upgrade-process.js`: the steps after the content's minor up to the target, lowest
  first, each given the parameters, a callback and `{ metadata }`, the `{ contentUpgrade }` form
  beside a bare function. The boot script calls it once the libraries' scripts have run, when
  the parameters are in `H5PIntegration` and not yet read, and before `H5P.init`. Four things differ
  from upstream. The target is the version served, read off the `library.json` that answers under
  the version the content names, so the reader's rule stays the only one; upstream upgrades to the
  version the parent's semantics name. Sub-content is found by its shape, as `librariesNamedIn`
  finds it, and not through semantics, so sub-content already at the version served is still
  looked inside — upstream does not look into sub-content whose version its parent's semantics
  accept — and no `semantics.json` is read. An `upgrades.js` is fetched and evaluated
  (`(0, eval)`, which the frame's `'unsafe-eval'` allows) in a promise chain whose rejection
  fails the upgrade, as the platforms' upgrade worker runs `importScripts` in a try: a `<script>`
  that threw as it loaded would reach the frame's error listener and fail the boot. Evaluated in
  the frame, where the core is loaded: H5P.SimpleMultiChoice's script takes `H5P.jQuery` as it
  loads, which that worker could not give it. And a step that does not call back within
  `STEP_TIMEOUT_MS` has failed, as has a `library.json` read that takes more than twenty seconds —
  loudly, not as "not served". Any failure leaves the parameters as written,
  which is how every package played before, and logs a console error, which the verifier reports
  as a warning. Sub-content takes the served version into its `library` string, as upstream does,
  and so does the main library: h5p-standalone built that name from `library.json` and dropped a
  major or minor that is 0 — "H5P.Accordion 1" — which the core turned into
  `H5P.Accordion-1.undefined`, the category of every statement; fifteen runnable libraries in the
  pack have a 0, the demo's Accordion among them. Since #37 the worker names it in full in the
  first place. The worker lists the folders that carry an `upgrades.js`
  (`PackageReader.foldersWithUpgrades`, as `upgrades`), so nothing is fetched that is not there:
  in the `boot` route's answer, and for a runtime up to 0.2 in the boot config, which `serveFrame`
  takes from the reader the element's `index` left open and never opens one, since a picked file's
  reader would ask for the file through the very frame being served; without a list — a worker
  older than the boot script — each script is asked for and a 404 means none. Not done: a change of major, which the file server never makes,
  and upstream's checks against the parent's semantics. `packages/runtime/tests/` pins the rules;
  `tests/browser/upgrades.test.ts` plays exports written for 1.0, 1.1 and 1.2, sub-content
  included, against a bundle at 1.2, and one whose step throws.
- **The core's strings follow the content's language.** Built on 2026-10-12, to match the CMS
  plugins, which show H5P's own strings — the fullscreen button, "Rights of use" and the licence
  names in it, the "this content has changed" dialog — in the site's language; h5p-standalone's
  are English. The element reads its `lang`, its own or inherited across a shadow root to its host
  (`declaredLanguage`), and the record keeps the tag. The frame's language is the content's:
  `h5p.json`'s `defaultLanguage`, which H5P writes into the iframe it makes, and the element's tag
  only for a package that names none (`frameLanguage` in `frame-document.ts`); unless it is
  English, the worker names the runtime's `l10n.js` before the boot script and puts the tag in the
  boot configuration. Until 2026-10-20 (#55) the strings followed the element's tag and only the
  `<html lang>` the content's, so an English quiz on a German page had "Vollbild" and
  "Nutzungsrechte" around its own Check and Retry, which its author wrote into the package. The
  owner's rule: the interface and the content in one language. A select for the language, on the
  player page and in the app, was built the same day and closed unmerged (#53, #54) for the same
  reason: it could only make the two differ. `lang` is the fallback, and so is the embed page's
  `&lang=`. `german.h5p` and `english.h5p`, `basic.h5p` naming its language, are the fixtures, and
  `german-late-manifest.h5p` a host without `Range` whose `h5p.json` arrives after the worker
  opened its reader: the frame route reads the language off the record, so `refresh` saves the
  manifest there once a merged snapshot brings it in, which until #57 it did not, and such a
  package booted early in the element's language, untitled and unlicensed. That one
  file has every language and the aliases; the boot script picks one by RFC 4647 lookup through
  the aliases (`src/l10n.ts` in the runtime — `de-AT` gets `de`, `nb` Norwegian) and lays it over
  the core's own English, `getLocalization()` at the vendored commit (`vendor/h5p-core/strings.json`,
  until #37 h5p-standalone's copy of the same 67 strings), so a missing key stays English, and in
  time for the core's ready handler to build the licence names from it. The player holds
  no list of languages, decided the same day: a first cut had a file per language and the player
  matching tags against the runtime's list, so a new language took a release of both. Now it is a
  runtime release, at the price of one file, about 50 kB gzipped, fetched once by a learner whose
  page is not in English, Thai included, which finds nothing in it. A script rather than JSON
  because the frame's `script-src` names the runtime's origin and its `connect-src` does not. A
  `runtime` without `l10nJs`, or a runtime directory without the file (its 404 ignored: no
  `data-h5p`), leaves the frame English. The embed page takes `&lang=`.

  The translations are Moodle's: H5P publishes none for the core, each platform translates it
  itself, and Moodle's translators (AMOS) are the most complete, under GPL-3.0-or-later; Lumi's set
  is machine-translated, reviewed by no native speaker by its own account
  (Lumieducation/H5P-Nodejs-library#4654). `pnpm l10n` reads `h5p.php` and `langconfig.php` from
  every pack in Moodle 5.2's `languages.md5`, by range through zip.js, maps each core key through
  its English message to Moodle's id by `$translationsmap` at a pinned commit, and writes
  `l10n/<tag>.json` and `index.json`, committed. `.github/workflows/l10n.yml` runs it every Monday
  and opens a pull request when a file changed; an unchanged week writes nothing, its date
  included, and one that would lose more than three languages at once stops before deleting
  anything (`--allow-loss` once someone has looked). When Moodle branches, `MOODLE_VERSION` is what
  moves. Which packs become languages is a rule, not a list (`packTag`): two thirds of the 67
  strings or more; a code of letters is its tag, `xx_yy` a region only where the pack's
  `langconfig.php` places it there — `fi_co` is Finnish for companies, not Colombia — `sr_cr`,
  `sr_lt` and `ca_valencia` named, other variants out, every tag in its canonical form (`pan` is
  written `pa`). A pack with nothing of its own beyond its parent's is left to the lookup when it
  is a region of the parent's language, and becomes an alias when it is another language, as Moodle
  shows Nynorsk, Greenlandic and Lower Sorbian learners the Norwegian, Danish and German; a few
  aliases are fixed (`iw`, `in`, Chinese by script and region, `sr`, `ca-ES-valencia`). A
  translation that renamed a `:placeholder`, or that carries markup or a double quote, which the
  core writes into attributes, is dropped, and a licence name loses the bracketed abbreviation
  Moodle's English added, "Attribution (CC BY)". `tests/l10n.test.ts` in the runtime holds every
  file and alias to those rules and pins the lookup; `tests/browser/l10n.test.ts` plays German,
  Brazilian Portuguese, Austrian German, Bokmål, Greek one string short, English and Thai, and a
  `runtime` with and without `l10nJs`, and a German and an English package each in their own
  language whatever the page's; the embed's `site.test.ts` an English quiz on a German page, in English.
- **The runtime is the H5P core at a commit, and the frame loads what the worker's `boot` route
  names, in h5p-standalone's order** (#37, 2026-10-18). Until then the runtime was
  h5p-standalone's two bundles: its copy of the core, synced about once a year and recording no
  upstream revision, and its loader, `main.bundle.js`, which walked every `library.json` from the
  frame. Now `pnpm core:sync` vendors h5p-php-library at a commit into
  `packages/runtime/vendor/h5p-core/` — which scripts and stylesheets, and in what order, is
  upstream's own `H5PCore::$scripts` and `$styles` at that commit — and the build joins the scripts
  into `frame.bundle.js` and minifies them, top-level names kept: they are global scripts, as a
  site loads them, and jQuery's wrapper puts `jQuery` on `window` only where no CommonJS `module`
  is in scope, which H5P's own `jQuery.noConflict(true)` right after it relies on (h5p-standalone
  got the same by building that file as an ES module). Measured on the build: 48.5 kB gzipped,
  against 54.6 for the two bundles it replaces. The boot script builds `H5PIntegration` itself,
  field for field as h5p-standalone did, with the core's English strings from `getLocalization()`
  at the same commit — the same 67, word for word — and `url` the package's root rather than a
  random id, which no library in the pack reads. **The route, not the document**: the worker
  answers `…/h5p/boot/<load>` with `LibraryLoad` (`sw/library-load.ts`) — the main library at the
  version served, in full; every library's scripts and styles; `libraryDirectories` for a library
  served from a folder its version does not name, which the core's `H5P.getLibraryPath` reads; and
  the `upgrades` list. Asked by the frame because only a request from the frame can open a reader
  the worker lost on a restart: for a picked file the page is asked for it through the frame,
  which while its own document is being served does not exist yet. **The order is h5p-standalone's
  to the letter** — its `loadDependencies` levels, its `sortDependencies` edges, the `toposort`
  2.0.2 it bundles with its tie-breaks, the phantom node a library without dependencies gets
  included — because it is the order every content type has been played in here.
  `tests/unit/library-load.test.ts` runs h5p-standalone's own code beside the port on five hundred
  random graphs; the demo's six packages, nine fixtures and the sweep's fifty-five, captured from
  the frame before and after, load the same files in the same order. Two things differ: a library
  is named by the folder it is served from, so content asking for 1.0 where 1.1 answers loads
  `H5P.Question-1.5/…` rather than `H5P.Question-1.4/…` that the server mapped, and two requests one
  folder answers load it once; and a dependency cycle is broken where it closes, where
  h5p-standalone threw. **One fix fell out**: h5p-standalone decided once, from the first
  dependency's versioned probe, whether every folder had a version in its name, so an older package
  with folders named without versions, played with the pack, whose newer parts sit in folders named
  with them, ended its boot on the next 404 — the `boardgame.h5p` fixture did, and
  `unversioned-pack.h5p` with `pack.test.ts` pins it; the walk tries each library both ways.
  **Across versions**: a record that names `mainJs` came from an element paired with the runtime
  up to 0.2, and the worker still writes that document — the loader, the upgrade list in the
  config — so an element from before keeps playing against an updated worker. It names the
  `boot` route in that document too (#49): a page from before an upgrade, still open, registers
  its loads naming the loader, and on a host that serves the runtime at one path — the demo, an
  embed site, any copy of `dist/` — the boot script at that path is 1.0's by then, which boots
  from the route and leaves the loader's 404 alone; without the route it stopped every such load.
  A later boot script given a document without the `boot` URL, a worker from before, says to
  update the player and `h5p-sw.js` together. An element of this player with a runtime up to 0.2 through `assets-base`
  cannot work and does not try: the peer range says which runtime it plays with.
- **A 404 from the virtual server is load-bearing.** A library's `library.json` is looked for
  under the versioned folder name and then the bare one, and the first 404 is what sends the
  lookup on: the worker's walk for the `boot` route does it inside the worker, and the boot
  script's upgrade lookup through the virtual server. Until #37 h5p-standalone probed the same way
  from the frame, once, for the first dependency, and named every folder by the answer.
- **h5p-standalone's options are attributes by the same names, and ride in the package record.**
  Added on 2026-10-07 after the question "do we support `customJs` and `customCss`": `frame`,
  `copyright`, `export`, `icon`, `embed`, `fullscreen`, `download-url`, `embed-code`, `resize-code`,
  `custom-css`, `custom-js`, `reporting` and `activity-id` are read by `frameOptions()` when the
  package is registered, stored as `PackageRecord.frameOptions`, and written by
  `frame-document.ts` into the boot config after `sanitizeFrameOptions` has checked every type
  and URL — a record is read back from IndexedDB, so it is held to a shape like the fonts are.
  `frame-boot.ts` lays them over its defaults and keeps a button off when its target is missing:
  export without a `downloadUrl`, embed without an `embedCode`. Two of them are more than
  passthroughs. `activity-id` defaults to the package URL, because what the runtime would use
  without it is the frame's own URL, which carries the package hash and so changed with every
  re-upload — every statement's object id was unstable until then; a picked file keeps the frame
  URL, having no other. And `user` is a property, not an attribute, and travels in the
  `need-user-data` reply (the frame asks with `?user=1` as it does with `?resume=1`) rather than
  in the record: a learner's name and address are not for the worker's database. A user set
  makes H5P core take itself to be on a site: every user-data call then goes to
  `H5PIntegration.ajax.contentUserData.replace(…)`, which does not exist here, and the first
  boot with a user died on it — so the frame installs the `resume` shim whenever the element
  answered, holding nothing without `resume`, and the element ignores a save that arrives with
  `resume` off rather than raising a `userdata` event nobody asked for. The custom
  stylesheets' and scripts' origins join the frame's `style-src` and `script-src` the way the
  frame assets' do, since they are the host's choice like `assets-base`. `customJs` is there for
  completeness, not for MathJax: formulas need `H5P.MathDisplay` in the package (see
  `docs/troubleshooting.md`), and a host-side analytics script has the `xapi` events instead.
  `tests/browser/options.test.ts` pins each against `H5PIntegration` and the statements the
  fixture sends; `frame-document.test.ts` pins the sanitising and the CSP.
  Two of them were found not to do what they said, the same day, by asking what each option
  gives a host. **`copyright` showed every package as "Undisclosed"**: h5p-standalone takes the
  content's metadata as an option and, given none, invents `{ title, license: 'U' }` whatever
  `h5p.json` says — and the core then hides the copyright button for content with nothing to
  show, so the demo's Big Buck Bunny video, CC BY in its manifest and its media, had no button.
  The worker now reads the manifest's metadata (`shared/metadata.ts`, `PackageReader.metadata`),
  keeps it on the record beside the title (`rememberManifest`, for the partial reader too) and
  the frame hands it to h5p-standalone with the title; the core also puts the title into every
  statement's `object.definition.name`, which was empty before. Two things that fix uncovered:
  the frame called `H5P.init()` as soon as h5p-standalone resolved, but the core builds
  `H5P.copyrightLicenses` in its own document-ready handler, which jQuery 1.x defers to `load`
  when the document is still `interactive` — the frame's own scripts and styles delay `load` —
  so a licensed package died on `copyrightLicenses['CC BY']`; the init is now queued on
  `H5P.jQuery(document).ready`, behind that handler. And the core reads its licence table by the
  manifest's string with no check, so a licence it has no name for (`MIT`, which h5p-cli writes)
  dies on `.hasOwnProperty`; `KNOWN_LICENSES` in `metadata.ts` is the core's table, and any
  other licence is left out of the metadata, which reads as "none given". **`reporting` set a
  flag nothing read**: `H5PIntegration.reportingIsEnabled` is h5p.com's, whose core passes it to
  the content as `extras.isReportingEnabled`; this core (and upstream h5p-php-library) calls
  `newRunnable` with `{ standalone: true }` alone. Measured over the app's library pack on
  2026-10-07: Question Set, Interactive Video, Course Presentation, Game Map and Question read
  the extras only, Interactive Book and Documentation Tool read both. So with `reporting` the
  frame wraps `H5P.newRunnable` before `init` and sets `isReportingEnabled` on the `standalone`
  instance. The fixture content type keeps its `extras` so the test can read them. The demo
  uses them: the player page sets `frame copyright export embed`, with the Setup C `/embed`
  snippet for the loaded URL as the embed code (per load, since it names the package; off for a
  picked file), the embed example asks for `&frame&copyright&export`, and the xAPI example sets
  `user`. `/embed` passes `frame`, `copyright`, `export`, `icon`, `reporting`, `fullscreen=off`,
  `activity-id`, `custom-css` and `lang` through from its query string, and not `custom-js`,
  `embed-code` or `user`: a script is a capability on this origin a link should not hand out,
  and a learner's name has no place in a URL.
- **The frame uses `embedType: 'div'`.** With the default `iframe` type, H5P core creates an inner
  `about:blank` frame, and whether that child inherits the Service Worker controller differs
  between browsers.
- **`H5P.getContentPath` answers the content's own folder.** The core builds it as
  `H5PIntegration.url + '/content/' + id`, which on a site is the H5P folder and each content's
  own below it; here the content is the package's `content/`, one level below `url`, which the
  boot script sets to the package's root (h5p-standalone set the content id, a random one then,
  so it answered `<id>/content/<id>`, relative to nothing). The core's own `H5P.getPath` reads
  `contents['cid-<id>'].contentUrl` first, which the boot script sets, and it makes
  `getContentPath` do the same (2026-10-13). IFrame Embedder is the one
  content type in the pack that asks, for a page the package carries — so it showed nothing, in
  either mode, until then; played `untrusted` it still does, by design, since `content/` serves
  no HTML. `playback.test.ts` pins the path.
- **The frame is navigated in place, not through its `src`.** Every navigation of a frame that
  already holds a document adds an entry to the page's session history, and the element used to
  set `src` for each package and remove it to empty the frame: two Back steps per package after
  the first, one per clear. Measured on 2026-10-12 on a plain page, two switches and a clear took
  the history from 2 entries to 7, and Back walked the frame through the old packages, booting
  them again, before it left the page. Found by the installable app, whose Back closes a file and
  whose Forward then had nothing to go to. `navigateFrame` navigates with
  `contentWindow.location.replace`, the first package included; `frameLocation` holds where the
  frame was sent, since no attribute says. It once set `src` for the first navigation, taking that
  to replace the frame's initial `about:blank` by itself, which Chromium and Firefox do; WebKit
  adds a step when the frame's first document has loaded and the page is top-level, so in Safari
  the first Back after opening a package emptied the frame and left the page showing it — found on
  2026-10-14 by the demo app's tests in WebKit, where opening a file took the history from 2 to 4.
  The player's own suite runs in a frame of the test runner's, where WebKit added no step, so
  `playback.test.ts` passed there before the fix; the app's tests, top-level, failed four. Only a
  frame out of the document, which has no window to navigate, still gets `src`, which loads as it
  is inserted and adds no step; that attribute is removed when the element leaves the document, so
  that putting the element back does not load what it last named. A fresh iframe for each load
  would also have kept the history clean, but would change where an old document's last messages
  come from, which the straggler rule depends on. `playback.test.ts` counts the history from
  before the first package across two switches and a clear; the app's tests go Back and Forward
  over a picked file and a link, in every engine.
- **The frame's `<html>` carries `class="h5p-iframe"`.** Seven rules in the core stylesheet are
  keyed on `html.h5p-iframe`: the base sans-serif font, the content's 16px/1.5 type, full width,
  the fullscreen heights. In a normal install H5P writes that class onto the `<html>` of the
  iframe it creates; div embedding puts it on a `<div>`, where none of those selectors can match
  and the content renders unstyled in the browser's default serif. This document *is* the H5P
  document, so it carries the class. Two things follow: `html` and `body` are then 100% tall, so
  auto-resize measures `#h5p-root` rather than `documentElement.scrollHeight` — the latter can
  never report less than the frame — and the inline frame CSS must not fight the core rules.
- **The frame's own CSS pins a YouTube iframe over its box.** H5P.Video's YouTube handler does
  that with `player.g.style = …`, reaching into the YouTube API object's minified internals; the
  field was renamed, so up to 1.6.66 — the version the hub still ships, and the one inside every
  existing export — the line throws and the iframe flows below its 16:9 box, clipped away by the
  wrapper: sound, black picture, the same in Lumi. The rule `.h5p-video.h5p-youtube iframe`
  says what the line meant; the fixed library (1.6.80, `getIframe()`) sets the same styles, so
  the rule is idle there. A workaround for one library, kept because that library is inside
  packages this player will be handed for years.
- **The frame reports the runtime's own failed loads.** Its `error` listener is capture-phase,
  because a resource failure fires on the element and never bubbles, and it reports only tags
  marked `data-h5p` — the ones the boot script added, the core's and the libraries'. A content image that 404s, or an
  optional script a content type reaches for, is the content's business.
