import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChunkStore } from '../../src/shared/chunk-store'
import { CHUNK_SIZE } from '../../src/shared/constants'

/** The Cache API reduced to what a read touches: what was put comes back as a streaming Response. */
function fakeCaches() {
  const stored = new Map<string, Uint8Array<ArrayBuffer>>()
  const cache = {
    async put(key: string, response: Response) {
      stored.set(key, new Uint8Array(await response.arrayBuffer()))
    },
    async match(key: string) {
      const bytes = stored.get(key)
      return bytes ? new Response(bytes) : undefined
    }
  }
  return { open: async () => cache, delete: async () => true, keys: async () => [] }
}

const collect = async (stream: ReadableStream<Uint8Array>) =>
  new Uint8Array(await new Response(stream).arrayBuffer())

describe('ChunkStore.readRange', () => {
  afterEach(() => vi.unstubAllGlobals())

  async function storeWithTwoChunks() {
    vi.stubGlobal('caches', fakeCaches())
    const store = new ChunkStore('pkg')
    const first = new Uint8Array(CHUNK_SIZE).map((_, i) => i % 251)
    const second = new Uint8Array(1000).map((_, i) => (i * 7) % 251)
    await store.putChunk('e', 0, first)
    await store.putChunk('e', 1, second)
    return { store, first, second }
  }

  it('serves a range inside one chunk', async () => {
    const { store, first } = await storeWithTwoChunks()
    expect(await collect(store.readRange('e', { start: 100, end: 199 }))).toEqual(first.subarray(100, 200))
  })

  it('serves a range that spans a chunk boundary, byte for byte', async () => {
    const { store, first, second } = await storeWithTwoChunks()
    const body = await collect(store.readRange('e', { start: CHUNK_SIZE - 10, end: CHUNK_SIZE + 9 }))
    expect(body).toEqual(new Uint8Array([...first.subarray(CHUNK_SIZE - 10), ...second.subarray(0, 10)]))
  })

  it('serves a short tail chunk whole when the range runs to the end of it', async () => {
    const { store, second } = await storeWithTwoChunks()
    expect(await collect(store.readRange('e', { start: CHUNK_SIZE, end: CHUNK_SIZE + 999 }))).toEqual(second)
  })

  it('errors on a chunk that is not there', async () => {
    const { store } = await storeWithTwoChunks()
    await expect(collect(store.readRange('e', { start: 2 * CHUNK_SIZE, end: 2 * CHUNK_SIZE + 9 }))).rejects.toThrow(
      /Missing chunk 2/
    )
  })

  it('asks before each chunk and errors when told the extraction stalled', async () => {
    const { store, first } = await storeWithTwoChunks()
    const asked: number[] = []
    const waitFor = async (bytes: number) => {
      asked.push(bytes)
      return bytes <= CHUNK_SIZE
    }

    await expect(
      collect(store.readRange('e', { start: CHUNK_SIZE - 10, end: CHUNK_SIZE + 9 }, waitFor))
    ).rejects.toThrow(/stalled/)
    expect(asked).toEqual([CHUNK_SIZE, CHUNK_SIZE + 10])

    // Asked for the first chunk only, it serves it.
    expect(await collect(store.readRange('e', { start: 0, end: 9 }, waitFor))).toEqual(first.subarray(0, 10))
  })
})
