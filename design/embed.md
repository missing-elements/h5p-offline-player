# The embed site

The demo's `/embed`, the site `@missing-elements/h5p-embed` writes for a player domain of the host's own, and why no public service sits in the learner's path. The package's SCORM side is in [scorm.md](scorm.md).

- **`/embed` is Setup C, and it is a page of its own.** The element alone, `auto-resize`, and
  the query string for `src`, `libraries`, `preload`, `xapi` and the display options by their
  attribute names (see *h5p-standalone's options are attributes by the same names* in
  [frame.md](frame.md) for which, and why not `custom-js`).
  Its snippets carry `allow="fullscreen; microphone; camera"`: a frame from another site gets
  neither device unless the embedding page allows it, and Audio Recorder, Speak the Words and AR
  Scavenger need one. Its script is `packages/embed/site/embed.js`, which the demo calls through
  `demo/embed-page.js` and the embed package deploys, so the two cannot drift. Three decisions in
  it:
  - It speaks H5P's resizer protocol *upward* — `hello`, then `resize` with `scrollHeight` — so a
    site that already includes h5p.org's `h5p-resizer.js` resizes this frame with no code of its
    own, and every other site gets `/resizer.js` from the player page's own origin, the same
    protocol in twenty lines, which the snippets name. Naming h5p.org's copy would make every
    visitor's browser call h5p.org, at a module path H5P Group can move, for a GPL file. The
    player page's embed dialog offers the same line under "advanced".
  - It relays xAPI only when `xapi=` names the parent's origin and posts to that origin only,
    which is the opt-in the frame-to-element channel cannot have.
  - For a browser that really cannot register a worker in a frame, it detects that by the
    `no-worker` error rather than by sniffing the user agent, and answers with a `target="_top"`
    link to itself.

  The height it reports is the body's own, not `documentElement.scrollHeight`, for the reason the
  element measures `#h5p-root` and not the document. `/embed` without `.html` is a Vercel rewrite
  in production and Vite's own html fallback locally.

  **Safari and iOS do run it.** A frame on another site registers its own worker, with no
  `requestStorageAccess()` and no prompt, and is controlled by it (desktop Safari, iOS and Chrome
  reached `ready` and played a quiz). `requestStorageAccess()` is not needed: it was rejected with
  `NotAllowedError` until the framed origin had been visited on its own, and its prompt says the
  frame wants "to track your activity". Storage is partitioned by the pair of sites, which the
  player does not mind: each host site that frames it keeps its own registration and chunk store,
  so a package is downloaded once per embedding site. The parent must be https or localhost: a
  plain-http LAN address makes the frame an insecure context with no `serviceWorker`. Not
  measured: Safari's seven-day limit on script-writable storage for a frame the learner never
  opens on its own, and video and offline playback in a frame on iOS. The `target="_top"`
  fallback stays for those, and for an in-app browser. No document names a Safari or iOS version
  floor: the player supports both, and a framed player that fails on an earlier release is a bug
  to fix, not a caveat to publish.
- **No public service is in the learner's path, and nothing here names one.** A public service
  cannot pass a GDPR, security or vendor review: every learner's browser connects to an origin
  the host has no data processing agreement with, the package URL passes through it, and that
  origin plays whatever anyone points it at. So the Embed setup is the `/embed` page served from
  a player domain the host runs (a separate registrable domain holding nothing else), written by
  `@missing-elements/h5p-embed` (next bullet). The docs use `https://h5p-player.example.net/?src=`
  and `/resizer.js` in their snippets; the player page's embed dialog (`EMBED_ORIGIN` in
  `player-page.js`) names this site's own `/embed`; no skill walks an agent through a public
  site, and the owner's separate public site is not named or linked anywhere in the repository.
  Still true: `/embed`'s query parameters (`src`, the bare `frame`, `copyright` and `export`,
  `xapi`) and its two message shapes — the resizer protocol upward and the `h5p-offline-player`
  xAPI relay — are an interface that site builds on (its snippets and its copy of the page), so a
  change to one means a change there with it.
- **`@missing-elements/h5p-embed` is the Embed setup as a deployable folder.**
  `npx @missing-elements/h5p-embed <folder>` copies the page, the player's `dist/`, the runtime as
  `frame-assets/` and the library pack's parts the player serves, with an index of those, as
  `libraries/` from the installed packages (so the versions are the ones published together, and
  nothing is fetched). The pack's `installOnly` parts (1.9 MB, for H5P sites' upload check) stay
  out. `config.js` then gives the page `packBase`, which it hands the element as `pack-base`, and
  `&refresh-libraries=off` passes through.
  - The policy is written six ways from one list of rules: a `<meta>` in the page for every
    host (it cannot carry `frame-ancestors`, so `--ancestors` needs a header), and the headers as
    `_headers` for Netlify and Cloudflare Pages, `vercel.json` for Vercel, and a `Caddyfile`, an
    `nginx.conf` and an `.htaccess` for a server of the host's own, since the European hosts a
    data protection officer accepts read none of the first two. nginx's `add_header` in a
    `location` replaces the inherited headers, so each location in the file repeats the policy.
  - `--packages` turns the default `connect-src 'self' https:` into exactly the hosts given,
    each a plain host, since the URL parser takes `*` and `"` in one and the page compares exact
    origins. `config.js` hands the same list to the page, which refuses an `src` or a library URL
    off it by name before fetching anything. A site without its own pack needs
    `https://cdn.jsdelivr.net` listed for `pack`; `hub` is no longer a token. The page checks only
    the address it is given; `connect-src` also applies to every redirect, so a listed host that
    redirects off the list fails as a plain network error, and the README says to list every host
    on the way.
  - Trust. With a list, a listed host plays as it is, never untrusted: the host vouched for it
    when it wrote the site. Without one, a package from another origin plays untrusted with the
    site's own sources (`--default-libraries` or the pack) and never the address's `libraries=`: a
    bundle is exempt from `untrusted`, so a link naming its own bundle would run that bundle's code
    as the host's. The address's bundle counts only once the click has trusted the package.
  - `pack` resolves to the folder's `libraries.h5p`, or to the element's own `pack` on jsDelivr
    for a site built with `--no-libraries`, where allowed.
  - The page is at the folder's root, not at `/embed`, because a static host's mapping of `/embed`
    to `embed.html` differs (S3 does not), and every URL in it is relative, so a project site
    under a path works.
  - The package is MIT: the folder carries the GPL runtime and the libraries as separate works
    with their notices, and `NOTICE.txt` says which file is what. `--force` replaces only the
    files it writes, never the folder.
  - `tests/site.test.ts` serves a written site on `127.0.0.1` and frames it from `localhost` (two
    sites, as deployed) with no headers, as GitHub Pages would; `http://localhost` and
    `127.0.0.1` are accepted as origins for that reason.
  - Publishing: `prepublishOnly` refuses unless `npm_config_user_agent` says pnpm, which rewrites
    the `workspace:^` ranges in the tarball (npm cannot install them, `EUNSUPPORTEDPROTOCOL`); the
    verifier, the other package with workspace dependencies, has the same guard.
  - The page posts a `report` to any parent on `ready` (source, metadata, library bundle, elapsed
    time — the `ready` detail, trimmed) and an `error` on a failed load or a refusal, in the exact
    shapes the owner's site's preview checks are built from. Options: `defaultLibraries` and
    `--default-libraries`, with `libraries=none` to turn it off per address, checked against
    `--packages` when the site is written so a default the page would refuse never ships;
    `runtime`, for a bundled element; and `askInOwnFrame: false`, for a site whose own preview
    frames the page for a package the visitor just chose.
  - A site is written from whatever player is installed, so a fix to the player reaches a player
    domain only through an embed release, and then only once the host writes and deploys the site
    again. Each embed release therefore raises its player, runtime and pack ranges to the fix it
    needs, and the verifier is released beside it when its checks depend on the same change,
    since `npx` keeps a cached copy's dependencies until the package itself changes.
