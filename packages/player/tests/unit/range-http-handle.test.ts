import { afterEach, describe, expect, it, vi } from 'vitest'
import { BLOCK_CACHE_MAX_READ, BLOCK_SIZE } from '../../src/shared/constants'
import { forgetBlocks, openSource } from '../../src/shared/source'
import { PackageReader } from '../../src/sw/package-reader'
import { collect, manifest, zipOf } from './helpers/archives'

const SIZE = 2 * 1024 * 1024
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

/**
 * Whether two byte arrays are equal, compared directly. `toEqual` walks a typed array element by
 * element through its generic equality, which took seconds on a megabyte and timed the case out on
 * CI's runners.
 */
function sameBytes(actual: Uint8Array, expected: Uint8Array): boolean {
  if (actual.length !== expected.length) return false
  for (let i = 0; i < actual.length; i += 1) if (actual[i] !== expected[i]) return false
  return true
}

/** A host that honours `Range` over `bytes`, keeping the ranges it was asked for. */
function rangeHost(bytes: Uint8Array) {
  const asked: string[] = []
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const header = new Headers(init?.headers).get('range') ?? ''
    asked.push(header)
    const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(header)!
    const end = Math.min(Number(to), bytes.length - 1)
    return new Response(bytes.slice(Number(from), end + 1), {
      status: 206,
      headers: { 'content-range': `bytes ${from}-${end}/${bytes.length}` }
    })
  })
  return asked
}

afterEach(() => {
  vi.unstubAllGlobals()
  forgetBlocks()
})

describe('RangeHttpHandle.read', () => {
  it('takes only the blocks it needs, and stops the transfer, when a host answers 200 to a Range request', async () => {
    const body = countingBody(archive)
    vi.stubGlobal('fetch', async () => new Response(body.stream, { status: 200 }))

    const handle = await openSource('pkg', descriptor)
    const bytes = await handle.read(range)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(bytes).toEqual(archive.subarray(range.start, range.end + 1))
    // The pipe ended at the block and cancelled the body: `stream()` always worked this way, and
    // `read()` buffering the whole archive instead meant four whole archives under segmenting.
    expect(body.cancelled()).toBe(true)
    expect(body.pulled()).toBeLessThan(SIZE / 2)
  })

  it('returns a 206 body whole, since the host already cut it', async () => {
    const asked = rangeHost(archive)

    const handle = await openSource('pkg', descriptor)
    expect(await handle.read(range)).toEqual(archive.subarray(range.start, range.end + 1))
    expect(asked).toEqual([`bytes=0-${BLOCK_SIZE - 1}`])
  })

  it('shares its blocks with a handle opened later on the same archive', async () => {
    const asked = rangeHost(archive)

    await (await openSource('pkg', descriptor)).read(range)
    const again = await openSource('pkg', descriptor)
    expect(await again.read({ start: 100, end: 200 })).toEqual(archive.subarray(100, 201))
    expect(asked).toHaveLength(1)

    // A republished archive at the same URL is other bytes.
    await (await openSource('pkg', { ...descriptor, validator: '"v2"' })).read(range)
    expect(asked).toHaveLength(2)
  })

  it('fetches a read longer than the bound as asked, and keeps none of it', async () => {
    const asked = rangeHost(archive)
    const handle = await openSource('pkg', descriptor)
    const long = { start: 10, end: 10 + BLOCK_CACHE_MAX_READ }

    expect(sameBytes(await handle.read(long), archive.subarray(long.start, long.end + 1))).toBe(true)
    await handle.read(long)
    expect(asked).toEqual([`bytes=${long.start}-${long.end}`, `bytes=${long.start}-${long.end}`])
  })
})

describe('RangeHttpHandle.stream', () => {
  it('serves a range of one block from the cache, and streams a longer one from the network as asked', async () => {
    const asked = rangeHost(archive)
    const handle = await openSource('pkg', descriptor)

    await handle.read({ start: 0, end: 10 })
    expect(await collect(await handle.stream({ start: 100, end: 5000 }))).toEqual(archive.subarray(100, 5001))
    expect(asked).toHaveLength(1)

    const media = { start: 200_000, end: 600_000 }
    expect(sameBytes(await collect(await handle.stream(media)), archive.subarray(media.start, media.end + 1))).toBe(true)
    expect(asked).toEqual([`bytes=0-${BLOCK_SIZE - 1}`, `bytes=${media.start}-${media.end}`])
    // Not kept: the cache holds index reads and small entries, not media.
    await handle.stream(media).then(collect)
    expect(asked).toHaveLength(3)
  })
})

describe('an index read over HTTP', () => {
  /**
   * zip.js reads an index in small pieces: the tail, the central directory inside it, then each
   * entry's local header and its data. Every piece was a request, and the reader the Service
   * Worker builds again once libraries are attached asked for all of them again (#133).
   */
  async function quiz() {
    // Entries from the start to well past the first block, so the tail and the head are apart.
    const media = Uint8Array.from({ length: 300_000 }, (_, i) => (i * 7919) % 256)
    return zipOf(
      {
        'h5p.json': manifest('H5P.Quiz', [['H5P.Quiz', 1, 0]]),
        'H5P.Quiz-1.0/library.json': '{"machineName":"H5P.Quiz","majorVersion":1,"minorVersion":0}',
        'content/images/photo.jpg': media,
        'content/content.json': JSON.stringify({ questions: ['one', 'two', 'three'] })
      },
      { stored: ['content/images/photo.jpg'] }
    )
  }

  it('costs the tail and the head, and a reader built again asks for nothing', async () => {
    const bytes = await quiz()
    const asked = rangeHost(bytes)
    const archiveDescriptor = { type: 'range-http', url: 'https://host.example/quiz.h5p', size: bytes.length } as const

    const first = await PackageReader.open('pkg', await openSource('pkg', archiveDescriptor))
    const content = new TextDecoder().decode(await collect(first.inflate(first.get('content/content.json')!.entry)))
    expect(JSON.parse(content).questions).toHaveLength(3)
    // The tail (end-of-directory search and the directory, and content.json beside it) and the
    // head (h5p.json): two requests, where each of those pieces was one of its own.
    expect(asked).toHaveLength(2)

    const again = await PackageReader.open('pkg', await openSource('pkg', archiveDescriptor))
    await collect(again.inflate(again.get('content/content.json')!.entry))
    expect(asked).toHaveLength(2)
  })
})
