# Scope

What is not built yet.

## Out of scope

The editor, offline management (save, library, delete), results storage and persistent file
handles. xAPI is emitted as events and stored nowhere.

## Open

**Demand-paced extraction, deferred on 2026-09-25.** The first request for a deflated entry
inflates the whole file, since a deflate stream cannot restart in the middle: an 80 MB deflated
video pulled 26 MB from GitHub Pages in its first 15 seconds while paused, and Interactive Video's
icons queued behind its segments, 1.3 to 1.8 s each against 52 ms on an idle link. Priority hints
and smaller segments did not help; only pulling fewer bytes does. A deflate stream can be paused,
though, and the design is:

- The Service Worker's streaming path announces on the watermark channel how far it has read.
- The chunk writer writes up to that position plus a segment or two, then waits for the next notice.
- `preload` announces unbounded demand, and a forward seek announces its position.
- A job paused for lack of demand must not read as a dead one to `waitForWatermark`.

About 150 lines. Deferred because `pnpm normalize` fixes it on the package's side (the same boot
pulled 1.4 MB instead of 81), and how often the player gets a deflated video that nobody can
normalize is not known.

Smaller ones:

- The content check leaves upstream's `extraAttributes` unchecked, as upstream does.
- Whether `finished` should carry the revision at top level, for hosts that read no statements;
  nobody has asked.
- Accessibility: a real screen reader (NVDA, JAWS, VoiceOver), Safari itself and iOS, zoom and
  contrast. What was run is in `ACCESSIBILITY.md`.
- Resume: `setFinished` (h5p-standalone's `setFinishedUrl`), which xAPI's `completed` already
  carries, and sub-content that saves under a data type other than `state`, which the store keeps
  without reading.
