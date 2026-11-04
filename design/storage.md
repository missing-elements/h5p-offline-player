# Storage and the Jobs worker

Where extracted bytes are kept and how they are written: the chunk store and its watermark, the Jobs worker's downloads and extractions and their order, eviction and quota. The code: `packages/player/src/shared/` (`chunk-store.ts`, `eviction.ts`, `locks.ts`, `storage.ts`, `idb.ts`) and `src/jobs/`.

## Invariants

- **The watermark is always a prefix.** Chunks are written in order, so a reader can serve
  anything below `meta.available` without checking which chunks exist. Do not write chunks out of
  order.
- **A resumed write must start on a chunk boundary.** `createChunkWriter` asserts this. Partial
  chunks are rewritten as they fill, with a doubling interval — a fixed interval is O(n²) in
  bytes rewritten.
- **Job requests are deduplicated for two seconds, not for the whole wait.** A job can die with
  the tab that owned it; a long window would leave the entry unserved until it expired. The real
  deduplication is the Jobs worker's in-flight map plus a Web Lock. `waitForWatermark` re-asks
  when the watermark has not moved for `COLD_ENTRY_WAIT_MS`.

- **The chunk writer's `abort` publishes nothing.** Everything that reached the store is already
  recorded by the `publish` that followed its write; bytes still in the partial buffer were never
  stored. Publishing `written` on abort — which it once did — put the watermark past the data,
  and a reader that trusted it got a short body.
- **A downloaded archive is read back before it is reported done.** WebKit can lose a cache's writes
  when the Jobs worker that made them is terminated just after them: measured on 2026-10-13 in
  Playwright's WebKit, a package from a host without `Range` downloaded whole — record written and
  read back as complete — its element removed a millisecond later, which terminates the Jobs worker,
  and played again at once: the second worker found the cache empty, downloaded every byte, and
  could not read back its own record a moment later. Nothing deleted the cache, from any context;
  deleting it by name and downloading again kept everything, every time. A check before the job did
  not help — the writes vanish during it — so `downloadArchive` reads the record back at the end
  and, when it is not complete, starts the cache afresh (`ChunkStore.destroy`) and downloads once
  more; a second loss is a `bad-archive` naming the storage. The archive is all or nothing, so that
  is where the check pays. An extraction's or a warm's writes lost the same way are not checked, and
  what the virtual server then serves for them is not measured. It takes a replay within
  milliseconds of removing the element, which the tests do and a learner rarely does; Safari itself
  is not measured. `playback.test.ts` failed four tests in WebKit without it.
- **An aborted job gives up its `inFlight` key at once, not when the abort finishes.** The
  teardown takes several tasks, and a second press of Play posts `abort` and `download` back to
  back; a key still held by the dying job made the new request look like a duplicate, and nothing
  ever answered it. The `finally` deletes only its own entry for the same reason.
- **Extractions run one at a time, and the order is the policy.** A runtime asks for every
  video it instantiates at boot, not only the one on screen: an Interactive Book from sodix.de
  with six deflated videos (4.6 to 57.8 MB, none faststart) kept two `<video>` elements attached
  and still requested all six within the first second — H5P.Video creates a media element per
  chapter, and a detached one loads its header all the same. Three extractions and three inline
  inflates then shared 1.27 MB/s, and the first chapter's 21 MB video, which plays nothing until
  its last byte because its `moov` is at the end, finished at 26 s instead of the 16 s it takes
  alone. So the Jobs worker runs extractions through `JobQueue`: a demand — the virtual server's
  `need-job` — queues behind earlier demands and ahead of every prefetch; a repeated demand for a
  queued entry moves it to the front, which the server's two-second dedupe keeps the boot burst
  from doing to itself while a learner opening a later chapter is heard at once; a prefetch
  (`extract` with `prefetch: true`, which is how `advancePrefetch` posts) goes to the back and
  promotes nothing. The running job is never interrupted, since a deflate stream cannot resume.
  Two things keep a queued entry's waiters honest: the Jobs worker announces it as `queued` on the
  watermark channel every `INPUT_LIVENESS_MS`, which `waitForWatermark` counts as alive, and
  `serveChunked` answers a queued entry at once with its headers and a body that follows, rather
  than holding the request open until the first flush — behind a long queue that could be
  minutes, longer than a fetch event may stay unanswered. Downloads and warming are not queued;
  both happen before the frame boots. `job-queue.test.ts` pins the order, `jobs-worker.test.ts`
  drives three extractions through the real worker and checks they never overlap.
- **A chunk streams out of the cache; it is not materialised.** `readRange` pipes each chunk's
  body through, slicing a partial one as it flows, so the 64 kB a media element probes with costs
  64 kB rather than the 8 MB chunk around it.
- **The watermark is announced, not only polled.** `setMeta` posts each write on a
  `BroadcastChannel`; `waitForWatermark` wakes on the notice and polls at `WATERMARK_POLL_MS`
  only as the fallback that catches a dead job. Two channel objects, because a channel never
  hears itself — which is also what lets the unit test hear it.
- **The Jobs worker carries no zip.js and reads no index.** Every job is told where its bytes
  are by the Service Worker, which has the central directory: the warm gets its spans, an
  extraction gets an `EntryLocation` — the local header's offset for a central-directory entry,
  the data's start for one the forward index named, plus sizes and method — on the `need-job`
  message and on each `PrefetchEntry`. The worker reads the thirty-byte local header
  (`local-header.ts`, the same parse the server and the warm use), streams the compressed span
  through `streamSpan` and inflates with the native `DecompressionStream`. Before this the worker
  opened its own zip.js reader per package, which was a round of ranged requests per worker —
  five seconds on the fwu.de host — for an index the server already had, and put zip.js in the
  element's bundle by way of the worker string: 159 kB of the worker's 193, 208 kB for the
  element. Measured after: the worker is 24 kB, the element 40 kB minified (17 kB gzipped), the
  Service Worker unchanged, since the index is its job. A chunked source is opened `partial` for
  an extraction, because an entry the forward index named lies whole below the watermark of an
  archive still downloading. `tests/browser/jobs-worker.test.ts` builds the locations the way
  the server does, through `locationOf`.
- **Bulk fetches are `cache: 'no-store'`.** The chunk store is the cache; a second copy in the
  browser's HTTP cache doubled the storage for nothing.
- **Eviction empties a cache before it deletes it.** In Chromium `caches.delete()` frees nothing
  the write that triggered it can use: the bytes stay on the books until every `Cache` object
  anyone holds for that cache has been garbage-collected, and the virtual server makes one per
  request. Measured against a simulated quota: with a handle alive the space never came back,
  with handles dropped it took about 770 ms, with the entries deleted first it was back in 3 ms.
  Before `emptyCache`, a write under pressure evicted every idle package in turn, found each
  eviction had freed nothing yet, and gave up — while a reload seconds later found the room.
  One cost that remains: a partial chunk is rewritten as it fills, and the Cache API holds the
  old and the new copy together while the put lands, so an entry needs up to twice its last
  partial — 16 MB at most — of spare room for a moment. A store within one chunk of full can
  therefore still refuse a write that would have fitted afterwards.
- **Caching an inline entry is a convenience; a refused write is served around.** Everything
  under `INLINE_MAX_SIZE` — including a stored mp4 — is copied into the cache before it is
  served, but nothing requires that. When the copy is refused for lack of space after eviction
  has found nothing more to drop, `serveUncached` streams the entry from the archive for that
  response alone, and the store is left untried for `FAILURE_BACKOFF_MS` so a media element
  probing a 10 MB entry with a burst of ranges does not copy 10 MB into a full store for each.
  Consequence: a package on a host that honours `Range`, or picked from disk, plays with no
  storage at all. Before this, a refused write was a 507, and the runtime's script loader —
  which waits on `load` alone — left the frame blank at `indexing` for ever, with no event.
  The one place storage is a hard requirement is a host without `Range`: the archive has to
  land whole, and a package larger than the room is refused with its size and the reason.
- **A failed extraction is recorded, not rediscovered.** The Jobs worker writes the failure into
  the entry's `ChunkMeta.error` and drops its chunks — a deflate stream cannot be resumed, and
  until the next attempt the partial chunks only hold space the rest of the package may need.
  `waitForWatermark` returns on a recorded failure, so a request gets its 507 (quota) or 500 at
  once instead of after the 15 s stall; after `FAILURE_BACKOFF_MS` the record is cleared and the
  entry tried again, because the space may have come back.
- **Bookkeeping never takes a request down.** An origin filled to the last byte refuses a
  hundred-byte write as readily as a chunk: `setMeta` therefore goes through the same eviction
  as the chunks (it once assumed tiny meant exempt), `touchPackage` and the `status` update are
  best-effort, and `register` keeps an existing row when the new one does not fit — the id is a
  hash of the source, so the row names the same package.
- **The quota message carries the numbers.** Built where the write failed, in the Jobs worker,
  from `navigator.storage.estimate()` and the size that was needed — the archive's for a
  download, the entry's for an extraction — because "quota exceeded" tells nobody whether the
  package is too big for this browser or the site has merely filled up. One caveat for testing
  it: under DevTools' "simulate custom storage quota", writes fail at the simulated cap while
  `estimate().quota` keeps reporting the real one, so the message reads oddly there and a
  pre-flight check could not have helped. `tests/browser-emulated/` uses that same override through
  CDP, in a Vitest project of its own because the override is per browser profile.
- **Eviction never touches a package under a Web Lock, in any tab.** Every lock name starts with
  `h5p:<pkgId>:` (`locks.ts`): the Jobs worker holds one per download or extraction for as long
  as it writes — the job key *is* the lock name — and the element holds `playing`, shared, for as
  long as a package is loaded. `busyPackages()` reads `navigator.locks.query()` and
  `coldestIdlePackage` skips anything held, so a write in one tab or a learner mid-video in
  another survives a quota squeeze caused by a third. Both workers install the same policy through
  `installEvictionPolicy`; before that the Jobs worker — where the large writes, and so the quota
  errors, actually are — had no policy and evicted whichever cache the browser listed first.
