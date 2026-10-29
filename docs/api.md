# The element's API

Every attribute, property, method and event of `<h5p-player>`. This is the contract
[Compatibility](compatibility.md) holds a version to: within a major, nothing here changes
meaning, and a new error `code` or `progress` phase can only be added.

## Attributes and properties

| Name | Set as | What it does |
|---|---|---|
| `src` | attribute, property | The package URL. Setting a new one loads; removing it empties the player. To reload the same URL, remove it and set it again |
| `file` | property | A `File` from a picker; wins over `src` |
| `sw` | attribute | The Service Worker's URL, same-origin. Default: `h5p-sw.js` beside the element |
| `jobs` | attribute | The background worker's URL, for a CSP without `blob:` in `worker-src`. Default: `blob:`, then `h5p-jobs.js` beside the element |
| `runtime` | property | The `runtime` export of `@missing-elements/h5p-runtime`. Set before `src` |
| `assets-base` | attribute | Where the runtime's `dist/` is served. Default: `frame-assets/` beside the element |
| `libraries` | attribute | Sources for a package's libraries, tried in order: `pack`, the library pack, of which only the libraries a package needs are downloaded, and whose newer versions play in place of those a package carries; a `.h5p` URL, which only fills gaps; or both. Default: a package plays as it is, and one without its libraries is refused |
| `pack-base` | attribute | Where `pack` is: the folder of a copy of `@missing-elements/h5p-libraries`' `parts/` on your site. Default: jsDelivr, at the version this release pins |
| `pack` | property | The `pack` export of `@missing-elements/h5p-libraries`, as a bundler emits it; wins over `pack-base`. Set before `src` |
| `refresh-libraries` | attribute | `off` plays the libraries a package carries as exported, and `pack` only fills gaps. Default: the pack's newer versions play |
| `downgrade-libraries` | attribute | `off` refuses content made for a newer minor version of a library than any source has. Default: once every source has been tried for that version, the newest older minor of the same major plays it, reported in `downgradedLibraries` and the console |
| `untrusted` | attribute, property | Plays a package you did not make as data: its own library folders are ignored and the libraries come from `libraries` (default `pack`), `content/` serves only H5P's own file types, and the frame's script policy names exact paths. Its content is checked against each library's `semantics.json`, as the H5P CMS plugins check it. A package that needs its own copy of a library is refused, with `missingLibraries.carried` set |
| `allow-origins` | attribute | Extra origins for the frame's CSP, space separated |
| `frame`, `copyright`, `export`, `icon`, `embed` | attribute | Show the H5P action bar and its buttons. `export` needs `download-url` or a package URL, `embed` needs `embed-code` |
| `fullscreen` | attribute | `off` removes the fullscreen button |
| `download-url`, `embed-code`, `resize-code` | attribute | What the download and embed buttons offer; `:w` and `:h` in `embed-code` stand for the size |
| `custom-css`, `custom-js` | attribute | Stylesheets and scripts loaded in the frame after the runtime's own |
| `reporting` | attribute | Enables the submit button in content types that have one |
| `activity-id` | attribute | The statements' object id. Default: the package URL |
| `lang` | attribute | The language of H5P's own buttons and dialogs, such as "Fullscreen" and "Rights of use", for a package that does not name its own. A package that names its language in `h5p.json` (`defaultLanguage`), as H5P's exports do, gets them in that language, so they match the content's own text whatever the page's language. More than fifty languages. Inherited from the page like any element's language, and read at each load. Default: English |
| `user` | property | `{ name, mail }`, the actor of every statement. Set before `src` |
| `auto-resize` | attribute | `off` to size the element yourself. Default: follows the content's height |
| `preload` | attribute, property | `auto` pulls large deflated media before it is asked for. Default: `none` |
| `resume` | attribute, property | `device` keeps the content's saved state on this device; `host` hands it to the page. Default: `off` |
| `save-interval` | attribute, property (`saveInterval`) | Seconds between saves while the content runs, with `resume`; also saved after each completion and as the page closes. Default: `10` |
| `userData` | property | Under `resume="host"`, the state to restore, as `userdata` events carried it. Set before `src`. Not checked against the build: compare the `revision` you stored |
| `state` | read-only | `idle`, `probing`, `downloading`, `indexing`, `ready` or `error` |
| `pkgId`, `revision` | read-only | The loaded package's id and build fingerprint |
| `source` | read-only | `{ type: 'range-http' \| 'chunked' \| 'file', size, … }` |
| `metadata` | read-only | `h5p.json`'s metadata plus `mainLibrary` |
| `libraryBundle` | read-only | `{ url, origin, fromCache, refreshed? }` for what supplied libraries: for the pack, `refreshed` lists the libraries the package carries that played at the pack's version, `{ library, from, to }` |
| `downgradedLibraries` | read-only | The libraries the content names at a newer minor than any source has, which played at the newest older one (`downgrade-libraries`): `{ library, from, to }`, with `from` the version named, such as `1.17`, and `to` the one played, such as `1.16.27`. Empty when none did. The older version may be the package's own, with no `libraryBundle` |
| `scope` | read-only | The Service Worker scope |

## Methods

`clearUserData()` forgets the state kept on this device for the current package; remove `src` and
set it again to restart the content.

## Events

Events are `CustomEvent`s:

| Event | `detail` | When |
|---|---|---|
| `ready` | `{ pkgId, source, metadata, revision, libraryBundle, downgradedLibraries }` | The content is visible |
| `xapi` | `{ statement, verb }` | Any xAPI statement; nothing is stored |
| `finished` | `{ statement }` | The content reported its result: a `completed` or `answered` statement from the content itself, not from a part inside it. That is H5P's own `setFinished` rule, except that a part created without a parent counts as a part too, which H5P's rule misses for Interactive Book's chapters and Game Map's exercises. It can come more than once, for a question checked again; the last is the result. Content that reports no result of its own never raises it, and Interactive Book reports one only with `reporting` |
| `userdata` | `{ pkgId, dataType, subContentId, data, revision }` | With `resume`: the content saved its state; `data: null` means delete it |
| `progress` | `{ phase, fraction, loaded, total, entry? }` | `download`, `libraries`, `warm` or `extract`; `fraction` is 0–1, or `null` while the total is unknown |
| `resize` | `{ height }` | The content's height changed |
| `statechange` | `{ state }` | `state` changed |
| `error` | `{ code, message, missingLibraries? }` | `no-cors`, `no-worker`, `network`, `quota`, `bad-archive` or `runtime`. An error while `state` stays `ready` (a content exception, or one media file that failed to extract) leaves the content running |

```js
const player = document.querySelector('h5p-player')
player.addEventListener('xapi', (e) => console.log(e.detail.statement))
player.addEventListener('error', (e) => {
  if (e.detail.code === 'no-cors') showDownloadHint()
})
input.onchange = () => (player.file = input.files[0])
```

The element renders the content and nothing else; URL fields, pickers and progress bars belong
to the page. The demo's [player page](../apps/demo/index.html) is an example, and
[Coming from h5p-standalone](h5p-standalone.md) maps its options to the names here.
