# Untrusted packages and security

What keeps a hostile package in its place: entry names, `untrusted` and the content check, the frame's policy and its messages. The code: `packages/player/src/shared/entry-names.ts`, the reader opened untrusted, the policy in `src/sw/frame-document.ts`, and `packages/runtime/src/content-check.ts`.

## Invariants

- **Entry names are rejected, never sanitised.** `normalizeEntryName` returns `null` for anything
  that cannot be a plain relative path. Stripping `..` would let `content/../h5p.json` shadow a
  real entry. zip.js is called with `filenameValidation: 'tolerant'` on purpose: its own check
  refuses the *whole archive* over one bad name, and we want per-entry rejection so a legitimate
  package with one hostile path still plays.
- **The traversal check that matters is the one on archive names, not on request paths.** A URL
  can never carry `..` to the worker — the URL parser collapses `..` and `%2e%2e` alike before
  the request is made. `normalizeRequestPath` still decodes before validating, as defence in
  depth, but the attack it is named for arrives through the central directory.
- **An untrusted package plays as data.** Built on 2026-10-12 as the first phase of matching what
  lets the CMS plugins accept packages from authors: they install library code from an upload
  only for a user who may update libraries, keep `content/` to a list of file types, and filter
  every field against the library's `semantics.json`. `untrusted` on the element puts
  `untrusted: true` in the record, and the worker opens the reader with it (`servedWhenUntrusted`):
  the package serves `h5p.json` and, under `content/`, only `H5PCore::$defaultContentWhitelist`'s
  types — images, audio, video, fonts, office documents, subtitles, JSON, no `.js`, `.css`, `.html`,
  `.svg` or `.xml`. Everything else it carries is withheld, its library folders above all, so the
  libraries come only from `libraries`, which defaults to `pack` in this mode, since nothing could
  play it otherwise. The bundle is the host's choice and is exempt (`role: 'libraries'` is never
  opened untrusted). The withheld names are kept so a refusal can say whether the package's own
  copy would have supplied what the sources lack: `MissingLibraries.carried`, which is how the
  demo pages know to ask before playing it trusted, and the one case in which they ask, beside an
  embed site with no pack to play it with.
  Two things the reader cannot do alone, both found by testing the first cut. Every entry
  response for such a package carries `X-Content-Type-Options: nosniff` (`withNoSniff`, which
  copies the response, since one read out of the Cache API has headers that cannot be changed):
  without it a `content/notes.txt` holding JavaScript, injected as `<script src>` from the
  package's own path, ran — measured, with the header off, the browser test failed with "ran".
  And the frame's `script-src` drops `'self'` for exact paths (`untrustedScriptSources`): the
  package's virtual root, the runtime's scripts, the host's `custom-js`, and the YouTube, Vimeo
  and Panopto APIs (`UNTRUSTED_SCRIPT_PATHS`, YouTube's `iframe_api` loading its widget script
  from `/s/player/`), and the worker's own script (`workerScript`, `self.location`). That last one
  is Firefox's: it checks a script the worker made up — every entry is a `new Response` — against
  the worker's URL rather than the request's, so without it every library refused to load and every
  untrusted package failed with "Could not load …/extra.js" (found by the first Firefox run of the
  suite, 2026-10-13; 0.7.0 to 0.9.0 shipped that way). In Firefox the exact paths therefore narrow
  nothing among the worker's own answers: another load's entries on this origin pass as well. What
  still holds there: the package's own folders are withheld, `nosniff` keeps any other file type
  from running, and the worker's other answers are frame documents, JSON and fixed error texts that
  echo nothing from the request. The frame shares the host's origin, so `'self'` let injected markup
  load any script on the host's whole site, a JSONP endpoint or an old AngularJS among them, which
  `'unsafe-eval'` makes worse; jsDelivr, cdnjs and Google's WebFont loader go too, since a CDN
  serves any npm or GitHub file. H5P.MathDisplay has carried MathJax in its own folder since 1.0, so
  formulas still render from a bundle that carries it, and the pack does since 2026-10-13. A source
  carries no query, and `;` and `,` in a path are percent-encoded so a URL cannot end the policy
  (`pathSource`); `base-uri` stays `'self'`, as H5P sets a `<base>`. The mode is the load's, kept
  under its load key (*What a load asked for is the load's, not the package's*, in [element.md](element.md)), so one package can play untrusted and trusted under the same
  id, at once.
  On a host without `Range`, `bootReady` does not wait for a withheld folder to finish arriving:
  the folder it resolved is the bundle's, which is whole, and a package laid out libraries-last
  would otherwise boot only with its final byte.
  The second phase, built on 2026-10-13: the content is checked against its libraries'
  `semantics.json` before the runtime reads it (`content-check.ts` in the runtime, a port of
  `H5PContentValidator` from h5p-php-library at cb64a1f and of the Drupal 7 `filter_xss` it
  carries). The boot script does it after the content upgrade, so the parameters have the shape
  the served versions' semantics describe, and before `H5P.init`, the first thing to read them;
  it reads `semantics.json` off the folders the upgrade's own lookup resolves, which for an
  untrusted package are the bundle's. The check is synchronous: `librariesIn` finds every library
  string by shape first, the semantics are fetched, and only then is the content walked, so the
  rules are tested in Node. Content whose main library has no semantics does not play; sub-content
  without any is removed, as is sub-content a field does not name — by machine name and major,
  not the exact string, since the pack serves one minor per major and the upgrade moved the
  content to it. Its other departures from upstream, each stricter or forced, are in the file's
  leading comment. Checked against upstream itself, not only against a reading of it: the PHP
  validator ran in `php:8.3-cli-alpine` through stubs of the framework and the core, beside the
  port, on 98 cases — 78 XSS vectors through a formatted and a plain field, every field kind, and
  the content of the demo's four packages, a real Interactive Video export and h5p-standalone's
  test package against the pack's semantics. 96 came out identical; the two others are a
  multi-select PHP leaves with a hole (an object `{"0": …, "2": …}`, where the port keeps a list)
  and a number PHP clamps to the semantics' string maximum. Real content came through unchanged
  but for empty lists and one `l10n` key the pack's version does not name, which upstream removes
  too. What testing found about the threat: the frame's jQuery is 3.5, whose `.html()` runs a
  script it finds as an inline `<script>`, which carries no nonce and is refused by the policy,
  as are inline handlers and `javascript:` URLs, so content markup could not run script even
  before the check. What the check adds is everything markup does without one, which the policy
  allows — a form asking for a password, a frame, styles over the page, a tracking image — and the
  type of every field, which library code puts into class names and selectors unescaped.
  Upstream is not watched, decided on 2026-10-13: the class has changed about once a year since
  2021 (attribute filtering 2021, `svg` and `xml` off the file types 2024, table styling 2026),
  all in the port. To update by hand, diff `H5PContentValidator` and the two constants
  (`$defaultContentWhitelist`, which `CONTENT_FILE_TYPES` in the player copies, and
  `$relativePathRegExp`) between the pinned commit and `master`, port what changed, move the
  commit named in `content-check.ts`, and run upstream beside the port again.
  Fail closed across versions: the boot script asks for an untrusted package's `content.json`
  with `X-H5P-Content-Check: semantics` (`CONTENT_CHECK_HEADER`; through h5p-standalone's
  `assetsRequestFetchOptions` until #37), and the worker answers anything else with a 403, so a runtime
  older than the check — which would play the content as written — plays nothing.
  With it the setup advice changed the same day: packages a site did not make can be installed
  with `untrusted`, and a site with signed-in users can install with every package `untrusted`,
  which is the plugins' arrangement — library code the host chose, content checked, same origin.
  Embed adds a separate origin on top.
  `tests/browser/untrusted.test.ts` plays `untrusted.h5p`, whose own copy of the fixture content
  type marks the frame, against the bundle and then trusted, checks each content type and the
  header, injects scripts, reads the policy, plays `untrusted-newer.h5p` on the bundle's older
  minor (see *Content written for a newer minor than any source has*) and, with
  `downgrade-libraries="off"`, refuses it with `carried`. It
  plays `untrusted-markup.h5p`, a form, a script, a handler, a `javascript:` link and a field the
  semantics do not name, at the top and in sub-content, through the fixture content type's
  `.html()`, untrusted and trusted, and refuses it against `libraries-without-semantics.h5p`; the
  runtime's `content-check.test.ts` holds the rules.
- **The frame CSP's runtime allowlist is written without schemes.** `RUNTIME_ALLOWLIST` in
  `frame-document.ts` names the origins real content types reach at runtime — a MathJax CDN, and
  Google's WebFont loader plus the two Google Fonts origins it pulls in turn. A scheme-less
  host-source is matched against the page's own scheme, so an https frame accepts only https
  while `http://localhost` also accepts http. That is not cosmetic: pre-2022 H5P.ArithmeticQuiz
  builds its loader URL with `('https:' == document.location.protocol ? 'https' : 'http')`, so a
  `https://`-pinned entry blocks it during local development. When a content type is blocked, the
  console names the directive and the origin — add it here, to the right directive, and remember
  that one feature often spans three (script, style, font). The list covers what H5P itself
  loads: MathJax, Google's WebFont loader, and the YouTube, Vimeo and Panopto player APIs that
  H5P.Video puts in the document before embedding a player (`frame-src *` covers the embed, not
  the script that creates it). Three entries came from the owner's Vimeo report of 2026-10-28
  and the scan it prompted: every script and stylesheet in the pack and the core read for the
  hosts they name, each load then traced to what makes it. `connect-src`, by path: Vimeo's
  `vimeo.com/api/oembed.json`, which its SDK reads before it creates the frame, given a URL and
  an element as H5P.Video's handler gives it, so under `'self'` alone every Vimeo video ended in
  the handler's loading error (the verifier reproduced it and still passed the package, with a
  CSP warning, since the content reached `ready` around the empty player). `script-src`, by
  path and in both policies (`RUNTIME_ALLOWLIST.jsonp`): the four live endpoints TimelineJS
  fetches a slide's media from as JSONP, Wikipedia in any language, Vimeo's v2 API, SoundCloud
  and Flickr, measured refused on a Timeline with a Wikipedia and a SoundCloud item and loading
  with the entries, the extract drawn and the SoundCloud widget playing. Left out on purpose:
  TimelineJS's Twitter, Storify, Vine and YouTube-feed endpoints, which are gone, and its Google
  Maps key of 2013; the WebVR device database A-Frame's polyfill asks for on a phone
  (`dpdb.webvr.rocks`, dead, and the polyfill falls back); A-Frame's fonts and controller
  models on `cdn.aframe.io`, which no content type in the pack uses; and MathJax's font CDN,
  since H5P.MathDisplay points it at its own folder. Everything else the scan found is an IRI,
  a licence link, a namespace or a share link. **AR Scavenger does not run under this policy at
  all**, found the same day with a marker given to the sweep's package and a fake camera: its
  bundle re-injects A-Frame and AR.js as inline scripts (`script.text = H5P.AFrame.toString()`),
  which the nonce refuses, so it shows its title and no scene, in both policies. Were that
  solved, AR.js would next fetch its default camera calibration,
  `ar-js-org.github.io/AR.js/data/data/camera_para.dat`, by XHR, since the content type sets no
  `cameraParametersUrl` and ships no file: a `connect-src` entry to add then, not before. The
  one policy shape that admits it is `'strict-dynamic'` beside the nonce, measured in Chrome:
  scripts a nonced script creates run, inline or external, while parser-inserted ones, a
  `<script>` in content markup, stay refused; but so would run the inline script jQuery's
  `.html()` makes of one, which only the content check then keeps out, and host sources stop
  counting for `script-src`. The owner decided against it on 2026-10-28: AR Scavenger is not
  supported, which `docs/troubleshooting.md` says, rather than `'strict-dynamic'` for every load
  or for its loads alone, which the worker could tell from the manifest it keeps. The sweep passes AR Scavenger
  because it reaches `ready` before its scene, with no marker to start one. A host
  that only some deployments use — a tenant's Panopto server — belongs in the host's
  `allow-origins` attribute instead, which appends host-sources and drops anything that is not
  plainly a host, so a value cannot append directives of its own.
- **The frame posts to `location.origin`, and the element checks `event.origin`.** Both sides are
  same-origin by construction, so nothing legitimate is lost — but `pkgId` is a hash of the URL,
  so frame URLs are guessable, and a wildcard would hand every xAPI statement to any third-party
  page that framed one. Not `frame-ancestors 'self'`: that checks every ancestor, and Setup C puts
  a third-party page at the top of the chain on purpose. It would also be silently ignored in a
  `<meta>` policy, which is where the frame's CSP lives.
