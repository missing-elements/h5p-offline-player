import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ChunkStore,
  QuotaError,
  onWatermark,
  setEvictionListener,
  setEvictionPolicy
} from '../../src/shared/chunk-store'

/** The Cache API reduced to what `write` touches, with the first put optionally out of quota. */
function fakeCaches(failFirstPut: boolean) {
  const stored = new Map<string, Uint8Array>()
  let puts = 0

  const cache = {
    async put(key: string, response: Response) {
      puts += 1
      const body = new Uint8Array(await response.arrayBuffer())
      if (failFirstPut && puts === 1) throw new DOMException('full', 'QuotaExceededError')
      stored.set(key, body)
    },
    async match() {
      return undefined
    }
  }

  return {
    caches: { open: async () => cache, delete: async () => true, keys: async () => [] },
    stored,
    puts: () => puts
  }
}

const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes)

describe('ChunkStore writes', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    setEvictionPolicy(async () => null)
    setEvictionListener(() => {})
  })

  it('builds the body exactly once when the put succeeds', async () => {
    const fake = fakeCaches(false)
    vi.stubGlobal('caches', fake.caches)
    let built = 0

    await new ChunkStore('pkg').putWhole(
      'a.js',
      () => {
        built += 1
        return new Blob(['hello']).stream()
      },
      'text/javascript'
    )

    // The old path cloned the response before every attempt; for a stream body the unread
    // branch of that tee held the whole entry in memory until the put finished.
    expect(built).toBe(1)
    expect(fake.puts()).toBe(1)
    expect(text([...fake.stored.values()][0])).toBe('hello')
  })

  it('evicts and builds a fresh body for the retry', async () => {
    const fake = fakeCaches(true)
    vi.stubGlobal('caches', fake.caches)
    const evicted: string[] = []
    setEvictionPolicy(async (except) => (except === 'pkg' ? 'colder' : null))
    setEvictionListener((pkgId) => {
      evicted.push(pkgId)
    })
    let built = 0

    await new ChunkStore('pkg').putWhole(
      'a.js',
      () => {
        built += 1
        return new Blob(['hello']).stream()
      },
      'text/javascript'
    )

    expect(built).toBe(2)
    expect(evicted).toEqual(['colder'])
    expect(text([...fake.stored.values()][0])).toBe('hello')
  })

  it('retries a chunk from the one copy it took', async () => {
    const fake = fakeCaches(true)
    vi.stubGlobal('caches', fake.caches)
    setEvictionPolicy(async () => 'colder')
    const bytes = new Uint8Array([1, 2, 3, 4])

    await new ChunkStore('pkg').putChunk('content/media/a.mp4', 0, bytes)

    expect(fake.puts()).toBe(2)
    expect([...fake.stored.values()][0]).toEqual(bytes)
  })

  it('announces every watermark it writes, so a waiter need not poll for it', async () => {
    vi.stubGlobal('caches', fakeCaches(false).caches)
    const heard: unknown[] = []
    const stop = onWatermark('pkg', 'content/media/a.mp4', (meta) => heard.push(meta))

    await new ChunkStore('pkg').setMeta('content/media/a.mp4', { size: 10, available: 5, complete: false })
    await new ChunkStore('other').setMeta('content/media/a.mp4', { size: 1, available: 1, complete: true })
    await new Promise((resolve) => setTimeout(resolve, 20))
    stop()

    // Only its own entry, and heard at all: a BroadcastChannel never delivers to the object that
    // posted, which is why the announcer and the listener are two of them.
    expect(heard).toEqual([{ size: 10, available: 5, complete: false }])
  })

  it('gives up with a QuotaError when nothing is left to evict', async () => {
    vi.stubGlobal('caches', fakeCaches(true).caches)
    setEvictionPolicy(async () => null)

    await expect(
      new ChunkStore('pkg').putWhole('a.js', () => new Blob(['x']).stream(), 'text/javascript')
    ).rejects.toBeInstanceOf(QuotaError)
  })
})
