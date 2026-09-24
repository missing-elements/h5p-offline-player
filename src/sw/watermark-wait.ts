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
 * Progress is two things. The watermark moving is the obvious one. The other is input: the Jobs
 * worker announces the bytes it has taken from the network, and those count too, because on a
 * slow or erratic host the inflate can be starved for longer than the stall bound before it has
 * produced its first flush, while the job is perfectly alive. Measured against a 93 MB deflated
 * video on a host with half-second latency, the first byte of output took 8.6 s on a fast link
 * and past 30 s on a 4 Mbit/s one — and the old bound read the second as a dead job.
 */
export async function waitForWatermark(
  store: ChunkStore,
  entry: string,
  needed: number,
  options: { stallMs?: number; onStall?: () => Promise<void> } = {}
): Promise<ChunkMeta | null> {
  const stallMs = options.stallMs ?? COLD_ENTRY_WAIT_MS
  let lastAvailable = -1
  let lastReceived = -1
  let lastAdvanceAt = Date.now()
  let askedAgain = false

  // Woken by the writer's notice when there is one; the poll is the fallback that keeps stall
  // detection working when there is not.
  let wake: (() => void) | null = null
  const stop = onWatermark(store.pkgId, entry, (notice) => {
    if (notice.received !== undefined && notice.received !== lastReceived) {
      lastReceived = notice.received
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
