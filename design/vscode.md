# The VS Code extension

`packages/vscode` is **H5P Preview by Missing Elements** (`MissingElements.h5p-preview`): a `.h5p`
opens in a read-only custom editor that plays it. Built on 2026-10-26 (#83), the first of the
plugins weighed in the owner's notes: the Marketplace had one H5P extension, for developing content
types, and nothing that played a package. It is not on npm. It is published to the Visual Studio
Marketplace and to Open VSX, for Cursor and VSCodium, under the publisher and namespace
`MissingElements`, the ID the owner gave the Marketplace publisher on 2026-10-28 and which
`package.json`'s `publisher` has to match; it was `missing-elements`, the npm scope's, until then.
Open VSX matches the case too (eclipse-openvsx/openvsx#2279).

Open VSX takes each version from `.github/workflows/vscode-publish.yml` by trusted publishing,
since 2026-10-28, when its namespace was granted. Its registration names the repository, that file
and the `open-vsx` environment, which deploys from `main` alone. The run's GitHub ID token stands in
for an access token, so none is stored. The owner runs the workflow by hand after a version bump. A
run on a version Open VSX already has publishes nothing and is the check that the trust holds: the
first, that day, on 0.1.0, had its token issued and the version refused as a duplicate. It also
installed from a cache, which the job is written not to: setup-node v5 restores the pnpm store
`ci.yml` saves on `main` whenever `package.json` names a package manager, so the job turns
`package-manager-cache` off. A registration cannot be edited, so renaming the file means
registering again. The Marketplace upload takes the same run's `.vsix`, by hand. vsce 4 has
`--oidc` for the Marketplace, which did not take it yet in October 2026: its token exchange
answered `TrustedPublishingNotSupportedException`, and it had no page to name a workflow on
(microsoft/vscode-vsce#1275).

The name is the owner's, under H5P Group's trademark policy (h5p.org/trademark, 2.5): open-source
code may lead with "H5P" only beside its author, "Acme's H5P interactive Quiz" being its example.
The icon is the project's logo, a play triangle with a hand tapping it, which the owner made on
2026-10-27 in place of the "H5P" tile, which was close to H5P Group's own mark. Its hand is filled,
pale on a dark ground as on a light one: in the first version, the same day, it was cut out of the
triangle and took the ground's colour. One file holds it, the demo's
`demo/favicon.svg`, and everything else is drawn from that: the site's tab and the bar's mark, on
the pages and in the installable app, read it as it is; the app's icons (`pnpm demo:icons`), the
social card (`pnpm demo:og`) and this icon (`pnpm --filter h5p-preview icon`) are rendered from it
and committed, as are the app's install screenshots (`pnpm demo:screenshots`), which show the bar.

- **A webview frames a page from a server on 127.0.0.1.** A webview's own origin,
  `vscode-webview://`, cannot register a Service Worker, since the spec takes `http` and `https`
  script URLs only; a page it frames from a local server can. Measured in VS Code 1.143.1
  (Electron 43, Chrome 150) on macOS, 2026-10-26: the frame's worker registers and controls it, the
  demo quiz reaches `ready` in 0.5 s, and the Interactive Video's H.264 clip decodes (`canPlayType`
  says "probably", `readyState` 4). Its picture, that is: the sound was not checked then.
- **VS Code does not play every format a browser does, and says it does.** Measured on 2026-10-29
  in the same VS Code (#90), the bytes handed to a media element from a blob so that the network
  played no part: MP3 plays with its sound; an MP4's H.264 picture plays and its AAC sound does not,
  no audio bytes decoded; M4A audio does not play (`DEMUXER_ERROR_NO_SUPPORTED_STREAMS`), nor does
  WebM (`DEMUXER_ERROR_COULD_NOT_OPEN`: its ffmpeg has no Matroska demuxer); and YouTube's player
  fetches its stream, drops it and fetches it again, buffering for ever. Chrome played every one.
  `canPlayType` and `MediaSource.isTypeSupported` answer yes to all of them, so H5P.Video takes a
  WebM listed first over the MP4 beside it — h5p.org's Interactive Video example does that — and
  shows "Video format not supported." The extension cannot change VS Code's codecs, so it says what
  will not play: the page reads the content's parameters from the element's frame on `ready`
  (`H5PIntegration.contents`, as the verifier does), so a video on a slide or tab not yet shown
  counts, and names the kinds in the `ready` it tells (`media`: `mp4`, `webm`, `aac`, `youtube`);
  the webview shows them under the bar with an Open in Browser button, which the extension takes
  from the webview alone. Not measured: Windows and Linux, where the H.264 picture may not decode
  either, and Vimeo and the other hosted players.
- **One server per window, on the first free port from 4646 to 4655.** Every preview in the window
  shares it. Each port is an origin with the player's worker and caches of its own, so the address
  has to be the same from session to session: the first window takes 4646, a second the next free
  port, and only past 4655 does the server take any free one (`serve` takes a list of ports for
  this). Until 2026-10-27 it was 4646 or any free port, and every start of a second window's
  server was a new origin, the last one's worker and caches left behind (#84's review). The
  command's 4645 is left to Open in Browser. A package is served under a hash of its URI,
  `/view/<id>` its page and `/__package/<id>/<name>` the archive, the same in every session, and
  stops being served with its last preview. The server stops with the last preview and starts
  again with the next. Not the command's `previewPackage`, which serves one package for as long as
  a tab holds it.
- **The verifier's server, bundled from this checkout.** `src/server.mjs` imports `serve` from
  `lib/serve.mjs` and `sendArchive` from `lib/preview.mjs` by relative path, as the skills' playback
  test imports `previewPackage`. They are `@internal`, so a change to them is a change to the
  extension, and its tests are where it shows. `lib/serve.mjs` was split out of `lib/verify.mjs` the
  same day, because `verify.mjs` imports Playwright at its top and the preview needs none of it;
  `scripts/build.mjs` refuses `playwright-core` with an esbuild plugin, so it stays out. The bundle
  is CommonJS, which VS Code's `require` loads, and the verifier's modules find their files by
  `import.meta.url`, which CommonJS has not: the build defines it as the bundle's own URL and puts
  `preview.html` beside the bundle, for Open in Browser.
- **The extension carries everything it serves.** `assets/` is copied at build from the installed
  packages, as the embed builder takes them: the player's three files, the runtime, the library
  pack's parts the player serves with an index of those (the pack's `installOnly` parts, 1.8 MB
  for H5P sites' upload check, stay out: a preview never reads one, #146) and `libraries.txt`.
  Content-only exports play offline and nothing leaves the machine. `vsce package --no-dependencies` ships `dist/` and `assets/` and no node_modules: 13.8 MB
  in 141 files on 2026-10-26. `--baseContentUrl` and `--baseImagesUrl` point the README's relative
  links at `packages/vscode/`, where vsce's default would point them at the repository's root.
- **Its VS Code types stay at the oldest VS Code it runs on.** `engines.vscode` is `^1.90.0` and
  `@types/vscode` is 1.90.0: vsce refuses to package an extension whose types are newer than its
  `engines.vscode`, since the compiler would then accept calls an older VS Code lacks. Dependabot's
  weekly group raised them to 1.144.0 in #125, and the extension's job failed on that check;
  `.github/dependabot.yml` has ignored `@types/vscode` since #128, so the types move with
  `engines.vscode`, by hand, when the floor does.
- **The listing's screenshot is rendered, not taken by hand** (2026-10-27). `scripts/screenshot.mjs`
  starts the VS Code the suite downloads through Playwright's Electron driver, which takes the window
  from inside, so it needs neither the screen nor macOS's recording permission: a fresh profile, the
  demo's quiz, video and glossary in a folder, the quiz's first question answered and checked, 1200
  by 750 at the screen's scale, since the Marketplace shrinks a picture to its column and a larger
  window leaves the quiz unreadable. Four things keep it plain and the same from run to run. The
  quiz is opened in the extension host by `screenshot-open.cjs` (`--extensionTestsPath`, as the
  suite opens packages): a fresh profile resolves a file opened from the command line or the
  Explorer without waiting for the extensions, and opened before the extension's editor was
  registered, `quiz.h5p` fell back to the text editor, which shows a zip as binary, in 2 of 11 runs
  from the command line and in both logged runs from the Explorer. The extension is loaded from its
  folder, so the window is an Extension Development Host, which the title bar VS Code draws under the
  native one says: `window.customTitleBarVisibility: never` takes it out, and the native one is not
  part of the page. Multiple Choice shuffles its answers, so `Math.random` is seeded in the preview's
  frames on 127.0.0.1 and nowhere else. And the score bar's star animates, so animations are
  finished before the capture. `--disable-extensions`, which the suite passes, is left out: its
  notification sat over the content. Two runs give the same bytes. The README names the image by a
  relative path that `--baseImagesUrl` turns into the file on `main`, so it reaches `main` before a
  package naming it is published.
- **Trust follows the workspace.** In Restricted Mode every package plays `untrusted`, the switch
  disabled. A trusted workspace plays as the settings say (`h5pPreview.untrusted`,
  `h5pPreview.newestLibraries`), with a switch for each in every editor. A change of setting, or
  trust granted, plays the open previews again as the settings now say. The page sets `untrusted`
  as an attribute, as it sets the others: its script runs before the module defines
  `<h5p-player>`, and a property set then stays on the element as its own, in front of the class's
  accessor. Until 2026-10-27 it set the property. Measured in Chrome, the package still played
  untrusted, because every read in the element goes through `this.untrusted`, which found the stray
  property; but the attribute was never there, and an element reading it would have played
  Restricted Mode's packages trusted while the bar said untrusted. The page's report reads the
  attribute, so the suite's untrusted tests check what the element plays by. Restricted Mode is the
  server's to keep, not the address's: `startServer` asks the workspace's trust at each page and,
  while it is restricted, plays every page untrusted whatever the address says. An untrusted
  package's content keeps its links, http and relative, and until 2026-10-27 one to its own page
  without the flag, clicked, played it trusted; the page's id, a hash of the file's path, was all
  that stood in the way. The tab's switch in a trusted workspace is still the address's alone, a
  convenience rather than a boundary.
- **Messages are taken from one sender each.** The page posts what the element reached to its first
  ancestor origin only (`location.ancestorOrigins[0]`, the webview). The webview takes the frame's
  messages by its window and the server's origin, and relays a state, `ready` and an error and
  nothing else; reload and the settings it takes from the extension alone, by its own origin. A
  package's own code runs in a frame below the page, on the server's origin. What it posts itself
  comes from neither, and played trusted, sharing the page's origin, it can post as the page, so the
  most it can do is misreport its own state. Until 2026-10-27 the webview relayed whatever the page
  posted, a `mode` among them, which the extension took for the tab's switches and Open in Browser
  played by. `tests/html.test.ts` runs both scripts in Node against stand-ins for their elements.
- **A file that is not on this computer is copied first.** `extensionKind` is `ui` alone, so the
  extension runs beside the webview, which reaches only this computer's loopback; a remote or
  virtual workspace's file is copied to a temporary folder through `workspace.fs`, and copied again
  when it changes. Copied again, the file is read whole before the copy is touched, so a read that
  fails leaves the copy, and its previews, as they were, with a warning that names the reason; until
  2026-10-27 the read sat outside its `catch`, the failure went unhandled and nothing said so. The
  suite plays a package from a file system of its own, a scheme over a folder that can say a file
  changed and can fail its reads, which takes this path: played, changed while it cannot be read,
  changed again. A real remote, SSH or a container, is not tested. `workspace` was in the
  list until 2026-10-27. VS Code for the Web with Codespaces then runs the extension on the remote
  machine, as the desktop does when it is installed only there, and the server listened on that
  machine's loopback while the webview framed this one's. Having no `browser` entry, the extension
  is now unavailable in VS Code for the Web, rather than installed and showing nothing.
- **A file written again plays again**, 500 ms after it last changed. A watcher on the file's folder
  sends the reload when an event names the file, and the validator, the file's size and time, makes
  it a new package to the element. The folder is watched and the name compared because a name as
  the pattern is a glob: until 2026-10-27 it was, and `quiz [v2].h5p` never matched itself, so its
  previews never played again. The suite's file is named `package [v2] {draft}.h5p` for that.

Tests. `tests/*.test.ts` run in Node with the rest of `pnpm test`: the server against the built
player, runtime and pack, with its run of ports and Restricted Mode, and the webview's and the
page's scripts run against stand-ins. `tests/vscode/run.mjs` downloads VS Code into
`.vscode-test/` and runs `suite.cjs` in its extension host. The suite opens the demo's packages and
waits on the extension's `onDidChangeState`, the one thing `activate` exports: the quiz, the
Interactive Video, a content-only export played from the pack, Reload, untrusted by setting and
live, a package on a file system of the suite's own, copied again when it changes and kept when it
cannot be read, and a file written again under a name with brackets and braces. CI runs it on Linux under `xvfb-run`, in the `vscode` job, which
also uploads the `.vsix`. Started from a terminal inside VS Code, the downloaded editor ran as plain
Node, because `ELECTRON_RUN_AS_NODE` is inherited; `run.mjs` deletes it. Not covered: Restricted
Mode in a real editor (the suite opens a trusted folder; the server's side of it is a Node test),
Open in Browser, a real remote, and Windows.
