import {
  ARCHIVE_ENTRY,
  COLD_ENTRY_WAIT_MS,
  FAILURE_BACKOFF_MS,
  JOB_REQUEST_DEDUPE_MS,
  VERSION,
  WATERMARK_POLL_MS
} from '../shared/constants'
import {
  ChunkStore,
  FORWARD_INDEX_ENTRY,
  QuotaError,
  deleteStaleCaches,
  isQuotaError,
  onWatermark,
  type ChunkMeta,
  type EntryFailure
} from '../shared/chunk-store'
import { installEvictionPolicy } from '../shared/eviction'
import { normalizeRequestPath } from '../shared/entry-names'
import { contentTypeOf } from '../shared/mime'
import {
  PlayerError,
  type FromWorkerMessage,
  type PackageRecord,
  type ToWorkerMessage,
  type WorkerReply
} from '../shared/protocol'
import { contentRange, parseRange, type ByteRange } from '../shared/range'
import { openSource } from '../shared/source'
import * as db from '../shared/idb'
import { PackageReader, STORED, type IndexedEntry, type LocatedEntry } from './package-reader'
import { buildFrameDocument, createNonce } from './frame-document'
import { matchRoute, routesFor, type RouteMatch, type Routes } from './routes'
import { sliceStream } from '../shared/stream-utils'
import { waitForWatermark } from './watermark-wait'
import { quotaMessage } from '../shared/storage'

/**
 * The Service Worker half of the player: a virtual file server over a zip that is never
 * extracted to disk, plus the frame document it synthesizes for the runtime to live in.
 *
 * It is deliberately stateless. Browsers terminate a worker between events, so every handler
 * rebuilds what it needs from the `packages` table and the chunk store, and anything that cannot
 * finish inside one event — downloading an archive, inflating a large entry — is handed to the
 * page-side Jobs worker instead.
 */

export interface MountOptions {
  /**
   * Override the route base. Only useful when a host mounts the handlers into a worker whose
   * scope is not where the routes should live.
   */
  scope?: string
}

/** A `need-file` request the page has not answered yet. */
interface PendingFile {
  promise: Promise<Blob>
  resolve: (blob: Blob) => void
  timer: ReturnType<typeof setTimeout>
}

export function mountH5P(worker: ServiceWorkerGlobalScope, options: MountOptions = {}): void {
  const routes = routesFor(options.scope ?? worker.registration.scope)
  const server = new VirtualServer(worker, routes)

  worker.addEventListener('install', () => {
    // A player update should reach open tabs on the next load, not the next browser restart.
    void worker.skipWaiting()
  })

  worker.addEventListener('activate', (event) => {
    event.waitUntil(
      (async () => {
        await deleteStaleCaches()
        await worker.clients.claim()
      })()
    )
  })

  worker.addEventListener('message', (event) => {
    event.waitUntil(server.handleMessage(event))
  })

  worker.addEventListener('fetch', (event) => {
    const match = matchRoute(routes, event.request.url)
    if (match.kind === 'none') return // Not ours: YouTube, external media, the host's own assets.
    event.respondWith(server.handleFetch(event, match))
  })
}

class VirtualServer {
  /** Open readers, keyed by package. Lost on worker restart and rebuilt on the next request. */
  private readers = new Map<string, Promise<PackageReader>>()
  /** Picked files, re-sent by the page after a restart because a `File` cannot be persisted. */
  private files = new Map<string, Blob>()
  private pendingFiles = new Map<string, PendingFile>()
  /** In-flight job requests, so a burst of range requests does not start the same job repeatedly. */
  private requestedJobs = new Set<string>()
  /** Inline entries being inflated into the cache right now, so a burst for one file inflates it once. */
  private inflating = new Map<string, Promise<void>>()
  /**
   * Until when the store is taken to be full. Set when a cache write is refused for lack of space
   * and nothing was left to evict; while it stands, inline entries are served straight from the
   * archive without another attempt to cache them.
   */
  private storageFullUntil = 0

  constructor(
    private readonly worker: ServiceWorkerGlobalScope,
    private readonly routes: Routes
  ) {
    installEvictionPolicy((pkgId) => {
      this.readers.delete(pkgId)
    })
  }

  /* ---------------------------------------------------------------- control channel */

  async handleMessage(event: ExtendableMessageEvent): Promise<void> {
    const message = event.data as ToWorkerMessage | undefined
    if (!message || typeof message.type !== 'string') return

    const reply = (payload: WorkerReply) => {
      const port = event.ports[0]
      if (port) port.postMessage(payload)
    }

    try {
      switch (message.type) {
        case 'ping':
          reply({ ok: true, type: 'pong', version: VERSION })
          return

        case 'register':
          await this.registerPackage(message.record)
          reply({ ok: true, type: 'ack' })
          return

        case 'index': {
          const reader = await this.refresh(message.pkgId, await this.reader(message.pkgId))
          if (!reader.partial) {
            await bookkeeping(db.updatePackage(message.pkgId, { status: 'indexed', lastPlayed: Date.now() }))
          }
          reply({
            ok: true,
            type: 'indexed',
            pkgId: message.pkgId,
            entryCount: reader.entries.size,
            title: reader.title,
            prefetch: reader.prefetchable(),
            // Only where a read is a round trip. A picked file and a downloaded archive are
            // local, and their entries are inflated on demand for nothing.
            warm:
              reader.handle.descriptor.type === 'range-http' && !reader.partial
                ? reader.warmSpans()
                : undefined,
            partial: reader.partial || undefined,
            ready: reader.partial ? reader.bootReady() : undefined
          })
          return
        }

        case 'attach-libraries': {
          await db.updatePackage(message.pkgId, { libraryPkgId: message.libraryPkgId })
          // Dropped so the next request rebuilds the reader with the bundle attached.
          this.readers.delete(message.pkgId)
          reply({ ok: true, type: 'ack' })
          return
        }

        case 'file': {
          this.files.set(message.pkgId, message.file)
          const pending = this.pendingFiles.get(message.pkgId)
          if (pending) {
            clearTimeout(pending.timer)
            pending.resolve(message.file)
            this.pendingFiles.delete(message.pkgId)
          }
          reply({ ok: true, type: 'ack' })
          return
        }
      }
    } catch (error) {
      reply(await toErrorReply(error))
    }
  }

  /**
   * Writes the package's row. On an origin with no room left for even that, a row already there
   * for the same package is kept and serves: it names the same source — the id is a hash of it —
   * and a package that played before can play again from an archive nothing needs to store.
   */
  private async registerPackage(record: PackageRecord): Promise<void> {
    try {
      await db.putPackage(record)
    } catch (error) {
      if (!isQuotaError(error) || !(await db.getPackage(record.pkgId))) throw error
    }
    this.readers.delete(record.pkgId)
  }

  /* ---------------------------------------------------------------- request routing */

  async handleFetch(event: FetchEvent, match: RouteMatch): Promise<Response> {
    try {
      switch (match.kind) {
        case 'ping':
          return json({ version: VERSION })

        case 'frame':
          return await this.serveFrame(match.pkgId)

        case 'entry':
          return await this.serveEntry(event, match.pkgId, match.path)

        default:
          return new Response(null, { status: 404 })
      }
    } catch (error) {
      // The same answer the frame route gives for a package the table does not know.
      if (error instanceof UnknownPackageError) return text(error.message, 404)
      if (error instanceof PlayerError && error.code === 'bad-archive') {
        return text(error.message, 422)
      }
      if (error instanceof QuotaError) {
        return text(error.message, 507)
      }
      return text(error instanceof Error ? error.message : 'Internal player error', 500)
    }
  }

  /* ---------------------------------------------------------------- the frame document */

  private async serveFrame(pkgId: string): Promise<Response> {
    const record = await db.getPackage(pkgId)
    if (!record) return text('Unknown package', 404)

    await bookkeeping(db.touchPackage(pkgId))

    const nonce = createNonce()
    const body = buildFrameDocument({
      pkgId,
      virtualRoot: `${this.routes.virtual}${pkgId}`,
      assets: record.frameAssets,
      nonce,
      title: record.title,
      allowOrigins: record.allowOrigins
    })

    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // The document is regenerated per navigation; a cached copy would pin a stale nonce.
        'cache-control': 'no-store'
      }
    })
  }

  /* ---------------------------------------------------------------- package entries */

  private async serveEntry(event: FetchEvent, pkgId: string, rawPath: string): Promise<Response> {
    const name = normalizeRequestPath(rawPath)
    if (name === null) return text('Bad entry path', 400)

    let reader = await this.reader(pkgId)
    let located = reader.get(name)

    if (!located && reader.partial) {
      // On a partial index a miss is ambiguous: absent, or not arrived yet. Wait for the index to
      // grow until the entry appears or the answer becomes certain.
      const outcome = await this.awaitEntry(pkgId, reader, name)
      if (outcome === 'stalled') return retryLater(`The download has stalled before ${name}`)
      reader = outcome.reader
      located = outcome.located
    }

    // A 404 here is load-bearing: h5p-standalone probes for `library.json` under both the
    // versioned and unversioned folder names and picks the shape that answers.
    if (!located) return new Response(null, { status: 404 })

    // With a bundle attached, `h5p.json` is answered from the merged manifest rather than from
    // the archive: the dependency list in a content-only export names only the main library.
    if (name === 'h5p.json' && reader.hasFallbacks) {
      return json(reader.mergedManifest())
    }

    const rangeHeader = event.request.headers.get('range')

    // Extracted bytes are stored against the archive they came from, not the package being
    // played. A library bundle shared by several packages is then inflated once for all of them.
    switch (located.entry.strategy.kind) {
      case 'inline':
        return this.serveInline(located, rangeHeader)
      case 'slice':
        return this.serveSlice(located, rangeHeader)
      case 'chunked':
        return this.serveChunked(event, located, rangeHeader)
    }
  }

  /**
   * Small entries and anything the runtime parses: inflate once into the cache, then serve.
   *
   * The cache is a convenience here, not a need. When the browser refuses the write for lack of
   * space — after eviction has found nothing more to drop — the entry is served from the archive
   * directly, and the store is left alone for `FAILURE_BACKOFF_MS` so a burst of requests does
   * not repeat the failed copy for each of them. A package on a host that honours `Range`, or
   * picked from disk, therefore plays with no storage at all; what it loses is only the speed of
   * a second play.
   */
  private async serveInline(
    { reader, entry }: LocatedEntry,
    rangeHeader: string | null
  ): Promise<Response> {
    const store = new ChunkStore(reader.pkgId)

    let cached = await store.getWhole(entry.name)
    if (!cached && Date.now() >= this.storageFullUntil) {
      try {
        await this.cacheInline(store, reader, entry)
        cached = await store.getWhole(entry.name)
      } catch (error) {
        if (!(error instanceof QuotaError)) throw error
        this.storageFullUntil = Date.now() + FAILURE_BACKOFF_MS
      }
    }

    if (!cached) return this.serveUncached(reader, entry, rangeHeader)
    if (!cached.body) return text('Entry could not be read', 500)

    const range = parseRange(rangeHeader, entry.size)
    if (range === 'unsatisfiable') return unsatisfiable(entry.size)

    if (range === 'none') {
      return new Response(cached.body, {
        status: 200,
        headers: entryHeaders(entry, { length: entry.size })
      })
    }

    return new Response(sliceStream(cached.body, range), {
      status: 206,
      headers: entryHeaders(entry, {
        length: range.end - range.start + 1,
        contentRange: contentRange(range, entry.size)
      })
    })
  }

  /**
   * Inflates an inline entry into the cache, sharing the work with any request already doing it.
   *
   * The runtime asks for a library's files in a burst, and the same file more than once when
   * two of them reference it; every one of those used to miss the cache together, inflate
   * separately and race each other on the same `cache.put`. The map is per worker instance and
   * dies with it, which costs nothing but the dedupe. A failure rejects every waiter alike and
   * clears the slot, so the next request tries again rather than inheriting a dead promise.
   */
  private cacheInline(store: ChunkStore, reader: PackageReader, entry: IndexedEntry): Promise<void> {
    const key = `${reader.pkgId}\u0000${entry.name}`
    const running = this.inflating.get(key)
    if (running) return running

    const writing = store
      .putWhole(entry.name, () => reader.inflate(entry), contentTypeOf(entry.name), entry.size)
      .finally(() => this.inflating.delete(key))
    this.inflating.set(key, writing)
    return writing
  }

  /**
   * An inline entry straight from the archive, with nothing written anywhere. A stored entry is
   * sliced out of the source like a large one would be; a deflated one is inflated for this
   * response alone and cut to the range as it flows.
   */
  private async serveUncached(
    reader: PackageReader,
    entry: IndexedEntry,
    rangeHeader: string | null
  ): Promise<Response> {
    const range = parseRange(rangeHeader, entry.size)
    if (range === 'unsatisfiable') return unsatisfiable(entry.size)

    const whole = range === 'none' || (range.start === 0 && range.end === entry.size - 1)
    const wanted: ByteRange = range === 'none' ? { start: 0, end: entry.size - 1 } : range

    let body: BodyInit | null
    if (entry.size === 0) body = null
    else if (entry.method === STORED) body = await reader.sliceStream(entry, wanted)
    else if (whole) body = reader.inflate(entry)
    else body = sliceStream(reader.inflate(entry), wanted)

    if (range === 'none') {
      return new Response(body, { status: 200, headers: entryHeaders(entry, { length: entry.size }) })
    }
    return new Response(body, {
      status: 206,
      headers: entryHeaders(entry, {
        length: wanted.end - wanted.start + 1,
        contentRange: contentRange(wanted, entry.size)
      })
    })
  }

  /** Large and stored: the bytes sit flat in the archive, so they are sliced out of the source. */
  private async serveSlice(
    { reader, entry }: LocatedEntry,
    rangeHeader: string | null
  ): Promise<Response> {
    const range = parseRange(rangeHeader, entry.size)
    if (range === 'unsatisfiable') return unsatisfiable(entry.size)

    const wanted: ByteRange = range === 'none' ? { start: 0, end: entry.size - 1 } : range
    const body = await reader.sliceStream(entry, wanted)

    if (range === 'none') {
      return new Response(body, { status: 200, headers: entryHeaders(entry, { length: entry.size }) })
    }

    return new Response(body, {
      status: 206,
      headers: entryHeaders(entry, {
        length: wanted.end - wanted.start + 1,
        contentRange: contentRange(wanted, entry.size)
      })
    })
  }

  /**
   * Large and deflated: the Jobs worker inflates it into chunks and publishes a watermark. What
   * is already there is served immediately as a shorter `206` — a legal answer that the media
   * element follows up on, which is what makes a cold video start playing before it is extracted.
   */
  private async serveChunked(
    event: FetchEvent,
    { reader, entry }: LocatedEntry,
    rangeHeader: string | null
  ): Promise<Response> {
    const pkgId = reader.pkgId
    const store = new ChunkStore(pkgId)
    const askAgain = () => this.requestJob(event, pkgId, entry.name)

    /** Lets a response body run ahead of the extraction, chunk by chunk. */
    const follow = async (bytes: number) => {
      const reached = await waitForWatermark(store, entry.name, bytes, { onStall: askAgain })
      return reached !== null && (reached.complete || reached.available >= bytes)
    }

    let meta: ChunkMeta | null | undefined = await store.getMeta(entry.name)

    // The last attempt failed. A fresh failure is the answer — waiting out a stall to rediscover
    // it helps nobody, and a media element takes a 507 as the error it is. An old one is retested:
    // the space it lacked may be there now. Cleared before asking, or the wait below would read
    // the stale record as the new attempt's result.
    if (meta?.error) {
      if (Date.now() - meta.error.at < FAILURE_BACKOFF_MS) return failedEntry(meta.error)
      await store.setMeta(entry.name, { size: entry.size, available: 0, complete: false })
      meta = undefined
    }

    if (!meta || (!meta.complete && meta.available === 0)) {
      await askAgain()
      meta = await waitForWatermark(store, entry.name, 1, { onStall: askAgain })
      if (!meta) return retryLater('Extraction has not produced any bytes yet')
      if (meta.error && meta.available === 0) return failedEntry(meta.error)
    }

    const range = parseRange(rangeHeader, entry.size)
    if (range === 'unsatisfiable') return unsatisfiable(entry.size)

    if (range === 'none') {
      // A media element's first request carries no `Range` — Chrome only starts using them once
      // it knows the resource supports them. The real length is known from the zip index, so the
      // response is honest about its size and the body follows the watermark down.
      return new Response(store.readRange(entry.name, { start: 0, end: entry.size - 1 }, follow), {
        status: 200,
        headers: entryHeaders(entry, { length: entry.size })
      })
    }

    // What already exists is answered as a shorter `206`, which is what lets a cold video start
    // before it is extracted. A range that begins past the watermark is answered in full and the
    // body waits: an mp4 whose `moov` index sits at the end — and plenty do — is unplayable until
    // that tail arrives, so refusing it would mean refusing the file.
    const served: ByteRange =
      range.start < meta.available
        ? { start: range.start, end: Math.min(range.end, meta.available - 1) }
        : range

    return new Response(store.readRange(entry.name, served, follow), {
      status: 206,
      headers: entryHeaders(entry, {
        length: served.end - served.start + 1,
        contentRange: contentRange(served, entry.size)
      })
    })
  }

  /**
   * Waits, on a partial reader, for an entry that may not have arrived yet.
   *
   * Woken by each publish of the forward index and each move of the archive's watermark, polling
   * as the fallback, until the entry appears, the reader can prove it absent, or the archive is
   * whole and the real index answers. The stall bound watches the archive watermark, not the
   * index: the index stands still for the whole of a large entry while the bytes keep coming, and
   * a healthy download of a 200 MB video must not read as a dead one. Only a download that stops
   * moving gives up, and it gives up with a retry rather than a wrong 404 — h5p-standalone treats
   * a 404 as a fact about the package.
   */
  private async awaitEntry(
    pkgId: string,
    reader: PackageReader,
    name: string
  ): Promise<{ reader: PackageReader; located: LocatedEntry | undefined } | 'stalled'> {
    const store = new ChunkStore(pkgId)
    let wake: (() => void) | null = null
    const stopIndex = onWatermark(pkgId, FORWARD_INDEX_ENTRY, () => wake?.())
    const stopArchive = onWatermark(pkgId, ARCHIVE_ENTRY, () => wake?.())
    let lastAvailable = -1
    let lastAdvanceAt = Date.now()

    try {
      for (;;) {
        const current = await this.refresh(pkgId, reader)
        const located = current.get(name)
        if (located || !current.partial || current.provablyAbsent(name)) return { reader: current, located }

        const available = (await store.getArchiveMeta())?.available ?? 0
        if (available !== lastAvailable) {
          lastAvailable = available
          lastAdvanceAt = Date.now()
        } else if (Date.now() - lastAdvanceAt >= COLD_ENTRY_WAIT_MS) {
          return 'stalled'
        }

        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, WATERMARK_POLL_MS)
          wake = () => {
            clearTimeout(timer)
            resolve()
          }
        })
        wake = null
        reader = current
      }
    } finally {
      stopIndex()
      stopArchive()
    }
  }

  /* ---------------------------------------------------------------- job requests */

  /**
   * Asks the page to run a job. The worker cannot do it: a browser kills a worker event after a
   * few minutes and a killed inflate cannot resume, so the request goes to the frame that made
   * the request, which relays it to its element.
   */
  private async requestJob(event: FetchEvent, pkgId: string, entry: string): Promise<void> {
    const key = `${pkgId}\u0000${entry}`
    if (this.requestedJobs.has(key)) return
    this.requestedJobs.add(key)
    // Cleared on a short timer rather than on completion: this worker may be killed in between,
    // and the page that owns the job may go away with its tab, so a request that is never
    // answered has to become askable again quickly.
    setTimeout(() => this.requestedJobs.delete(key), JOB_REQUEST_DEDUPE_MS)

    await this.postToClient(event.clientId, { type: 'need-job', pkgId, entry })
  }

  private async postToClient(clientId: string, message: FromWorkerMessage): Promise<void> {
    const client = clientId ? await this.worker.clients.get(clientId) : undefined
    if (client) {
      client.postMessage(message)
      return
    }

    // No originating client (a restarted worker, or a request made outside a page): tell every
    // window we control and let the one that owns the package act on it.
    const clients = await this.worker.clients.matchAll({ type: 'window' })
    for (const each of clients) each.postMessage(message)
  }

  /* ---------------------------------------------------------------- readers */

  /**
   * Returns the reader for a package, rebuilding it from the `packages` table when the worker has
   * been restarted since it was last used.
   */
  private reader(pkgId: string): Promise<PackageReader> {
    const existing = this.readers.get(pkgId)
    if (existing) return existing

    const opening = this.openReader(pkgId)
    this.readers.set(pkgId, opening)
    opening.catch(() => this.readers.delete(pkgId))
    return opening
  }

  private async openReader(pkgId: string): Promise<PackageReader> {
    const record = await db.getPackage(pkgId)
    if (!record) throw new UnknownPackageError(pkgId)

    const file = record.source.type === 'file' ? await this.fileFor(pkgId) : undefined

    // An archive still downloading is served from its forward index — what the local headers
    // have given up so far — until it is whole and the central directory can take over.
    if (record.source.type === 'chunked') {
      const store = new ChunkStore(pkgId)
      const meta = await store.getArchiveMeta()
      if (!meta?.complete) {
        const snapshot = (await store.getForwardIndex()) ?? {
          entries: [],
          parsedTo: 0,
          done: false,
          stopped: null
        }
        const partialHandle = await openSource(pkgId, record.source, file, { partial: true })
        const partial = await PackageReader.fromForwardIndex(pkgId, partialHandle, snapshot)
        if (record.libraryPkgId) partial.use(await this.reader(record.libraryPkgId))
        return partial
      }
    }

    const handle = await openSource(pkgId, record.source, file)

    // Validation waits until any attached bundle is in place; a bundle registered to supply
    // libraries to something else is never held to its own manifest at all.
    const standalone = record.role !== 'libraries' && !record.libraryPkgId
    const reader = await PackageReader.open(pkgId, handle, { requireLibraries: standalone })

    if (record.libraryPkgId) {
      reader.use(await this.reader(record.libraryPkgId))
      reader.assertLibrariesPresent()
    }

    const { title } = reader
    if (title && title !== record.title) await db.updatePackage(pkgId, { title })

    return reader
  }

  /**
   * Brings a partial reader up to date with the latest forward index, or — once the archive is
   * whole — drops it for a reader built from the central directory, which is the authority.
   */
  private async refresh(pkgId: string, reader: PackageReader): Promise<PackageReader> {
    if (!reader.partial) return reader

    const store = new ChunkStore(pkgId)
    const meta = await store.getArchiveMeta()
    if (meta?.complete) {
      this.readers.delete(pkgId)
      return this.reader(pkgId)
    }

    const snapshot = await store.getForwardIndex()
    if (snapshot) await reader.absorb(snapshot)
    return reader
  }

  /** Asks the page for a `File` the worker lost on restart, and waits for it to arrive. */
  private async fileFor(pkgId: string): Promise<Blob> {
    const held = this.files.get(pkgId)
    if (held) return held

    const pending = this.pendingFiles.get(pkgId)
    if (pending) return pending.promise

    let resolve!: (blob: Blob) => void
    let reject!: (error: Error) => void
    const promise = new Promise<Blob>((res, rej) => {
      resolve = res
      reject = rej
    })

    const request: PendingFile = {
      promise,
      resolve,
      timer: setTimeout(() => {
        // Forgotten as well as rejected. Left in the map, this settled promise would be the
        // answer to every later call for the package, and the page would never be asked again —
        // even once it has the file to give.
        if (this.pendingFiles.get(pkgId) === request) this.pendingFiles.delete(pkgId)
        reject(new PlayerError('bad-archive', 'The picked file is no longer available'))
      }, COLD_ENTRY_WAIT_MS)
    }
    this.pendingFiles.set(pkgId, request)

    await this.postToClient('', { type: 'need-file', pkgId })
    return promise
  }
}

/* ------------------------------------------------------------------ helpers */

function entryHeaders(
  entry: IndexedEntry,
  options: { length: number; contentRange?: string }
): Headers {
  const headers = new Headers({
    // A zip records no media type. Without one here CSS is ignored and Safari refuses media.
    'content-type': contentTypeOf(entry.name),
    'content-length': String(options.length),
    'accept-ranges': 'bytes',
    // Responses are already served out of the chunk store; an HTTP cache on top would only
    // duplicate them.
    'cache-control': 'no-store'
  })
  if (options.contentRange) headers.set('content-range', options.contentRange)
  return headers
}

function unsatisfiable(size: number): Response {
  return new Response(null, {
    status: 416,
    headers: { 'content-range': `bytes */${size}`, 'accept-ranges': 'bytes' }
  })
}

function retryLater(message: string): Response {
  return new Response(message, {
    status: 503,
    headers: { 'retry-after': '1', 'content-type': 'text/plain; charset=utf-8' }
  })
}

/** What a request for an entry gets when the job that should have produced it failed. */
function failedEntry(failure: EntryFailure): Response {
  return text(failure.message, failure.code === 'quota' ? 507 : 500)
}

/**
 * A write to the `packages` table that only keeps the books — `lastPlayed`, `status` — and must
 * not take a request down with it. An origin filled to the last byte refuses these tiny writes
 * along with the large ones, and neither is needed to serve the package.
 */
async function bookkeeping(write: Promise<unknown>): Promise<void> {
  try {
    await write
  } catch (error) {
    if (!isQuotaError(error)) throw error
  }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  })
}

function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' }
  })
}

/** A package the `packages` table does not know. Every route answers it with a 404. */
class UnknownPackageError extends PlayerError {
  constructor(pkgId: string) {
    super('bad-archive', `Package ${pkgId} is not registered`)
    this.name = 'UnknownPackageError'
  }
}

async function toErrorReply(error: unknown): Promise<WorkerReply> {
  if (error instanceof PlayerError) {
    // The structured form travels with the message so the element can act on it — fetching the
    // libraries a package is missing needs to know which ones, and for which content type.
    return {
      ok: false,
      code: error.code,
      message: error.message,
      missingLibraries: error.missingLibraries
    }
  }
  if (error instanceof QuotaError) {
    return { ok: false, code: 'quota', message: error.message }
  }
  if (isQuotaError(error)) {
    // Raw from IndexedDB: the `packages` row itself did not fit.
    return { ok: false, code: 'quota', message: await quotaMessage('this package', null) }
  }
  return {
    ok: false,
    code: 'bad-archive',
    message: error instanceof Error ? error.message : String(error)
  }
}
