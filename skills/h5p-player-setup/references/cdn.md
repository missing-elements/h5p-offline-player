# Install from a CDN

Only when the user prefers a CDN to copying the files onto the site. Load the element and the
runtime from jsDelivr and copy only the worker, and tell them that every learner's browser then
reaches jsDelivr, as it does for the pack unless `pack-base` names a copy:

```html
<script type="module"
  src="https://cdn.jsdelivr.net/npm/@missing-elements/h5p-offline-player@<player version>/dist/h5p-player.js"></script>
<h5p-player src="https://host.example/course.h5p" sw="/h5p-sw.js"
            assets-base="https://cdn.jsdelivr.net/npm/@missing-elements/h5p-runtime@<runtime version>/dist/"></h5p-player>
```

Download `https://cdn.jsdelivr.net/npm/@missing-elements/h5p-offline-player@<player version>/dist/h5p-sw.js`
and place it on the site; `sw` points at it. `assets-base` names the runtime package's `dist/`
on the CDN, since the player's own package does not carry the runtime. The root is fine for the
worker: its scope becomes `/h5p/`, not `/`, so an existing site worker is untouched.

Pin an explicit version in each URL; the two packages have their own version numbers
(`npm view @missing-elements/h5p-offline-player version` and
`npm view @missing-elements/h5p-runtime version` for the latest). Unpinned, the CDN moves and
the copied worker does not. Re-download `h5p-sw.js` on every upgrade of the player; the console
warns when the two differ.
