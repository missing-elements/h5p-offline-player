# When it does not work

| Report | Cause | Fix |
|---|---|---|
| `error: no-worker` | page on `http://` or `file://`; or `sw` points at another origin | serve over https; keep the worker same-origin |
| `error: network`, "is an http: URL and this page is served over https:" | mixed content: an `http://` package or bundle on an `https://` page | use the `https://` URL; `http://localhost` is exempt |
| `error: no-cors` | the package host sends no CORS headers | host the package where you control headers (GitHub Pages works as it comes), or offer a file picker: `player.file = input.files[0]` |
| `error: bad-archive`, "contains no libraries" | an h5p.com / h5p.org export: `content/` only | set `libraries="pack"`: `@missing-elements/h5p-libraries`, every hub content type's libraries, of which the player downloads only those a package needs, from jsDelivr. If the site must not reach a CDN, serve a copy of the package's `parts/` with its `libraries.txt` of licences and name the folder with `pack-base`, or, with a bundler, set the `pack` property to the package's `pack` export. With `pack`, the libraries a package carries play at the pack's newer versions; `refresh-libraries="off"` keeps them as exported. The H5P hub itself is not asked |
| worker or runtime files 404 after a build | the bundler did not rewrite `new URL` (esbuild); or an install with a bundler but without `player.runtime`, so the element looked for `frame-assets/` beside a hashed bundle | set `runtime` from `@missing-elements/h5p-runtime`; or serve both packages' `dist/` statically and set `sw` and `assets-base` |
| the frame renders the host page inside itself | an SPA fallback answered a virtual route with `index.html`: the worker is not registered | check the registration; after "clear site data" reload once |
| content collapsed to 150 px | `auto-resize="off"` with no height from CSS; or the host's CSP has `style-src 'self'` and the browser lacks `adoptedStyleSheets`, so the fallback `<style>` is blocked | remove `auto-resize="off"`, or give the `h5p-player` tag a height; update the browser |
| `error` while `state` stays `ready` | a content type threw a non-fatal exception (`runtime`, common on resize), or one media file failed to extract | log it; hide the player only when `state` is `error` |
| Vite dev only: worker or assets 404 | the packages are hoisted somewhere Vite does not serve (a monorepo); their own fallback for `.vite/deps/` covers the normal layout | add both packages to `optimizeDeps.exclude`, or set `sw` and `assets-base` |
| a video takes minutes to start, then plays | the package, not the player: the video is compressed inside the zip and its index is at the end | the `h5p-normalize` skill; `preload="auto"` only moves the wait earlier |
| the content starts over on every reload | `resume` is not set, which is the default | set `resume` (or `resume="host"`) if the user wants that; see `options.md` |
| "This content has changed since you last used it. You'll be starting over." | the package at that URL was replaced since the state was saved; the state is keyed by the build | expected, H5P's own dialog; OK drops the old state and the content saves afresh under the new build |

Every symptom and its fix, in more detail:
https://github.com/missing-elements/h5p-offline-player/blob/main/docs/troubleshooting.md
