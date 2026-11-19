# Build, types and publishing

The artefacts and how each is built, the declarations of the plain-JS packages, publishing, and the Node versions.

## Build shape

Three artefacts, built three different ways, because they are consumed three different ways:

| Artefact | Built by | Why |
|---|---|---|
| `dist/h5p-player.js` | Vite library build | An ES module the host imports |
| `dist/h5p-sw.js` | esbuild, IIFE | Registered by URL; has to run on a site with no build step |
| `dist/h5p-sw-mount.js` | esbuild, ESM | For hosts that enforce one worker per origin |
| `dist/h5p-jobs.js` | esbuild, IIFE | The Jobs worker as a file, for a page whose CSP refuses a `blob:` worker |
| `dist/h5p-plan.js` | esbuild, ESM, not minified | The player's library rules, `./plan`, for the packages that write what it plays; the build fails if zip.js gets in |
| `packages/embed/dist/scorm-page.js` | esbuild, ESM | The SCORM page's script for a written site, which has no bundler: zip.js and the player's `./plan` inside, zip.js's licence in its header |
| `packages/runtime/dist/` | `packages/runtime/scripts/build.mjs` | The H5P core from `vendor/h5p-core/`, its scripts joined and minified under a licence header, its stylesheets rebuilt to stand alone, and the boot script; a package of its own, GPL |
| `apps/demo/dist-demo/` | `apps/demo/scripts/build-demo.mjs` | The hosted demo: the pages, and `dist/`'s layout at the site root |

The Jobs worker ships twice. `vite.config.ts` bundles it with esbuild into a string behind
`virtual:h5p-jobs-worker`, and the element spawns it from a `blob:` URL: one fewer file for a host
to deploy, and the only way a host on Setup B, with the element on a CDN, gets it with nothing
copied. And `build-workers.mjs` writes the same entry as `dist/h5p-jobs.js`, which the element
names with its own literal `new URL`, so a bundler emits it like the Service Worker. A policy with
`script-src 'self'` and no `worker-src`, or `worker-src 'self'`, refuses the `blob:` worker, and
nothing could download or extract. `JobsWorkerHandle` tries the scripts in turn (`blob:` first,
then the file; a `jobs` attribute's URL first, then `blob:`) and takes the next on either way an
engine refuses: Chromium throws from `new Worker`, the spec has an `error` event once the load has
failed. Messages posted to a worker whose script never loaded are dropped, so the worker posts
`JOBS_READY` once its listener is in and the handle holds every job until then; with every script
refused, each job is answered `failed` with `no-worker`, so a download rejects instead of waiting
for ever. `jobs` exists for the violation report: a policy that refuses `blob:` logs the attempt,
and a security team reading `report-uri` would see it on every load. `worker-policy.test.ts` adds
a `<meta>` policy to its own test frame; `jobs-worker-handle.test.ts` pins the order and the
failure.

**The frame's boot script is a file of the runtime package, not a string in the worker.**
`packages/runtime/src/frame-boot.ts` is built by that package's `scripts/build.mjs` to
`dist/frame-boot.js`, and `frame-document.ts` names it with `<script nonce src>` beside the
per-package configuration in a `<script type="application/json">` block, so the script is the
same bytes for every package and the JSON needs no nonce. It is the one piece of our code that runs
in the H5P document and calls the core's API, so it ships with the core under the core's licence
(see *Licensing*), and the MIT worker only names it. Two consequences: the JSON block and the
messages the script posts are a contract between two packages, which is why the player names the
runtime as an optional peer dependency; and a record written by an element before 0.5 has no
`bootJs`, so `bootScriptUrl` looks beside `mainJs`. The unit tests that pin the script's behaviour
read the runtime's source as text.

**The element is minified after Vite, in `build-workers.mjs`.** Vite leaves an ES library's
whitespace and comments alone on purpose: esbuild drops `/* @__PURE__ */` annotations when it
minifies whitespace, and a consumer's bundler tree-shakes a library by them. This module
registers the element on import, so nothing in it can be shaken out and nothing is lost by the
extra pass.

**A host's bundler copies every file; nobody copies anything by hand.** Each package names each
file it ships with its own literal `new URL('./file', import.meta.url)` (the element its worker
and `h5p-jobs.js`, the runtime's generated `index.js` the two runtime scripts, `frame-boot.js`,
`l10n.js`, `h5p.css` and the twelve text fonts) because that is the one shape Vite, Rollup and
webpack 5 emit as an asset and rewrite. A directory (`./frame-assets/` plus a name at runtime)
cannot be emitted that way, and neither can a file that reaches a sibling by a relative URL, since
each asset lands under a hashed name of its own. So the runtime's build rebuilds the core
stylesheet: the icon fonts and the throbber, 30 kB, are inlined as data URLs; Inter and Open Sans
are taken out, copied to `fonts/`, listed in `MANIFEST.json`, and declared by the frame document
(`fontFaceRules`) against the URLs the host resolved and stored in `FrameAssets`. **The element
names no runtime file statically**, since the runtime is not in its package: a bundled host hands
the runtime's `runtime` export to the `runtime` property, a CDN host sets `assets-base`, and the
default, `frame-assets/` beside the element's script (the layout of a served `dist/` with the
runtime copied in, which the demo site and the verifier serve), is built from a variable so that no
bundler resolves it. The player's `src/frame-fonts.ts` keeps the font *names* for the `assets-base`
and default cases, written by `sync-h5p-assets` from the runtime's manifest so the two cannot drift
within one checkout. The fonts are not inlined because twelve faces made a 1.4 MB sheet, fetched
whole for the one or two faces a page renders, and the runtime does not wait for its stylesheet, so
the content would be at `ready` still unstyled. Declared in the frame, the browser fetches only the
faces in use.
Two consumer traps. Vite's dev server pre-bundles the element into `node_modules/.vite/deps/` and
rewrites the URLs to files that are not there; `unbundled()` points such a URL back at the
package's own `dist/`, which Vite serves, and the runtime's `index.js` carries the same helper for
its own package. And Vite runs every `.js` it serves through import analysis: zip.js's one
`import(codecURI)` made it prepend `import … from "/@vite/client"` to `h5p-sw.js`, a syntax error
in a classic worker. The worker build (`noCodecImport` in `scripts/lib/worker-bundle.mjs`) replaces
that call, which a Service Worker may not make anyway and our `configure` never reaches.

**The element does not carry zip.js, and neither does the Jobs worker string inside it.** The
element probes a source and never reads an archive, and zip.js has module-level side effects
Rollup cannot drop, so the reader bridge lives in `source-reader.ts`, apart from `source.ts`. The
Jobs worker is told where each entry is instead of reading an index (*The Jobs worker carries no
zip.js and reads no index*, in [storage.md](storage.md)). zip.js is in the two Service Worker
scripts only.

**Shipped strings carry no comments.** The frame's `<style>` block is explained in TypeScript
comments beside the constant, not inside it; a comment inside a template literal survives every
minifier and ships with every response. The element's shadow CSS is the exception that proves
it: it is a `.css` file imported `?inline`, which Vite's CSS pipeline minifies for the build, so
its comments live in the file. The frame's four rules stay a string because the Service Worker is
bundled by esbuild behind Vite's back, where a `.css` import would need a plugin of its own to
save sixty bytes a response.

In dev the same plugin file serves the Service Worker at any path ending in `/h5p-sw.js`, so
`new URL('./h5p-sw.js', import.meta.url)` resolves in dev and in a consuming app alike. **esbuild
bundles both workers behind Vite's back**, so the plugin has a `handleHotUpdate` that invalidates
the virtual module when anything under `src/` changes. Without it the page keeps running a worker
bundle that no longer matches the source. The boot script has no such hook: it is a file under
`public/frame-assets/`, so a change to `packages/runtime/src/frame-boot.ts` needs
`pnpm sync:assets` in the player (or `pnpm dev` again).

## Types for the plain-JS packages

The normalizer, the verifier, the embed package and the author are JavaScript with JSDoc, and
their documented API ships with declarations generated from it: `tsconfig.json` checks `lib/` (and
`site/embed.js`) with `checkJs`, `tsconfig.types.json` emits the entries' declarations into
`types/` with `stripInternal`, and each `exports` entry names them under `types`. `pnpm types`
writes them, deleting the folder first, since `tsc` never removes a declaration whose source
went; `typecheck` and `prepack` both run it. Three rules, with TypeScript 7:

- **A top-level `@typedef` is always exported**, and `@internal` on one does not strip it. Worse,
  its comment counts among the leading comments of the next declaration, which `stripInternal`
  then drops: an `@internal` typedef above a public function takes the function out of the
  declarations and leaves the typedef in. A type only the code needs is written inline, derived
  (`ReturnType<typeof headerRules>`), or declared inside the function that uses it, where it is
  local. `@internal` goes on functions and classes only: the helpers each entry exports for its
  tests (`contentChanges`, `parseOrigin`, `orderEntries` and the rest).
- **`tests/package-types.ts` imports the package by its own name**, so it resolves through the
  `types` condition. Without `types/`, TypeScript falls back to the JavaScript through `default`
  and finds the internal helper, so the file's `@ts-expect-error` on that import fails: the check
  cannot pass on anything but the published declarations.
- **The player's relative imports name their file, `./shared/protocol.js`**, as cmi5's do.
  `tsc` copies a specifier into the declarations as written, and `node16`/`nodenext` resolution
  follows only one that names its file, so a specifier without `.js` leaves what came through
  `types/`'s own imports (`PlayerErrorDetail['code']`, `missingLibraries`, `ReadyDetail['source']`)
  `any` to such a caller with `skipLibCheck`, and an error without it; under `bundler` everything
  is typed. Vite and esbuild take `.js` to the `.ts` beside it, so the bundles are the same code.
  `tests/package-types.ts` is the player's check, compiled by `tsconfig.consumer.json` on
  `nodenext` with `skipLibCheck` off (`skipDefaultLibCheck` on, since the DOM and WebWorker libs
  clash when checked together) and kept out of `tsconfig.test.json`, where the source's
  `H5PPlayerElement` would meet the declarations' one. `sync-h5p-assets` writes the `.js` into
  the generated `pack-index.ts` too. The player's bundler resolution says nothing about a new
  import without one: the check catches it only where the public types reach it.

## Publishing and Node versions

**The packages are published from CI, by trusted publishing** (#246). `publish.yml` is run by hand
from main, in the `npm` environment, once the bump is pushed (`gh workflow run publish.yml`). It
publishes every package whose version npm lacks, as `pnpm -r publish` finds them: in dependency
order, one at a time, passing over a version npm has. npm takes the ID token GitHub gives the run
in place of an access token, so none is stored, and records each package's provenance, the run and
the commit its tarball came from. Each package's trusted publisher on npmjs.com names the file and
the environment. pnpm publishes through npm, which takes that token from 11.5.1, so the job runs
Node 24. A publish by hand, with a one-time password, still works and records no provenance.

A publish of the player runs its `prepublishOnly` (a check that the pack it names is on npm,
typecheck, the unit suite and the build) so a broken tree cannot ship; the browser suite is left out because it needs an installed
Chromium. Firefox, WebKit and the slow browser files run only in CI's weekly run and a run by hand,
so before publishing the player, run CI by hand on main (`gh workflow run ci.yml`) and wait for
green. Then `prepack` copies the root LICENSE into the package, which is where npm takes it
from. The player's README is its own, `packages/player/README.md`, since the root one is the
toolkit's front page. The repository sets no `ignore-scripts`, so `prepublishOnly` runs; pnpm 10 blocks
dependency scripts by itself. The build deletes `types/` and the TypeScript build info first:
`tsc -b` never removes a declaration whose source was deleted.

Use Node 22 LTS or 24 LTS. Vitest's `engines` covers `^22.12 || ^24 || >=26`, so an odd-numbered
release such as Node 23 prints an engine warning on install. It is only a warning and the suite
runs, and no patched Vitest accepts Node 23. The workspace's own `engines` is `>=22.12`, the floor
of the tools it builds and tests with. The commands (normalize, verify, embed, author and mcp) need
Node 22: Node 20 is past its end of life and CI runs 22, so `>=20` was a claim nothing tested. The
browser packages (the player, the runtime, the libraries and cmi5) keep `>=20`: nothing in them
runs on Node, and a higher floor would only fail the install of a host still building on 20 under
Yarn 1 or `engine-strict`, for no gain. Given no version, npm installs the newest one whose
`engines` match the running Node, so on Node 20 an unversioned `npx @missing-elements/h5p-embed`
quietly installs an old release that writes an old player's site. Every documented command
therefore names `@latest`, which npm installs on any Node with an `EBADENGINE` warning, and says
Node 22 beside it.
