import { COLD_ENTRY_WAIT_MS, WATERMARK_POLL_MS } from '../shared/constants'
import { onWatermark, type ChunkMeta, type ChunkStore } from '../shared/chunk-store'

/**
 * Waits until the entry has at least `needed` bytes, is complete, or carries a recorded failure.
 *
 * The bound is a stall, not a wall clock: extraction of a large entry legitimately takes minutes,
 * and a request for the tail of a 220 MB video cannot be answered until it finishes. What must
 * not happen is waiting on a job that has died with the tab that owned it, so the job is expected
 * to keep showing progress — when it stops, the job is asked for again, and only a second silent
 * stretch gives up.
 *
 * Progress is the watermark moving, and it is also the job saying it is there. The Jobs worker
 * announces a running job every second whether or not bytes are arriving, and a queued one the
 * same way, and either resets the clock: the bound is for a job that died with its tab, not for a
 * link that has gone quiet. It once counted only bytes taken from the network, and thirty
 * silent seconds on a live job — a host hiccup, a phone changing networks — ended the media
 * element's response with an error it never recovers from, while the extraction went on to
 * finish. How long a silent link is tolerated is the job's own business (`resilientStream`),
 * and a job that gives up records a failure, which this returns at once.
 */
export async function waitForWatermark(
  store: ChunkStore,
  entry: string,
  needed: number,
  options: {
    stallMs?: number
    onStall?: () => Promise<void>
    /**
     * Return as soon as the job reports itself queued. For a response that can carry a body
     * which follows the extraction, a queued job is reason enough to send the headers now — the
     * bytes come when its turn does — rather than hold the request open until its first flush,
     * which behind a long queue could be minutes, longer than a fetch event may stay unanswered.
     */
    queuedIsEnough?: boolean
  } = {}
): Promise<ChunkMeta | null> {
  const stallMs = options.stallMs ?? COLD_ENTRY_WAIT_MS
  let lastAvailable = -1
  let lastReceived = -1
  let lastAdvanceAt = Date.now()
  let askedAgain = false
  let queued = false

  // Woken by the writer's notice when there is one; the poll is the fallback that keeps stall
  // detection working when there is not.
  let wake: (() => void) | null = null
  const stop = onWatermark(store.pkgId, entry, (notice) => {
    if (notice.running || (notice.received !== undefined && notice.received !== lastReceived)) {
      lastReceived = notice.received ?? lastReceived
      lastAdvanceAt = Date.now()
      askedAgain = false
    }
    // Queued is alive: extractions run one at a time, and an entry waiting its turn behind a
    // long video must not read as a dead job.
    if (notice.queued) {
      queued = true
      lastAdvanceAt = Date.now()
      askedAgain = false
    }
    wake?.()
  })

  try {
    for (;;) {
      const meta = await store.getMeta(entry)
      if (meta && (meta.available >= needed || meta.complete)) return meta
      // A recorded failure is an answer too; the caller decides what to serve.
      if (meta?.error) return meta
      if (queued && options.queuedIsEnough) return meta ?? { size: null, available: 0, complete: false }

      const available = meta?.available ?? 0
      if (available !== lastAvailable) {
        lastAvailable = available
        lastAdvanceAt = Date.now()
        askedAgain = false
      } else if (Date.now() - lastAdvanceAt >= stallMs) {
        if (askedAgain || !options.onStall) return null
        await options.onStall()
        askedAgain = true
        lastAdvanceAt = Date.now()
      }

      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, WATERMARK_POLL_MS)
        wake = () => {
          clearTimeout(timer)
          resolve()
        }
      })
      wake = null
    }
  } finally {
    stop()
  }
}
