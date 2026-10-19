# Single-worker hosts and upgrades

## Single-worker hosts

Where only one Service Worker per origin is allowed (Angular `ngsw`, some Next.js PWA plugins, team policy), mount the handlers in the host's worker:

```js
// host's sw.js
import { mountH5P } from '@missing-elements/h5p-offline-player/sw';
mountH5P(self);                       // call before Workbox routing so h5p/* is claimed first
```

Routes then live under `<hostScope>h5p/`, and the element uses them instead of registering its own worker. Upgrading the package means rebuilding the host's worker.

**An app that must work offline needs this setup.** The frame's requests for the runtime, `h5p.css` and the fonts go to the worker that mounts the routes, so that worker must also precache them with your app shell, and the page must be controlled by it before the element loads anything — on a first visit, wait for `controllerchange` after registering. Worked example: the demo's installable app, [`apps/demo/app/sw.js`](https://github.com/missing-elements/h5p-offline-player/blob/main/apps/demo/app/sw.js) and [`app.js`](https://github.com/missing-elements/h5p-offline-player/blob/main/apps/demo/app/app.js).

## Upgrading

- Cache names include the package major version; minor and patch updates reuse cached packages, and a worker update never invalidates them. A major starts the cache afresh, and each package is downloaded once more; saved state is kept.
- After an upgrade, the element updates its own worker before the first load, waiting up to three seconds, or up to thirty when the worker is from another major version, which cannot serve it.
- Serve the runtime's folder and a copy of the library pack revalidated (`Cache-Control: no-cache`), or under a path with the version in it, as jsDelivr's addresses are. Their file names stay the same from one version to the next, and a copy the browser kept from before an upgrade runs against the new worker: from 0.10 to 1.0, kept for an hour, it failed every play for that hour.
- Installed without a build step: re-download `h5p-sw.js` after upgrading. The element logs a warning when versions differ.
- Single-worker hosts update their own worker; offer a reload on `controllerchange`, as the demo's app does.

What an upgrade may change, by version number, is in [Compatibility](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/compatibility.md).
