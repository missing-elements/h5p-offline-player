import { READ_RETRIES, READ_RETRY_DELAY_MS, READ_STALL_MS } from './constants'
import { PlayerError } from './protocol'
import type { ByteRange } from './range'

/**
 * A ranged read that survives the link: a request that stops delivering for `READ_STALL_MS`, or
 * fails outright, is opened again from the byte it reached, after a delay that doubles with each
 * consecutive attempt, `READ_RETRIES` times before the read fails for good.
 *
 * Ranges are byte-addressed, which is what makes this cheap: nothing already delivered is asked
 * for twice, and the consumer — an inflate, usually, which cannot be restarted — never notices.
 * The attempt count starts over whenever bytes arrive, so a link that stalls now and then for
 * the length of a long transfer keeps going; only a link that is dead for every attempt in a row
 * fails, and then the caller records the failure rather than waiting on it.
 *
 * `open` is asked for the remaining range and given a signal that aborts a stalled attempt. It
 * throws a `PlayerError` for what cannot get better by asking again — a `404`, a `403` on an
 * expired URL — and anything else for what can: a network failure, a `503`, a reset. Only the
 * latter is retried.
 *
 * A stall is a silent *link*, not a silent request. `progress` is a counter of everything the
 * source has received on any request — the handle's `received` — and while it moves, a request
 * that has delivered nothing is left alone: a host that serves one request at a time answers the
 * segments of a span in turn, and on a slow link the ones waiting their turn can sit for longer
 * than the bound while the first is still flowing. Aborting those would only send them to the
 * back of that host's queue again.
 */
export function resilientStream(
  range: ByteRange,
  open: (range: ByteRange, signal: AbortSignal) => Promise<ReadableStream<Uint8Array>>,
  options: { progress?: () => number } = {}
): ReadableStream<Uint8Array> {
  const progress = options.progress ?? (() => 0)
  const total = range.end - range.start + 1
  let delivered = 0
  let attempt = 0
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  let controller: AbortController | null = null
  let cancelled = false

  const drop = () => {
    controller?.abort()
    void reader?.cancel().catch(() => {})
    reader = null
    controller = null
  }

  return new ReadableStream<Uint8Array>(
    {
      async pull(sink) {
        for (;;) {
          try {
            if (!reader) {
              controller = new AbortController()
              const body = await bounded(
                open({ start: range.start + delivered, end: range.end }, controller.signal),
                controller,
                progress
              )
              reader = body.getReader()
            }
            const { done, value } = await bounded(reader.read(), controller!, progress)
            if (done) {
              if (delivered >= total) {
                sink.close()
                return
              }
              // A body that ended early is a failed attempt: the rest is asked for again.
              throw new StallError(`the host closed the range after ${delivered} of ${total} bytes`)
            }
            if (value.length === 0) continue
            delivered += value.length
            attempt = 0
            sink.enqueue(value)
            return
          } catch (error) {
            drop()
            if (cancelled || error instanceof PlayerError) throw error
            if (attempt >= READ_RETRIES) {
              throw new PlayerError(
                'network',
                `Gave up reading bytes ${range.start + delivered}-${range.end} after ${attempt + 1} attempts: ${
                  error instanceof Error ? error.message : String(error)
                }`
              )
            }
            await delay(READ_RETRY_DELAY_MS * 2 ** attempt, () => cancelled)
            attempt += 1
          }
        }
      },
      async cancel() {
        cancelled = true
        drop()
      }
    },
    // Nothing is opened until something reads: a stream nobody consumes must not hold a request.
    { highWaterMark: 0 }
  )
}

class StallError extends Error {}

/**
 * The promise, unless nothing has settled it and nothing has moved `progress` within
 * `READ_STALL_MS`: then the attempt is aborted and a stall is thrown instead. Progress that moved
 * buys another bound, so a link that is alive is never read as dead, and a dead one is caught
 * within twice the bound. The aborted attempt's own rejection is swallowed — it has been
 * answered.
 */
function bounded<T>(promise: Promise<T>, controller: AbortController, progress: () => number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let seen = progress()
    let timer: ReturnType<typeof setTimeout>
    const check = () => {
      const now = progress()
      if (now !== seen) {
        seen = now
        timer = setTimeout(check, READ_STALL_MS)
        return
      }
      controller.abort()
      reject(new StallError(`no bytes from the host for ${READ_STALL_MS / 1000} s`))
    }
    timer = setTimeout(check, READ_STALL_MS)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/** Waits `ms`, checking every so often whether the read was cancelled meanwhile. */
async function delay(ms: number, cancelled: () => boolean): Promise<void> {
  const until = Date.now() + ms
  while (Date.now() < until && !cancelled()) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, until - Date.now())))
  }
}
