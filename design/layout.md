# Layout

A pnpm workspace of ten packages and two apps. Nine packages are published to npm; the VS Code
extension is a `.vsix`. Paths in `design/` are relative to their part: `src/…` and `scripts/…`
mean the player's unless a file says otherwise. `dist/`, `types/`, the player's `public/` and the
runtime's `index.js` are generated and not in git.

```
packages/player/       the <h5p-player> element, MIT
  src/h5p-offline-player.ts   the element, the only public entry; plan.ts the `./plan` export
  src/shared/          what all three contexts run: the sources and their reads, the chunk store,
                       eviction and locks, the `packages` table, entry names (the security
                       boundary for hostile archives), the revision every statement names
  src/sw/              the Service Worker: mount.ts the virtual file server, package-reader.ts,
                       pack-plan.ts, the frame document and its CSP, the stall-bounded wait
  src/jobs/            the Jobs worker: downloads, extractions in demand order, the warm
  scripts/             sync-h5p-assets, build-workers, build-plan, build-fixtures, prepack
  tests/               unit/ in Node; browser/ the real element against the real worker;
                       browser-emulated/ conditions set over CDP, Chromium only; fixtures/src/
  page/                page.css, the page around the player, shared by the demo, the verifier's
                       preview, the extension and the build page
packages/runtime/      the H5P core vendored at a commit (vendor/h5p-core/) and the frame's boot
                       script (src/frame-boot.ts), GPL-3.0; the content check, the upgrade, l10n
                       and the `finished` rule are bundled into it; l10n/ the core's strings
packages/libraries/    the library pack: parts/ an archive per library and its index,
                       libraries.h5p the whole pack; committed, built by `pnpm libraries`
packages/normalize/    the package rewriter: lib/normalize.mjs the policy, mp4-faststart.mjs the
                       remux, zip-writer.mjs the zip writer, mp4.mjs what an MP4's index says
packages/verify/       a package played headless (lib/verify.mjs) and in a browser
                       (lib/preview.mjs); lib/serve.mjs what both share, which the extension bundles
packages/author/       a playable .h5p from a short source: lib/build.mjs both builds, node.mjs
                       Node's, generator.mjs content from semantics, check.mjs, outline.mjs,
                       types.mjs the editor widgets' rules, mistakes.mjs the notes of what is
                       almost surely a mistake, read.mjs a package back to a source;
                       scripts/ the skill's sync and copy, and build-tool.mjs the command line
                       as one file (dist/)
packages/mcp/          the local MCP server: bin/h5p-mcp.mjs the command, lib/server.mjs its four
                       tools, lib/folders.mjs the folders it may use
packages/cmi5/         the element as a cmi5 AU: src/index.ts startCmi5, src/client.ts the protocol
packages/embed/        site/ the embed page and the SCORM page; lib/build.mjs the site,
                       lib/scorm*.mjs the SCORM zip in Node and in a page; scorm/ its launch page
packages/vscode/       H5P Preview: src/ the extension, the preview server and the webview;
                       tests/vscode/ the suite in a real VS Code
apps/demo/             the dev server and the hosted site: index.html the player page, embed.html
                       /embed, demo/ the examples and integrator pages, app/ the installable app,
                       partials/ the shared markup, scripts/ the builds and the sweep, sweep/ its files
apps/skills/           the skills' test project: author-verify, author-playback, to-scorm,
                       front-matter
skills/                the agent skills, at the root, where `npx skills add` looks
docs/                  the README's longer sections, for integrators
api/, vercel.json      the hosted demo's Vercel function and deployment; at the root because that
                       is the Vercel project's root, which only the dashboard can move
```

**The demo compiles the element from the player's source.** `apps/demo/vite.config.ts` aliases the
package's name to `packages/player/src/h5p-offline-player.ts`, so dev needs no player build, and the
demo does not exercise the published `dist/` the way an app that installs the package does. In dev
the Service Worker's scope is `/@fs/…/packages/player/src/h5p/`, and the player's `public/` is
served as the demo's own, which is where the element finds `/frame-assets/`.
