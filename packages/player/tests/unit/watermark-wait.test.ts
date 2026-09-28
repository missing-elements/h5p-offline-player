import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChunkStore, announceQueued, announceRunning } from '../../src/shared/chunk-store'
import { waitForWatermark } from '../../src/sw/watermark-wait'

/** The Cache API reduced to a map, enough for meta records to be written and read back. */
function fakeCaches() {
  const stored = new Map<string, Uint8Array<ArrayBuffer>>()
  const cache = {
    async put(key: string, response: Response) {
      stored.set(key, new Uint8Array(await response.arrayBuffer()))
    },
    async match(key: string) {
      const body = stored.get(key)
      return body ? new Response(body) : undefined
    },
    async keys() {
      return [...stored.keys()].map((key) => new Request(key))
    },
    async delete(request: Request | string) {
      return stored.delete(typeof request === 'string' ? request : request.url)
    }
  }
  return { open: async () => cache, has: async () => true, delete: async () => true, keys: async () => [] }
}

const ENTRY = 'content/videos/a.mp4'
const every = (ms: number, tick: (n: number) => void) => {
  let n = 0
  const timer = setInterval(() => tick((n += 1)), ms)
  return () => clearInterval(timer)
}

describe('waitForWatermark', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('gives up after two silent stretches, asking for the job once in between', async () => {
    vi.stubGlobal('caches', fakeCaches())
    const store = new ChunkStore('pkg')
    await store.setMeta(ENTRY, { size: 10, available: 0, complete: false })
    let asked = 0

    const result = await waitForWatermark(store, ENTRY, 1, {
      stallMs: 100,
      onStall: async () => {
        asked += 1
      }
    })

    expect(result).toBeNull()
    expect(asked).toBe(1)
  })

  it('keeps waiting while the job reports input, then serves the bytes when they land', async () => {
    vi.stubGlobal('caches', fakeCaches())
    const store = new ChunkStore('pkg')
    await store.setMeta(ENTRY, { size: 10, available: 0, complete: false })
    let asked = 0

    // The inflate has produced nothing, but the network has: a slow host, not a dead job.
    const stopInput = every(100, (n) => announceRunning('pkg', ENTRY, n * 65536))
    const landing = setTimeout(() => {
      void store.setMeta(ENTRY, { size: 10, available: 1, complete: false })
    }, 1_500)

    try {
      const result = await waitForWatermark(store, ENTRY, 1, {
        stallMs: 100,
        onStall: async () => {
          asked += 1
        }
      })
      expect(result?.available).toBe(1)
      expect(asked).toBe(0)
    } finally {
      stopInput()
      clearTimeout(landing)
    }
  })

  it('keeps waiting while the job reports itself running, even with nothing arriving', async () => {
    vi.stubGlobal('caches', fakeCaches())
    const store = new ChunkStore('pkg')
    await store.setMeta(ENTRY, { size: 10, available: 0, complete: false })
    let asked = 0

    // The link has gone quiet, and the job is riding it out: neither the watermark nor the bytes
    // taken from the network move, and the job says so every tick. That is not a dead job.
    const stopHeartbeat = every(100, () => announceRunning('pkg', ENTRY, 65536))
    const landing = setTimeout(() => {
      void store.setMeta(ENTRY, { size: 10, available: 1, complete: false })
    }, 1_500)

    try {
      const result = await waitForWatermark(store, ENTRY, 1, {
        stallMs: 100,
        onStall: async () => {
          asked += 1
        }
      })
      expect(result?.available).toBe(1)
      expect(asked).toBe(0)
    } finally {
      stopHeartbeat()
      clearTimeout(landing)
    }
  })

  it('keeps waiting while the job reports itself queued behind another', async () => {
    vi.stubGlobal('caches', fakeCaches())
    const store = new ChunkStore('pkg')
    await store.setMeta(ENTRY, { size: 10, available: 0, complete: false })
    let asked = 0

    const stopHeartbeat = every(100, () => announceQueued('pkg', ENTRY))
    const landing = setTimeout(() => {
      void store.setMeta(ENTRY, { size: 10, available: 1, complete: false })
    }, 1_500)

    try {
      const result = await waitForWatermark(store, ENTRY, 1, {
        stallMs: 100,
        onStall: async () => {
          asked += 1
        }
      })
      expect(result?.available).toBe(1)
      expect(asked).toBe(0)
    } finally {
      stopHeartbeat()
      clearTimeout(landing)
    }
  })

  it('returns at once on a queued notice when the caller can send a body that follows', async () => {
    vi.stubGlobal('caches', fakeCaches())
    const store = new ChunkStore('pkg')
    const stopHeartbeat = every(50, () => announceQueued('pkg', ENTRY))

    try {
      const started = performance.now()
      const result = await waitForWatermark(store, ENTRY, 1, { stallMs: 5_000, queuedIsEnough: true })
      expect(result).toEqual({ size: null, available: 0, complete: false })
      expect(performance.now() - started).toBeLessThan(1_000)
    } finally {
      stopHeartbeat()
    }
  })

  it('returns a recorded failure at once', async () => {
    vi.stubGlobal('caches', fakeCaches())
    const store = new ChunkStore('pkg')
    const failure = { code: 'quota' as const, message: 'full', at: Date.now() }
    await store.setMeta(ENTRY, { size: 10, available: 0, complete: false, error: failure })

    const started = performance.now()
    const result = await waitForWatermark(store, ENTRY, 1, { stallMs: 5_000 })

    expect(result?.error).toEqual(failure)
    expect(performance.now() - started).toBeLessThan(200)
  })
})
