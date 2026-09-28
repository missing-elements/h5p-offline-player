import { afterEach, describe, expect, it, vi } from 'vitest'
import { openSource } from '../../src/shared/source'

const SIZE = 64 * 1024
const archive = new Uint8Array(SIZE)
for (let i = 0; i < SIZE; i += 1) archive[i] = i % 251

const descriptor = { type: 'range-http', url: 'https://host.example/a.h5p', size: SIZE } as const
const range = { start: 2048, end: 4095 }

/** A body that reports how much of it was pulled and whether it was cancelled. */
function countingBody(bytes: Uint8Array, piece = 1024) {
  let at = 0
  let pulled = 0
  let cancelled = false

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.length) return controller.close()
      const chunk = bytes.subarray(at, Math.min(at + piece, bytes.length))
      at += chunk.length
      pulled += chunk.length
      controller.enqueue(chunk)
    },
    cancel() {
      cancelled = true
    }
  })

  return { stream, pulled: () => pulled, cancelled: () => cancelled }
}

describe('RangeHttpHandle.read', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('takes only the slice, and stops the transfer, when a host answers 200 to a Range request', async () => {
    const body = countingBody(archive)
    vi.stubGlobal('fetch', async () => new Response(body.stream, { status: 200 }))

    const handle = await openSource('pkg', descriptor)
    const bytes = await handle.read(range)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(bytes).toEqual(archive.subarray(range.start, range.end + 1))
    // The pipe ended at the slice and cancelled the body: `stream()` always worked this way, and
    // `read()` buffering the whole archive instead meant four whole archives under segmenting.
    expect(body.cancelled()).toBe(true)
    expect(body.pulled()).toBeLessThan(SIZE / 2)
  })

  it('returns a 206 body whole, since the host already cut it', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response(archive.slice(range.start, range.end + 1), { status: 206 })
    )

    const handle = await openSource('pkg', descriptor)
    expect(await handle.read(range)).toEqual(archive.subarray(range.start, range.end + 1))
  })
})
