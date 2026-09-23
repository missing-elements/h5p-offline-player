import { describe, expect, it } from 'vitest'
import { createChunkWriter } from '../../src/jobs/chunk-writer'
import type { ChunkMeta, ChunkStore } from '../../src/shared/chunk-store'

const MB = 1024 * 1024

/** A store that remembers what was actually put, so the watermark can be checked against it. */
function recordingStore() {
  const held = new Map<number, number>()
  const metas: ChunkMeta[] = []

  const store = {
    putChunk: async (_entry: string, index: number, bytes: Uint8Array) => {
      held.set(index, bytes.length)
    },
    setMeta: async (_entry: string, meta: ChunkMeta) => {
      metas.push(meta)
    }
  } as unknown as ChunkStore

  const bytesInStore = () => [...held.values()].reduce((sum, length) => sum + length, 0)
  return { store, metas, bytesInStore }
}

describe('createChunkWriter', () => {
  it('never publishes a watermark past the bytes actually in the store', async () => {
    const { store, metas, bytesInStore } = recordingStore()
    const writer = createChunkWriter({ store, entry: 'content/videos/a.mp4', totalSize: 10 * MB }).getWriter()

    // 1 MB crosses the first partial-flush threshold and is stored; the next half only buffers.
    await writer.write(new Uint8Array(MB))
    await writer.write(new Uint8Array(MB / 2))
    expect(bytesInStore()).toBe(MB)

    await writer.abort(new Error('tab closed'))

    // The abort used to publish `written` — 1.5 MB — over a store holding 1 MB. A reader that
    // trusted that got a short body.
    const last = metas.at(-1)!
    expect(last.available).toBe(bytesInStore())
    expect(last.complete).toBe(false)
  })

  it('stores the partial tail and marks the entry complete on close', async () => {
    const { store, metas, bytesInStore } = recordingStore()
    const writer = createChunkWriter({ store, entry: 'content/videos/a.mp4', totalSize: null }).getWriter()

    await writer.write(new Uint8Array(MB + MB / 2))
    await writer.close()

    expect(bytesInStore()).toBe(MB + MB / 2)
    expect(metas.at(-1)).toEqual({ size: MB + MB / 2, available: MB + MB / 2, complete: true })
  })
})
