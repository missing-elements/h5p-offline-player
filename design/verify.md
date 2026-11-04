# The verifier

`pnpm verify course.h5p` plays a package through the real element in a headless Chromium and
says whether it worked. Built on 2026-09-29 after generating three packages with h5p-cli by
hand: two of the three were broken in ways no zip check would find — a Course Presentation
whose `content.json` lacked a field the library reads at start, a Drag and Drop whose sizes were
in the wrong unit — and the player was what found them, in seconds, with no server. That is the
tool's whole purpose: the last step of a pipeline that generates or rewrites packages, an AI
agent's included, so "verified" means "played" rather than "parsed". It is its own package,
`packages/verify`, published as `@missing-elements/h5p-verify`, because it brings a browser
driver along and the normalizer should not.

- **It plays the package the way the app does: as a picked file.** `lib/page.html` is one
  element and a hidden file input; the tool serves it and the player's `dist/` from a static
  server on a random localhost port (a Service Worker is allowed on `localhost`), and hands the
  file to the input through Playwright. So it needs no `Range` support, no network and no
  storage, and every path it exercises is the one a learner's browser takes.
- **An uncaught error while booting fails the check, even when the content comes up.** Found on
  the first run: a CLI export lists editor libraries as runtime dependencies, six scripts threw
  `H5PEditor is not defined` as they loaded, the content rendered around them, and the tool
  said pass. A script that throws at load is a defect in the package — the part that threw is
  missing from what was drawn — so it is a `fail` with the messages listed and deduplicated.
  An error after `ready` is a warning, for the reason the element treats it as an event: content
  types throw non-fatal exceptions routinely, on resize in particular.
- **The runtime's `library.json` probe 404s are filtered out**, from the response listener by
  URL and from the console by dropping every `Failed to load resource` line, since the console's
  copy names no URL and the response listener already has the real failures. Without that,
  every run carried one spurious warning.
- **A CSP violation is caught with an init script** on the browser context, because the event
  fires in the document it happens in and the frame is created after the page loads.
- **The browser is Chrome or Edge if installed, else Playwright's Chromium**, through
  `playwright-core` rather than `playwright`, so installing the package downloads nothing; the
  error names `npx playwright install chromium` as the way to get one.
- **`skills/h5p-verify/SKILL.md` at the repository root is the contract with an agent.** It says when to run the tool, what each verdict
  and warning means and what to do about it, to look at the screenshot because layout mistakes
  raise no error, never to make the check pass by removing what fails, and what a pass does not
  claim: nothing about the content's correctness, level, licensing or accessibility. After a pass
  it opens the preview for the user, as h5p-author's does, since verify 1.2.0 reached npm
  (2026-10-23): a skill is installed from `main`, so neither named `--preview` before the release.
- **`--untrusted` plays a package as a site that did not make it does** (2026-10-18, #38): the
  element's `untrusted`, read back from it for the report rather than taken from the option, the
  libraries from `--libraries` or the element's own `pack`. What the content check changed is
  measured, not told: the runtime's notes, which the boot script writes to the frame's console and
  the report keeps, cover six kinds of change and none of the markup it strips. So the verifier
  fetches the package's `content.json` through the frame with `X-H5P-Content-Check: semantics`,
  which the worker answers with the file as written, and compares it with the parameters the boot
  script left in `H5PIntegration` (`contentChanges`): tags removed by name, attributes and style
  properties counted only on the kinds of tag still there (a form removed whole is one line, not
  its inputs' attributes too), fields and list items removed, values changed; a removed empty value
  is left out, as upstream drops those too. The content upgrade runs before the check and can move
  fields when the pack is newer than the content, so a change that is not markup is not attributed
  to the check. Every change is a warning, never a failure: the content plays, as it would on the
  site. A package that needs its own copy of a library is refused with `carried`, and the summary
  says to build against the pack's versions or play it trusted. `--libraries` takes a bundle on
  disk too, served from the verifier's own server at `/__libraries/<n>.h5p`, so the check runs
  offline against a pack the caller names; the tests use the workspace's.
- **With the pack, the verifier plays what a site with the pack plays** (2026-10-18, #40): a
  folder on disk in `--libraries` is a copy of the pack's `parts/`, served at `/__pack/` and named
  to the element as `pack-base`, and the element's refresh is on unless `--no-refresh-libraries`.
  `report.refreshed`, read from the element's `libraryBundle`, lists the libraries that played at
  the pack's version, and the summary prints them on a line of their own, not as a warning: the
  content was checked as the site will play it. Writing the test found the demo's own quiz, built
  in March, older than the pack by a patch or two in four libraries, H5P.Video 1.6.68 against
  1.6.79 among them.
- **`--preview` is the person's half of the check** (2026-10-23, #69). The check says whether a
  package starts. Whether it is right, a person judges by playing it, the same way for every content
  type; an answer key or scripted screenshots would be one more thing to write per type. So
  `--preview` checks nothing. It serves the package and a page of its own from the verifier's
  server, with the same player, runtime and library sources, and opens the default browser on
  it. Three choices in it:
  - **The package is served with `Range`, as a static host serves it**, not handed over as a
    picked file, which a page cannot get without a click. That means `206`, `Content-Range`, and an
    `ETag` from the file's size and time, so a file written again is a new package to the element.
    The element reads it `range-http`: the libraries in the warm's few requests, media by the
    ranges asked for. Measured on 2026-10-23 with a 32 MB stored video added beside the demo's
    clip: of 36.1 MB, 1.58 MB in 9 requests reached `ready`, and a range of that video cost a
    kilobyte. Every request was ranged. In Chrome, Firefox and WebKit the clip played.
  - **It ends by itself.** The page holds an event stream open. The server ends ten seconds after
    the last stream closes, which a reload reconnects within, or ten minutes after starting if
    none ever opened. The page stops reconnecting once its server has gone, so a stale tab cannot
    keep a later preview on the same port alive.
  - **It takes port 4645 when that port is free.** Every preview then shares one origin's worker
    and caches, instead of leaving a new origin's behind for each run. When another preview or
    another program holds the port, it takes any free one.

  The check's own options are refused with it, not ignored. The browser opener is `open`,
  `cmd /c start` or `xdg-open`, and the address is printed either way; it has not been tried on
  Windows. Its SIGINT and SIGTERM listeners go in before it prints anything and stay for its whole
  life: through npx one Ctrl+C arrives twice, from the terminal to the process group and from npm
  passing it on, and 1.2.0, listening once, was killed by the second before its closing line, so
  never exited with 0 there (#79). The page sets `src` from the parsed URL's `href`, `http` or
  `https` only, as every page that takes a package address from outside does (#71): its own route
  needs no check, but CodeQL flagged the text going in, as `js/xss-through-dom`. A Download link
  beside the name (#81, the owner's request of 2026-10-23, so that whoever reviews a package can
  keep the file they played) takes the same parsed address, and hides once the presence stream
  fails, since the server it downloads from has gone. The status line then says the preview has
  ended and keeps saying it: a load still under way when the server goes changes state afterwards,
  and until 2026-10-28 its "Opening…" or its error wrote over that line, which CI caught on `main`
  and which failed 1 local run in 12. H5P's own Reuse button (`frame export
  download-url`) was the other way: it changes how the content looks, takes two clicks, and its
  dialog's button is English whatever the content's language.

Not built, deliberately: steps that click through the content and check the xAPI it sends, and a
content digest for reviewing what was generated. A check of library versions against the hub's
catalogue, the commonest reason a package that plays here is refused on upload (h5p-cli builds
from GitHub `master`, and h5p.com carries the hub's versions), is not built either; `--untrusted`
checks them against the pack's, which follows the hub weekly.
The tests need the player built (`pnpm build`); the package's `test` script does that first.
The repository's own sweep does click through content and read its statements (*The content-type sweep*, in [testing.md](testing.md)),
for packages it makes; the verifier, which is handed a stranger's, still does not.
