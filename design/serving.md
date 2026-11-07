# Serving archives

How a package's bytes reach the H5P runtime: the Service Worker's virtual file server, how a source is read (one request, several at once, small reads from a block cache, again after a stall), media that streams and media that cannot, the warm, and the index built while a download is still arriving. The code: `packages/player/src/sw/` (`mount.ts`, `package-reader.ts`, `routes.ts`, `watermark-wait.ts`), `src/shared/` (`source.ts`, `block-cache.ts`, `source-reader.ts`, `span-stream.ts`, `resilient-stream.ts`, `range.ts`, `local-header.ts`, `forward-index.ts`, `mime.ts`) and `src/jobs/warm.ts`.

## Invariants

- **`SourceReader` overrides `createReadable`.** It hands the span to `streamSpan`, which is also
  what the Jobs worker reads an entry through. Without it zip.js falls back to walking an entry
  through `readUint8Array` in 64 kB steps. Over a picked `File` each step is a free `slice()`;
  over HTTP each one is a request, and a 218 MB video meant roughly 3,500 round trips to the
  origin — slow enough to look like a hang and enough to get throttled. One ranged request covers
  the span. This is the main reason a large package behaved completely differently from disk and
  from a URL.
- **A large span over HTTP is then pulled by several connections at once.** One request per span
  is necessary but not sufficient: plenty of hosts cap a single connection well below the link.
  `segmentedStream` runs `SEGMENT_CONCURRENCY` ranged requests of `SEGMENT_SIZE` and emits them in
  order — download parallel, inflate serial, because a deflate stream has to be fed from the
  front. Measured against a server capping each connection at 4 MB/s, a 42 MB entry went from
  10.7 s to 3.1 s. Against one real host the gain was 1.28x, because that link was already near
  its own ceiling, so expect anything between the two and nothing at all when the bottleneck is
  the last mile. Before reaching for something cleverer, measure which of the two limits you are
  against: `curl -o /dev/null -w '%{speed_download}'` on one connection versus four parallel
  ranges settles it in seconds.
  A rolling window, not "split the span into N parts": splitting a 230 MB span four ways would
  leave three 57 MB quarters in memory waiting their turn. The window keeps at most
  `SEGMENT_CONCURRENCY * SEGMENT_SIZE` — 16 MB — outstanding for a span of any size, which is a
  deliberate loosening of the one-chunk-in-memory rule and the reason the segment is 4 MB rather
  than the 8 MB used elsewhere. It applies only to `range-http`: a picked file and an archive
  already in the chunk store are local reads, where splitting costs buffering and buys nothing.
  **The first segment streams, and the others open only once it flows.** Handing a segment over
  whole meant the inflate saw nothing until 4 MB had landed, and on a link that is itself the
  limit the four connections shared it, so the first byte of output waited for roughly 16 MB of
  transfer. Measured with a 40 MB deflated video at 4 Mbit/s: 34 s to the first extracted byte,
  past the stall bound, so the media request got a 503 for a job that was perfectly healthy; a
  real 93 MB package from a host with half-second latency took 8.6 s on a fast link. `Segment`
  keeps a request's bytes as they arrive and the consumer follows it live when its turn comes,
  and the window fills only after the first byte, which costs a per-connection-capped host one
  round trip and nothing else. Same 40 MB at 4 Mbit/s now: first byte in under two seconds.
- **Small reads over HTTP go through a block cache, and a rebuilt reader finds it; with a validator, so does a worker started again.** zip.js reads
  an index in pieces, one after another: 65,557 bytes from the end to find the end-of-central-
  directory record, then the directory — which in a package of a few hundred entries lies inside
  those same bytes — then each entry's 30-byte local header, its extra field when it has one, and
  its data. Over HTTP every piece was a request, and the reader the Service Worker builds again
  after `attach-libraries` — on every load that names the pack, since the pack attaches its newer
  parts — read them all again. Measured on 2026-11-04 with the demo's 1.5 MB quiz from a Lovable
  site (Cloudflare in front) and from Vercel: fourteen ranged requests to `ready`, thirteen of them
  small and in sequence at 0.2–0.4 s each, about 2.4 s of a 5.5 s first load; an archive zip.js
  wrote, with extra fields, paid three requests an entry (#133). So `RangeHttpHandle.read` takes a
  range of at most `BLOCK_CACHE_MAX_READ` from a `BlockCache`, pdf.js's design
  (`ChunkedStreamManager`): blocks of `BLOCK_SIZE`, 64 kB, aligned from the start of the archive,
  the missing ones fetched in one request per contiguous run, each fetched once and shared while
  on its way, at most `BLOCK_CACHE_MAX_BYTES` (4 MB) held per worker, the least recently used going
  first. `stream` serves a range of at most one block from it too, and a longer one the cache holds
  whole, since zip.js streams an entry's data right after reading its header; anything else
  streams from the network as before, so media never passes through the cache. And
  `PackageReader.inflate` pulls a small entry's header and data in one read before zip.js reads
  them in pieces (`blocksFor`). The cache is one per worker, made on first use so the element's
  bundle does not carry it, keyed by the archive's URL, validator and
  size — the package id's ingredients — so the new handle a rebuilt reader opens finds the blocks
  the first one fetched; it dies with the worker, but for the blocks an index was read from, and
  it is never authority. The quiz now costs
  four: the probe, the tail, the head and the warm. Two things left out on purpose, by the owner's
  decision the same day: a whole-file download below a size, which with the cache saves one
  request and needs a threshold; and rules per content type for what to fetch first, which would
  tie the player to the libraries. `tests/unit/block-cache.test.ts` pins the cache,
  `tests/unit/range-http-handle.test.ts` a real archive's index over a host that honours `Range`,
  and `tests/browser/range-requests.test.ts` counts what a load costs at `/counted/`, a host that
  writes down every request it takes.

  The blocks an index was read from outlive the worker (2026-11-07, #136). Chromium stops an idle
  worker after about thirty seconds, so the usual revisit found the cache empty and read the tail
  and the head again, one after the other, before the worker answered anything. Measured on the
  demo's quiz from a host paced to 1 MB/s with 100 ms on every request, the worker stopped
  through CDP between the loads: a reload took four requests and was ready at 0.64 s. Now, at the
  end of each `index` of a whole reader over HTTP, `keepIndexBlocks` writes the blocks that
  reader's small reads went through (`blocksReadBy`: the index, `content.json`, whatever the load
  read before the boot; the player names no file) into the package's cache, with the validator
  and the size they were read under. `openReader` puts them back (`seedBlocks`) before zip.js
  opens the archive, when both still match, and the same reload is the probe alone, ready at
  0.21 s. Only with a validator: without one, an archive republished at the same URL keeps its
  package id, and old blocks would send zip.js to the old offsets, so such a host reads the index
  again. A copy that is missing, cut short or of the wrong length is read around, never trusted
  (`BlockCache.seed` checks each block's length for its place), and it goes with the package's
  cache when that is evicted. The bytes are kept rather than a parsed index, so zip.js stays the
  only parser, and the price is one Cache API read in place of a round trip.
  `tests/browser-emulated/worker-stopped.test.ts` stops the worker and counts the reload's
  requests at `/counted/` with an `ETag` and without.
- **Waiting on the watermark is bounded by a stall, not by a wall clock.** Inflating a few hundred
  megabytes over a network legitimately takes minutes, and a request for the *tail* of such an
  entry cannot be answered until it finishes: an mp4 whose `moov` index sits at the end — common,
  since faststart is not the default — is undecodable until then, and extraction only runs
  forward. So a range beginning past the watermark is answered in full with a body that follows
  the extraction, and a request with no `Range` header gets a `200` of the true length the same
  way. Only a watermark that stops moving, twice, gives up — and **a running job counts as
  movement**: the Jobs worker announces every job it is running every `INPUT_LIVENESS_MS` on the
  watermark channel (`announceRunning`, nothing written, the bytes taken from the network riding
  along), and `waitForWatermark` resets its stall clock on each, so neither a slow host nor a
  silent one can make a live job look dead. The bound is for a job that died with its tab. It
  once counted only bytes taken from the network, and thirty silent seconds on a live link were
  enough to end a media element's response for good — the next invariant. The first flush is
  256 kB, not 1 MB, for a related reason: it is what the opening probe waits on.
- **A ranged read survives the link, and a body the server gives up on ends short.** Reproduced
  on 2026-09-25 with a 27.8 MB deflated, non-faststart mp4 from a local host paced at 1 MB/s: the
  host went silent for 40 s during the extraction, and 31 s in, the media element's response —
  its body following the extraction — was errored, Chrome reported `net::ERR_ABORTED`, and the
  `<video>` went to `MEDIA_ERR_SRC_NOT_SUPPORTED`, "Format error", Interactive Video's own
  handler throwing on the way and leaving its play icon on. A media element never asks again
  after that. The extraction, alive throughout, finished a minute later, which is why a reload
  played from cache. A host that dropped the connection did the same by a shorter path: the
  fetch rejected, the job failed, same error. Three things now hold. Every request
  `RangeHttpHandle` makes — a span for `stream`, the blocks behind `read` — is a
  `resilientStream`: a request that delivers nothing for
  `READ_STALL_MS`, fails, or ends early is opened again from the byte it reached, after a delay
  that doubles from `READ_RETRY_DELAY_MS`, and `READ_RETRIES` consecutive attempts without a byte
  fail it; the count starts over whenever bytes arrive, so a link that stalls now and then over a
  long transfer keeps going. The stall is a silent *link*, measured on the handle's `received`
  across every request of the archive, not a silent request: a host that serves one request at a
  time answers a span's segments in turn, and on a slow link the ones waiting their turn sit for
  longer than the bound while the first still flows — aborting those would only send them to the
  back of that host's queue. A `PlayerError` from the request is final — a 404, a 403 on an
  expired URL — and `TRANSIENT_STATUSES` are what a host answers when it, not the request, is the
  problem for now. `readRange` ends the body with `close()` rather than `error()` when its wait
  gives up: measured in the same setup, Chrome then asks for the rest, as it does after the
  shorter `206` a partly extracted entry gets, and played 22 s after the host came back; an
  errored body it never follows up. And a body that stays open for as long as the transfer takes
  is fine in Chromium — 6.5 minutes on one tail request at 50 kB/s, measured — so no wall clock
  is needed there; in Firefox it needs the next invariant. `/stalling/<fixture>?rate=` on the dev
  server is a host with an outage switch; `tests/browser/stalling-host.test.ts` runs an extraction
  across a silent link and across a reset one and expects the tail to arrive, and
  `tests/unit/resilient-stream.test.ts` pins the retry policy. Not covered: the archive download
  from a host without `Range`, which is a plain `GET` with nothing to resume by; a silent link there
  still ends in a 503 from `awaitEntry`. Left so on purpose (2026-10-10): plain-`GET` hosts are
  supported as they are, not invested in.
- **A body that streams holds its fetch event open.** Firefox stops a Service Worker thirty seconds
  after its last event, whatever it is still sending: measured on 2026-10-13, a request for an
  entry's tail, waiting on an extraction across a silent host, ended at 30 s as a `206` with none of
  its bytes, where Chromium delivered all of them once the host was back, at 49 s. So every response
  the virtual server gives goes through `keptAlive` in `mount.ts`: its body is passed through a
  stream that tells when it has ended, and `event.waitUntil` holds the event until then — called
  inside the `respondWith` promise, while the event may still be extended. Bounded by
  `STREAM_KEEPALIVE_MS` (four minutes), because Chromium ends an event that runs past five, as does
  Firefox (`dom.serviceWorkers.idle_extended_timeout`; the thirty seconds are its `idle_timeout`),
  while Chromium keeps a worker alive for a body on its own — so a body that outlasts the bound has
  another thirty seconds in Firefox and goes on in Chromium as before. This is not the long work the
  hard constraints keep out of the worker: nothing runs, the event is only kept from being declared
  idle. Firefox differs in one more way the tests had to learn: it hands the page a worker's
  response headers only with the first bytes of the body, so a tail request past the watermark has
  no headers until the extraction reaches it, where Chromium has them at once. Whether a media
  element in Firefox waits that long without giving up is not measured. `stalling-host.test.ts`
  starts its outages while the tail request is still pending for that reason, and fails in Firefox
  without the keep-alive.
- **Some video cannot be streamed at all, and `preload` is the only lever.** Progressive serving
  assumes the player can use the front of a file. Two package properties together break that: the
  mp4 is deflated in the zip, so no `Range` reaches a byte without the whole stream before it, and
  the mp4 is not faststart, so its `moov` index is the last few kilobytes and nothing decodes
  until the final byte. A real example measured here — a 237 MB package from sodix.de — has both:
  a 220 MB mp4 deflated at ratio 0.991 (the packager compressed an already-compressed file for a
  0.9% saving) whose `moov` sits behind a 230 MB `mdat`. Three escape routes were probed near the
  end of that stream and none opened: the last 2 MB hold no chain of stored blocks to skip
  through, there are no `00 00 FF FF` markers at head, middle or tail, and so nothing offers pako
  or zlib a byte-aligned boundary to re-enter at. Read that scan for no more than it says: `00 00
  FF FF` is an *empty* stored block, so its absence proves only that the compressor never called
  `Z_SYNC_FLUSH`, and an ordinary stored block is marked by `BTYPE=00` in a 3-bit header that can
  only be found by walking the chain from the start. It is not evidence that the whole stream is
  Huffman-coded, and it does not need to be: every compressed byte crosses the network either
  way, which is the thing that actually costs. Inflation is not the cost either — native `DecompressionStream` runs at 625 MB/s,
  so 220 MB inflates in under a second against roughly two minutes of network. The wait is the
  transfer, it is genuinely required, and the only thing left is to start it earlier. That is what
  `preload="auto"` does. What remains theoretically possible is deflate resynchronisation —
  brute-force a block boundary near the end, decode forward, discard the first 32 kB as
  window-contaminated, recover `moov`, and serve a synthesized faststart file — which needs a
  hand-written bit-level inflate and is not worth it for one badly built zip. The other cost of a deflated
  video — the whole of it is pulled once anything touches it, watched or not — has a design and
  no code yet: demand-paced extraction, under *Not built yet*.
- **Prefetch waits for `ready`, runs one entry at a time, and is off by default.** Not at index
  time: those bytes would compete with the archive reads that boot the runtime and make the player
  itself slower to appear. Not in parallel: two concurrent extractions just halve the rate of
  whichever video the learner reaches first. Archive order rather than largest first, because the
  order a packager wrote entries in tracks the order content uses them better than size does. Off
  by default because it spends a learner's bandwidth on media they may never reach — the same
  reasoning that keeps `libraries` off. `PackageReader.prefetchable()` names the candidates and
  they ride back on the `indexed` reply, so no extra round trip.
- **The cache is never the authority on size.** An entry's real size comes from the zip central
  directory, so the virtual server can answer with the correct total length while only a prefix
  exists. That is what lets a cold video start playing.
- **Every response needs a `Content-Type`.** A zip records none. Browsers ignore a stylesheet that
  is not `text/css`, and Safari refuses media served as `application/octet-stream`.
- **`RangeHttpHandle.read` slices a `200` body as it flows, like `stream` always did.** A host
  classified `range-http` answered `206` once, which is not a promise it always will; buffering a
  whole-archive `200` to take a slice held the whole file, and under `segmentedStream` four of
  them at once.

- **The archive's size never comes from a plain `GET`.** When a host does not expose
  `Content-Range`, the probe measures the archive with `Range: bytes=0-` and reads `Content-Length`
  off the `206`, and the Jobs worker's download trusts that size over the `Content-Length` of its
  own plain `GET`. A host that compresses the archive on the way out — GitHub Pages gzips
  `application/octet-stream` — answers a plain `GET` with the gzipped copy's length, and
  `Content-Encoding` is not readable cross-origin either, so nothing marks the number as wrong: an
  84.6 MB package measured 84.4 MB, and zip.js searched for the end of the central directory
  275 kB short of it — "Could not read the archive index" within a second. Chromium, Firefox and
  WebKit all send `Accept-Encoding: identity` on any request carrying a `Range` header, which is
  also why the ranged reads themselves were right all along. A suffix range (`bytes=-22`, the
  end-of-central-directory record without knowing the size) is not an alternative: it is not a
  simple range in the Fetch spec's sense, so it triggers a preflight that a static host does not
  answer, and the fetch fails. `/compressing/<fixture>` on the dev server is that host, gzip
  applied to ranges too when the request accepts it; `tests/browser/compressing-host.test.ts`
  pins the browser behaviour the probe depends on, and `tests/unit/source-probe.test.ts` covers
  the fallback with CORS-filtered headers.
- **On a host that honours `Range`, the libraries `h5p.json` declares are pulled whole before the frame boots.** The
  runtime reads them exhaustively at boot — every `library.json`, script and stylesheet — and an
  inline entry read on demand cost two ranged requests, the 30-byte local header and then the
  data (one since the block cache, or none when its block is already held). Measured against a real host (nginx in front of a store, `stream.dev.mkis.fwu.de`): a
  90 MB package with 53 libraries took 136 s to `ready`, 128 of them in 156 requests for 0.54 MB,
  because that host answers one client's requests roughly one at a time — eight small ranges
  fired together took 4.8 to 14 s each, the same eight in sequence 0.5 to 0.7 s. Its non-media
  entries lay in two runs, 3.85 MB and 0.16 MB, which one request each pulled in 6.5 s and 1.0 s.
  So `PackageReader.warmSpans()` names those runs — small inline entries that are not media,
  coalesced across gaps of at most `WARM_GAP`, a span kept only if it holds something the boot
  reads, the total capped at `WARM_MAX_BYTES` — and they ride back on the `indexed` reply; the
  element hands them to the Jobs worker as a `warm` job and boots the frame when it is done.
  `warm.ts` walks each span by the offsets the central directory gave, inflates each entry and
  `putWhole`s it, then writes a marker under `WARM_ENTRY` so the next load skips it. The spans
  travel in the reply rather than being recomputed in the Jobs worker because that worker has no
  index of its own, and building one cost another round of index requests — five seconds on
  that host — back when it did. Three rules:
  it never fails a load (no room, a stalled span, a header that is not where the index said —
  the frame boots against whatever landed, and the virtual server serves the rest on demand);
  only a warm that landed everything writes the marker; and it runs for `range-http` only, since
  a picked file and a downloaded archive are local reads. `tests/unit/warm.test.ts` builds a real
  archive with a video between two library folders and checks the split, the walk and the marker;
  `tests/browser/warm.test.ts` checks the phase, the cache and the skip on a second load.

  Only the library folders `h5p.json` declares are candidates, beside the root and `content/`
  (`declaredFolders`, 2026-11-07, #148). An export lists there every library its content plays,
  flattened, and none it carries only for an H5P site's upload check: the editor libraries, and an
  older minor one of them names, which h5p-author's packages carry too since #146. Until then the
  warm pulled them with the rest. Across the 88 real packages of the local corpus, 70 carry such
  folders, and the warm came to 231 MB against 149 MB for what plays; a platform's Course
  Presentation pulled 5.3 MB where its content needs 1.8. In all 88, `h5p.json` declared every
  folder the dependency walk reaches, so nothing has to be read to decide; a folder left out is
  served on demand if anything asks for it, as every file was before the warm, and an `h5p.json`
  that declares nothing the archive carries keeps every folder in. Measured from a host paced to
  1 MB/s: the demo's video ready at 1.9 s where it took 4.5 (1.9 before #146 added its editors),
  that Course Presentation at 2.2 s where it took 5.8, an Interactive Video export at 2.5 s where it
  took 4.4. Leaving a folder out between two that play can split a run, a request more each: the
  Interactive Video's load went from five requests to nine, a Column export's from eight to
  thirteen, and with 100 ms added to every request and the link at 10 MB/s the two were still
  ready sooner, 1.4 s for 1.6 and 1.7 s for 2.5.
  The pack's plan reads only the folders the content reaches, for the same reason: what the warm
  leaves out would otherwise be read one request at a time (*The refresh rule* in libraries.md).
  `tests/browser/range-requests.test.ts` checks that `installable.h5p`'s run is never asked for,
  with the pack offered and without.
- **Media is held to a lower inline bar than everything else.** `INLINE_MAX_SIZE` is 16 MB, and an
  inline entry is copied whole before its first byte is served; a media element wants the head
  first and the rest by ranges. So `chooseStrategy` puts media over `MEDIA_INLINE_MAX_SIZE`
  (1 MB) on the slice path when stored and the chunked path when deflated, where the head is
  served on demand and a deflated one takes its turn in the queue. Before this, the same book's
  three smaller videos, 5 to 10 MB each, were inflated whole by the Service Worker on their
  probes, in parallel with the three extractions, for chapters nobody had opened.
- **An inline entry is inflated once per burst.** `cacheInline` keeps a per-instance map of
  writes in flight; concurrent requests for the same cold file join the first one instead of each
  inflating and racing on the same `cache.put`. The map dies with the worker, which only costs
  the dedupe.
- **An unknown `pkgId` is a 404 on every route.** `UnknownPackageError` is what `openReader`
  throws for a package the table does not know, or a load key its row does not hold, and
  `handleFetch` maps it before the generic `bad-archive` → 422.
- **An archive from a host that ignores `Range` is indexed as it downloads.** The central
  directory is at the end, so a download that has to complete before it can be read holds every
  entry hostage — including the libraries that arrived in the first second. `LocalHeaderScanner`
  (`forward-index.ts`) walks the local headers off the same bytes on their way to the chunk store;
  the Jobs worker publishes what it has found as a `ForwardIndexSnapshot` beside the watermark,
  announced on the same channel; the Service Worker builds a `partial` `PackageReader` from it and
  serves from that until the archive is whole, when a reader from the central directory — the
  authority — replaces it. Three rules keep a partial index honest:
  - **An entry is in the snapshot only once its bytes have all arrived.** Recording it off its
    header alone would let the worker reach for data that is not there yet.
  - **The element boots only when `bootReady()` holds:** `h5p.json` has arrived and every
    dependency it declares resolves to a folder that is present *and finished arriving* — a
    folder has finished once an entry of a later folder has arrived, since exporters write a
    folder's files together. An index the scanner had to give up on never says ready.
  - **On a partial reader a miss waits; it does not 404.** A 404 is taken as a fact about the
    package: by the worker's walk, by the boot script's upgrade lookup, and by h5p-standalone
    before #37. `awaitEntry` wakes on each index publish and each move of the archive
    watermark until the entry appears, the reader can prove it absent (`provablyAbsent`: its folder
    has finished arriving, or it is the versioned probe on a library the package keeps
    unversioned), or the real index answers. The stall bound watches the *archive* watermark: the
    index stands still for the whole of a large entry while bytes keep coming, and a healthy
    200 MB download must not read as a dead one. A stall answers 503, never a wrong 404.

  Two facts about real packages shape this, both measured, not assumed. A PHP-style export
  (`boardgame.h5p`) puts libraries before content and uses no data descriptors: it boots after
  about a hundred entries with 40 MB of media still to come. An h5p.com export
  (`interactive-video-2-618.h5p`) sets bit 3 on *every* entry — sizes after the data, all stored —
  so a walker that trusts local-header sizes gets nothing from it; the scanner resolves those by
  finding the descriptor signature and accepting it only where its compressed size equals the
  bytes seen since the data began. A library is looked for under the *versioned* folder name
  first, so on a modern export the boot never issues the one 404 a partial index would have to
  wait on.
  `zip.js`'s own `ZipReaderStream` is not an option here: it buffers the entire input into a Blob
  and then reads the central directory from the end (`getEntriesGenerator` → `streamToBlob`) —
  a streaming surface over whole-archive buffering.
