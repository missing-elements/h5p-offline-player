import { ARCHIVE_ENTRY, CACHE_PREFIX, CHUNK_KEY_ORIGIN, CHUNK_SIZE } from './constants'
import type { ByteRange } from './range'
import { sliceStream } from './stream-utils'
import { busyPackages } from './locks'

/**
 * The chunk store: one Cache API cache per package. Small entries are stored whole; archives and
 * extracted media are stored as fixed-size chunks, so a range request is chunk arithmetic plus a
 * slice and nothing bigger than one chunk is ever resident.
 *
 * It is a cache, not a library. Nothing in v1 lets a user manage it; when a write hits the quota,
 * the coldest package that is not currently playing is dropped and the write is retried.
 */

/** What is known about a chunked entry while and after it is written. */
export interface ChunkMeta {
  /** Total size once known. `null` while a download of unknown length is in flight. */
  size: number | null
  /** Bytes written so far, always a prefix of the entry: chunks are written in order. */
  available: number
  complete: boolean
}

const META_MARKER = '/__meta__'

/** How many evictions one write may trigger before it gives up. */
const MAX_EVICTIONS_PER_WRITE = 32

function encodeEntry(entry: string): string {
  return entry.split('/').map(encodeURIComponent).join('/')
}

export function cacheNameFor(pkgId: string): string {
  return `${CACHE_PREFIX}${pkgId}`
}

function wholeKey(pkgId: string, entry: string): string {
  return `${CHUNK_KEY_ORIGIN}${pkgId}/whole/${encodeEntry(entry)}`
}

function chunkKey(pkgId: string, entry: string, index: number): string {
  return `${CHUNK_KEY_ORIGIN}${pkgId}/chunk/${encodeEntry(entry)}/${index}`
}

function metaKey(pkgId: string, entry: string): string {
  return `${CHUNK_KEY_ORIGIN}${pkgId}/chunk/${encodeEntry(entry)}${META_MARKER}`
}

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  )
}

export class QuotaError extends Error {
  constructor(message = 'Not enough storage to cache this package') {
    super(message)
    this.name = 'QuotaError'
  }
}

/** Chunk indices covering an inclusive byte range. */
export function chunksForRange(range: ByteRange): { first: number; last: number } {
  return {
    first: Math.floor(range.start / CHUNK_SIZE),
    last: Math.floor(range.end / CHUNK_SIZE)
  }
}

/** The slice of chunk `index` that contributes to `range`, as offsets within the chunk. */
export function sliceWithinChunk(index: number, range: ByteRange): { from: number; to: number } {
  const chunkStart = index * CHUNK_SIZE
  return {
    from: Math.max(0, range.start - chunkStart),
    to: Math.min(CHUNK_SIZE, range.end - chunkStart + 1)
  }
}

export class ChunkStore {
  readonly pkgId: string
  private cachePromise: Promise<Cache> | null = null

  constructor(pkgId: string) {
    this.pkgId = pkgId
  }

  private cache(): Promise<Cache> {
    this.cachePromise ??= caches.open(cacheNameFor(this.pkgId))
    return this.cachePromise
  }

  /* ---------------------------------------------------------------- whole entries */

  async getWhole(entry: string): Promise<Response | undefined> {
    const cache = await this.cache()
    return cache.match(wholeKey(this.pkgId, entry))
  }

  /**
   * Stores an entry in one piece. `body` builds the payload — usually a fresh inflate stream
   * straight off zip.js, so the entry streams into storage instead of landing in memory first —
   * and is called again only if a quota retry needs another.
   */
  async putWhole(
    entry: string,
    body: () => BodyInit,
    contentType: string,
    size?: number
  ): Promise<void> {
    const headers = new Headers({ 'content-type': contentType })
    if (size !== undefined) headers.set('content-length', String(size))
    await this.write(wholeKey(this.pkgId, entry), () => new Response(body(), { headers }))
  }

  /* ---------------------------------------------------------------- chunked entries */

  async getMeta(entry: string): Promise<ChunkMeta | undefined> {
    const cache = await this.cache()
    const response = await cache.match(metaKey(this.pkgId, entry))
    if (!response) return undefined
    try {
      return (await response.json()) as ChunkMeta
    } catch {
      return undefined
    }
  }

  async setMeta(entry: string, meta: ChunkMeta): Promise<void> {
    const cache = await this.cache()
    // The watermark must never be the write that fails on quota, or a complete entry would look
    // partial forever. It is tiny, so it is written without the eviction dance.
    await cache.put(
      metaKey(this.pkgId, entry),
      new Response(JSON.stringify(meta), { headers: { 'content-type': 'application/json' } })
    )
    announceWatermark({ pkgId: this.pkgId, entry, meta })
  }

  async putChunk(entry: string, index: number, bytes: Uint8Array): Promise<void> {
    // A fresh copy: `bytes` may be a view into a larger buffer the caller keeps writing into. One
    // copy serves every attempt, since a `Response` takes its own copy of a buffer body.
    const copy = bytes.slice()
    await this.write(
      chunkKey(this.pkgId, entry, index),
      () =>
        new Response(copy.buffer as ArrayBuffer, {
          headers: { 'content-type': 'application/octet-stream' }
        })
    )
  }

  async getChunk(entry: string, index: number): Promise<Uint8Array | undefined> {
    const cache = await this.cache()
    const response = await cache.match(chunkKey(this.pkgId, entry, index))
    if (!response) return undefined
    return new Uint8Array(await response.arrayBuffer())
  }

  /**
   * Streams an inclusive byte range out of a chunked entry. Chunks are pulled one at a time as
   * the consumer reads, and each streams straight out of the cache — a partial one sliced as it
   * flows — so serving a 300 MB video costs kilobytes of memory, not a chunk of it. That matters
   * most for the small ranges a media element probes with: materialising the 8 MB chunk to hand
   * back 64 kB of it was the old cost of every such request.
   *
   * `waitFor` lets the stream run ahead of the extraction: it is called with the byte the next
   * chunk reaches and must resolve true once that much exists. Without it every byte of the
   * range has to be in the store before the first one can be served.
   */
  readRange(
    entry: string,
    range: ByteRange,
    waitFor?: (bytes: number) => Promise<boolean>
  ): ReadableStream<Uint8Array> {
    const { first, last } = chunksForRange(range)
    let index = first
    let current: ReadableStreamDefaultReader<Uint8Array> | null = null
    const store = this

    return new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          for (;;) {
            if (current) {
              const { done, value } = await current.read()
              if (!done) {
                controller.enqueue(value)
                return
              }
              current = null
              index += 1
            }

            if (index > last) {
              controller.close()
              return
            }

            if (waitFor) {
              const reaches = Math.min((index + 1) * CHUNK_SIZE, range.end + 1)
              if (!(await waitFor(reaches))) {
                controller.error(new Error(`Extraction of ${entry} stalled before byte ${reaches}`))
                return
              }
            }

            const body = await store.chunkBody(entry, index)
            if (!body) {
              controller.error(new Error(`Missing chunk ${index} of ${entry}`))
              return
            }

            const { from, to } = sliceWithinChunk(index, range)
            const whole = from === 0 && to >= CHUNK_SIZE
            current = (whole ? body : sliceStream(body, { start: from, end: to - 1 })).getReader()
          }
        },
        async cancel(reason) {
          await current?.cancel(reason)
        }
      },
      // Nothing is pulled, and nothing waited for, until the response body is actually read.
      { highWaterMark: 0 }
    )
  }

  /** The stored body of one chunk, streaming, or `undefined` when it is not there. */
  private async chunkBody(entry: string, index: number): Promise<ReadableStream<Uint8Array> | undefined> {
    const cache = await this.cache()
    const response = await cache.match(chunkKey(this.pkgId, entry, index))
    return response?.body ?? undefined
  }

  /** Reads an inclusive range into memory. Only used for archive reads, which are bounded. */
  async readRangeBytes(entry: string, range: ByteRange): Promise<Uint8Array> {
    const out = new Uint8Array(range.end - range.start + 1)
    const { first, last } = chunksForRange(range)
    let offset = 0

    for (let index = first; index <= last; index += 1) {
      const chunk = await this.getChunk(entry, index)
      if (!chunk) throw new Error(`Missing chunk ${index} of ${entry}`)
      const { from, to } = sliceWithinChunk(index, range)
      const slice = chunk.subarray(from, Math.min(to, chunk.length))
      out.set(slice, offset)
      offset += slice.length
    }

    return offset === out.length ? out : out.subarray(0, offset)
  }

  /* ---------------------------------------------------------------- archive helpers */

  getArchiveMeta(): Promise<ChunkMeta | undefined> {
    return this.getMeta(ARCHIVE_ENTRY)
  }

  readArchiveRange(range: ByteRange): Promise<Uint8Array> {
    return this.readRangeBytes(ARCHIVE_ENTRY, range)
  }

  /* ---------------------------------------------------------------- writing and eviction */

  /**
   * A cache write that survives a full disk: on a quota error the coldest *other* package is
   * dropped and the write retried. The package being served is never a candidate, so playback
   * cannot evict itself mid-stream.
   *
   * It takes a factory, not a `Response`. A body can only be consumed once, and the obvious way
   * to keep a retry copy — `clone()` before every attempt — tees the body: for a stream straight
   * off the inflate, the unread branch then buffers the entire entry in memory, on every write,
   * only to be thrown away when the put succeeds. Building a fresh response only when a retry
   * actually happens keeps the common path a single pass through.
   */
  private async write(key: string, build: () => Response): Promise<void> {
    const cache = await this.cache()

    for (let attempt = 0; ; attempt += 1) {
      const response = build()
      try {
        await cache.put(key, response)
        return
      } catch (error) {
        // A failed put can leave a stream body half-read and still being produced; let it go
        // before building another. Cancelling a body the put still holds rejects, which is fine.
        void response.body?.cancel().catch(() => {})
        if (!isQuotaError(error)) throw error
        if (attempt >= MAX_EVICTIONS_PER_WRITE) throw new QuotaError()
        if (!(await evictColdestPackage(this.pkgId))) throw new QuotaError()
      }
    }
  }

  async destroy(): Promise<void> {
    this.cachePromise = null
    await caches.delete(cacheNameFor(this.pkgId))
  }
}

/* ------------------------------------------------------------------ module-level maintenance */

/**
 * Hook the eviction policy up to the `packages` table. The lookup is injected rather than imported
 * so the store stays testable without IndexedDB; `eviction.ts` supplies the real one, and both the
 * Service Worker and the Jobs worker install it.
 */
let coldestPackageLookup: ((exceptPkgId: string) => Promise<string | null>) | null = null

export function setEvictionPolicy(lookup: (exceptPkgId: string) => Promise<string | null>): void {
  coldestPackageLookup = lookup
}

let onPackageEvicted: ((pkgId: string) => Promise<void> | void) | null = null

export function setEvictionListener(listener: (pkgId: string) => Promise<void> | void): void {
  onPackageEvicted = listener
}

async function evictColdestPackage(exceptPkgId: string): Promise<boolean> {
  const victim = coldestPackageLookup
    ? await coldestPackageLookup(exceptPkgId)
    : await coldestCacheName(exceptPkgId)

  if (!victim) return false

  await caches.delete(cacheNameFor(victim))
  await onPackageEvicted?.(victim)
  return true
}

/** Fallback when no policy is installed: any other idle package cache, in whatever order the browser lists. */
async function coldestCacheName(exceptPkgId: string): Promise<string | null> {
  const [names, busy] = await Promise.all([caches.keys(), busyPackages()])
  const mine = cacheNameFor(exceptPkgId)
  const candidate = names.find(
    (name) => name.startsWith(CACHE_PREFIX) && name !== mine && !busy.has(name.slice(CACHE_PREFIX.length))
  )
  return candidate ? candidate.slice(CACHE_PREFIX.length) : null
}

/* ------------------------------------------------------------------ watermark notices */

/**
 * The watermark is written by the Jobs worker and waited on by the Service Worker: different
 * threads, no shared memory. Polling the cache record bridges that, but only at the poll
 * interval; a notice on a `BroadcastChannel` wakes a waiter the moment the bytes exist. The poll
 * stays as the fallback — it is what notices a job that died — so a platform without the channel
 * is slower, not broken.
 *
 * Two channel objects, not one: a channel never delivers to itself, and the announcer and the
 * listener can be the same module — as they are in a unit test, and would be in a single-worker
 * host that ran both halves in one place.
 */
const WATERMARK_CHANNEL = 'h5p-player-watermark'

export interface WatermarkNotice {
  pkgId: string
  entry: string
  meta: ChunkMeta
}

let announcer: BroadcastChannel | null | undefined
let listener: BroadcastChannel | null | undefined

function openChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel !== 'function') return null
  const channel = new BroadcastChannel(WATERMARK_CHANNEL)
  // Node keeps the process alive for an open channel; browsers have no such method.
  ;(channel as BroadcastChannel & { unref?: () => void }).unref?.()
  return channel
}

function announceWatermark(notice: WatermarkNotice): void {
  announcer ??= openChannel()
  try {
    announcer?.postMessage(notice)
  } catch {
    // A closed channel must not turn a successful write into a failed one.
  }
}

/** Calls `onNotice` for every watermark written to one entry, until the returned function is called. */
export function onWatermark(
  pkgId: string,
  entry: string,
  onNotice: (meta: ChunkMeta) => void
): () => void {
  listener ??= openChannel()
  const channel = listener
  if (!channel) return () => {}

  const onMessage = (event: MessageEvent<WatermarkNotice>) => {
    const notice = event.data
    if (notice?.pkgId === pkgId && notice.entry === entry) onNotice(notice.meta)
  }
  channel.addEventListener('message', onMessage)
  return () => channel.removeEventListener('message', onMessage)
}

/** Drops package caches written by an older major version. Called from the worker's `activate`. */
export async function deleteStaleCaches(): Promise<string[]> {
  const names = await caches.keys()
  const stale = names.filter((name) => /^h5p-pkg-v(\d+)-/.test(name) && !name.startsWith(CACHE_PREFIX))
  await Promise.all(stale.map((name) => caches.delete(name)))
  return stale
}
