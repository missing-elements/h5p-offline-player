import {
  ARCHIVE_ENTRY,
  COLD_ENTRY_WAIT_MS,
  FAILURE_BACKOFF_MS,
  FILE_HANDOVER_TIMEOUT_MS,
  JOB_REQUEST_DEDUPE_MS,
  LIBRARY_PACK_BASE,
  STREAM_KEEPALIVE_MS,
  VERSION,
  WATERMARK_POLL_MS
} from '../shared/constants.js'
import { PACK_INDEX } from '../shared/pack-index.js'
import { packLibrariesIn } from '../shared/pack.js'
import { planPack } from './pack-plan.js'
import {
  ChunkStore,
  FORWARD_INDEX_ENTRY,
  QuotaError,
  deleteStaleCaches,
  isQuotaError,
  onWatermark,
  type ChunkMeta,
  type EntryFailure
} from '../shared/chunk-store.js'
import { installEvictionPolicy } from '../shared/eviction.js'
import { normalizeRequestPath } from '../shared/entry-names.js'
import { contentTypeOf } from '../shared/mime.js'
import {
  PlayerError,
  type FromWorkerMessage,
  type LibraryLoad,
  type LoadSettings,
  type PackOffer,
  type PackPlan,
  type PackageRecord,
  type ToWorkerMessage,
  type WorkerReply
} from '../shared/protocol.js'
import { contentRange, parseRange, type ByteRange } from '../shared/range.js'
import { openSource } from '../shared/source.js'
import * as db from '../shared/idb.js'
import { type IndexedEntry, type LocatedEntry, PackageReader, dependenciesIn, explainMissingLibraries, libraryFolderNames, locationOf } from './package-reader.js'
import { libraryLoad, walkLibraries } from './library-load.js'
import { STORED } from '../shared/local-header.js'
import { CONTENT_CHECK_HEADER, buildFrameDocument, createNonce } from './frame-document.js'
import { loadSegment, matchRoute, routesFor, type LoadRef, type RouteMatch, type Routes } from './routes.js'
import { sliceStream } from '../shared/stream-utils.js'
import { waitForWatermark } from './watermark-wait.js'
import { quotaMessage } from '../shared/storage.js'

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
    event.respondWith(server.handleFetch(event, match).then((response) => keptAlive(event, response)))
  })
}

/**
 * The response with its body passed through a stream that tells when it has ended, and the event
 * held open until then, for at most `STREAM_KEEPALIVE_MS`: Firefox stops a worker thirty seconds
 * after its last event even while a body it is sending is still streaming. Called before
 * `respondWith`'s promise settles, while the event may still be extended.
 */
function keptAlive(event: FetchEvent, response: Response): Response {
  if (!response.body) return response
  let ended!: () => void
  const finished = new Promise<void>((resolve) => (ended = resolve))
  const bound = setTimeout(ended, STREAM_KEEPALIVE_MS)
  void finished.then(() => clearTimeout(bound))
  event.waitUntil(finished)
  const reader = response.body.getReader()
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await reader.read()
        if (done) {
          controller.close()
          ended()
        } else {
          controller.enqueue(value)
        }
      } catch (error) {
        controller.error(error)
        ended()
      }
    },
    cancel(reason) {
      ended()
      return reader.cancel(reason)
    }
  })
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
}

/**
 * How many loads' settings a package's row keeps. Each load registers its own under a new key,
 * and a frame whose key has gone gets a 404, so the bound is set well above the number of players
 * one browser has open on one package at once; each is a couple of kilobytes, mostly the frame
 * assets' URLs, and eviction reads every row.
 */
const KEPT_LOADS = 8

class VirtualServer {
  /**
   * Open readers, keyed by load (`loadSegment`): two loads of one package can differ in trust
   * and in the bundle attached. Lost on worker restart and rebuilt on the next request.
   */
  private readers = new Map<string, Promise<PackageReader>>()
  /**
   * Readers of packages that are played, which an `index` holds to carrying their libraries: not
   * a bundle or a part registered only to supply some. Checked there rather than as the archive
   * is opened, since an `index` that offers the pack plans what it lacks first.
   */
  private playable = new WeakSet<PackageReader>()
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
      for (const key of this.readers.keys()) if (key.startsWith(pkgId)) this.readers.delete(key)
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
          reply((await this.registerPackage(message.record, message.view)) ? { ok: true, type: 'ack', views: true } : { ok: true, type: 'ack' })
          return

        case 'index': {
          const load = { pkgId: message.pkgId, view: message.view }
          const reader = await this.refresh(load, await this.reader(load))
          if (message.pack) {
            const plan = await this.planFromPack(reader, message.pack, message.deep === true)
            if (plan) {
              reply({ ok: true, type: 'indexed', pkgId: message.pkgId, plan })
              return
            }
          }
          // A partial reader may simply not have what is missing yet; the final index says.
          if (!reader.partial && this.playable.has(reader)) reader.assertLibrariesPresent()
          if (message.deep && !reader.partial) {
            const served = reader.hasFallbacks ? await reader.mergedManifest() : reader.manifest
            const missing = await reader.missingDependencies(served, (located) => this.readJson(located))
            if (missing) throw new PlayerError('bad-archive', explainMissingLibraries(missing), { missingLibraries: missing })
          }
          if (!reader.partial) {
            await bookkeeping(db.updatePackage(message.pkgId, { status: 'indexed', lastPlayed: Date.now() }))
          }
          reply({
            ok: true,
            type: 'indexed',
            pkgId: message.pkgId,
            title: reader.title,
            prefetch: reader.prefetchable(),
            // Only where a read is a round trip. A picked file and a downloaded archive are
            // local, and their entries are inflated on demand for nothing.
            warm:
              reader.handle.descriptor.type === 'range-http' && !reader.partial
                ? reader.warmSpans()
                : undefined,
            ready: reader.partial ? await this.bootsEarly(reader) : undefined,
            revision: reader.revision(),
            metadata: reader.metadata,
            mainLibrary: typeof reader.manifest.mainLibrary === 'string' ? reader.manifest.mainLibrary : undefined
          })
          return
        }

        case 'attach-libraries': {
          const { pkgId, view } = message
          const changed = await db.changePackage(pkgId, (record) => {
            if (!record || !view) return record && attached(record, message)
            const settings = record.views?.[view]
            return settings && { ...record, views: { ...record.views, [view]: attached(settings, message) } }
          })
          if (view && !changed) throw new UnknownPackageError(pkgId)
          // Dropped so the next request rebuilds the reader with the bundle attached.
          this.readers.delete(loadSegment({ pkgId, view }))
          reply({ ok: true, type: 'ack' })
          return
        }

        case 'find-downloaded-libraries':
          reply({ ok: true, type: 'downloaded-libraries', pkgId: await this.downloadedBundle(message.url) })
          return

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
   * Writes the package's row, and the load's settings under its key when the element named one.
   * Merged in one transaction rather than replaced: the other loads' settings stay, and so do the
   * title and metadata, which are the archive's and which a reader already open for another load
   * will not write again.
   *
   * On an origin with no room left for even that, a row already there for the same package is
   * kept and serves: it names the same source — the id is a hash of it — and a package that
   * played before can play again from an archive nothing needs to store. No key can be written
   * then, so the load gets the row's own settings, the ones a route without a key is served
   * by, and only when they are what it asked for: an untrusted load is never handed a trusted
   * row. Returns whether the settings went under the key.
   */
  private async registerPackage(record: PackageRecord, view: string | undefined): Promise<boolean> {
    this.readers.delete(loadSegment({ pkgId: record.pkgId }))
    try {
      await db.changePackage(record.pkgId, (existing) => ({
        ...record,
        title: record.title ?? existing?.title,
        metadata: record.metadata ?? existing?.metadata,
        views: view ? newestLoads({ ...existing?.views, [view]: loadSettings(record) }) : existing?.views
      }))
    } catch (error) {
      const existing = isQuotaError(error) ? await db.getPackage(record.pkgId) : undefined
      if (!existing || (view && !sameSettings(existing, record))) throw error
      return false
    }
    if (view) this.readers.delete(loadSegment({ pkgId: record.pkgId, view }))
    return Boolean(view)
  }

  /* ---------------------------------------------------------------- request routing */

  async handleFetch(event: FetchEvent, match: RouteMatch): Promise<Response> {
    try {
      switch (match.kind) {
        case 'ping':
          return json({ version: VERSION })

        case 'frame':
          return await this.serveFrame(match)

        case 'boot':
          return await this.serveBoot(match)

        case 'entry':
          return await this.serveEntry(event, match, match.path)

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

  private async serveFrame(load: LoadRef): Promise<Response> {
    const record = await db.getPackage(load.pkgId)
    const settings = record && settingsOf(record, load.view)
    if (!record || !settings) return text('Unknown package', 404)

    await bookkeeping(db.touchPackage(load.pkgId))

    // For a runtime up to 0.2, whose boot script takes the list from the document: from the
    // reader the element's `index` left open, never a new one, since a picked file's reader asks
    // the page for the file through the frame, and the frame is what is being served. With no
    // reader the list is left out, and the frame asks for each script and takes a 404 as none. A
    // later runtime asks the `boot` route, whose answer carries it.
    const upgrades = settings.frameAssets.mainJs
      ? await this.readers.get(loadSegment(load))?.then(
          (reader) => reader.foldersWithUpgrades(),
          () => undefined
        )
      : undefined

    const nonce = createNonce()
    const body = buildFrameDocument({
      pkgId: load.pkgId,
      virtualRoot: `${this.routes.virtual}${loadSegment(load)}`,
      bootUrl: `${this.routes.boot}${loadSegment(load)}`,
      assets: settings.frameAssets,
      nonce,
      title: record.title,
      metadata: record.metadata,
      allowOrigins: settings.allowOrigins,
      frameOptions: settings.frameOptions,
      upgrades,
      language: settings.language,
      untrusted: settings.untrusted === true,
      workerScript: this.worker.location.href
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

  /**
   * What the frame loads (`LibraryLoad`): every library the content needs, its scripts and
   * stylesheets dependencies first, as `sw/library-load.ts` works them out from the manifest the
   * runtime is served — the merged one when archives are attached. The boot script of a runtime
   * after 0.2 asks for it as it starts. Asked by the frame rather than written into its document,
   * because only a request from the frame can open a reader the worker lost on a restart: for a
   * picked file the page is asked for the file through the frame, which, while its own document is
   * being served, does not exist yet.
   *
   * A library is looked up the way `get()` serves its files — the folder its version names, the
   * bare machine name, a compatible newer minor — and on an archive still arriving it is waited
   * for as any entry the frame asks for is. One that nothing answers for is named in the refusal.
   */
  private async serveBoot(load: LoadRef): Promise<Response> {
    // `let`: a wait on a partial reader hands back the reader to go on with, which is a new one
    // once the archive is whole, as in `serveEntry`.
    let reader = await this.refresh(load, await this.reader(load))
    const manifest = reader.hasFallbacks ? await reader.mergedManifest() : reader.manifest
    // A download that stops moving is a stall, answered with a retry as an entry's is, and not a
    // library the package lacks: a lookup that found one ends the walk's waiting.
    let stalled: string | undefined
    const walk = await walkLibraries(dependenciesIn(manifest), async (dependency) => {
      for (const folder of libraryFolderNames(dependency)) {
        const name = `${folder}/library.json`
        let located = reader.get(name)
        if (!located && reader.partial && !stalled) {
          const outcome = await this.awaitEntry(load, reader, name)
          if (outcome === 'stalled') {
            stalled = name
            return null
          }
          reader = outcome.reader
          located = outcome.located
        }
        if (located) {
          const served = located.entry.name
          return { folder: served.slice(0, served.indexOf('/')), library: await this.readJson(located) }
        }
      }
      return null
    })
    if (stalled) return retryLater(`The download has stalled before ${stalled}`)
    if (walk.missing.length > 0) {
      const missingLibraries = { mainLibrary: manifest.mainLibrary, folders: walk.missing.sort(), all: false }
      throw new PlayerError('bad-archive', explainMissingLibraries(missingLibraries), { missingLibraries })
    }
    const libraries = libraryLoad(manifest, walk)
    if (!libraries) throw new PlayerError('bad-archive', `h5p.json names ${String(manifest.mainLibrary)} as its main library, and does not list it among its dependencies`)
    return json({ ...libraries, upgrades: reader.foldersWithUpgrades() } satisfies LibraryLoad)
  }

  /* ---------------------------------------------------------------- package entries */

  private async serveEntry(event: FetchEvent, load: LoadRef, rawPath: string): Promise<Response> {
    const name = normalizeRequestPath(rawPath)
    if (name === null) return text('Bad entry path', 400)

    let reader = await this.reader(load)
    let located = reader.get(name)

    if (!located && reader.partial) {
      // On a partial index a miss is ambiguous: absent, or not arrived yet. Wait for the index to
      // grow until the entry appears or the answer becomes certain.
      const outcome = await this.awaitEntry(load, reader, name)
      if (outcome === 'stalled') return retryLater(`The download has stalled before ${name}`)
      reader = outcome.reader
      located = outcome.located
    }

    // A 404 here is load-bearing: h5p-standalone probes for `library.json` under both the
    // versioned and unversioned folder names and picks the shape that answers.
    if (!located) return new Response(null, { status: 404 })

    // An untrusted package's content is checked against its libraries' semantics by the boot
    // script before the runtime reads it, and only a boot script that does so asks with the
    // header. One older than the check would play the content as written, so it gets none.
    if (reader.untrusted && name === 'content/content.json' && event.request.headers.get(CONTENT_CHECK_HEADER) !== 'semantics') {
      return text(
        'This package is played untrusted, and the runtime does not check its content against its ' +
          "libraries' semantics: @missing-elements/h5p-runtime 0.2 or newer does.",
        403
      )
    }

    const response = await this.serveLocated(event, reader, name, located)
    // For an untrusted package the browser runs nothing whose type is not a script's: with
    // `script-src` naming the package's own path, a `content/` file of any listed type would
    // otherwise run as a script if injected markup named it, since a browser sniffs by default.
    return reader.untrusted ? withNoSniff(response) : response
  }

  private async serveLocated(event: FetchEvent, reader: PackageReader, name: string, located: LocatedEntry): Promise<Response> {
    // With a bundle attached, `h5p.json` is answered from the merged manifest rather than from
    // the archive: the dependency list in a content-only export names only the main library.
    if (name === 'h5p.json' && reader.hasFallbacks) {
      return json(await reader.mergedManifest())
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

    return entryResponse(entry, range, range === 'none' ? cached.body : sliceStream(cached.body, range))
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

    return entryResponse(entry, range, body)
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

    return entryResponse(entry, range, body)
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
    const askAgain = () => this.requestJob(event, pkgId, entry)

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
      // Its first flush, or word that it is queued behind another extraction: either way the
      // headers go out now and the body follows the watermark down. Only silence gives up.
      meta = await waitForWatermark(store, entry.name, 1, { onStall: askAgain, queuedIsEnough: true })
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
    load: LoadRef,
    reader: PackageReader,
    name: string
  ): Promise<{ reader: PackageReader; located: LocatedEntry | undefined } | 'stalled'> {
    const { pkgId } = load
    const store = new ChunkStore(pkgId)
    let wake: (() => void) | null = null
    const stopIndex = onWatermark(pkgId, FORWARD_INDEX_ENTRY, () => wake?.())
    const stopArchive = onWatermark(pkgId, ARCHIVE_ENTRY, () => wake?.())
    let lastAvailable = -1
    let lastAdvanceAt = Date.now()

    try {
      for (;;) {
        const current = await this.refresh(load, reader)
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
  private async requestJob(event: FetchEvent, pkgId: string, entry: IndexedEntry): Promise<void> {
    const key = `${pkgId}\u0000${entry.name}`
    if (this.requestedJobs.has(key)) return
    this.requestedJobs.add(key)
    // Cleared on a short timer rather than on completion: this worker may be killed in between,
    // and the page that owns the job may go away with its tab, so a request that is never
    // answered has to become askable again quickly.
    setTimeout(() => this.requestedJobs.delete(key), JOB_REQUEST_DEDUPE_MS)

    // The entry's location rides along: the Jobs worker has no index of its own to look it up in.
    await this.postToClient(event.clientId, {
      type: 'need-job',
      pkgId,
      entry: entry.name,
      location: locationOf(entry)
    })
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

  /**
   * The newest library bundle downloaded whole from `url`, if one is still in the chunk store.
   * Whole, not merely registered: a download cut short, or a bundle evicted since, has a row and
   * not the bytes. More than one row can name the same URL, because the id also hashes the
   * host's validator, so a bundle that changed was downloaded again under a new one.
   */
  private async downloadedBundle(url: string): Promise<string | null> {
    const rows = (await db.allPackages())
      .filter((row) => row.role === 'libraries' && row.source.type === 'chunked' && row.source.url === url)
      .sort((a, b) => b.lastPlayed - a.lastPlayed)

    for (const row of rows) {
      if ((await new ChunkStore(row.pkgId).getArchiveMeta())?.complete) return row.pkgId
    }
    return null
  }

  /* ---------------------------------------------------------------- readers */

  /**
   * Returns the reader for a load of a package, rebuilding it from the `packages` table when the
   * worker has been restarted since it was last used.
   */
  private reader(load: LoadRef): Promise<PackageReader> {
    const key = loadSegment(load)
    const existing = this.readers.get(key)
    if (existing) return existing

    const opening = this.openReader(load)
    this.readers.set(key, opening)
    opening.catch(() => {
      if (this.readers.get(key) === opening) this.readers.delete(key)
    })
    return opening
  }

  private async openReader(load: LoadRef): Promise<PackageReader> {
    const { pkgId } = load
    const record = await db.getPackage(pkgId)
    const settings = record && settingsOf(record, load.view)
    if (!record || !settings) throw new UnknownPackageError(pkgId)

    const file = record.source.type === 'file' ? await this.fileFor(pkgId) : undefined
    // A bundle registered to supply libraries is the host's choice, never the package's.
    const untrusted = settings.untrusted === true && record.role !== 'libraries'
    const { libraryPkgId, parts = [], superseded = [] } = settings
    // The pack's parts first, then a bundle: the parts are what was planned for this package.
    const attached = [...parts, ...(libraryPkgId ? [libraryPkgId] : [])]

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
        const partial = await PackageReader.fromForwardIndex(pkgId, partialHandle, snapshot, { untrusted, superseded })
        for (const id of attached) partial.use(await this.reader({ pkgId: id }))
        await this.rememberManifest(record, partial)
        return partial
      }
    }

    const handle = await openSource(pkgId, record.source, file)

    // Not held to its libraries here: an `index` does that, after any plan from the pack, and a
    // bundle or a part registered to supply libraries to something else never is.
    const reader = await PackageReader.open(pkgId, handle, { requireLibraries: false, untrusted, superseded })
    for (const id of attached) reader.use(await this.reader({ pkgId: id }))
    await reader.settleRevision()
    if (record.role !== 'libraries') this.playable.add(reader)

    await this.rememberManifest(record, reader)
    return reader
  }

  /**
   * What the library pack has to supply before the package can play, or `null` when nothing:
   * the parts it needs, and the package's own folders that newer versions among them replace
   * (`planPack`). The pack's own index for the version this release pins, or the one of a copy
   * the element hands over.
   *
   * A partial reader plans once what the plan needs has arrived: for an untrusted package, the
   * manifest and the content; otherwise what the boot needs, the folders `h5p.json` declares, so
   * that the parts are attached before the frame boots early. A package without its libraries
   * waits for the whole archive, as it did, since what it lacks cannot be told before the end.
   */
  private async planFromPack(reader: PackageReader, offer: PackOffer, deep: boolean): Promise<PackPlan | null> {
    if (reader.partial && !(reader.untrusted ? reader.get('h5p.json') && reader.contentArrived : reader.bootReady())) return null
    const pack =
      'pinned' in offer ? PACK_INDEX.map((library) => ({ ...library, url: `${LIBRARY_PACK_BASE}${library.folder}.h5p` })) : packLibrariesIn(offer.libraries)
    // A `library.json` over HTTP is two ranged requests until the warm has cached it; from a
    // picked file or a download, or once warmed, it is a local read.
    const readable = deep || reader.partial || reader.handle.descriptor.type !== 'range-http'
    return planPack({
      own: await reader.ownLibraries(readable ? (located) => this.readJson(located) : undefined),
      provided: reader.providedLibraries(),
      roots: await reader.contentDependencies(),
      params: await reader.contentParameters(),
      pack,
      refresh: offer.refresh === true && !reader.untrusted,
      fill: offer.fill !== false
    })
  }

  /**
   * What the frame document shows of the manifest — the title, and the metadata behind the
   * copyright dialog and the statements' object name — kept on the record, because the frame
   * route reads the record and never opens a reader. A partial reader's manifest counts too,
   * once `h5p.json` has arrived, so a host without `Range` gets it on the first boot.
   */
  private async rememberManifest(record: PackageRecord, reader: PackageReader): Promise<void> {
    const patch: Partial<PackageRecord> = {}
    const { title, metadata } = reader
    if (title && title !== record.title) patch.title = title
    if (metadata && JSON.stringify(metadata) !== JSON.stringify(record.metadata)) patch.metadata = metadata
    if (Object.keys(patch).length) await db.updatePackage(record.pkgId, patch)
  }

  /**
   * Brings a partial reader up to date with the latest forward index, or — once the archive is
   * whole — drops it for a reader built from the central directory, which is the authority.
   */
  private async refresh(load: LoadRef, reader: PackageReader): Promise<PackageReader> {
    if (!reader.partial) return reader

    const store = new ChunkStore(load.pkgId)
    const meta = await store.getArchiveMeta()
    if (meta?.complete) {
      this.readers.delete(loadSegment(load))
      return this.reader(load)
    }

    const snapshot = await store.getForwardIndex()
    if (!snapshot) return reader
    const manifest = reader.manifest
    await reader.absorb(snapshot)
    // `h5p.json` has just arrived. The reader was opened before it, at the first progress report,
    // so its title, metadata and language reach the record here or not until the download is
    // whole — after the frame has booted early without them, in the element's language (#57).
    if (reader.manifest !== manifest) {
      const record = await db.getPackage(load.pkgId)
      if (record) await this.rememberManifest(record, reader)
    }
    return reader
  }

  /** An entry's JSON, from the cache when it is there, as every library's is after the warm. */
  /**
   * Whether a download still under way can boot the frame: `bootReady`, and no library the
   * declared ones need in turn absent so far. One that is absent is waited for — it may still
   * arrive — and if it never does, the deep check after the download attaches a bundle that has
   * it or refuses the package by name. Booted before then, the runtime asked for its
   * `library.json` while the bundle was not attached yet and ended on the 404, read as JSON.
   */
  private async bootsEarly(reader: PackageReader): Promise<boolean> {
    if (!reader.bootReady()) return false
    return (await reader.missingDependencies(reader.manifest, (located) => this.readJson(located))) === null
  }

  private async readJson({ reader, entry }: LocatedEntry): Promise<unknown> {
    const cached = await new ChunkStore(reader.pkgId).getWhole(entry.name)
    return (cached ?? new Response(reader.inflate(entry))).json()
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
      }, FILE_HANDOVER_TIMEOUT_MS)
    }
    this.pendingFiles.set(pkgId, request)

    await this.postToClient('', { type: 'need-file', pkgId })
    return promise
  }
}

/* ------------------------------------------------------------------ helpers */

/**
 * What a load asked for: the settings under its key, or, for a frame an older element opened,
 * the row's own, which are the last registration's. `undefined` for a key the row does not hold.
 */
function settingsOf(record: PackageRecord, view: string | undefined): Omit<LoadSettings, 'registered'> | undefined {
  return view ? record.views?.[view] : record
}

/**
 * A load's settings, or a row's, with what an `attach-libraries` brings: a bundle replaces the one
 * before, and parts of the pack and the folders they replace are added to those already there.
 */
function attached<T extends { libraryPkgId?: string; parts?: string[]; superseded?: string[] }>(
  settings: T,
  { libraryPkgId, parts = [], superseded = [] }: { libraryPkgId?: string; parts?: string[]; superseded?: string[] }
): T {
  const merged = (before: string[] | undefined, added: string[]) => [...new Set([...(before ?? []), ...added])]
  return {
    ...settings,
    ...(libraryPkgId ? { libraryPkgId } : {}),
    ...(parts.length ? { parts: merged(settings.parts, parts) } : {}),
    ...(superseded.length ? { superseded: merged(settings.superseded, superseded) } : {})
  }
}

/** A registration's settings, as kept under its load key; a bundle is attached by the load itself. */
function loadSettings(record: PackageRecord): LoadSettings {
  const { frameAssets, allowOrigins, frameOptions, language, untrusted } = record
  return { frameAssets, allowOrigins, frameOptions, language, untrusted, registered: Date.now() }
}

function sameSettings(a: PackageRecord, b: PackageRecord): boolean {
  const { registered: _a, ...left } = loadSettings(a)
  const { registered: _b, ...right } = loadSettings(b)
  return JSON.stringify(left) === JSON.stringify(right)
}

function newestLoads(views: Record<string, LoadSettings>): Record<string, LoadSettings> {
  return Object.fromEntries(
    Object.entries(views)
      .sort(([, a], [, b]) => b.registered - a.registered)
      .slice(0, KEPT_LOADS)
  )
}

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

/**
 * The same response with `X-Content-Type-Options: nosniff`, built anew because one read out of the
 * Cache API has headers that cannot be changed. The body passes through as it streams.
 */
function withNoSniff(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set('x-content-type-options', 'nosniff')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

function unsatisfiable(size: number): Response {
  return new Response(null, {
    status: 416,
    headers: { 'content-range': `bytes */${size}`, 'accept-ranges': 'bytes' }
  })
}

function retryLater(message: string): Response {
  return text(message, 503, { 'retry-after': '1' })
}

/**
 * An entry's body as the answer to its request: the whole of it as a `200` when no range was
 * asked for, else the `206` the range gets, with the length and `Content-Range` to match.
 */
function entryResponse(entry: IndexedEntry, range: ByteRange | 'none', body: BodyInit | null): Response {
  if (range === 'none') return new Response(body, { status: 200, headers: entryHeaders(entry, { length: entry.size }) })
  return new Response(body, {
    status: 206,
    headers: entryHeaders(entry, { length: range.end - range.start + 1, contentRange: contentRange(range, entry.size) })
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

function text(body: string, status: number, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...headers }
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
