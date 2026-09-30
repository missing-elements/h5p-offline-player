# Development

The repository, its commands, and what the demo site is.

A pnpm workspace: the player in `packages/player`, the normalizer in `packages/normalize`, the
verifier in `packages/verify`, the demo site in `apps/demo`.

```bash
pnpm install
pnpm --filter @missing-elements/h5p-offline-player exec playwright install chromium   # once, for the browser tests

pnpm dev          # the demo player page on http://localhost:5173
pnpm test         # every package's tests, the player's browser suite included
pnpm build        # the player package
pnpm normalize course.h5p   # rewrite a package so it streams (docs/streaming-video.md)
pnpm verify course.h5p      # play a package headless and report whether it works
pnpm build:demo             # the hosted demo, as Vercel builds it, into apps/demo/dist-demo/
pnpm preview:demo           # serve it locally with the production headers
pnpm demo:content           # rebuild the demo's content packages from their sources
pnpm demo:icons             # re-render the installable app's icons
```

`pnpm dev` serves the player page with real content — a quiz, an interactive video, an
accordion and dialog cards, built from H5P hub libraries around text written for this player —
plus, in dev only, generated test archives under `/fixtures/` covering each path the player
takes: a host that honours `Range` and one that does not, 20 MB of deflated and of stored media,
hostile entry names, a file that is not an H5P package. `/demo/` is the two-line integration,
with the other ways to embed it — xAPI, cmi5, a file from disk, two players on one page —
linked from there.

The demo site deploys to Vercel from `vercel.json`: the pages, the element, its worker and the
frame assets as static files, plus one function that plays a host without `Range` support. Its
`/app/` page is the player as an installable app: in Chrome or Edge it installs, opens `.h5p`
files from the file manager and plays them with no network — including packages exported without
their libraries, since the app carries the H5P hub's libraries for every content type.
`/app/?src=<url of a .h5p>` is a link that opens a package from the web in the installed app.

Working on the code? Start with [AGENTS.md](https://github.com/missing-elements/h5p-offline-player/blob/main/AGENTS.md).
