import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { READ_RETRIES, READ_RETRY_DELAY_MS, READ_STALL_MS } from '../../src/shared/constants'
import { PlayerError } from '../../src/shared/protocol'
import type { ByteRange } from '../../src/shared/range'
import { resilientStream } from '../../src/shared/resilient-stream'

/**
 * A ranged read over a link that misbehaves. The host is a script: each request gets the next
 * behaviour in the list, and the test checks what came out and which ranges were asked for.
 */

const SOURCE = new Uint8Array(1000).map((_, i) => i % 251)
const RANGE: ByteRange = { start: 100, end: 899 }

type Behaviour = (range: ByteRange, signal: AbortSignal) => Promise<ReadableStream<Uint8Array>>

const bytes = (range: ByteRange) => SOURCE.subarray(range.start, range.end + 1)

/** The whole remaining range, in two pieces. */
const whole: Behaviour = async (range) => {
  const data = bytes(range)
  const half = Math.floor(data.length / 2)
  return new ReadableStream({
    start(controller) {
      controller.enqueue(data.subarray(0, half))
      controller.enqueue(data.subarray(half))
      controller.close()
    }
  })
}

/** `n` bytes, then silence until aborted. */
const thenHang =
  (n: number): Behaviour =>
  async (range, signal) =>
    new ReadableStream({
      start(controller) {
        if (n > 0) controller.enqueue(bytes(range).subarray(0, n))
      },
      pull() {
        return new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
        })
      }
    })

/** `n` bytes and then the end, as a host that cut the connection short. */
const thenEnd =
  (n: number): Behaviour =>
  async (range) =>
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes(range).subarray(0, n))
        controller.close()
      }
    })

/** A request that never gets its headers. */
const neverAnswers: Behaviour = (_range, signal) =>
  new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
  })

const failsWith =
  (error: unknown): Behaviour =>
  async () => {
    throw error
  }

function scriptedHost(behaviours: Behaviour[]) {
  const requests: ByteRange[] = []
  const open: Behaviour = (range, signal) => {
    requests.push(range)
    const behaviour = behaviours[Math.min(requests.length - 1, behaviours.length - 1)]
    return behaviour(range, signal)
  }
  return { open, requests }
}

/** Reads the stream to the end while the fake clock runs, so stalls and delays pass at once. */
async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  let settled = false
  const reading = new Response(stream)
    .arrayBuffer()
    .then((buffer) => new Uint8Array(buffer))
    .finally(() => {
      settled = true
    })
  // A rejection is the caller's to see; until it looks, it must not count as unhandled.
  reading.catch(() => {})
  // Each round lets the stream make what progress it can, then runs the timers it is waiting on.
  while (!settled) {
    await new Promise((resolve) => setImmediate(resolve))
    if (!settled) await vi.advanceTimersByTimeAsync(250)
  }
  return reading
}

describe('resilientStream', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }))
  afterEach(() => vi.useRealTimers())

  it('delivers a range that arrives without trouble in one request', async () => {
    const host = scriptedHost([whole])
    expect(await collect(resilientStream(RANGE, host.open))).toEqual(bytes(RANGE))
    expect(host.requests).toEqual([RANGE])
  })

  it('asks again from the byte it reached when the host goes quiet', async () => {
    const host = scriptedHost([thenHang(300), whole])
    const started = Date.now()

    expect(await collect(resilientStream(RANGE, host.open))).toEqual(bytes(RANGE))
    expect(host.requests).toEqual([RANGE, { start: 400, end: 899 }])
    // The stall bound, then the first retry delay.
    expect(Date.now() - started).toBeGreaterThanOrEqual(READ_STALL_MS + READ_RETRY_DELAY_MS)
  })

  it('treats a request that never answers as a stall', async () => {
    const host = scriptedHost([neverAnswers, whole])
    expect(await collect(resilientStream(RANGE, host.open))).toEqual(bytes(RANGE))
    expect(host.requests).toEqual([RANGE, RANGE])
  })

  it('asks for the rest when the host ends the body early', async () => {
    const host = scriptedHost([thenEnd(250), whole])
    expect(await collect(resilientStream(RANGE, host.open))).toEqual(bytes(RANGE))
    expect(host.requests).toEqual([RANGE, { start: 350, end: 899 }])
  })

  it('retries a request that fails, with a delay that doubles', async () => {
    const host = scriptedHost([failsWith(new TypeError('Failed to fetch')), failsWith(new Error('503')), whole])
    const started = Date.now()

    expect(await collect(resilientStream(RANGE, host.open))).toEqual(bytes(RANGE))
    expect(host.requests).toHaveLength(3)
    expect(Date.now() - started).toBeGreaterThanOrEqual(READ_RETRY_DELAY_MS * 3)
    expect(Date.now() - started).toBeLessThan(READ_STALL_MS)
  })

  it('gives up at once on a failure that asking again cannot fix', async () => {
    const host = scriptedHost([failsWith(new PlayerError('network', 'Range request failed with 404'))])
    await expect(collect(resilientStream(RANGE, host.open))).rejects.toThrow(/404/)
    expect(host.requests).toHaveLength(1)
  })

  it('fails after the retries are spent on a link that stays dead', async () => {
    const host = scriptedHost([failsWith(new TypeError('Failed to fetch'))])
    await expect(collect(resilientStream(RANGE, host.open))).rejects.toThrow(/Gave up reading bytes 100-899/)
    expect(host.requests).toHaveLength(READ_RETRIES + 1)
  })

  it('starts the count over whenever bytes arrive, so a link that keeps stalling still finishes', async () => {
    const stalls = READ_RETRIES * 2
    const host = scriptedHost([...Array.from({ length: stalls }, () => thenHang(40)), whole])
    expect(await collect(resilientStream(RANGE, host.open))).toEqual(bytes(RANGE))
    expect(host.requests).toHaveLength(stalls + 1)
    expect(host.requests[stalls]).toEqual({ start: 100 + 40 * stalls, end: 899 })
  })

  it('leaves a silent request alone while the link delivers elsewhere', async () => {
    // Another request of the same archive is flowing — a host serving one at a time — and stops
    // after a while. The waiting request is aborted only once the whole link has been quiet.
    const flowingUntil = Date.now() + READ_STALL_MS * 3
    const progress = () => Math.min(Date.now(), flowingUntil)
    const host = scriptedHost([neverAnswers, whole])
    const started = Date.now()

    expect(await collect(resilientStream(RANGE, host.open, { progress }))).toEqual(bytes(RANGE))
    expect(host.requests).toEqual([RANGE, RANGE])
    const retriedAt = Date.now() - started - READ_RETRY_DELAY_MS
    expect(retriedAt).toBeGreaterThanOrEqual(READ_STALL_MS * 4)
    expect(retriedAt).toBeLessThanOrEqual(READ_STALL_MS * 5 + 1_000)
  })

  it('opens nothing until it is read, and aborts the attempt in flight when cancelled', async () => {
    let aborted = false
    const host = scriptedHost([
      async (range, signal) => {
        signal.addEventListener('abort', () => {
          aborted = true
        })
        return thenHang(10)(range, signal)
      }
    ])
    const stream = resilientStream(RANGE, host.open)
    expect(host.requests).toHaveLength(0)

    const reader = stream.getReader()
    expect((await reader.read()).value).toEqual(bytes(RANGE).subarray(0, 10))
    await reader.cancel()
    expect(aborted).toBe(true)
    expect(host.requests).toHaveLength(1)
  })
})
