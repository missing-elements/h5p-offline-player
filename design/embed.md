# The embed site

The demo's `/embed`, the site `@missing-elements/h5p-embed` writes for a player domain of the host's own, and why no public service sits in the learner's path. The package's SCORM side is in [scorm.md](scorm.md).

- **`/embed` is Setup C, and it is a page of its own.** The element alone, `auto-resize`, and
  the query string for `src`, `libraries`, `preload`, `xapi` and the display options by their
  attribute names (see the h5p-standalone options invariant for which, and why not `custom-js`).
  Its snippets carry `allow="fullscreen; microphone; camera"` since 2026-10-13: a frame from
  another site gets neither device unless the embedding page allows it, and Audio Recorder,
  Speak the Words and AR Scavenger need one; H5P's own embed code allows them too. Its
  script is `packages/embed/site/embed.js`, which the demo calls through `demo/embed-page.js`
  and the embed package deploys, so the two cannot drift. Three decisions in it: it speaks H5P's resizer protocol *upward* — `hello`, then `resize` with
  `scrollHeight` — so a site that already includes h5p.org's `h5p-resizer.js` for its h5p.org
  embeds resizes this frame with no code of its own, and every other site gets `/resizer.js`
  from the player page's own origin, the same protocol in twenty lines, which the snippets name
  (chosen on
  2026-10-07 over naming h5p.org's copy: every visitor's browser would otherwise call h5p.org,
  at a Drupal module path H5P Group can move, for a GPL file; the player page's embed dialog
  offers the same line under "advanced"); it relays xAPI only when `xapi=` names the
  parent's origin and posts to that origin only, which is the opt-in the frame-to-element channel
  cannot have; and, for a browser that really cannot register a worker in a frame, it detects
  that by the `no-worker` error rather than by sniffing the user agent, and answers with a
  `target="_top"` link to itself. The height it reports is the body's own, not `documentElement.scrollHeight`, for the reason the element
  measures `#h5p-root` and not the document. `/embed` without `.html` is a Vercel rewrite in
  production and Vite's own html fallback locally.
  **Safari and iOS do run it** — measured on 2026-10-03, which reverses the removal of 2026-09-30,
  made on the belief that Safari gives a cross-origin iframe no Service Worker. A probe with the
  host page and the deployed demo on two different https sites reached `ready` and played a quiz
  in desktop Safari 26.6.2, on an iPhone on iOS 26.6.1 and in Chrome (and the owner's own GitHub
  Pages site, https://alekswebnet.github.io/h5p/, a third origin, reported it working in every
  browser tried, 2026-10-04, unchecked here); the frame registers its own
  worker, with no `requestStorageAccess()` and no prompt, and is controlled by it. (That call is
  not needed. It was rejected with `NotAllowedError` until the framed origin had been visited on
  its own, and its prompt says the frame wants "to track your activity".) Storage is partitioned
  by the pair of sites, which the player does not mind: each host site that frames it keeps its
  own registration and chunk store, so a package is downloaded once per embedding site. The
  parent must be https or localhost: a plain-http LAN address makes the frame an insecure
  context with no `serviceWorker`, which is what a first iPhone test looked like. Not measured:
  Safari's seven-day limit on script-writable storage for a frame the learner never opens on
  its own, and video and offline playback in a frame on iOS. The `target="_top"` fallback
  stays for those, and for an in-app browser. No document names a Safari or iOS version
  floor, decided on 2026-10-08: the player supports both, and a framed player that fails on an
  earlier release is a bug to fix, not a caveat to publish.
- **No public service is in the learner's path, and nothing here names one.** The owner runs a
  separate public site on the player — paste a package link, get a live preview, a package check
  and a snippet — and from 2026-10-08 the README, the setup guide, the skills, the demo's setup
  page and the player page's embed dialog named it as *the* Embed setup, with a skill that walked
  an agent through pasting its snippet into a live page. Repositioned on 2026-10-09 by the owner:
  a public service cannot pass a GDPR, security or vendor review — every learner's browser
  connects to an origin the host has no data processing agreement with, the package URL passes
  through it, and that origin plays whatever anyone points it at. So the Embed setup is the
  `/embed` page served from a player domain the host runs (a separate registrable domain holding
  nothing else), written by `@missing-elements/h5p-embed` (next bullet); the docs use
  `https://h5p-player.example.net/?src=` and `/resizer.js` in their snippets; the player page's
  embed dialog (`EMBED_ORIGIN` in `player-page.js`) names this site's own `/embed`; the skill is
  deleted, and since 2026-10-13 the site is not named or linked anywhere in the repository, as
  it is being reworked. Still true: `/embed`'s query parameters (`src`, the bare `frame`,
  `copyright` and `export`, `xapi`) and its two message shapes — the resizer protocol upward and
  the `h5p-offline-player` xAPI relay — are an interface that site builds on (its snippets and
  its copy of the page), so a change to one means a change there with it.
- **`@missing-elements/h5p-embed` is the Embed setup as a deployable folder.** Built on
  2026-10-09, the day the public site stopped being the production path: until then a host that wanted
  its own player domain had to build the demo app. `npx @missing-elements/h5p-embed <folder>`
  copies the page, the player's `dist/`, the runtime as `frame-assets/` and the library pack's
  parts the player serves, with an index of those, as `libraries/` (since 2026-10-18; the pack's
  `installOnly` parts, 1.9 MB for H5P sites' upload check, stay out, #146; `config.js` then gives the page `packBase`, which it
  hands the element as `pack-base`, and `&refresh-libraries=off` passes through) from
  the installed packages (so the versions are the ones published together, and nothing is
  fetched), and writes the policy six ways from one list of rules: a `<meta>` in the page for
  every host — which cannot carry `frame-ancestors`, so `--ancestors` needs a header — and the
  headers as `_headers` for Netlify and Cloudflare Pages, `vercel.json` for Vercel, and, since
  2026-10-16, a `Caddyfile`, an `nginx.conf` and an `.htaccess` for a server of the host's own,
  because the European hosts a data protection officer accepts read none of the first two and
  the docs had named only US providers. nginx's `add_header` in a `location` replaces the
  inherited headers, so each location in the file repeats the policy. `--packages`
  turns the default `connect-src 'self' https:` into exactly the hosts given — each a plain host,
  since the URL parser takes `*` and `"` in one and the page compares exact origins (#58) — and
  `config.js` hands the same list to the page, which refuses an `src` or a library URL off it by name
  before fetching anything. (Until 2026-10-10 it also refused `hub` unless `https://api.h5p.org`
  was listed; a site without its own pack needs `https://cdn.jsdelivr.net` listed for `pack`, and
  `hub`, which meant `pack` from then to embed 0.8, is no longer a token.) The page checks only the address it is
  given; `connect-src` also applies to every redirect, so a listed host that redirects off the
  list fails as a plain network error — the README says to list every host on the way. With a list, a listed host plays as
  it is, never untrusted: the host vouched for it when it wrote the site. Without one, a package
  from another origin plays untrusted with the site's own sources — `--default-libraries` or the
  pack — and never the address's `libraries=`, found in review on 2026-10-12: a bundle is exempt
  from `untrusted`, so a link naming its own bundle would have run that bundle's code as the
  host's; the address's bundle counts only once the click has trusted the package. `pack` resolves to the folder's
  `libraries.h5p`, or to the element's own `pack` on jsDelivr for a site built with
  `--no-libraries`, where allowed. The page is at the folder's root, not at
  `/embed`, because a static host's mapping of `/embed` to `embed.html` differs (S3 does not),
  and every URL in it is relative, so a project site under a path works. MIT: the folder carries
  the GPL runtime and the libraries as separate works with their notices, and `NOTICE.txt` says
  which file is what. `--force` replaces only the files it writes, never the folder, so a wrong
  path costs nothing that was not its own. `tests/site.test.ts` serves a written site on
  `127.0.0.1` and frames it from `localhost` — two sites, as deployed — with no headers, as
  GitHub Pages would; `http://localhost` and `127.0.0.1` are accepted as origins for that reason.
  0.1.0 went out with `npm publish` and its dependencies as `workspace:^`, which npm cannot
  install (`EUNSUPPORTEDPROTOCOL`); found on 2026-10-09 by the first site that tried to install it.
  `prepublishOnly` now refuses unless `npm_config_user_agent` says pnpm, which rewrites those
  ranges in the tarball; the verifier, the other package with workspace dependencies, has the
  same guard. 0.2.0, the same day, added what the owner's public site's own page did and this one did not, so
  that it can call `startEmbed()` instead of keeping a copy: the `report` posted to any parent on
  `ready` (source, metadata, library bundle, elapsed time — the `ready` detail, trimmed) and the
  `error` posted on a failed load or a refusal, in the exact shapes that site's preview checks
  are built from; `defaultLibraries` and `--default-libraries`, with `libraries=none`
  to turn it off per address, checked against `--packages` when the site is written so a default
  the page would refuse never ships; `runtime`, for a bundled element; and `askInOwnFrame:
  false`, for a site whose own preview frames the page for a package the visitor just chose.
  That site runs on 0.2.0 since that day. 0.2.1, on 2026-10-10, changes nothing in the package:
  it is published to require player `^0.5.2`, the null-source straggler fix, because a site is
  written from whatever player is installed — a fix to the player reaches a player domain only
  through an embed release, and then only once the host writes and deploys the site again.
  0.3.0, the same day, follows player 0.6: `hub` means `pack`, `pack` without a copy of the site's
  own is the element's on jsDelivr, and `--packages` checks `https://cdn.jsdelivr.net` for it
  instead of `https://api.h5p.org`. It needs player 0.6, since an older element reads `pack` as a
  relative URL. 0.3.1, on 2026-10-12, changes nothing in the package either: it requires player
  `^0.6.1` and runtime `^0.1.1`, for the content upgrade, and verify 0.1.3 went out beside it for the
  same reason, since `npx` keeps a cached copy's dependencies until the package itself changes.
  0.3.2, the same day, passes `lang=` to the element and requires player `^0.6.2` and runtime
  `^0.1.2`, which carry the core's strings in the page's language; verify stays at 0.1.3, since its
  page is English and the translations change nothing it checks. 0.5.0 (2026-10-13) requires
  player 0.8 and runtime 0.2, the content check. 0.6.0, the same day, requires player 0.9, runtime
  0.2.1 and the pack 0.2.0: per-load settings, the pack with AR Scavenger and MathDisplay, and
  `microphone; camera` in the snippets it prints; verify 0.1.4 went out beside it, since the
  transitive dependency check and `getContentPath` change what it reports.
