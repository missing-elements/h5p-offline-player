# Offline Browser-Based H5P Playback Plan

## Project

Extend `tunapanda/h5p-standalone` with an optional browser-only import and storage layer that can load `.h5p` packages locally, extract them incrementally, store them in OPFS, and expose them to the existing H5P player through virtual URLs.

## Executive recommendation

Do not rewrite the H5P player.

Keep the existing `h5p-standalone` runtime responsible for:

- Reading `h5p.json` and `content/content.json`
- Resolving H5P library dependencies
- Ordering JavaScript and CSS assets
- Creating iframe or inline players
- Initializing the H5P runtime
- Dispatching xAPI events
- Restoring user state

Add a separate browser filesystem adapter responsible for:

- Selecting `.h5p` files
- Streaming ZIP extraction
- Validating package structure
- Persisting files in OPFS
- Serving files through virtual URLs
- Implementing HTTP Range requests for media
- Managing package lifecycle and cleanup

The preferred architecture is:

```text
User selects .h5p
        ↓
Streaming ZIP reader
        ↓
Package validation
        ↓
OPFS storage
        ↓
Service worker virtual filesystem
        ↓
Existing h5p-standalone player
```

This minimizes changes to the existing player and preserves compatibility with ordinary H5P package layouts.

---

# 1. Objectives

## Primary objectives

1. Load `.h5p` files without a backend server.
2. Support large packages, including approximately 2 GB archives where browser storage permits.
3. Avoid loading the complete archive into JavaScript memory.
4. Support H5P packages containing:
   - `h5p.json`
   - `content/content.json`
   - JavaScript libraries
   - CSS libraries
   - Images
   - Audio
   - Video
   - Fonts
   - Other permitted content assets
5. Reuse the existing `h5p-standalone` player.
6. Support offline reopening after initial import.
7. Support iframe-based playback as the default isolation mode.
8. Provide clear progress, quota, validation, and extraction errors.
9. Support media seeking through HTTP byte ranges.
10. Keep the new functionality optional so existing consumers are unaffected.

## Secondary objectives

1. Allow multiple imported packages.
2. Support package deletion.
3. Support package metadata and import history.
4. Support browser persistence through IndexedDB and OPFS.
5. Allow future support for user state persistence.
6. Allow future support for package export or re-download.
7. Provide an API suitable for React, Vue, Svelte, and plain HTML applications.

## Non-objectives for the first version

Do not initially implement:

- H5P authoring or editing
- Server-side package management
- Full PHP-library compatibility
- H5P library installation into a global registry
- Content Hub integration
- Automatic library updates
- Arbitrary package modification
- Inline execution as the default mode
- A complete replacement for `h5p-standalone`

---

# 2. Existing repository capabilities

The current repository already provides most of the playback layer.

Important existing files:

```text
src/index.ts
  Public package entry point.

src/h5p-standalone.ts
  Main H5P player implementation.

src/h5p-integration.ts
  Default H5PIntegration object and localization.

src/h5p.d.ts
  Types for H5P packages, libraries, content, and integration data.

src/frame.ts
  Entry point that bundles vendored H5P core JavaScript.

src/utils.ts
  URL resolution, JSON fetching, script loading, stylesheet loading,
  object merging, and array merging.

vendor/h5p/
  Vendored H5P core JavaScript, CSS, fonts, and images.

webpack.common.js
  Produces main.bundle.js and frame.bundle.js.

test/
  Manual HTML integration pages and a sample H5P package.

cypress/
  End-to-end browser tests.

.github/workflows/
  Build, test, and release workflows.
```

The most important existing behavior is in `src/h5p-standalone.ts`.

It currently:

1. Resolves `h5pJsonPath`, `contentJsonPath`, and `librariesPath`.
2. Fetches `h5p.json`.
3. Fetches `content/content.json`.
4. Reads library metadata.
5. Recursively discovers preloaded dependencies.
6. Sorts dependency assets with `toposort`.
7. Builds `window.H5PIntegration`.
8. Loads scripts and stylesheets.
9. Creates an iframe or inline content container.
10. Calls `window.H5P.init()`.

This URL-oriented design makes it compatible with a service-worker virtual filesystem.

---

# 3. Target user experience

## Basic user flow

```text
1. User opens the offline H5P application.
2. User selects an .h5p file.
3. Application checks file metadata and available storage.
4. Application streams the archive into OPFS.
5. Application validates h5p.json and content/content.json.
6. Application registers a virtual package URL.
7. Application starts h5p-standalone.
8. H5P content plays in an iframe.
9. User can reopen the package later without selecting it again.
```

## Example application API

```javascript
const packageInfo = await H5POffline.import(file, {
  onProgress(progress) {
    console.log(`${progress.percent}%`);
  }
});

await H5POffline.play(packageInfo.id, {
  container: document.querySelector("#h5p-container"),
  frameJs: "/dist/frame.bundle.js",
  frameCss: "/dist/styles/h5p.css",
  embedType: "iframe"
});
```

## Lower-level API

```javascript
const imported = await importer.import(file);

const player = await player.open(imported.id, {
  container,
  frameJs: "/dist/frame.bundle.js",
  frameCss: "/dist/styles/h5p.css"
});
```

---

# 4. Proposed architecture

## Components

```text
packages/
  h5p-offline/
    src/
      importer.ts
      package-storage.ts
      package-index.ts
      package-validator.ts
      virtual-url.ts
      service-worker-client.ts
      player.ts
      errors.ts
      types.ts

    service-worker/
      h5p-worker.ts

    tests/
      importer.test.ts
      validator.test.ts
      storage.test.ts
      range-response.test.ts

    README.md
```

The first implementation may live directly inside the existing repository:

```text
src/
  offline/
    h5p-importer.ts
    h5p-storage.ts
    h5p-validator.ts
    h5p-virtual-url.ts
    h5p-player.ts
    h5p-errors.ts
    types.ts

service-worker/
  h5p-service-worker.ts
```

A separate package is preferable if the offline layer is expected to evolve independently.

## Data flow

```text
File
  ↓
ZIP reader
  ↓
Entry metadata
  ↓
Path validation
  ↓
OPFS writer
  ↓
Package index
  ↓
Service worker registration
  ↓
Virtual URL
  ↓
h5p-standalone
```

## Virtual URL format

Use a stable URL namespace:

```text
/virtual-h5p/<package-id>/h5p.json
/virtual-h5p/<package-id>/content/content.json
/virtual-h5p/<package-id>/content/images/example.png
/virtual-h5p/<package-id>/content/video/example.mp4
/virtual-h5p/<package-id>/H5P.Video-1.6/library.json
/virtual-h5p/<package-id>/H5P.Video-1.6/video.js
/virtual-h5p/<package-id>/H5P.Video-1.6/video.css
```

The corresponding OPFS layout should be:

```text
OPFS/
  h5p-offline/
    packages/
      <package-id>/
        h5p.json
        content/
          content.json
          images/
          video/
        H5P.Video-1.6/
          library.json
          video.js
          video.css
```

The package ID must be generated by the application and must not be derived directly from an untrusted filename.

---

# 5. Package import design

## File selection

Support both APIs:

```javascript
const input = document.querySelector("input[type=file]");
const file = input.files[0];
```

and, where supported:

```javascript
const [handle] = await window.showOpenFilePicker({
  types: [{
    description: "H5P packages",
    accept: {
      "application/zip": [".h5p"]
    }
  }]
});

const file = await handle.getFile();
```

The fallback must remain a normal file input because File System Access API support varies across browsers.

## Import stages

The importer should expose explicit stages:

```text
idle
reading
inspecting
checking-storage
extracting
validating
registering
complete
failed
cancelled
```

Example progress model:

```typescript
interface ImportProgress {
  stage:
    | "reading"
    | "inspecting"
    | "checking-storage"
    | "extracting"
    | "validating"
    | "registering"
    | "complete";

  bytesRead: number;
  totalBytes?: number;
  filesProcessed: number;
  filesTotal?: number;
  currentPath?: string;
  percent?: number;
}
```

## Streaming requirements

The importer must not assume that the entire archive can be loaded into memory.

Avoid:

```javascript
const buffer = await file.arrayBuffer();
```

for large packages.

The ZIP implementation should support:

- ZIP64
- Large files
- Reading from a `File` or file-like random-access source
- Incremental decompression
- One-entry-at-a-time processing
- Uncompressed size reporting
- CRC checking where available
- Cancellation
- Progress reporting
- Duplicate entry detection

A practical implementation may use a ZIP library that reads from `Blob` slices and streams decompressed entries into OPFS.

## Path security

Reject entries that contain:

```text
../
/absolute/path
\absolute\path
./../
encoded traversal sequences
null bytes
```

Normalize paths before writing them.

Recommended validation rules:

```typescript
function validateArchivePath(path: string): string {
  if (path.includes("\0")) {
    throw new InvalidPackageError("Path contains a null byte");
  }

  const normalized = path.replaceAll("\\", "/");

  if (
    normalized.startsWith("/") ||
    normalized.split("/").includes("..")
  ) {
    throw new InvalidPackageError(`Unsafe archive path: ${path}`);
  }

  return normalized;
}
```

The service worker must repeat path validation. Never rely only on importer validation.

## Required files

The importer must require:

```text
h5p.json
content/content.json
```

It should reject packages missing either file.

The first version should also validate:

- `h5p.json` is valid JSON.
- `content/content.json` is valid JSON.
- `h5p.json.mainLibrary` exists.
- `h5p.json.preloadedDependencies` exists or is handled explicitly.
- The main library is present.
- Every declared preloaded dependency has a corresponding library directory.
- Every referenced `library.json` is valid JSON.

---

# 6. Storage design

## OPFS responsibilities

OPFS should store package files, not application metadata.

Use IndexedDB for:

- Package ID
- Original filename
- Import timestamp
- Package title
- Language
- Main library
- Archive size
- Extracted size
- File count
- Last-used timestamp
- Import status
- Optional source metadata

Use OPFS for:

- `h5p.json`
- `content/content.json`
- Library files
- Media assets
- Fonts
- Images
- CSS
- JavaScript

## Package metadata

```typescript
interface H5PPackageRecord {
  id: string;
  originalName: string;
  title?: string;
  language?: string;
  mainLibrary?: string;
  archiveSize: number;
  extractedSize: number;
  fileCount: number;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
  status: "ready" | "incomplete" | "failed";
}
```

## Atomic imports

Do not make a partially extracted package visible to the player.

Use a temporary directory:

```text
OPFS/
  h5p-offline/
    staging/
      <import-id>/
    packages/
      <package-id>/
```

Import flow:

```text
1. Create staging directory.
2. Extract and validate into staging.
3. Validate required files and dependencies.
4. Rename or copy staging into packages/<package-id>.
5. Commit metadata to IndexedDB.
6. Delete staging directory.
```

If extraction fails, delete the staging directory.

## Storage quota

Before extraction:

1. Inspect archive central-directory metadata.
2. Calculate total uncompressed size.
3. Add working overhead.
4. Compare against `navigator.storage.estimate()`.
5. Ask for persistent storage when appropriate.
6. Fail early with a clear message if capacity is insufficient.

Approximate requirement:

```text
required space =
  extracted package size
  + temporary extraction overhead
  + filesystem overhead
  + safety margin
```

Do not assume the compressed archive size represents the required storage.

---

# 7. Service worker design

## Purpose

The service worker provides a virtual HTTP server for files stored in OPFS.

It must handle:

```text
GET /virtual-h5p/<package-id>/<path>
HEAD /virtual-h5p/<package-id>/<path>
GET with Range header
```

## Request flow

```text
1. Intercept request.
2. Check whether path begins with /virtual-h5p/.
3. Parse package ID and relative path.
4. Validate package ID and path.
5. Resolve the OPFS file.
6. Determine MIME type.
7. Return full or partial response.
```

All unrelated requests should fall through:

```javascript
return fetch(event.request);
```

## MIME type handling

Use an extension map:

```text
.json  application/json
.js    text/javascript
.css   text/css
.svg   image/svg+xml
.png   image/png
.jpg   image/jpeg
.jpeg  image/jpeg
.gif   image/gif
.webp  image/webp
.mp4   video/mp4
.webm  video/webm
.mp3   audio/mpeg
.m4a   audio/mp4
.ogg   audio/ogg
.wav   audio/wav
.woff  font/woff
.woff2 font/woff2
.ttf   font/ttf
```

Unknown files may use:

```text
application/octet-stream
```

## Range requests

Media playback should support:

```http
Range: bytes=START-END
```

Successful partial responses must include:

```http
206 Partial Content
Accept-Ranges: bytes
Content-Range: bytes START-END/TOTAL
Content-Length: LENGTH
Content-Type: MEDIA_TYPE
```

For unsatisfiable ranges:

```http
416 Range Not Satisfiable
Content-Range: bytes */TOTAL
```

Support at least single-range requests in the first version.

## OPFS media reads

Use OPFS synchronous access handles in a dedicated worker where practical for large media files. If browser compatibility is insufficient, use asynchronous file handles initially and optimize later.

Do not construct a complete in-memory `Blob` for a multi-gigabyte media file unless the browser implementation requires it.

## Service worker readiness

The application must wait until the service worker controls the page:

```javascript
await navigator.serviceWorker.register("/h5p-service-worker.js");

if (!navigator.serviceWorker.controller) {
  await new Promise(resolve => {
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      resolve,
      { once: true }
    );
  });
}
```

The application should not start the H5P player before virtual URL handling is active.

## Scope

The service worker must control:

```text
/virtual-h5p/
```

and the iframe must use the same origin whenever possible.

---

# 8. Integration with h5p-standalone

## Preferred integration

Use the existing player without modifying its core URL behavior:

```javascript
const virtualRoot = `/virtual-h5p/${packageId}`;

await new H5PStandalone.H5P(container, {
  h5pJsonPath: virtualRoot,
  librariesPath: virtualRoot,
  frameJs: "/dist/frame.bundle.js",
  frameCss: "/dist/styles/h5p.css",
  embedType: "iframe"
});
```

This works because `h5p-standalone` already fetches JSON and loads assets by URL.

## Recommended default

Use:

```javascript
embedType: "iframe"
```

Reasons:

- Better isolation from the parent page
- Reduced global H5P state conflicts
- Lower risk when loading third-party libraries
- Easier multi-package support
- Cleaner lifecycle management

Support `embedType: "div"` later after validating global script interactions.

## Potential current-player issues

Before production release, verify:

1. `window.H5PIntegration` behavior inside the iframe.
2. Whether service-worker requests from the iframe are intercepted.
3. Whether relative paths resolve correctly from the iframe.
4. Whether `frame.bundle.js` is loaded from the expected origin.
5. Whether H5P libraries use direct relative URLs that remain inside the virtual namespace.
6. Whether dynamically requested assets are also intercepted.
7. Whether multiple players share or overwrite global integration state.
8. Whether all H5P content types work with OPFS-backed media responses.

## Optional small player improvements

Only if integration testing identifies a need, add:

- A configurable `baseUrl` or asset root.
- A player destruction method.
- An explicit player instance ID.
- A way to provide a custom URL resolver.
- More precise errors for failed asset requests.
- A callback for loading progress.

Do not introduce a custom asset abstraction until the service-worker approach has been proven insufficient.

---

# 9. Security model

H5P packages contain executable JavaScript and HTML-like content. Treat every imported package as untrusted.

## Isolation

Use iframe mode by default.

Prefer a same-origin iframe only when service-worker access is required. If cross-origin isolation is introduced, ensure virtual assets remain accessible.

## Content Security Policy

A production host should define a restrictive CSP appropriate for the application.

At minimum, evaluate:

```text
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
media-src 'self' blob:;
font-src 'self' data:;
connect-src 'self';
frame-src 'self';
```

Some H5P content types may require additional sources. Do not blindly allow all origins.

## External resources

H5P content may reference external resources or custom scripts.

Decide whether the product will:

1. Permit external resources.
2. Block them.
3. Ask the user.
4. Allow only an administrator-configured allowlist.

The safest default for an offline product is to block or restrict external resource access.

## Archive security

Protect against:

- Path traversal
- Absolute paths
- Duplicate paths
- Oversized decompressed entries
- Decompression bombs
- Excessive file counts
- Unexpected executable locations
- Invalid ZIP structures
- Malformed JSON
- Symlink-like archive entries if supported by the ZIP library

Set limits:

```text
Maximum archive size
Maximum extracted size
Maximum individual file size
Maximum file count
Maximum path length
Maximum nesting depth
```

The limits should be configurable.

---

# 10. User-state persistence

The existing player accepts user state and can call application-provided endpoints.

For a browser-only implementation, add an IndexedDB state adapter.

## State key

```text
packageId
contentId
userId
dataType
subContentId
```

For a local single-user application:

```text
packageId
contentId
dataType
subContentId
```

## Possible API

```javascript
const stateStore = createH5PStateStore();

await H5POffline.play(packageId, {
  container,
  stateStore
});
```

The adapter can:

1. Load previous state before player initialization.
2. Pass it through `contentUserData`.
3. Save state periodically.
4. Save on page visibility changes.
5. Save on `beforeunload` where possible.
6. Clear state when requested.

## Initial scope

Implement state persistence after basic playback is stable. It should not block the first importer/player release.

---

# 11. Testing strategy

## Unit tests

Test:

- Archive path normalization
- Path traversal rejection
- Duplicate path handling
- Required file detection
- JSON parsing
- Main library detection
- Dependency presence
- Storage quota calculation
- Package metadata extraction
- MIME type mapping
- Range parsing
- Unsatisfiable range handling
- Package cleanup after failed import

## Browser tests

Use Cypress for:

```text
1. Import a small H5P package.
2. Render one player.
3. Render multiple players.
4. Load advanced display options.
5. Load external libraries.
6. Restore local state.
7. Delete a package.
8. Reopen a previously imported package.
9. Reload the page and play offline.
10. Cancel a large import.
11. Reject an invalid package.
12. Reject an unsafe archive path.
13. Play audio and video.
14. Seek within video.
15. Verify Range responses.
```

## Large-file tests

Do not commit a 2 GB test fixture to the repository.

Use generated or locally provisioned fixtures:

```text
small package       under 10 MB
medium package      100–500 MB
large package       1–2 GB
decompression bomb  synthetic test fixture
invalid package     missing required files
unsafe package      traversal entries
```

Large-file tests should run separately from normal CI.

## Cross-browser matrix

At minimum test:

- Chromium desktop
- Firefox desktop
- Safari desktop
- Chromium Android
- Safari iOS where feasible

Check:

- OPFS support
- Service worker support
- File System Access API availability
- Storage quota behavior
- Range playback
- Iframe behavior
- Video/audio codec support

---

# 12. Performance requirements

## Import performance

The importer should:

- Process entries incrementally.
- Avoid retaining extracted buffers.
- Update progress periodically, not for every byte.
- Use a Web Worker when decompression blocks the UI.
- Support cancellation.
- Avoid repeated full-directory scans.

## Playback performance

The player should:

- Fetch only required metadata initially.
- Load library assets in dependency order.
- Avoid duplicate library requests.
- Use browser caching where possible.
- Stream media through range requests.
- Avoid converting large media files into data URLs.

## Memory targets

For a package with a 2 GB archive:

```text
Expected application memory:
  small ZIP metadata overhead
  current compressed chunk
  current decompressed chunk
  player runtime memory

Avoid:
  full archive ArrayBuffer
  complete extracted package in memory
  complete media Blob for every asset
```

The exact memory target depends on the ZIP implementation and browser.

---

# 13. Packaging and public API

## Suggested exports

```typescript
export {
  H5POffline,
  H5PImporter,
  H5PPackageStorage,
  H5PPackageValidator,
  H5PVirtualFileSystem
};
```

## Suggested API

```typescript
interface ImportOptions {
  onProgress?: (progress: ImportProgress) => void;
  signal?: AbortSignal;
  maxArchiveSize?: number;
  maxExtractedSize?: number;
  maxFileCount?: number;
}

interface PlayOptions {
  container: HTMLElement;
  frameJs: string;
  frameCss: string;
  embedType?: "iframe" | "div";
  title?: string;
  stateStore?: H5PStateStore;
}

interface OfflineH5P {
  import(file: File, options?: ImportOptions): Promise<H5PPackageRecord>;
  list(): Promise<H5PPackageRecord[]>;
  get(id: string): Promise<H5PPackageRecord | undefined>;
  play(id: string, options: PlayOptions): Promise<unknown>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}
```

## Backward compatibility

Existing usage must continue to work:

```javascript
new H5PStandalone.H5P(container, {
  h5pJsonPath: "/h5p/my-package",
  frameJs: "/dist/frame.bundle.js",
  frameCss: "/dist/styles/h5p.css"
});
```

The offline functionality should be additive.

---

# 14. Implementation phases

## Phase 0: Technical spike

### Goal

Prove that the existing player works with a service-worker-backed virtual package.

### Tasks

1. Register a service worker.
2. Hard-code a small in-memory virtual filesystem.
3. Serve:
   - `h5p.json`
   - `content/content.json`
   - One library
   - One CSS file
   - One JavaScript file
4. Start the existing player using `/virtual-h5p/test`.
5. Verify iframe playback.

### Exit criteria

- Existing `h5p-standalone` starts successfully.
- JSON loads through the service worker.
- Library scripts and CSS load.
- H5P content renders.
- No changes are required in `src/h5p-standalone.ts`, or only documented minimal changes are required.

## Phase 1: OPFS filesystem adapter

### Goal

Replace the in-memory map with OPFS-backed files.

### Tasks

1. Create package directories.
2. Write test files into OPFS.
3. Read files from OPFS.
4. Return correct MIME types.
5. Add package IDs and virtual roots.
6. Add cleanup.

### Exit criteria

- A package can be written to OPFS.
- The service worker can read it.
- The existing player can render it.
- Reloading the application preserves the package.

## Phase 2: Streaming importer

### Goal

Import real `.h5p` files incrementally.

### Tasks

1. Integrate ZIP reader.
2. Add ZIP64 support.
3. Stream archive entries into OPFS.
4. Add progress callbacks.
5. Add cancellation.
6. Add staging directories.
7. Add cleanup on error.

### Exit criteria

- Small real-world H5P packages import successfully.
- Import does not require a full archive `ArrayBuffer`.
- Failed imports leave no visible incomplete packages.
- Progress is visible to the application.

## Phase 3: Validation and security

### Goal

Reject invalid and unsafe packages before playback.

### Tasks

1. Validate required files.
2. Validate JSON.
3. Validate dependency directories.
4. Add path traversal checks.
5. Add decompression and file-count limits.
6. Add package size checks.
7. Add clear typed errors.

### Exit criteria

- Invalid packages fail with actionable errors.
- Unsafe archive paths are rejected.
- Oversized packages fail before exhausting storage.
- Staging data is removed after failure.

## Phase 4: Media and Range support

### Goal

Support large audio and video assets efficiently.

### Tasks

1. Implement Range parsing.
2. Return `206 Partial Content`.
3. Return `416` for invalid ranges.
4. Test MP4, WebM, MP3, and other relevant formats.
5. Test seeking.
6. Test startup latency.
7. Test large media files.

### Exit criteria

- Video and audio play from OPFS.
- Seeking works.
- The service worker does not load the entire media file into memory.
- Browser developer tools show partial requests where appropriate.

## Phase 5: Package manager and offline reopening

### Goal

Provide a usable application-level package API.

### Tasks

1. Store metadata in IndexedDB.
2. List packages.
3. Open packages.
4. Delete packages.
5. Show storage usage.
6. Detect incomplete packages.
7. Add last-opened tracking.

### Exit criteria

- Users can import, list, play, reopen, and delete packages.
- Page reload does not lose imported packages.
- Storage cleanup works.

## Phase 6: User state

### Goal

Persist learner progress locally.

### Tasks

1. Implement IndexedDB state storage.
2. Load state before initialization.
3. Save state periodically.
4. Save on visibility changes.
5. Add reset state behavior.
6. Test multiple content IDs.

### Exit criteria

- A user can leave and reopen content.
- Progress is restored.
- State can be reset.
- State from different packages does not collide.

## Phase 7: Production hardening

### Goal

Prepare for release.

### Tasks

1. Test supported browsers.
2. Test large packages.
3. Review CSP.
4. Review third-party ZIP dependency.
5. Review service-worker update behavior.
6. Add error telemetry hooks without collecting content data.
7. Add documentation.
8. Add examples.
9. Add release notes.
10. Add CI checks.

### Exit criteria

- CI passes.
- Documentation covers limitations.
- Browser support is documented.
- Large-file behavior is characterized.
- Security review is complete.

---

# 15. Suggested repository changes

## New source files

```text
src/offline/types.ts
src/offline/errors.ts
src/offline/h5p-importer.ts
src/offline/h5p-validator.ts
src/offline/h5p-storage.ts
src/offline/h5p-package-index.ts
src/offline/h5p-player.ts
src/offline/service-worker-client.ts
service-worker/h5p-service-worker.ts
```

## New tests

```text
test/offline/
  invalid-package.h5p
  unsafe-path.h5p
  minimal-package/

cypress/e2e/
  offline-import.spec.js
  offline-reopen.spec.js
  offline-media.spec.js
  offline-state.spec.js
```

## New documentation

```text
docs/offline-browser-architecture.md
docs/offline-browser-api.md
docs/offline-browser-security.md
docs/offline-browser-limitations.md
```

## Build changes

The Webpack configuration may need a second output for the service worker:

```text
dist/
  main.bundle.js
  frame.bundle.js
  h5p-service-worker.js
  styles/h5p.css
```

The service worker should not be bundled with browser-only assumptions that prevent it from running in a worker context.

---

# 16. Risks and mitigations

## Risk: Browser quota is insufficient

### Mitigation

- Check `navigator.storage.estimate()`.
- Calculate uncompressed package size.
- Request persistent storage where available.
- Provide a clear error.
- Allow package deletion.
- Do not claim universal 2 GB support.

## Risk: ZIP decompression uses too much memory

### Mitigation

- Use streaming extraction.
- Use a Web Worker.
- Avoid `file.arrayBuffer()` for large files.
- Process one archive entry at a time.
- Test with large packages.

## Risk: Service worker cannot control the page

### Mitigation

- Require HTTPS or localhost.
- Show a setup error for `file://`.
- Wait for service-worker activation.
- Document deployment requirements.

## Risk: H5P content expects server functionality

### Mitigation

- Support read-only playback first.
- Provide optional IndexedDB state storage.
- Clearly document that backend AJAX endpoints are not automatically provided.
- Add adapters for state and results later.

## Risk: H5P library executes unwanted code

### Mitigation

- Default to iframe mode.
- Use CSP.
- Restrict external requests.
- Validate archive paths.
- Document that H5P packages contain executable content.

## Risk: Browser media support differs

### Mitigation

- Test codecs explicitly.
- Document supported formats.
- Do not promise playback for unsupported browser codecs.
- Provide user-facing media errors.

## Risk: Global H5P state conflicts

### Mitigation

- Default to iframe mode.
- Use unique content IDs.
- Test multiple players.
- Add explicit cleanup if needed.
- Avoid inline mode for the first production release.

## Risk: Service worker lifecycle causes stale files

### Mitigation

- Version the service worker.
- Store package metadata separately.
- Use package IDs in URLs.
- Clean up removed packages.
- Avoid caching mutable package paths without a clear invalidation strategy.

---

# 17. Acceptance criteria

The feature is ready for an initial release when all of the following are true:

## Import

- A user can select a valid `.h5p` file.
- The file is extracted without requiring a server.
- Small and medium packages work reliably.
- Large packages are streamed without a full-memory copy.
- Import progress is exposed.
- Import can be cancelled.

## Validation

- Missing `h5p.json` is rejected.
- Missing `content/content.json` is rejected.
- Invalid JSON is rejected.
- Unsafe archive paths are rejected.
- Missing declared libraries are reported.
- Oversized packages are rejected before extraction when detectable.

## Playback

- Existing `h5p-standalone` renders imported packages.
- Iframe mode works.
- JavaScript and CSS libraries load.
- Images load.
- Audio and video load.
- Multiple packages can be opened independently.

## Offline behavior

- An imported package can be reopened after reload.
- Playback works without network access for self-contained packages.
- External dependencies are clearly reported or blocked.

## Storage

- Packages can be listed.
- Packages can be deleted.
- Failed imports are cleaned up.
- Storage usage can be displayed.

## Media

- Video starts successfully.
- Seeking works where browser and codec support it.
- Range requests are handled correctly.
- Large media files do not require full in-memory buffering.

## Compatibility

- Existing `h5p-standalone` API remains unchanged.
- Existing server-hosted H5P usage continues to work.
- Offline functionality is opt-in.

---

# 18. Final recommendation

The lowest-risk implementation is:

```text
1. Keep h5p-standalone.
2. Add a streaming ZIP importer.
3. Store extracted files in OPFS.
4. Store metadata in IndexedDB.
5. Add a service worker that exposes OPFS files as virtual URLs.
6. Point h5p-standalone at the virtual package root.
7. Use iframe mode by default.
8. Add Range support for media.
9. Add local state persistence after playback is stable.
```

Do not begin by rewriting `src/h5p-standalone.ts`.

Only introduce a custom asset resolver if testing proves that service-worker URLs cannot support a required H5P content type or deployment environment.

The central product boundary should be:

```text
Offline H5P layer:
  import, validate, store, route, persist, clean up

h5p-standalone:
  resolve, load, render, initialize, report events
```

This preserves the existing player investment while adding the minimum functionality needed for serverless browser playback.
