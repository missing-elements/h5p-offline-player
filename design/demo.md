# The hosted demo

`vercel.json` deploys `apps/demo/dist-demo/` — the output of `pnpm build:demo` — as a static site plus
one function. The site root has the layout of the package's `dist/`: `h5p-player.js` unhashed
(an explicit entry of `apps/demo/vite.config.ts`, named without a hash), with `h5p-sw.js` and
`frame-assets/` beside it, so the pages set neither `sw` nor `assets-base` and the element finds
both the way it does in any app that serves `dist/` statically. The worker's scope is therefore
`/h5p/`, and a request that reaches Vercel under it is a 404 rather than a page — the
SPA-fallback trap described above cannot happen there.

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
  frame collapses to an iframe's intrinsic height with the content otherwise working — found by
  driving the built demo under the production CSP. `CSSStyleSheet.replaceSync` is CSSOM and is
  not subject to it; the `<style>` element remains only as the fallback for a browser without
  `adoptedStyleSheets`.
- **The pages' code is highlighted when they are served or built, with classes.** A page writes
  `<pre class="code" data-lang="sh|js|html|xml|text">`, with `data-title` for a file name and
  `<div class="code-tabs">` around blocks that each carry `data-tab` for alternatives (npm, pnpm,
  yarn); `scripts/lib/code-blocks.mjs`, a `transformIndexHtml` hook after the site URL's, turns
  each into a figure with a label, tabs and Copy, highlighted by Shiki. Shiki's own themes, and
  every highlighter's default output, put a `style` attribute on each token, which `style-src
  'self'` refuses, so the theme there is our own and names roles (`var(--tk-string)`) that leave
  the output as classes, coloured in `player-page.css`. Nothing of Shiki reaches a visitor:
  `demo/code-blocks.js`, 1.6 kB, only works the tabs, one choice for the whole site kept in
  `localStorage`, and Copy. Added on 2026-10-14, after the owner found the snippets hard to tell
  from the text: they were the page's pale surface colour, and three in a row touched. Checked
  under the production headers: no violation on any page.
- **The pages carry their metadata, and the origin is filled in at build time.** Titles,
  descriptions, canonical links, Open Graph and Twitter tags, JSON-LD for the software on the
  front page, `robots.txt` and `sitemap.xml`, and the repository's Star button at the right of
  every page's header, beside the theme switch (*The header's Star button*, below). The
  absolute URLs are written as `%SITE_URL%` in the HTML and replaced by `siteUrlPlugin`
  (`apps/demo/vite.config.ts`), which runs before Vite's own `%ENV%` pass so Vite does not warn about a
  name it does not know. `build-demo.mjs` decides the origin — `SITE_URL` if set, else Vercel's
  `VERCEL_PROJECT_PRODUCTION_URL`, else the preview's localhost — and writes the sitemap and
  robots file with it. `/embed` stays out of the sitemap and carries `noindex`. Since 2026-10-18,
  asked for by the owner, each title names H5P and what the page is about in the words people
  search for, and the front page says it is a standalone, headless and offline player in its
  title, its lede and a section of that name, and its h1 says what the player is: the package's
  npm name, the h1 until then, is in the bar, and broke mid-word on a phone. Its JSON-LD adds a
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
  installs, precaches and claims the page, about a second on localhost. A hard reload bypasses
  the worker for that load; the page then says "online only" and the element registers its own
  worker at `/h5p/`, which plays but not offline. The precache list is not written by hand:
  `build-demo.mjs` turns on Vite's build manifest, walks the app page's chunks from it, adds what
  the built page links, then deletes the manifest so it is not deployed; the cache version is a
  hash over the files, so the worker's bytes change exactly when something it caches has. The web
  app manifest is linked with `vite-ignore` and copied as it is, because a hashed copy under
  `/assets/` would resolve its relative icon URLs to nothing. `file_handlers` makes the
  installed app the handler for `.h5p` in the operating system and `launchQueue` hands the file
  to the page. `/app/?src=<url>` plays a package from the web, the link a teacher sends: Chrome
  lists `/app/*` as the installed app's "supported links", so the link opens in the app's window,
  and with `launch_handler: focus-existing` a link clicked while that window is open arrives on
  `launchQueue` as `targetURL` rather than as a navigation — so `app.js` reads `?src=` from both,
  and skips a target it has already opened, since the launch that opened the page carries the
  page's own address too. A URL needs the network whatever was cached, because the probe is a
  request; offline the page says so; `navigator.storage.persist()` is asked for once installed. In dev the worker is
  bundled per request with an empty precache, so dev always goes to the server. Checked in
  Chromium against `pnpm preview:demo`: installable with no manifest errors, and after going
  offline and reloading, the Interactive Video and the Accordion play from picked files, the video
  decoding and playing as it does online.
  **It is laid out as an app, not as the page with its menu hidden** (2026-10-12, after a review
  found the installed window showing the site's header, a paragraph on installing, a strip that
  read IDLE and an empty box, with the content below the fold). A bar, and one of two screens:
  home, a drop area around one button; and the player, the content under a bar with Back, the
  package's own title (`h5p.json`'s, the file's name until it is read) and Start over, with a
  loading screen and the download's progress along the bar's edge while it opens. Opening is a
  step in the window's history — a link keeps its `?src=` there — so Back, the bar's, the
  browser's or Android's, closes the file rather than leaving the app; that needed the element to
  stop adding history of its own (*The frame is navigated in place*). Content adds steps of its
  own: the frame shares the page's origin, and Interactive Book writes its chapter into the
  page's address (`top.location.hash`) at every move, a step with no state. The app first took
  any step it had not made for Back and closed the book at its cover's Read button (2026-10-12, an
  h5p.com portfolio, which the player page played, having no history of its own to keep). So
  every step the app writes carries its screen and, for the player, its depth above home, and a
  stateless step with a new fragment is taken for the open file's and marked one past the step
  before it: the browser's Back turns the book's pages back before it closes the file, a reload
  keeps its place, and the bar's Back goes home past all of them with one `history.go`. Chrome
  keeps fifty steps, so a long read can push home out of the history; when nothing answers that
  `go`, the bar closes the file where it is and makes that step home. A stateless step without a
  fragment is taken for home, which covers steps written before steps were marked. The page's account of
  itself, written for search engines, follows the home screen in a tab and is gone from the
  installed window, where About in the menu says what matters. Installed is `display-mode:
  standalone`, or `window-controls-overlay` for Chrome and Edge on the desktop, where the manifest's
  `display_override` puts the bar in the title bar's place between the window's controls; the
  stylesheet names both. The title bar takes the page's colour (`theme-color`, which `app.js` keeps
  for a theme pinned against the system's) and says the app's name, not the page's search title.
  `app.css` scopes every rule to `.app`, the body's class, because the build links it ahead of the
  shared sheet. The manifest's screenshots, for Chrome's fuller install dialog, are rendered from
  the built site by `pnpm demo:screenshots`, the installed rules switched on through the CSSOM
  since Chromium cannot emulate `display-mode`, and kept out of the precache. `tests/app.test.ts`
  drives the screens, the history, the menu and the keyboard, and writes to the address from the
  frame as Interactive Book does, across a reload too. Two shared-sheet bugs came up on the
  way: `[hidden]` lost to `button`'s own display, so Start over showed with nothing open; and
  `label.file` hid its input with `display: none`, so no key could open the picker on any page —
  the input is now out of sight but focusable. Install is on the home screen beside "Works
  offline" and in the menu, not in the bar, where it was one item too many and pushed the icons
  onto a row of their own; for the same reason the site's links take their own row below 64rem,
  on every page since 2026-10-17, so the bar is the same height in the app and out of it.
  **The files opened before are listed under the drop area** (2026-10-12, asked for by the owner):
  each one's title, its name or a link's host, when it was opened, and a cross that takes it off;
  a choice opens it again where it was left, since what the player knows a file by — name, size
  and date — is kept with it. `recent.js` keeps the list in a database of the app's own,
  `h5p-app`, and records an open only once it reached `ready`, so the list offers what played; it
  keeps twenty. What reopens a file differs by browser. Installed from Chrome or Edge on the
  desktop, the app keeps the file handle — from their picker, `showOpenFilePicker`, which `choose`
  uses where it exists, from a drop (`getAsFileSystemHandle`, asked for during the drop) and from
  `launchQueue` — and reads the file from disk again, after the permission prompt Chrome shows
  once a session, which offers "Allow on every visit"; a file moved or deleted asks to be chosen
  again. Everywhere else, a tab in Chrome included, it keeps a copy of the file in a store beside
  the list, and the entry shows the copy's size; taking the entry off deletes the copy. A private
  profile keeps a reference to the file there, not its bytes: in the one Playwright opens, a file
  deleted after it was opened could not be read from its "copy", and the player said "Could not
  read the archive index", where a profile on disk, Chromium's and Chrome's, kept the bytes and
  reopened it (2026-10-12). So `copyOf` reads a byte before handing a copy over, and an entry that
  cannot open its file asks for it, and goes from the list until it is chosen again — a copy kept
  already is never written again, so the dead one would otherwise stay. Handles
  only when installed, because storing one in IndexedDB took the whole browser down in a private
  profile: Chromium 153 in a context Playwright opens, which is the DevTools protocol's private
  kind, with a handle to a file dropped from disk and to one in the origin's own file system
  alike, while a profile on disk stored and read both back (2026-10-12). Whether Chrome's own
  incognito window does the same was not established — the attempt reported a normal profile's
  quota — and an installed app never runs in a private profile, where a tab may. The tests that
  store a handle use a profile on disk and answer `display-mode` as installed through
  `matchMedia`, the one thing about an installed window a test can stand in for. The choice
  between a copy and asking for the file again was the owner's, on 2026-10-12: a copy, because on
  an iPad choosing the file again is the step the list exists to save.
  **A package without its own libraries plays offline from the first open**, because the app
  carries them: `packages/libraries/libraries.h5p` (`@missing-elements/h5p-libraries`, the app's
  until 2026-10-08) is the H5P hub's runtime libraries for every content type it serves — 105
  folders from 53 content types and one addon, 13.7 MB, on 2026-10-13: AR Scavenger and
  H5P.MathDisplay added to the 100 folders and 9.8 MB rebuilt from the new hub host on
  2026-10-10 (98 and 9.5 MB from the old host's catalogue on 2026-09-29) — kept at the newest minor of
  each major, imported by `app.js` as a URL asset so Vite emits it under `assets/` and the
  precache picks it up from the manifest, and set as `libraries` on every open. Since 2026-10-18
  the app imports the `pack` export instead: Vite emits the 105 parts, the precache takes them
  from the manifest (144 files), `libraries` is `pack`, and the player copies into its own cache
  only the parts a package uses, where it used to keep a second copy of the whole pack beside the
  precache's, and refreshes older packages' libraries offline. Nothing else is
  asked since 2026-10-10: a package that needs a newer minor than the pack, or a content type
  added since, gets a message that a later version of the app will play it. Until then the hub
  was the fallback, behind a consent remembered in `localStorage`. `pnpm libraries`
  rebuilds it, and should before a release; it stops on a library whose `library.json` names no
  licence unless `UNDECLARED` in the script names one found in its repository — fifteen H5P
  libraries state MIT in their README only, and flowplayer's GPL-3.0 is in its script's header —
  and writes `libraries.txt`, linked from the page, with each library's licence and authors. The
  licences are MIT (92), public domain (2), MPL (2) and GPL-3.0 (2); the site already serves the
  GPL runtime. Committed, like the demo content, so a deploy does not depend on the hub. Checked:
  stripped exports of the four demo packages played offline in a fresh browser that had never
  consented to the hub, with no request to h5p.org.
  Installs in Safari on macOS (Add to Dock) and on iOS (Add to Home Screen, as a web app),
  and plays offline in the iOS app (installed, a package played, airplane mode, reopened),
  both reported by the owner on 2026-10-11; `apple-touch-icon.png` (180, opaque) was added the same
  day, since iOS takes the home screen icon from that link and draws a screenshot of the page
  without it. What Safari and iOS do not do, by design rather than a gap here: `file_handlers` and
  `launch_handler` are Chromium's, so only Chrome and Edge open a `.h5p` from the file manager;
  iOS opens a `?src=` link in Safari, not in the installed app; and each iOS install has storage
  of its own, apart from Safari's, list of recent files included. Not covered: whether WebKit
  clears an installed app's storage, the copies the list keeps among it, after weeks unused.
- **What a public demo means.** The frame is same-origin by design, and a package's libraries
  are JavaScript, so `/?src=<any url>` runs a stranger's code on the demo's origin. That is the
  architecture — a host chooses what it plays — not a flaw in it, and it is why the demo origin
  holds no cookies and no accounts. It does hold storage worth reading, and the rule once said
  it must not: the app sets `resume`, so `h5p-player-userdata` has the saved state of every
  package opened there, answers included; the chunk store has every package's extracted files;
  and the `packages` table lists every URL and file name played. Any package on the origin can
  read all three and send them out through the frame's `img-src *`, and `connect-src 'self'`
  does not stop it. Found by the security review of 2026-10-04: a link to
  `/app/?src=<hostile package>` opened at once, in the installed app too. So the player page,
  the app, the cmi5 page and `/embed` asked before opening a package from another origin, naming
  the host, until 2026-10-12; since then they play it `untrusted` (the invariant *An untrusted
  package plays as data*), with the library pack — the site's own copy, the parts it needs, on
  every page since 2026-10-18 (the cmi5 page took jsDelivr's until then) — and ask, naming the host, only when it is
  refused for needing its own copy of a library (`missingLibraries.carried`); the click plays it
  trusted. Their own origin's packages and what the visitor typed or picked play as before. The
  player page shows both modes since 2026-10-18, asked for by the owner because a visitor saw only
  one: a Trusted/Untrusted switch in its form holds for whatever plays next — a typed URL, a picked
  file, a sample — and changing it plays the current package again in the other mode. A `?src=`
  link from another site and the content-only sample set it to Untrusted, and the click that lets a
  refused link run its own code sets it to Trusted, so it always shows the mode playing; the status
  line names the mode once the content is up. Refused untrusted for needing its own code, a
  package from this site or a picked file asks nothing, since the visitor chose the mode: the page
  says to switch. What the content check changed is not shown: the runtime writes it to the
  frame's console only, and the element has no way to tell the page. Since 2026-10-18 the page
  plays every package with `libraries="pack"` and the site's own pack (the `pack` export), so a
  package without its libraries gets the parts it needs with no question — the "this site's
  bundle, ~14 MB" offer it showed until then is gone — and a "Newest libraries" switch beside the
  modes turns the refresh off, to show an older export as exported against the same one at the
  pack's versions; the log lists each refreshed library, and the status line counts them. The
  app's list of recent files reopens a link the way it first opened, untrusted if it is on
  another site, asking again if it needs its own code. The cmi5 page covers both places a launch
  names the package, `?src=` and `launchParameters`, since a link can carry cmi5 parameters
  pointing at an LMS of the link-writer's own; it passes `src: false` and sets `src` itself on
  `initialized`. `/embed` in another origin's frame plays a package as it is: its storage is
  partitioned by the embedding site, so a page only reaches what was played under its own embed;
  framed by this origin, or opened on its own, it plays untrusted like the rest, and a page that
  passes `askInOwnFrame: false` — a site's own preview — plays as it is. Every check fails closed: a
  `data:` URL, with no host, counts as another site's, and no page gives the element one (next
  bullet). The rule stays: any package whose own code runs on an origin can read every other
  package's data there.
- **A package address from a link, a field or a launch reaches `src` parsed, and only as `http`
  or `https`** (2026-10-23, #71). `packageUrl` in `demo/page-common.js` for the player page, the cmi5
  page and the app; its copy in the embed page's `embed.js`; `webAddress` in
  `@missing-elements/h5p-cmi5`, with the page's address as its base, which reports what it passes
  over as `unsafe-src`. Each resolves the text with `new URL`, refuses any other scheme with a
  message, and sets the parsed URL's `href`, never the text. The element fetches its `src` and
  never navigates to it, so a `javascript:` address could not have run. But CodeQL cannot know
  what the element does with `src`: it flagged every
  `setAttribute('src', …)` fed by a link, a field or the launch under `js/xss`,
  `js/xss-through-dom` and `js/client-side-unvalidated-url-redirection`, 22 alerts dismissed as
  false positives from 2026-10-06 to -18, each filed again once a line around it moved. Its model of
  `new URL(x)` carries taint into `search`, `hash` and `searchParams` alone, so the parsed URL's
  `href` is clean to all three queries. A check on the text, such as `startsWith('https:')`,
  satisfies `js/xss` only, and the redirect query accepts nothing short of a fixed host, which a
  player of any host's packages cannot have. New code that sets `src` from outside takes the same
  path, rather than another dismissal.
- **Page views are counted by Vercel Web Analytics**, through `demo/analytics.js` in every
  page's head, including `/embed` and the app: `inject()` from `@vercel/analytics`, which loads
  `/_vercel/insights/script.js` from the site's own origin and reports to it, so the CSP needs no
  change and no cookie is set; in dev it logs to the console. Added on 2026-09-26, removed on
  2026-10-07 and put back on 2026-10-13 by the owner. Demo only: the packages carry none, and
  `docs/privacy.md` describes the packages, not this site.
- **The header's Star button shows the repository's live star count**, asked for by the owner on
  2026-10-17: `demo/stars.js`, on every page with the header, reads `stargazers_count` from
  `api.github.com` in the visitor's browser — the one request to a third party the pages make,
  which `connect-src 'self' https:` already allowed — with `no-referrer`, at most once an hour,
  since the API answers sixty unauthenticated requests an hour per address. It is a classic
  script in the head, like `theme.js`, and puts the count it last had on `<html>` before the first
  paint, as `data-stars` and as `--star-count`, a CSS string the stylesheet draws after the star
  (`root.style.setProperty` is CSSOM, which `style-src 'self'` does not refuse). The first cut was
  a module, which runs after the first paint, so the button grew under the reader on every page.
  What is stored is when to ask next, written before asking: an hour after a success, ten minutes
  after a failure, and after a rate limit the moment GitHub's `X-RateLimit-Reset` names, which it
  exposes to pages; a failure keeps the count already shown. The first cut stored only a success,
  so a rate-limited visitor asked again on every page and kept the limit hit; the second waited an
  hour after any failure, so the deployed site showed no count until an hour after a visit during
  the limit — found on 2026-10-17, when testing had used up this address's sixty, and records in
  that shape are read as stale. In an installed
  window of the app, where the button is hidden, the script returns at once, so the app reaches no
  third party. Measured on the built site under the production headers: no layout shift in the bar across five pages with a
  count kept, and one request where there had been five without. The links sit in the middle of
  the bar from 64rem (a three-column grid), and on a row of their own below it. The app's bar puts
  its back button, name and file title in one box (`.appbar-start`) so the file's screen has the
  grid's three cells too; the title gets no intrinsic width (`contain: inline-size`), or the box
  took the whole title's width and pushed the icons onto a row of their own on a phone. Its
  installed window, with no links, keeps a flex row.
- **"My file does not play" opens a bug report that the visitor sends**, asked for by the owner
  on 2026-11-08. Under the player page's element, once something has been played, it opens
  GitHub's `bug_report.yml` form in a new tab without `opener`, its fields filled in by their
  `id`s from what the page knows of the load: the file's name or the link, the switches, the
  content type (`metadata`, or a refusal's `missingLibraries.mainLibrary`), the error, the
  player's version and the event log, oldest first and without the statements. Nothing is sent
  from the page, and the package goes only if the visitor attaches it, which GitHub takes renamed
  to `.zip`, up to 25 MB. Every address loses its query and fragment, in the log too: a signed
  URL carries its credentials there, and an issue is public. `labels` is not passed, since GitHub
  answers a visitor who may not set labels with a 404, and the form adds `bug` itself. The log is
  cut from its middle to keep the address under 7,000 characters, short of GitHub's 414.
- **The header and the head's shared lines are partials** (`partials/`, put into each page by
  `scripts/lib/partials.mjs`, a `transformIndexHtml` hook that runs first, in dev and the build
  alike), since 2026-10-17, asked for by the owner after the Star button had to be added to eleven
  copies of the bar. The nav marks the page it is on itself — the link whose address is the
  longest prefix of the page's — so a page names no current link. The footers stay in the pages:
  each lists its own links. The per-page metadata — title, description, Open Graph and Twitter
  tags, each written two or three times — is the obvious next candidate and has not been done.
- **Caching.** Hashed files under `/assets/` are immutable; `h5p-sw.js` and `frame-assets/` are
  `no-cache`; `fixtures/` revalidate hourly. `frame-assets/` was hourly, with a day of
  `stale-while-revalidate`, until #49: its file names stay the same from one runtime to the next,
  and after the 1.0 deploy a returning browser ran runtime 0.2.5's boot script, kept from before,
  under the new worker — "Cannot read properties of undefined (reading 'H5P')" on every play for
  that hour. The embed command's headers changed the same way, for `/libraries/` as well. Fixtures also carry permissive CORS with
  `Range` allowed and `Content-Range` exposed, so another player instance can be pointed at them.
- **The demo plays real content; the fixtures never ship.** The player's `public/fixtures/` is the test
  suite's stub library saying "Served from the archive, never extracted to disk", which is right
  for a test and wrong for a visitor. The site plays four packages from `demo/content/`: a
  Question Set, an Interactive Video on a ten-second Big Buck Bunny clip, an Accordion on how the
  player works, and Dialog Cards for its vocabulary. They are built by
  `scripts/build-demo-content.mjs` from `demo/content/src/<name>/` — our `content.json` and a
  `manifest.json` naming the content type — with the libraries taken from the H5P hub's bundle
  for that type (which `libraries="hub"` fetched at runtime until 0.6). The script keeps the
  dependency closure the content needs (walked from `library.json`, plus every sub-content
  library the params name) and, after it, what an H5P site's upload check wants of those
  libraries (below), and runs the result through
  the normalizer, so each package is also an example of what the normalizer produces. A fifth,
  `formulas.h5p` (2026-10-13), is a Question Set with LaTeX in it written with `"stripped": true`
  in its manifest — `h5p.json` naming the main library alone, `content/`, no library folders, as
  h5p.com and h5p.org export — which the player page's sample button marked `data-untrusted`
  plays `untrusted` against the site's pack: the one place on the site that shows the untrusted
  path, the addon rule and the pack's MathDisplay. A sixth, `markup.h5p` (2026-10-18), is a
  Column whose text holds markup no H5P site would have saved: a notice pinned over the content
  with `position: fixed`, a sign-in form, a link dressed as a button. It carries its libraries and
  plays in whichever mode the player page's switch is in, so switching shows what the content check
  removes and what it keeps (the words, and the colours a text field allows). Each part says, in
  markup the check keeps, what each mode should show: the first cut had no captions, pinned the
  notice across the top of the content and left the form unstyled, and the owner found it looked
  like the site failing rather than a demonstration. Building it found
  `build-demo-content.mjs` failing for every package since the hub helpers moved: its loop ran as
  the module loaded, before the helpers below it were declared. The two-players example plays
  `how-it-works.h5p` twice since the same day, the second `frame copyright`, since one package
  under two settings is what the per-load fix is for; it was `lang="de"` too until #55, when an
  English package's strings became English whatever the element's language. The outputs
  are committed, 8.3 MB for the four, because a deploy should need neither the hub nor the video
  host; `pnpm demo:content` regenerates them. Since 2026-11-06 (#146) a package that carries
  libraries also carries what an H5P site's upload check wants of them: every dependency a carried
  library names, editor ones included, at its exact major.minor, as a platform's export does, with
  `h5p.json` naming only what plays. A Moodle with no library installed refused the quiz, the
  video and the glossary for their editor libraries, and accepts them now (checked on 4.5.15 with
  the hub's content types not yet installed; `how-it-works.h5p` and `markup.h5p` needed nothing,
  and `formulas.h5p` carries no library on purpose, so a site without Question Set refuses it, as it
  does an h5p.com export). The quiz grew 123 kB, the glossary 8 kB and the video from 2.5 to
  5.2 MB, an Interactive Video's editor preloading every type it can hold. The script has the
  normalizer write the added ones after the media (`last`, #148), so `content.json` stays where it
  was: on a host without `Range`, `/no-range/video.h5p` boots after 1.5 MB, where the first
  rebuild, with them sorted before `content/`, needed 4.1. The same rebuild moved the
  quiz's Question Set, Blanks, Drag the Words, Video and Components to the hub's newer patches,
  which the plan had been refreshing from the pack (the quiz now refreshes only Components, 97 to
  101). A bundle has older patches than the pack for some libraries, so the video's refresh also
  fetched SingleChoiceSet 1.11 (88 to 89, 180 kB) from the site's pack, a library nothing in it
  plays, carried for the editor; since #148 the plan reads and refreshes only what the content
  reaches, and leaves it as it is. Provenance: the libraries are MIT, the text is
  ours under CC0, and the clip is Big Buck Bunny, © Blender Foundation, CC BY 3.0, credited in the
  package metadata and on the player page. The `/no-range/` route serves this content on the site,
  and this content or a fixture locally, which is what the browser tests need.
