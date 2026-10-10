# Development

A pnpm workspace: `packages/player`, `packages/runtime`, `packages/libraries`,
`packages/normalize`, `packages/verify`, `packages/cmi5`, `packages/embed`, and the demo site in
`apps/demo`.

```bash
pnpm install
pnpm --filter @missing-elements/h5p-offline-player exec playwright install chromium   # once, for the browser tests

pnpm dev          # the demo player page on http://localhost:5173
pnpm test         # every package's tests, the player's browser suite included
pnpm build        # the player package, building the runtime package on the way
pnpm normalize course.h5p   # rewrite a package so it streams (docs/streaming-video.md)
pnpm verify course.h5p      # play a package headless and report whether it works
pnpm build:demo             # the hosted demo, as Vercel builds it, into apps/demo/dist-demo/
pnpm preview:demo           # serve it locally with the production headers
pnpm demo:content           # rebuild the demo's content packages from their sources
pnpm demo:icons             # re-render the installable app's icons
pnpm libraries              # rebuild packages/libraries from the H5P hub
```

`pnpm dev` serves the player page with real content, plus, in dev only, generated test archives
under `/fixtures/`. `/demo/` links the other ways to host it: xAPI, cmi5, a file from disk, a
framed player page, two players on one page.

The demo deploys to Vercel from `vercel.json`. Its `/app/` page is the player as an installable
app that plays `.h5p` files with no network, libraries included; `/app/?src=<url of a .h5p>`
opens a package from the web in it.

Working on the code? Start with [AGENTS.md](https://github.com/missing-elements/h5p-offline-player/blob/main/AGENTS.md).
