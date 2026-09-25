/** Version of the element/worker pair. Kept in sync with package.json by scripts/sync-h5p-assets.mjs. */
export const VERSION = '0.1.4'

/** Major version. Cache names carry it, so a major bump discards every cached package. */
export const MAJOR_VERSION = 0

/** One cache per package: `h5p-pkg-v<major>-<pkgId>`. */
export const CACHE_PREFIX = `h5p-pkg-v${MAJOR_VERSION}-`

/**
 * Chunk size for archives and extracted media: the unit of storage, and the ceiling on what one
 * read or write holds in memory. The segment window in `source.ts` is the one deliberate exception.
 */
export const CHUNK_SIZE = 8 * 1024 * 1024

/**
 * Entries at or below this size are inflated whole into the cache on first request, whatever
 * their compression method. Above it, a deflated entry goes to the Jobs worker and a stored
 * entry is sliced straight out of the source.
 */
export const INLINE_MAX_SIZE = 16 * 1024 * 1024

/**
 * Media is the exception to the rule above. A media element reads by ranges and, on first
 * contact, wants only the header; an inline entry is copied whole before its first byte is
 * served, so a 7 MB video cost 7 MB the moment the runtime created its `<video>` — and a book
 * with six of them pulled all six at boot, whether or not anyone would watch. Above this, media
 * is sliced when stored and extracted when deflated, both of which serve the head on demand.
 */
export const MEDIA_INLINE_MAX_SIZE = 1024 * 1024

/**
 * How a large span is pulled over HTTP: `SEGMENT_CONCURRENCY` ranged requests of `SEGMENT_SIZE`
 * in flight at once, emitted in order.
 *
 * One request per span is already the difference between a working player and 3,500 round trips
 * — but a single connection is often capped well below the link. Measured against one real host:
 * 2.0 MB/s on one connection, 2.6 MB/s on four, against a 3.5 MB/s link. Four is where it
 * stopped improving; eight was no better.
 *
 * The cost is memory. Segments arrive out of order and wait their turn, so up to
 * `SEGMENT_CONCURRENCY * SEGMENT_SIZE` — 16 MB — can be held at once. That is a deliberate
 * loosening of "nothing larger than one chunk in memory", and it is why the segment is 4 MB
 * rather than the 8 MB used everywhere else.
 */
export const SEGMENT_SIZE = 4 * 1024 * 1024
export const SEGMENT_CONCURRENCY = 4

/** Below this, one request is better: the overlap cannot pay back its own latency. */
export const SEGMENT_MIN_SPAN = 8 * 1024 * 1024

/** Reserved chunk-store entry name for the archive itself (chunked adapter). */
export const ARCHIVE_ENTRY = '__archive__'

/**
 * Reserved chunk-store entry name for the warm marker: its meta says the archive's inline spans
 * have been pulled into the cache, so a later load boots without asking the host.
 */
export const WARM_ENTRY = '__warm__'

/**
 * Warming: on a host that honours `Range`, the runs of the archive that hold the runtime's own
 * files — every library's scripts, styles and JSON — are pulled whole before the frame boots,
 * instead of one or two ranged requests per file while it boots. Two requests of 4 MB against
 * 156 of a few hundred bytes each, measured on one real package; on a host that answers a
 * client's requests one at a time, that was the difference between 128 s and 9 s.
 *
 * A span is a run of inline entries separated by gaps of at most `WARM_GAP`, so a large media
 * entry between two library folders splits it and is never pulled. An entry over
 * `WARM_ENTRY_MAX_SIZE` compressed is not a candidate, a span with nothing the boot reads in it is
 * not pulled, and the whole warm is capped at `WARM_MAX_BYTES`. A span that stops flowing for
 * `WARM_STALL_MS` is given up, and the frame boots against whatever landed.
 */
export const WARM_GAP = 256 * 1024
export const WARM_ENTRY_MAX_SIZE = 1024 * 1024
export const WARM_MAX_BYTES = 16 * 1024 * 1024
export const WARM_STALL_MS = 20_000

/**
 * How long the watermark may sit still before the virtual server concludes the job behind it is
 * gone. It is not a budget for the whole extraction: inflating a few hundred megabytes over a
 * network legitimately takes minutes, and a request for the tail of such an entry cannot be
 * answered before it finishes.
 */
export const COLD_ENTRY_WAIT_MS = 15_000

/**
 * How often a waiting response re-reads the watermark when no notice has arrived. Progress is
 * announced on a `BroadcastChannel` the moment it is written, so this is the fallback that keeps
 * stall detection honest, not what makes serving prompt.
 */
export const WATERMARK_POLL_MS = 500

/**
 * How long one job request suppresses the next for the same entry. A media element opens with a
 * burst of range requests that all land within milliseconds, and this is only there to keep that
 * burst from becoming a burst of messages — the real deduplication is the Jobs worker's own
 * in-flight map and its Web Lock. Keeping the window short matters: a job can die with the tab
 * that owned it, and a long window would leave the entry unserved until it expired.
 */
export const JOB_REQUEST_DEDUPE_MS = 2_000

/**
 * How long a storage failure is taken at its word. After a write has been refused for lack of
 * space, the virtual server serves inline entries straight from the archive without trying the
 * cache again, and answers a request for an entry whose extraction failed with that failure,
 * until this much time has passed — then it tries once more, because space may have come back:
 * another tab closed, a package evicted, the user cleared something. Short, so a recovery is
 * noticed; long enough that a media element probing a 10 MB entry with a burst of range requests
 * does not copy 10 MB into a full store on every one of them.
 */
export const FAILURE_BACKOFF_MS = 10_000

/**
 * How often a job announces the bytes it has taken from the network. The Service Worker's stall
 * bound watches the watermark, which cannot move until the inflate has produced its first flush;
 * on a slow or erratic host the input can flow for a good while before that. These notices are
 * how a waiter tells slow from dead. Nothing is written for them: they go on the watermark
 * channel and wake whoever is waiting on the entry.
 */
export const INPUT_LIVENESS_MS = 1_000

/**
 * How a ranged read over HTTP survives the link. A request that delivers nothing for
 * `READ_STALL_MS` is aborted and opened again from the byte it reached, as is one that fails or
 * ends early; the delay before each retry starts at `READ_RETRY_DELAY_MS` and doubles, and
 * `READ_RETRIES` consecutive attempts without a byte fail the read. The stall bound is above the
 * slowest first answer measured from a real host — 14 s, on one that serves a client's requests
 * one at a time — because a retry against such a host goes to the back of its queue. With the
 * doubling delays, a link that is dead throughout is given up after roughly a minute when the
 * requests fail at once, four when they hang.
 */
export const READ_STALL_MS = 30_000
export const READ_RETRIES = 6
export const READ_RETRY_DELAY_MS = 1_000

/** IndexedDB database and store names. */
export const DB_NAME = 'h5p-player'
export const DB_VERSION = 1
export const PACKAGES_STORE = 'packages'

/**
 * Synthetic origin for chunk-store keys. The Cache API needs absolute http(s) URLs; these are
 * never fetched, so an unresolvable TLD keeps them from ever reaching the network.
 */
export const CHUNK_KEY_ORIGIN = 'https://chunks.h5p-player.invalid/'
