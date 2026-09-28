import { afterEach, describe, expect, it, vi } from 'vitest'
import { WARM_ENTRY, WARM_GAP } from '../../src/shared/constants'
import { ChunkStore } from '../../src/shared/chunk-store'
import { PackageReader } from '../../src/sw/package-reader'
import { warmPackage } from '../../src/jobs/warm'
import { manifest, memoryHandle, zipOf } from './helpers/archives'

/**
 * Warming: the spans the index names, and the walk that lands their entries in the cache. A real
 * archive from zip.js, with a stored video between two library folders wide enough to split them.
 */

/** The Cache API reduced to a map, enough for whole entries and meta records. */
function fakeCaches() {
  const stored = new Map<string, { body: Uint8Array<ArrayBuffer>; headers: Headers }>()
  const cache = {
    async put(key: string, response: Response) {
      stored.set(key, { body: new Uint8Array(await response.arrayBuffer()), headers: response.headers })
    },
    async match(key: string) {
      const hit = stored.get(key)
      return hit ? new Response(hit.body, { headers: hit.headers }) : undefined
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

const script = 'H5P.OfflineTest = function () { return 42 }\n'.repeat(40)
const video = new Uint8Array(WARM_GAP * 2)
for (let i = 0; i < video.length; i += 1) video[i] = (i * 7919) & 0xff

const files = {
  'h5p.json': manifest('H5P.A', [
    ['H5P.A', 1, 0],
    ['H5P.B', 1, 0]
  ]),
  'H5P.A-1.0/library.json': JSON.stringify({ machineName: 'H5P.A', majorVersion: 1, minorVersion: 0 }),
  'H5P.A-1.0/a.js': script,
  'H5P.A-1.0/a.css': '.a { color: red }',
  'content/content.json': '{"params":{}}',
  'content/videos/v.mp4': video,
  'H5P.B-1.0/library.json': JSON.stringify({ machineName: 'H5P.B', majorVersion: 1, minorVersion: 0 }),
  'H5P.B-1.0/b.js': script
}

async function indexed() {
  const bytes = await zipOf(files, { stored: ['content/videos/v.mp4'] })
  const memory = memoryHandle(bytes)
  const reader = await PackageReader.open('pkg', memory.handle, { requireLibraries: false })
  return { ...memory, reader, spans: reader.warmSpans() }
}

describe('warmSpans', () => {
  it('names the runs of small entries, split by the media between them', async () => {
    const { spans, handle } = await indexed()

    expect(spans.map((span) => span.entries.map((entry) => entry.name))).toEqual([
      ['h5p.json', 'H5P.A-1.0/library.json', 'H5P.A-1.0/a.js', 'H5P.A-1.0/a.css', 'content/content.json'],
      ['H5P.B-1.0/library.json', 'H5P.B-1.0/b.js']
    ])
    expect(spans[0].start).toBe(0)
    // The video lies between the two and is in neither.
    expect(spans[1].start - spans[0].end).toBeGreaterThanOrEqual(video.length)
    expect(spans[1].end).toBeLessThanOrEqual(handle.size)
  })
})

describe('warmPackage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lands every entry of every span with one request per span, and writes the marker', async () => {
    vi.stubGlobal('caches', fakeCaches())
    const { handle, streams, spans } = await indexed()
    streams.length = 0
    const store = new ChunkStore('pkg')
    const progress: number[] = []

    const result = await warmPackage(handle, spans, store, {
      signal: new AbortController().signal,
      onProgress: (report) => progress.push(report.loaded)
    })

    expect(result).toEqual({ stored: 7, skipped: 0, complete: true })
    expect(streams).toEqual(spans.map((span) => ({ start: span.start, end: span.end - 1 })))
    expect(await (await store.getWhole('H5P.A-1.0/a.js'))?.text()).toBe(script)
    expect(await (await store.getWhole('H5P.B-1.0/b.js'))?.text()).toBe(script)
    expect(await (await store.getWhole('content/content.json'))?.text()).toBe('{"params":{}}')
    expect((await store.getWhole('H5P.A-1.0/a.css'))?.headers.get('content-type')).toContain('text/css')
    expect(await store.getWhole('content/videos/v.mp4')).toBeUndefined()
    expect(await (await store.getWhole(WARM_ENTRY))?.json()).toEqual({ stored: 7, bytes: spans.reduce((sum, span) => sum + span.end - span.start, 0) })
    expect(progress.at(-1)).toBe(spans.reduce((sum, span) => sum + span.end - span.start, 0))
  })

  it('stops on abort, storing nothing more and leaving no marker', async () => {
    vi.stubGlobal('caches', fakeCaches())
    const { handle, spans } = await indexed()
    const store = new ChunkStore('pkg')
    const controller = new AbortController()
    controller.abort()

    const result = await warmPackage(handle, spans, store, { signal: controller.signal })

    expect(result.complete).toBe(false)
    expect(result.stored).toBe(0)
    expect(await store.getWhole(WARM_ENTRY)).toBeUndefined()
  })

  it('abandons a span whose bytes are not where the index said, and writes no marker', async () => {
    vi.stubGlobal('caches', fakeCaches())
    const { handle, spans } = await indexed()
    const store = new ChunkStore('pkg')
    // The second span's first entry, claimed 16 bytes early: no local header there.
    spans[1].entries[0].offset -= 16
    spans[1].start -= 16

    await expect(
      warmPackage(handle, spans, store, { signal: new AbortController().signal })
    ).rejects.toThrow(/no local header/)
    // The first span had already landed.
    expect(await (await store.getWhole('H5P.A-1.0/a.js'))?.text()).toBe(script)
    expect(await store.getWhole(WARM_ENTRY)).toBeUndefined()
  })
})
