# The hosted demo

`vercel.json` deploys `apps/demo/dist-demo/` — the output of `pnpm build:demo` — as a static site plus
one function. The site root has the layout of the package's `dist/`: `h5p-player.js` unhashed
(an explicit entry of `apps/demo/vite.config.ts`, named without a hash), with `h5p-sw.js` and
`frame-assets/` beside it, so the pages set neither `sw` nor `assets-base` and the element finds
both the way it does in any app that serves `dist/` statically. The worker's scope is therefore
`/h5p/`, and a request that reaches Vercel under it is a 404 rather than a page: a request the
worker misses is never answered with a site's HTML fallback, which the runtime would take for the
file.

- **`/no-range/<fixture>` is a function, `api/no-range.js`.** Vercel's static files honour
  `Range`, so the host-that-ignores-Range case — the common one in the wild — would otherwise not
  exist on the demo at all. The function fetches the fixture back from the deployment's own
  static files and answers `200` with the whole body and no `Accept-Ranges`. Behind deployment
  protection that internal fetch gets the login page; `VERCEL_AUTOMATION_BYPASS_SECRET` on the
  project makes it send the bypass header. The `?throttle=` pacing is dev and preview only.
- **The CSP header is real, and it reaches more than the pages.** `connect-src 'self' https:`
  because the page and the blob Jobs worker fetch whatever package URL a visitor pastes;
  `worker-src blob:` for that worker; `frame-src 'self'` for the frame. The same header lands on
  `/h5p-sw.js` and so becomes the Service Worker's own policy, which is the second reason
  `connect-src` has to cover the package hosts. It does not reach the frame document — the worker
  synthesizes that response, and its policy is the `<meta>` in `frame-document.ts`. `vite
  preview` applies the same headers (`apps/demo/vite.config.ts` reads them out of `vercel.json`), so a
  violation shows up locally before it ships.
- **The element's shadow styles are a constructable stylesheet because of that header.** Under
  `style-src 'self'` an inline `<style>` in the shadow root is blocked without a word, and the
  frame collapses to an iframe's intrinsic height. `CSSStyleSheet.replaceSync` is CSSOM and is
  not subject to it; the `<style>` element remains only as the fallback for a browser without
  `adoptedStyleSheets`.
- **The pages' code is highlighted when they are served or built, with classes.** A page writes
  `<pre class="code" data-lang="sh|js|html|xml|text">`, with `data-title` for a file name and
  `<div class="code-tabs">` around blocks that each carry `data-tab` for alternatives (npm, pnpm,
  yarn); `scripts/lib/code-blocks.mjs`, a `transformIndexHtml` hook after the site URL's, turns
  each into a figure with a label, tabs and Copy, highlighted by Shiki. Shiki's own themes put a
  `style` attribute on each token, which `style-src 'self'` refuses, so the theme there is our own
  and names roles (`var(--tk-string)`) that leave the output as classes, coloured in
  `player-page.css`. Nothing of Shiki reaches a visitor: `demo/code-blocks.js` only works the
  tabs, one choice for the whole site kept in `localStorage`, and Copy.
- **The pages carry their metadata, and the origin is filled in at build time.** Titles,
  descriptions, canonical links, Open Graph and Twitter tags, JSON-LD for the software on the
  front page, `robots.txt` and `sitemap.xml`, and the repository's Star button at the right of
  every page's header, beside the theme switch (*The header's Star button*, below). The
  absolute URLs are written as `%SITE_URL%` in the HTML and replaced by `siteUrlPlugin`
  (`apps/demo/vite.config.ts`), which runs before Vite's own `%ENV%` pass so Vite does not warn about a
  name it does not know. `build-demo.mjs` decides the origin — `SITE_URL` if set, else Vercel's
  `VERCEL_PROJECT_PRODUCTION_URL`, else the preview's localhost — and writes the sitemap and
  robots file with it. `/embed` stays out of the sitemap and carries `noindex`. Each title names
  H5P and what the page is about in the words people search for; the front page says it is a
  standalone, headless and offline player in its title, its lede and a section of that name, and
  its h1 says what the player is (the package's npm name is in the bar). Its JSON-LD adds a
  `WebSite`, which gives search results the site's name rather than the host's. The social card,
  `demo/og-image.png`, is rendered by `pnpm demo:og` in Chromium from a small HTML page and
  committed, because link previews want a raster image and the deploy has no browser.
- **`/app/` is the installable player, and the one place the single-worker setup runs.** A teacher hands out
  `.h5p` files, a student plays them later with no connection: playing a picked file never
  needed a network, the player itself did. `app/sw.js` is a host worker with scope `/app/` that
  calls `mountH5P(self)` first and then serves a precache — the page, the element, every file
  under `frame-assets/`, the manifest and icons — cache first. **One worker, not two**: the
  frame is a client of whichever worker serves it, so its requests for the runtime, `h5p.css`
  and the fonts go to that worker, and `mount.ts` passes anything outside its routes to the
  network; an app-shell worker beside ours at `/h5p/` would never see them. So the element must
  find the mounted routes (`findMountedRoutes`, the `_ping` check), which needs the page to be
  controlled, and `app.js` therefore plays nothing until it is — on a first visit the worker
  installs, precaches and claims the page. A hard reload bypasses the worker for that load; the
  page then says "online only" and the element registers its own worker at `/h5p/`, which plays
  but not offline. The precache list is not written by hand: `build-demo.mjs` turns on Vite's
  build manifest, walks the app page's chunks from it, adds what the built page links, then
  deletes the manifest so it is not deployed; the cache version is a hash over the files, so the
  worker's bytes change exactly when something it caches has. The web app manifest is linked with
  `vite-ignore` and copied as it is, because a hashed copy under `/assets/` would resolve its
  relative icon URLs to nothing. `file_handlers` makes the installed app the handler for `.h5p`
  in the operating system and `launchQueue` hands the file to the page. `/app/?src=<url>` plays
  a package from the web, the link a teacher sends: Chrome lists `/app/*` as the installed app's
  "supported links", so the link opens in the app's window, and with `launch_handler:
  focus-existing` a link clicked while that window is open arrives on `launchQueue` as
  `targetURL` rather than as a navigation — so `app.js` reads `?src=` from both, and skips a
  target it has already opened, since the launch that opened the page carries the page's own
  address too. A URL needs the network whatever was cached, because the probe is a request;
  offline the page says so; `navigator.storage.persist()` is asked for once installed. In dev the
  worker is bundled per request with an empty precache, so dev always goes to the server.
  **It is laid out as an app, not as the page with its menu hidden**: a bar, and one of two
  screens: home, a drop area around one button; and the player, the content under a bar with
  Back, the package's own title (`h5p.json`'s, the file's name until it is read) and Start over,
  with a loading screen and the download's progress along the bar's edge while it opens. Opening
  is a step in the window's history — a link keeps its `?src=` there — so Back, the bar's, the
  browser's or Android's, closes the file rather than leaving the app; that needs the element to
  stop adding history of its own (*The frame is navigated in place*). Content adds steps of its
  own: the frame shares the page's origin, and Interactive Book writes its chapter into the
  page's address (`top.location.hash`) at every move, a step with no state. So every step the
  app writes carries its screen and, for the player, its depth above home, and a stateless step
  with a new fragment is taken for the open file's and marked one past the step before it: the
  browser's Back turns the book's pages back before it closes the file, a reload keeps its
  place, and the bar's Back goes home past all of them with one `history.go`. Chrome keeps fifty
  steps, so a long read can push home out of the history; when nothing answers that `go`, the
  bar closes the file where it is and makes that step home. A stateless step without a fragment
  is taken for home. The page's account of itself, written for search engines, follows the home
  screen in a tab and is gone from the installed window, where About in the menu says what
  matters. Installed is `display-mode: standalone`, or `window-controls-overlay` for Chrome and
  Edge on the desktop, where the manifest's `display_override` puts the bar in the title bar's
  place between the window's controls; the stylesheet names both. The title bar takes the page's
  colour (`theme-color`, which `app.js` keeps for a theme pinned against the system's) and says
  the app's name, not the page's search title. `app.css` scopes every rule to `.app`, the body's
  class, because the build links it ahead of the shared sheet. The manifest's screenshots, for
  Chrome's fuller install dialog, are rendered from the built site by `pnpm demo:screenshots`,
  the installed rules switched on through the CSSOM since Chromium cannot emulate
  `display-mode`, and kept out of the precache. `tests/app.test.ts` drives the screens, the
  history, the menu and the keyboard, and writes to the address from the frame as Interactive
  Book does, across a reload too. `label.file` hides its input out of sight but focusable, not
  with `display: none`, so a key can open the picker on any page. Install is on the home screen
  beside "Works offline" and in the menu, not in the bar; for the same reason the site's links
  take their own row below 64rem, so the bar is the same height in the app and out of it.
  **The files opened before are listed under the drop area**: each one's title, its name or a
  link's host, when it was opened, and a cross that takes it off; a choice opens it again where
  it was left, since what the player knows a file by — name, size and date — is kept with it.
  `recent.js` keeps the list in a database of the app's own, `h5p-app`, and records an open only
  once it reached `ready`, so the list offers what played; it keeps twenty. What reopens a file
  differs by browser. Installed from Chrome or Edge on the desktop, the app keeps the file
  handle — from their picker, `showOpenFilePicker`, which `choose` uses where it exists, from a
  drop (`getAsFileSystemHandle`, asked for during the drop) and from `launchQueue` — and reads
  the file from disk again, after the permission prompt Chrome shows once a session. A file
  moved or deleted asks to be chosen again. Everywhere else, a tab in Chrome included, it keeps
  a copy of the file in a store beside the list, and the entry shows the copy's size; taking the
  entry off deletes the copy. A copy was chosen over asking for the file again because on an
  iPad choosing the file again is the step the list exists to save. A private profile keeps a
  reference to the file, not its bytes, so `copyOf` reads a byte before handing a copy over, and
  an entry that cannot open its file asks for it, and goes from the list until it is chosen
  again — a copy kept already is never written again, so the dead one would otherwise stay.
  Handles are kept only when installed, because storing one in IndexedDB took the whole browser
  down in a private profile (Chromium in a context Playwright opens); an installed app never
  runs in a private profile, where a tab may. The tests that store a handle use a profile on disk
  and answer `display-mode` as installed through `matchMedia`.
  **A package without its own libraries plays offline from the first open**, because the app
  carries them: the app imports the `pack` export of `packages/libraries/`
  (`@missing-elements/h5p-libraries`), the H5P hub's runtime libraries for every content type it
  serves, kept at the newest minor of each major. Vite emits the parts, the precache takes them
  from the manifest, `libraries` is `pack`, and the player copies into its own cache only the
  parts a package uses and refreshes older packages' libraries offline. A package that needs a
  newer minor than the pack, or a content type added since, gets a message that a later version
  of the app will play it; nothing else is asked. `pnpm libraries` rebuilds it, and should
  before a release; it stops on a library whose `library.json` names no licence unless
  `UNDECLARED` in the script names one found in its repository, and writes `libraries.txt`,
  linked from the page, with each library's licence and authors. The licences are MIT, public
  domain, MPL and GPL-3.0; the site already serves the GPL runtime. It is committed, like the
  demo content, so a deploy does not depend on the hub.
  Installs in Safari on macOS (Add to Dock) and on iOS (Add to Home Screen, as a web app), and
  plays offline in the iOS app; `apple-touch-icon.png` (180, opaque) is there because iOS takes
  the home screen icon from that link. What Safari and iOS do not do, by design rather than a
  gap here: `file_handlers` and `launch_handler` are Chromium's, so only Chrome and Edge open a
  `.h5p` from the file manager; iOS opens a `?src=` link in Safari, not in the installed app;
  and each iOS install has storage of its own, apart from Safari's, list of recent files
  included. Not covered: whether WebKit clears an installed app's storage, the copies the list
  keeps among it, after weeks unused.
- **What a public demo means.** The frame is same-origin by design, and a package's libraries
  are JavaScript, so `/?src=<any url>` runs a stranger's code on the demo's origin. That is the
  architecture — a host chooses what it plays — not a flaw in it, and it is why the demo origin
  holds no cookies and no accounts. It does hold storage worth reading: the app sets `resume`,
  so `h5p-player-userdata` has the saved state of every package opened there, answers included;
  the chunk store has every package's extracted files; and the `packages` table lists every URL
  and file name played. Any package on the origin can read all three and send them out through
  the frame's `img-src *`, and `connect-src 'self'` does not stop it. So the player page, the
  app, the cmi5 page and `/embed` play a package from another origin `untrusted` (the invariant
  *An untrusted package plays as data*), with the library pack — the site's own copy, the parts
  it needs — and ask, naming the host, only when it is refused for needing its own copy of a
  library (`missingLibraries.carried`); the click plays it trusted. Their own origin's packages
  and what the visitor typed or picked play as before. The player page shows both modes: a
  Trusted/Untrusted switch in its form holds for whatever plays next — a typed URL, a picked
  file, a sample — and changing it plays the current package again in the other mode. A `?src=`
  link from another site and the content-only sample set it to Untrusted, and the click that lets
  a refused link run its own code sets it to Trusted, so it always shows the mode playing; the
  status line names the mode once the content is up. Refused untrusted for needing its own code,
  a package from this site or a picked file asks nothing, since the visitor chose the mode: the
  page says to switch. What the content check changed is not shown: the runtime writes it to the
  frame's console only, and the element has no way to tell the page. The page plays every
  package with `libraries="pack"` and the site's own pack (the `pack` export), so a package
  without its libraries gets the parts it needs with no question, and a "Newest libraries"
  switch beside the modes turns the refresh off, to show an older export as exported; the log
  lists each refreshed library, and the status line counts them. The app's list of recent files
  reopens a link the way it first opened, untrusted if it is on another site, asking again if it
  needs its own code. The cmi5 page covers both places a launch names the package, `?src=` and
  `launchParameters`, since a link can carry cmi5 parameters pointing at an LMS of the
  link-writer's own; it passes `src: false` and sets `src` itself on `initialized`. `/embed` in
  another origin's frame plays a package as it is: its storage is partitioned by the embedding
  site, so a page only reaches what was played under its own embed; framed by this origin, or
  opened on its own, it plays untrusted like the rest, and a page that passes
  `askInOwnFrame: false` — a site's own preview — plays as it is. Every check fails closed: a
  `data:` URL, with no host, counts as another site's, and no page gives the element one (next
  bullet). The rule stays: any package whose own code runs on an origin can read every other
  package's data there.
- **A package address from a link, a field or a launch reaches `src` parsed, and only as `http`
  or `https`**: `packageUrl` in `demo/page-common.js` for the player page, the cmi5
  page and the app; its copy in the embed page's `embed.js`; `webAddress` in
  `@missing-elements/h5p-cmi5`, with the page's address as its base, which reports what it passes
  over as `unsafe-src`. Each resolves the text with `new URL`, refuses any other scheme with a
  message, and sets the parsed URL's `href`, never the text. The element fetches its `src` and
  never navigates to it, so a `javascript:` address could not have run. But CodeQL cannot know
  what the element does with `src`: it flags every `setAttribute('src', …)` fed by a link, a
  field or the launch under `js/xss`, `js/xss-through-dom` and
  `js/client-side-unvalidated-url-redirection`. Its model of `new URL(x)` carries taint into
  `search`, `hash` and `searchParams` alone, so the parsed URL's `href` is clean to all three
  queries. A check on the text, such as `startsWith('https:')`, satisfies `js/xss` only, and the
  redirect query accepts nothing short of a fixed host, which a player of any host's packages
  cannot have. New code that sets `src` from outside takes the same path, rather than another
  dismissal.
- **Page views are counted by Vercel Web Analytics on the site's pages, never in the app or
  `/embed`**, through `demo/analytics.js`: `partials/head.html` is `head-base.html` plus that
  script, the app's page names `head-base` itself, and `/embed` loads neither. `inject()` from
  `@vercel/analytics` loads `/_vercel/insights/script.js` from the site's own origin and reports
  to it, so the CSP needs no change and no cookie is set; in dev it logs to the console. The
  installed app would count every launch made with a network (its worker answers the precached
  shell but not Vercel's script, so the request goes out and fails only offline), and `/embed`
  plays inside other people's sites. Demo only: the packages carry none, and `docs/privacy.md`
  describes the packages, not this site.
- **The header's Star button shows the repository's live star count**: `demo/stars.js`, on every
  page with the header, reads `stargazers_count` from `api.github.com` in the visitor's browser —
  the one request to a third party the pages make, which `connect-src 'self' https:` already
  allowed — with `no-referrer`, at most once an hour, since the API answers sixty unauthenticated
  requests an hour per address. It is a classic script in the head, like `theme.js`, and puts
  the count it last had on `<html>` before the first paint, as `data-stars` and as
  `--star-count`, a CSS string the stylesheet draws after the star (`root.style.setProperty` is
  CSSOM, which `style-src 'self'` does not refuse). A module would run after the first paint and
  the button would grow under the reader. What is stored is when to ask next, written before
  asking: an hour after a success, ten minutes after a failure, and after a rate limit the
  moment GitHub's `X-RateLimit-Reset` names, which it exposes to pages; a failure keeps the count
  already shown. In an installed window of the app, where the button is hidden, the script
  returns at once, so the app reaches no third party. The links sit in the middle of the bar from
  64rem (a three-column grid), and on a row of their own below it. The app's bar puts its back
  button, name and file title in one box (`.appbar-start`) so the file's screen has the grid's
  three cells too; the title gets no intrinsic width (`contain: inline-size`), or the box takes
  the whole title's width and pushes the icons onto a row of their own on a phone. Its installed
  window, with no links, keeps a flex row.
- **"My file does not play" opens a bug report that the visitor sends.** Under the player page's
  element, once something has been played, it opens GitHub's `bug_report.yml` form in a new tab
  without `opener`, its fields filled in by their `id`s from what the page knows of the load:
  the file's name or the link, the switches, the content type (`metadata`, or a refusal's
  `missingLibraries.mainLibrary`), the error, the player's version and the event log, oldest
  first and without the statements. Nothing is sent from the page, and the package goes only if
  the visitor attaches it, which GitHub takes renamed to `.zip`, up to 25 MB. Every address
  loses its query and fragment, in the log too: a signed URL carries its credentials there, and
  an issue is public. `labels` is not passed, since GitHub answers a visitor who may not set
  labels with a 404, and the form adds `bug` itself. The log is cut from its middle to keep the
  address under 7,000 characters, short of GitHub's 414.
- **The header and the head's shared lines are partials** (`partials/`, put into each page by
  `scripts/lib/partials.mjs`, a `transformIndexHtml` hook that runs first, in dev and the build
  alike), so a change to the bar is made once. The nav marks the page it is on itself — the link
  whose address is the longest prefix of the page's — so a page names no current link. The nav's
  last link, Create with AI, leaves the site: it goes to the build page on
  missing-elements.github.io (*Where `npx` cannot install, a page builds*, design/author.md),
  with a sentence in the front page's lede that says what that page is for. An address on
  another site is never a prefix of a page's own, so it is never the marked one. With seven
  links the bar is as high as before at every width from 320 to 1440 px, but it has little room
  left: centred on one line it needs 1011 px (1061 px in the app), and a wider font wraps the
  pages' nav to a second row or scrolls the app's bar, which does not wrap, sideways. CI's test
  of the app's bar asks for its icons on one row and no sideways scroll at 1024 px. The footers stay in the pages: each lists its own links. The per-page metadata —
  title, description, Open Graph and Twitter tags, each written two or three times — is not
  shared yet.
- **The page's design is the player's `page.css`.** The colours for light and dark, the bar, the
  buttons, the status strip, the player's box, cards and messages are in
  `packages/player/page/page.css`, which the player ships in `dist/` and the demo imports first;
  the config aliases the package path to the source, as it does the element's. The verifier's
  preview and the extension's page import the same file, so the pages around the player look the
  same and cannot drift from the demo. The build page is not one of them: on
  missing-elements.github.io, it takes that site's own look (*Where `npx` cannot install, a page
  builds*, design/author.md). The bar's three-column grid applies to a bar with a nav
  (`.topbar:has(nav)`): a bar of a brand and its actions keeps the actions at its end.
- **Caching.** Hashed files under `/assets/` are immutable; `h5p-sw.js` and `frame-assets/` are
  `no-cache`; `fixtures/` revalidate hourly. `frame-assets/` must not be cached for an hour: its
  file names stay the same from one runtime to the next, and a returning browser would run the
  old boot script under the new worker ("Cannot read properties of undefined (reading 'H5P')").
  The embed command's headers follow the same rule, for `/libraries/` as well. Fixtures also
  carry permissive CORS with `Range` allowed and `Content-Range` exposed, so another player
  instance can be pointed at them.
- **The demo plays real content; the fixtures never ship.** The player's `public/fixtures/` is the test
  suite's stub library saying "Served from the archive, never extracted to disk", which is right
  for a test and wrong for a visitor. The site plays four packages from `demo/content/`: a
  Question Set, an Interactive Video on a ten-second Big Buck Bunny clip, an Accordion on how the
  player works, and Dialog Cards for its vocabulary. They are built by
  `scripts/build-demo-content.mjs` from `demo/content/src/<name>/` — our `content.json` and a
  `manifest.json` naming the content type — with the libraries taken from the H5P hub's bundle
  for that type. The script keeps the dependency closure the content needs (walked from
  `library.json`, plus every sub-content library the params name) and, after it, what an H5P
  site's upload check wants of those libraries (below), and runs the result through the
  normalizer, so each package is also an example of what the normalizer produces. A fifth,
  `formulas.h5p`, is a Question Set with LaTeX in it written with `"stripped": true` in its
  manifest — `h5p.json` naming the main library alone, `content/`, no library folders, as h5p.com
  and h5p.org export — which the player page's sample button marked `data-untrusted` plays
  `untrusted` against the site's pack: the one place on the site that shows the untrusted path,
  the addon rule and the pack's MathDisplay. A sixth, `markup.h5p`, is a Column whose text holds
  markup no H5P site would have saved: a notice pinned over the content with `position: fixed`,
  a sign-in form, a link dressed as a button. It carries its libraries and plays in whichever
  mode the player page's switch is in, so switching shows what the content check removes and
  what it keeps (the words, and the colours a text field allows). Each part says, in markup the
  check keeps, what each mode should show, so the result reads as a demonstration and not as the
  site failing. The two-players example plays `how-it-works.h5p` twice, the second `frame
  copyright`, since one package under two settings is what the per-load fix is for. The outputs
  are committed, about 8 MB for the four, because a deploy should need neither the hub nor the
  video host; `pnpm demo:content` regenerates them. A package that carries libraries also carries
  what an H5P site's upload check wants of them: every dependency a carried library names,
  editor ones included, at its exact major.minor, as a platform's export does, with `h5p.json`
  naming only what plays. A Moodle with no library installed refuses a package without its
  editor libraries. `how-it-works.h5p` and `markup.h5p` need nothing, and `formulas.h5p` carries
  no library on purpose, so a site without Question Set refuses it, as it does an h5p.com
  export. An Interactive Video's editor preloads every type it can hold, so its package is
  larger. The script has the normalizer write the added libraries after the media (`last`), so
  `content.json` stays early: on a host without `Range`, `/no-range/video.h5p` boots after
  1.5 MB, not 4.1. A bundle has older patches than the pack for some libraries; the plan reads
  and refreshes only what the content reaches, and leaves the carried-for-the-editor ones as
  they are. Provenance: the libraries are MIT, the text is ours under CC0, and the clip is Big
  Buck Bunny, © Blender Foundation, CC BY 3.0, credited in the package metadata and on the
  player page. The clip is seconds 10 to 20 of Blender's own `BigBuckBunny_640x360.m4v` (the
  opening music, so it has sound), trimmed without re-encoding (`avconvert -p PresetPassthrough
  --start 10 --duration 10`, built into macOS) and kept beside the source. The `/no-range/`
  route serves this content on the site, and this content or a fixture locally, which is what
  the browser tests need.
