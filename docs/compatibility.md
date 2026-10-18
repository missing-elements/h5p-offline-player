# Compatibility

What a version number of these packages promises, what it does not, and how a breaking change
reaches you.

## Version numbers

The packages follow [semantic versioning](https://semver.org). From 1.0.0, a change that breaks
anything under *What is covered* comes only in a major release; a minor adds without breaking; a
patch fixes. Before 1.0.0, a minor may break what is covered and a patch does not.

Two kinds of fix ship in any release, a patch included:

- **Security.** A fix that refuses something hostile, even when it refuses a package that played
  before. Which releases receive one is in
  [SECURITY.md](https://github.com/missing-elements/h5p-offline-player/blob/main/SECURITY.md).
- **Conformance.** A fix that brings what a package sends or writes into line with the standard
  it implements — xAPI, cmi5, the zip format — even when a system downstream accepted the old
  form.

Each release's notes, on [GitHub](https://github.com/missing-elements/h5p-offline-player/releases),
list a breaking change, or a fix of either kind, first, with what to do about it.

## What is covered

### The player, `@missing-elements/h5p-offline-player`

- **The element.** `<h5p-player>`, and every attribute, property, method and event in the
  [README's API tables](https://github.com/missing-elements/h5p-offline-player#api), with the
  values and `detail` shapes given there. A new error `code` or `progress` phase can come in a
  minor: treat one you do not know as the general case.
- **The files.** The package's exports — `.`, the element, and `./sw`, `mountH5P` — and the four
  files a host without a build step copies by name: `h5p-player.js`, `h5p-sw.js`,
  `h5p-sw-mount.js` and `h5p-jobs.js`.
- **The worker's path.** The player's routes are `h5p/` beside `h5p-sw.js`, the scope the element
  registers, or `h5p/` in the scope of a host's own worker that mounts them. Every other request is
  left to the network, or to the host's own handlers.
- **What statements carry.** `context.platform` is `h5p-offline-player <version>`, and
  `context.revision` is `sha256:<hex>`, followed by `; libraries` and the fingerprint of what
  supplied libraries, a bundle's or the pack's archives' ([Which build a learner completed](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/revision.md)).
  The recipe behind the hash does not change within a major, and a major that changes it gives
  the new value a prefix of its own, so an audit can always tell which recipe to recompute with.
- **What names a package.** `activity-id` defaults to the package URL, and the statements'
  object ids are built on it; a package's `pkgId` comes from its URL and the host's validator, or
  from the picked file's name, size and date, and saved state is kept under it. Neither recipe
  changes within a major.
- **What counts as the result.** The rule behind `finished`, as the README states it, since an
  LMS records completion by it.
- **What is kept on the device.** Saved state (`resume="device"`) survives every release, a
  major included, unless the release's notes say otherwise. Cached packages survive minors and
  patches; a major starts the cache afresh, and each package is downloaded once more.
- **Versions side by side.** Within a major, an element plays with a Service Worker from an older
  release: it updates its own worker before the first load, and logs a warning where it cannot —
  a stale copy of `h5p-sw.js` on the host, or a host's worker with the routes mounted. A worker
  serves an element from an older release too. [Upgrading](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/single-worker.md#upgrading)
  says what a host does about it.

### The runtime, `@missing-elements/h5p-runtime`

- **The `runtime` export** a bundled host hands the element, and `dist/`, which a host using
  `assets-base` serves whole.
- **Its pairing with the player.** The player's peer dependency names the runtime versions it
  plays with, and any pairing in that range plays. The boot configuration and the messages
  between the frame and the element are a contract between the two packages, not an API: a
  runtime that needs more of it than older players write is a breaking release of the runtime,
  and goes out with a player that moves its range.
- **The H5P core inside** is updated in minor releases, the version it carries named in the
  notes and in `dist/NOTICE.txt`. The core's own strings, refreshed weekly from Moodle's language
  packs, change in patches.

### The library pack, `@missing-elements/h5p-libraries`

`libraries="pack"` plays against the pack version a player release pins, so one player version
always plays a package against the same libraries. The pin moves in a minor release, never in a
patch: with `pack`, a library a package carries plays at the pack's newer version, so a new pack
changes what packages that carry their libraries play, and their `revision`, and a learner's state
saved against the build before starts over. Libraries move to newer minors, and content written
for an older minor is brought up by the libraries' own upgrade steps. A pack that drops a content
type or a library major the one before carried comes only with a player major.

What is covered of the pack itself: the `pack` export, `parts/` with its `index.json` and one
`<folder>.h5p` per library, and `libraries.h5p`, the whole pack as one file.

### The embed site, `@missing-elements/h5p-embed`

- **The command's options**, and the files it writes for each kind of host.
- **The page's interface**: its query parameters and the messages it posts, as its
  [README](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/embed#readme)
  lists them: what a snippet, or a page that reads `report`, is built on.
- **`buildSite()`**, the command as a function, and **`startEmbed()`**, the page as one, with
  their options; and `resizer.js`, which speaks H5P's own resizer protocol.

A written site is a folder of copies and changes only when it is written again: upgrading is
running the new version of the command and deploying the folder.

### cmi5, `@missing-elements/h5p-cmi5`

`startCmi5()`, `isCmi5Launch()` and `createCmi5Client()`, with the options and the session's and
client's methods its [README](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/cmi5#readme)
lists, and their types. The statements it sends are cmi5's, so a fix that brings one into line
with the specification is a conformance fix.

### The normalizer, `@missing-elements/h5p-normalize`

The command's options, and `normalizeArchive()`, `formatBytes()` and `archiveFingerprint()`. The
content of a package it rewrites never changes. How it lays out the zip may change in a minor, as
long as the player streams the result at least as well.

### The verifier, `@missing-elements/h5p-verify`

The command's options, its exit codes — 0 plays, 1 does not, 2 could not run — `report.json`, to
which fields may be added, and `verifyPackage()` and `summarize()`. The verifier is a step in other
people's pipelines, so a check that turns a pass into a fail comes in a minor, never a patch; a new
warning can come in any release.

## What is not covered

- The routes inside `h5p/`, the messages between the element, the workers and the frame, and how
  the database and the caches are laid out. They may change in any release, within what
  *Versions side by side* promises.
- The frame's document and its policy, beyond what `allow-origins` and `untrusted` promise.
- Content types. The libraries are H5P's and their authors', and how one looks or behaves changes
  with the pack.
- Exports and files this page does not name: a package's other exports, the rest of the
  player's `dist/`, the files inside the runtime's. Nor anything reached by a path a package does
  not export.
- The demo site, including `/app/` and `/embed` there, and this repository's scripts and
  workflows.

## Deprecation

A renamed attribute, value or option keeps working through the rest of its major and goes only
in a major. None is in that state now.

## Browsers

The player needs a secure context — https, or `localhost` — with Service Workers, the Cache API,
IndexedDB, Web Locks and `DecompressionStream` for `deflate-raw`. Its browser suite runs on every
change in Chromium, Firefox and WebKit, Playwright's builds of their current releases; Safari on
macOS and iOS is checked by hand. No version floor is published: a package that plays in a current
browser and not in another that has those features is a bug, and worth reporting. Dropping an engine
is a major change.

## Node

The commands — `h5p-normalize`, `h5p-verify`, `h5p-embed` — and the functions behind them
declare the Node versions they run on in `engines`. That floor rises in a minor when a Node line
reaches its end of life, never in a patch.

## Which packages move together

The player, the runtime and the embed site are released together whenever the contract between them
changes: the player names the runtime versions it plays with, and the embed site the player, runtime
and library pack it writes a site from. The library pack has a version of its own, and each release
of it is followed by a player release that pins it, since `pack` plays only the version the player
names. cmi5, the normalizer and the verifier are versioned on their own.
