# Troubleshooting

`npx @missing-elements/h5p-normalize course.h5p` is "normalize" below: it rewrites a package once so its media streams, leaving the content untouched.

| Symptom | Cause | Fix |
|---|---|---|
| `error: no-cors` | Package host sends no CORS headers | Ask the user to download the file and use `file` |
| `error: network`, "is an http: URL and this page is served over https:" | `src` or `libraries` is `http://` on an `https://` page | Use the `https://` URL. `http://localhost` works as is |
| `error: no-worker` | Page on `http://`, in-app browser without Service Workers, or `sw` cross-origin | Use `https://`; show "Open in Safari / Chrome"; serve `h5p-sw.js` from your origin |
| Worker or runtime files 404 after build | Bundler does not analyse `new URL(…, import.meta.url)` (esbuild), or the `runtime` property is not set | Set `player.runtime`; or serve both packages' `dist/` and set `sw` + `assets-base` |
| Worker blocked by CSP | `sw` points at another origin | Keep the worker same-origin |
| Console: creating a worker from `blob:` violates `worker-src` | The page refuses `blob:` workers; the element falls back to `h5p-jobs.js` | Set `jobs` to that file to skip the attempt. If `error: no-worker` follows, `h5p-jobs.js` is missing or not same-origin |
| Video won't play in Safari, other browsers fine | `h5p-sw.js` older than the element (no build step) | Re-download `h5p-sw.js`; the console warns on version mismatch |
| Console: `503` from the worker for a media file, after about 30 s | Nothing of the entry arrived for 30 s: the extracting tab closed or the host stopped answering | Reload. If it repeats, check the host answers `Range` requests promptly |
| `error: quota` | Not enough storage after evicting everything idle — a host without `Range`, where the whole archive must land, or one large deflated entry | Show `event.detail.message` (size needed, usage against quota). Normalize the package, or move it to a host that supports ranges |
| `error: bad-archive`, "Could not read the archive index" | The bytes are not a whole zip: a login page, a truncated upload, or an old element on a compressing host | `curl -sI -H 'Range: bytes=0-0' <url>` should give a `206` whose body starts with `PK`; `unzip -t` a download. Update the element |
| `error: bad-archive`, "contains no libraries" | An export with `content/` but no library folders (h5p.com, h5p.org) | Set `libraries="pack"`, or the URL of your own copy of the pack (with its `libraries.txt`); or re-export with libraries. `event.detail.missingLibraries` names them |
| Console: 404 for `<Library>-<major>.<minor>/library.json` on load | The runtime probing folder names | Ignore it. One per load is expected |
| Console: "violates the following Content Security Policy directive" | Content loads from an origin the frame does not permit | Built in: MathJax CDNs, Google WebFont, YouTube, Vimeo, Panopto. Add anything else to `allow-origins` |
| No copyright button with `frame copyright` | `h5p.json` names no licence, `U`, or one H5P does not know (such as `MIT`) | Give `h5p.json` a licence H5P knows (CC BY, CC0 1.0, GNU GPL, PD, C, …) |
| Formulas show as raw LaTeX, `\(…\)` or `$$…$$` | The package lacks `H5P.MathDisplay`; the player injects none, and a `libraries` bundle is not attached to a complete package | Add `H5P.MathDisplay-1.0/` to the archive and `H5P.MathDisplay` to `preloadedDependencies` (hub, MIT). It loads MathJax from a CDN, so formulas need the network even in the installable app |
| A video shows nothing for a long time, then plays (often the first of several) | The mp4 is deflated in the zip *and* not faststart, so it plays nothing until its last byte; videos are extracted one at a time | Normalize the package; until then, `preload="auto"` starts the transfer early |
| A video never starts after the host stays down for minutes | The player retries a silent or dropped link for a few minutes, then fails the entry with an `error` event | Reload once the host is back |
| `error: runtime`, content blank | Content type threw — usually a library missing from the archive, or a script blocked by the frame CSP | Check the console inside the frame; report the archive |
| `error` while the content works | A non-fatal `runtime` exception, common on resize, or one media file that failed to extract (`network`, `quota`, its name first in the message). `state` stays `ready` | Log it; hide the player only when `state` is `error` |
| YouTube video: `error: runtime` naming `youtube.js` | H5P.Video up to 1.6.66; the player works around it, so the video plays | Re-export with H5P.Video 1.6.80 or later to lose the error |
