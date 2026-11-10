# Commands

Every command of the repository, from its root, and what to know when running them. The ones most
tasks need are in [`AGENTS.md`](../AGENTS.md) too.

From the repository root:

```bash
pnpm install           # pnpm 10: dependency install scripts stay off, see pnpm-workspace.yaml
pnpm --filter @missing-elements/h5p-offline-player exec playwright install chromium   # once, for the browser tests

pnpm dev               # vendors assets, builds fixtures, serves the demo on :5173
pnpm test              # every package: the player's unit + browser suites, the normalizer's and verifier's tests
pnpm test:unit         # fast, no browser
pnpm test:browser
H5P_TEST_BROWSER=firefox pnpm test:engine   # the player's browser suite and the app's tests in
                       # Firefox, or webkit; after `playwright install firefox webkit` in the player
pnpm typecheck         # every package
pnpm build             # the player: types, element, both workers; builds the runtime package on the way
pnpm normalize course.h5p          # rewrite a package so it streams: media stored, mp4 index first
pnpm verify course.h5p             # play a package in a headless browser and report whether it works
pnpm author build source.json course.h5p  # a package of any content type in the pack from a short source;
                       # after pnpm build, or the player's build:plan, whose dist/h5p-plan.js it imports
pnpm --filter @missing-elements/h5p-author sync:skill  # the h5p-author skill's type files' fields, from the pack
pnpm --filter h5p-preview package  # the VS Code extension's .vsix, from the player as pnpm build left it
pnpm --filter h5p-preview test:vscode  # its suite in a VS Code it downloads; under xvfb-run on Linux
pnpm --filter h5p-preview screenshot  # its listing's screenshot, images/preview.png, in that VS Code
pnpm build:demo        # the hosted demo into apps/demo/dist-demo/, what Vercel runs
pnpm demo:content      # rebuild apps/demo/demo/content/*.h5p from their sources; needs the H5P hub
pnpm demo:og           # re-render the social card, apps/demo/demo/og-image.png
pnpm demo:icons        # re-render the installable app's icons, apps/demo/app/icons/
pnpm demo:screenshots  # re-render the app's install-dialog screenshots, apps/demo/app/screenshots/,
                       # from the built site: after pnpm build:demo
pnpm libraries         # rebuild packages/libraries from the H5P hub; before a release, and every
                       # Monday by .github/workflows/libraries.yml, which opens a PR when a library changed
pnpm l10n              # take the core's translations from Moodle's language packs again, into
                       # packages/runtime/l10n/; every Monday by .github/workflows/l10n.yml, which
                       # opens a PR when a translation changed
pnpm core:sync master  # vendor the H5P core from h5p-php-library's newest commit, into
                       # packages/runtime/vendor/h5p-core/; with no argument, the recorded commit
                       # again; then the sweep, and the release notes name the commit
pnpm sweep             # play every content type in the pack, untrusted and trusted, and check
                       # each boots; after pnpm build
pnpm preview:demo      # serves dist-demo/ with the production headers and the /no-range route
```

`pnpm test` runs the packages one at a time (`--workspace-concurrency=1`). The demo's `test`
runs the player's `prepare:dev` and the verifier's runs the player's `build`, and both of those
begin with `sync:assets`, which deletes `public/frame-assets/` and writes it again. Run in
parallel, as `pnpm -r` does once their shared dependency is done, one run deleted the directory
while the other was writing into it. CI hit exactly that: ENOENT on `frame.bundle.js`.

pnpm forwards extra arguments on its own: `pnpm preview:demo --port 4199`, not `-- --port`. A
literal `--` reaches the script, which Vite then reads as the end of its options.

`pnpm test:browser` runs two browser projects: `browser`, the suite, and `browser-emulated`,
the tests that emulate a browser condition through CDP — a storage cap, a slow link. Those get a
browser of their own, one file at a time, because the emulation is per browser profile and would
otherwise land on whatever other file was running.

`pnpm dev` and `pnpm test` both run the player's `prepare:dev` first, which builds the runtime
package (`packages/runtime/dist/`, the vendored H5P core plus the boot script) and copies it
to `packages/player/public/frame-assets/`, and builds the fixtures into
`packages/player/public/fixtures/`. None of those directories is in git; all are reproducible.

The browser provider is a package, not a name: `provider: playwright()` from
`@vitest/browser-playwright`. Vitest 4 moved providers out of the core package, so a bare
`provider: 'playwright'` string silently stops being valid.

**What is tested**, by the owner's rule: the packages and their source, and of the demo app only
the installable app; the demo's pages are checked by hand, and the skills are tested from
`apps/skills`. [`design/testing.md`](testing.md) has the rule in full, the engines, CI and
the content-type sweep.

Node 22 LTS or 24 LTS: the commands the packages ship need 22, and the browser packages keep
`>=20`. Packages are published with pnpm, which rewrites the `workspace:` ranges, and each one's
`prepublishOnly` is its guard: [`design/build.md`](build.md).
