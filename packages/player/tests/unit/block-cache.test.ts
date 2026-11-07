import { describe, expect, it } from 'vitest'
import { BlockCache } from '../../src/shared/block-cache'
import type { ByteRange } from '../../src/shared/range'

/**
 * The block cache under small HTTP reads: whole blocks fetched, each once, by contiguous run,
 * shared while on their way, bounded by use. Block size 16 here, so the arithmetic stays visible.
 */
const BLOCK = 16
const SIZE = 100
const archive = Uint8Array.from({ length: SIZE }, (_, i) => i)

function source(options: { fail?: boolean; short?: boolean } = {}) {
  const asked: ByteRange[] = []
  const waiting: Array<() => void> = []
  let held = false
  const fetchRange = async (range: ByteRange) => {
    asked.push(range)
    if (held) await new Promise<void>((resolve) => waiting.push(resolve))
    if (options.fail) throw new Error('link down')
    const end = options.short ? range.end - 1 : range.end
    return archive.slice(range.start, end + 1)
  }
  return {
    asked,
    fetchRange,
    hold: () => (held = true),
    release: () => waiting.splice(0).forEach((resolve) => resolve())
  }
}

describe('BlockCache', () => {
  it('returns exactly the bytes asked for, fetched as whole blocks', async () => {
    const cache = new BlockCache(BLOCK, 1024)
    const { asked, fetchRange } = source()

    expect(await cache.read('a', SIZE, { start: 20, end: 40 }, fetchRange)).toEqual(archive.slice(20, 41))
    expect(asked).toEqual([{ start: 16, end: 47 }])
  })

  it('asks for nothing when every block of a read is held', async () => {
    const cache = new BlockCache(BLOCK, 1024)
    const { asked, fetchRange } = source()

    await cache.read('a', SIZE, { start: 16, end: 47 }, fetchRange)
    expect(await cache.read('a', SIZE, { start: 30, end: 33 }, fetchRange)).toEqual(archive.slice(30, 34))
    expect(cache.holds('a', { start: 16, end: 47 })).toBe(true)
    expect(cache.holds('a', { start: 16, end: 48 })).toBe(false)
    expect(asked).toHaveLength(1)
  })

  it('fetches what a read is missing in one request per contiguous run', async () => {
    const cache = new BlockCache(BLOCK, 1024)
    const { asked, fetchRange } = source()

    // Block 2 held; a read of blocks 0 to 5 misses 0–1 and 3–5.
    await cache.read('a', SIZE, { start: 32, end: 32 }, fetchRange)
    asked.length = 0
    expect(await cache.read('a', SIZE, { start: 0, end: 95 }, fetchRange)).toEqual(archive.slice(0, 96))
    expect(asked).toEqual([
      { start: 0, end: 31 },
      { start: 48, end: 95 }
    ])
  })

  it('cuts a read at the end of the archive, and the last block with it', async () => {
    const cache = new BlockCache(BLOCK, 1024)
    const { asked, fetchRange } = source()

    expect(await cache.read('a', SIZE, { start: 90, end: 200 }, fetchRange)).toEqual(archive.slice(90, 100))
    expect(asked).toEqual([{ start: 80, end: 99 }])
    expect(await cache.read('a', SIZE, { start: 100, end: 110 }, fetchRange)).toEqual(new Uint8Array(0))
  })

  it('lets reads that need the same block share one fetch', async () => {
    const cache = new BlockCache(BLOCK, 1024)
    const { asked, fetchRange, hold, release } = source()

    hold()
    const first = cache.read('a', SIZE, { start: 0, end: 5 }, fetchRange)
    const second = cache.read('a', SIZE, { start: 10, end: 20 }, fetchRange)
    await Promise.resolve()
    release()

    expect(await first).toEqual(archive.slice(0, 6))
    expect(await second).toEqual(archive.slice(10, 21))
    // Block 0 once, for both; block 1 for the second read alone.
    expect(asked).toEqual([
      { start: 0, end: 15 },
      { start: 16, end: 31 }
    ])
  })

  it('keeps nothing from a fetch that failed, so the next read asks again', async () => {
    const cache = new BlockCache(BLOCK, 1024)
    const failing = source({ fail: true })

    await expect(cache.read('a', SIZE, { start: 0, end: 5 }, failing.fetchRange)).rejects.toThrow('link down')
    expect(cache.holds('a', { start: 0, end: 5 })).toBe(false)

    const working = source()
    expect(await cache.read('a', SIZE, { start: 0, end: 5 }, working.fetchRange)).toEqual(archive.slice(0, 6))
    expect(working.asked).toHaveLength(1)
  })

  it('refuses a short answer rather than keep a block that looks whole', async () => {
    const cache = new BlockCache(BLOCK, 1024)
    const { fetchRange } = source({ short: true })

    await expect(cache.read('a', SIZE, { start: 0, end: 5 }, fetchRange)).rejects.toThrow('Expected 16 bytes')
    expect(cache.holds('a', { start: 0, end: 5 })).toBe(false)
  })

  it('holds at most its bound, the least recently used block going first', async () => {
    const cache = new BlockCache(BLOCK, 3 * BLOCK)
    const { asked, fetchRange } = source()

    for (const index of [0, 1, 2]) await cache.read('a', SIZE, { start: index * BLOCK, end: index * BLOCK }, fetchRange)
    // Block 0 used again, so block 1 is now the oldest, and a fourth block evicts it.
    await cache.read('a', SIZE, { start: 0, end: 0 }, fetchRange)
    await cache.read('a', SIZE, { start: 48, end: 48 }, fetchRange)

    expect(cache.holds('a', { start: 0, end: 0 })).toBe(true)
    expect(cache.holds('a', { start: 16, end: 16 })).toBe(false)
    expect(cache.holds('a', { start: 32, end: 63 })).toBe(true)
    expect(asked).toHaveLength(4)
  })

  it('assembles a read longer than its bound from the blocks it fetched', async () => {
    const cache = new BlockCache(BLOCK, BLOCK)
    const { fetchRange } = source()

    expect(await cache.read('a', SIZE, { start: 5, end: 70 }, fetchRange)).toEqual(archive.slice(5, 71))
  })

  it('keeps the blocks of one archive apart from another', async () => {
    const cache = new BlockCache(BLOCK, 1024)
    const { asked, fetchRange } = source()

    await cache.read('a', SIZE, { start: 0, end: 5 }, fetchRange)
    await cache.read('b', SIZE, { start: 0, end: 5 }, fetchRange)
    expect(asked).toHaveLength(2)
  })

  it('forgets everything on clear', async () => {
    const cache = new BlockCache(BLOCK, 1024)
    const { asked, fetchRange } = source()

    await cache.read('a', SIZE, { start: 0, end: 5 }, fetchRange)
    cache.clear()
    await cache.read('a', SIZE, { start: 0, end: 5 }, fetchRange)
    expect(asked).toHaveLength(2)
  })
})

describe('BlockCache, kept beyond the worker (#136)', () => {
  it('gives the blocks of a key it holds among those asked for, and holds them again in a new cache', async () => {
    const first = new BlockCache(BLOCK, 1024)
    const { fetchRange } = source()
    await first.read('a', SIZE, { start: 90, end: 99 }, fetchRange)
    await first.read('a', SIZE, { start: 0, end: 3 }, fetchRange)
    // Block 6 holds 96 to 99 only: the archive ends there.
    const kept = first.blocksOf('a', [0, 3, 5, 6])
    expect(kept.map(({ index, bytes }) => [index, bytes.length])).toEqual([
      [0, 16],
      [5, 16],
      [6, 4]
    ])

    const next = new BlockCache(BLOCK, 1024)
    const later = source()
    next.seed('a', SIZE, kept)
    expect(await next.read('a', SIZE, { start: 92, end: 97 }, later.fetchRange)).toEqual(archive.slice(92, 98))
    expect(await next.read('a', SIZE, { start: 2, end: 9 }, later.fetchRange)).toEqual(archive.slice(2, 10))
    expect(later.asked).toEqual([])
  })

  it('leaves out a block of the wrong length for its place, and one it already holds', async () => {
    const cache = new BlockCache(BLOCK, 1024)
    const { asked, fetchRange } = source()
    await cache.read('a', SIZE, { start: 0, end: 3 }, fetchRange)

    cache.seed('a', SIZE, [
      // Held already: what was fetched stands.
      { index: 0, bytes: new Uint8Array(BLOCK).fill(255) },
      // Short for a whole block, and past the archive's end.
      { index: 1, bytes: archive.slice(16, 20) },
      { index: 9, bytes: new Uint8Array(BLOCK) }
    ])
    expect(await cache.read('a', SIZE, { start: 0, end: 3 }, fetchRange)).toEqual(archive.slice(0, 4))
    expect(await cache.read('a', SIZE, { start: 16, end: 19 }, fetchRange)).toEqual(archive.slice(16, 20))
    // Block 1 was fetched after all.
    expect(asked).toEqual([
      { start: 0, end: 15 },
      { start: 16, end: 31 }
    ])
  })
})
