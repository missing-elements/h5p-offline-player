import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ChunkStore,
  FORWARD_INDEX_ENTRY,
  QuotaError,
  cacheNameFor,
  onWatermark,
  setEvictionListener,
  setEvictionPolicy
} from '../../src/shared/chunk-store'

/**
 * The Cache API reduced to what the store touches: named caches with `put`, `match`, `keys` and
 * `delete`, and the first put optionally out of quota. `events` records every deletion in the
 * order it happened, which is what the eviction test is about.
 */
function fakeCaches(failFirstPut: boolean) {
  const stores = new Map<string, Map<string, Uint8Array<ArrayBuffer>>>()
  const handles = new Map<string, ReturnType<typeof makeCache>>()
  const events: string[] = []
  let puts = 0

  const mapFor = (name: string) => {
    let stored = stores.get(name)
    if (!stored) {
      stored = new Map()
      stores.set(name, stored)
    }
    return stored
  }

  function makeCache(name: string) {
    const stored = mapFor(name)
    return {
      async put(key: string, response: Response) {
        puts += 1
        const body = new Uint8Array(await response.arrayBuffer())
        if (failFirstPut && puts === 1) throw new DOMException('full', 'QuotaExceededError')
        stored.set(key, body)
      },
      async match(key: string) {
        const body = stored.get(key)
        return body ? new Response(body) : undefined
      },
      async keys() {
        return [...stored.keys()].map((key) => new Request(key))
      },
      async delete(request: Request | string) {
        const url = typeof request === 'string' ? request : request.url
        events.push(`entry ${name} ${url}`)
        return stored.delete(url)
      }
    }
  }

  const primary = cacheNameFor('pkg')

  return {
    caches: {
      open: async (name: string = primary) => {
        let handle = handles.get(name)
        if (!handle) {
          handle = makeCache(name)
          handles.set(name, handle)
        }
        return handle
      },
      has: async (name: string) => stores.has(name),
      delete: async (name: string) => {
        events.push(`cache ${name}`)
        return stores.delete(name)
      },
      keys: async () => [...stores.keys()]
    },
    /** Puts an entry in place without going through `put`, so it does not count as an attempt. */
    seed: (name: string, key: string) => mapFor(name).set(key, new Uint8Array([1])),
    stored: mapFor(primary),
    events,
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

  it('empties the victim before deleting it, so the space is back before the retry', async () => {
    const fake = fakeCaches(true)
    vi.stubGlobal('caches', fake.caches)
    const victim = cacheNameFor('colder')
    fake.seed(victim, 'https://chunks.h5p-player.invalid/colder/whole/a.js')
    fake.seed(victim, 'https://chunks.h5p-player.invalid/colder/whole/b.js')
    setEvictionPolicy(async () => 'colder')

    await new ChunkStore('pkg').putWhole('a.js', () => new Blob(['x']).stream(), 'text/javascript')

    // Chromium keeps a deleted cache's bytes on the books until every handle to it is collected;
    // deleting its entries first is what gives the space back to the write that needed it.
    expect(fake.events).toEqual([
      `entry ${victim} https://chunks.h5p-player.invalid/colder/whole/a.js`,
      `entry ${victim} https://chunks.h5p-player.invalid/colder/whole/b.js`,
      `cache ${victim}`
    ])
    expect(fake.puts()).toBe(2)
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

  it('writes the watermark through eviction too: a full origin refuses a hundred bytes as readily as a chunk', async () => {
    const fake = fakeCaches(true)
    vi.stubGlobal('caches', fake.caches)
    const evicted: string[] = []
    setEvictionPolicy(async () => 'colder')
    setEvictionListener((pkgId) => {
      evicted.push(pkgId)
    })
    const store = new ChunkStore('pkg')

    await store.setMeta('content/media/a.mp4', { size: 10, available: 10, complete: true })

    expect(evicted).toEqual(['colder'])
    expect(await store.getMeta('content/media/a.mp4')).toEqual({ size: 10, available: 10, complete: true })
  })

  it("discards an entry's chunks and keeps its meta", async () => {
    const fake = fakeCaches(false)
    vi.stubGlobal('caches', fake.caches)
    const store = new ChunkStore('pkg')
    const failure = { code: 'quota' as const, message: 'full', at: 1 }

    await store.putChunk('content/media/a.mp4', 0, new Uint8Array([1]))
    await store.putChunk('content/media/a.mp4', 1, new Uint8Array([2]))
    await store.putChunk('content/media/b.mp4', 0, new Uint8Array([3]))
    await store.setMeta('content/media/a.mp4', { size: 2, available: 0, complete: false, error: failure })

    await store.discardChunks('content/media/a.mp4')

    expect(await store.getChunk('content/media/a.mp4', 0)).toBeUndefined()
    expect(await store.getChunk('content/media/a.mp4', 1)).toBeUndefined()
    expect(await store.getChunk('content/media/b.mp4', 0)).toEqual(new Uint8Array([3]))
    expect((await store.getMeta('content/media/a.mp4'))?.error).toEqual(failure)
  })

  it('announces every watermark it writes, so a waiter need not poll for it', async () => {
    vi.stubGlobal('caches', fakeCaches(false).caches)
    const heard: unknown[] = []
    const stop = onWatermark('pkg', 'content/media/a.mp4', (notice) => heard.push(notice.meta))

    await new ChunkStore('pkg').setMeta('content/media/a.mp4', { size: 10, available: 5, complete: false })
    await new ChunkStore('other').setMeta('content/media/a.mp4', { size: 1, available: 1, complete: true })
    await new Promise((resolve) => setTimeout(resolve, 20))
    stop()

    // Only its own entry, and heard at all: a BroadcastChannel never delivers to the object that
    // posted, which is why the announcer and the listener are two of them.
    expect(heard).toEqual([{ size: 10, available: 5, complete: false }])
  })

  it('keeps the forward index beside the archive and announces each publish of it', async () => {
    vi.stubGlobal('caches', fakeCaches(false).caches)

    const heard: unknown[] = []
    const stop = onWatermark('pkg', FORWARD_INDEX_ENTRY, (notice) => heard.push(notice.meta))
    const store = new ChunkStore('pkg')
    const snapshot = {
      entries: [{ name: 'h5p.json', directory: false, method: 8, encrypted: false, crc32: 1, compressedSize: 10, uncompressedSize: 12, headerOffset: 0, dataStart: 38 }],
      parsedTo: 48,
      done: false,
      stopped: null
    }

    await store.setForwardIndex(snapshot)
    await new Promise((resolve) => setTimeout(resolve, 20))
    stop()

    expect(await store.getForwardIndex()).toEqual(snapshot)
    expect(heard).toEqual([{ size: null, available: 48, complete: false }])
  })

  it('gives up with a QuotaError when nothing is left to evict', async () => {
    vi.stubGlobal('caches', fakeCaches(true).caches)
    setEvictionPolicy(async () => null)

    await expect(
      new ChunkStore('pkg').putWhole('a.js', () => new Blob(['x']).stream(), 'text/javascript')
    ).rejects.toBeInstanceOf(QuotaError)
  })
})
