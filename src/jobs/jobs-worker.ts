/// <reference lib="webworker" />
import { ARCHIVE_ENTRY, CHUNK_SIZE, INPUT_LIVENESS_MS, WARM_ENTRY } from '../shared/constants'
import { ChunkStore, QuotaError, announceQueued, announceRunning, isQuotaError } from '../shared/chunk-store'
import { installEvictionPolicy } from '../shared/eviction'
import { LocalHeaderScanner } from '../shared/forward-index'
import { DEFLATE, LOCAL_HEADER_FIXED_SIZE, STORED, localHeaderDataStart } from '../shared/local-header'
import { packageLockName, packageLockPrefix } from '../shared/locks'
import {
  PlayerError,
  type EntryLocation,
  type ErrorCode,
  type FromJobsMessage,
  type SourceDescriptor,
  type ToJobsMessage,
  type WarmSpan
} from '../shared/protocol'
import { openSource, type SourceHandle } from '../shared/source'
import { streamSpan } from '../shared/span-stream'
import { quotaMessage } from '../shared/storage'
import { createChunkWriter } from './chunk-writer'
import { JobQueue, type ExtractJob } from './job-queue'
import { warmPackage } from './warm'

/**
 * The Jobs worker. Everything that takes longer than a Service Worker event is allowed to lives
 * here: downloading an archive from a host that ignores `Range`, warming the libraries, and
 * inflating a large deflated entry into chunks. It runs in the page, so it lives as long as the
 * tab and can be killed only by the user navigating away.
 *
 * It carries no zip.js and reads no index. Every job is told where in the archive its bytes are
 * — the warm gets its spans, an extraction gets its entry's location — by the Service Worker,
 * which has the central directory already; the worker steps over a local header and inflates
 * with the native `DecompressionStream`. Reading the index here as well cost a round of ranged
 * requests per worker and a hundred and sixty kilobytes in every page that embeds the element.
 *
 * Jobs are guarded by a Web Lock named after the package and entry, so two tabs playing the same
 * package share one extraction instead of racing to write the same chunks.
 */

const scope = self as unknown as DedicatedWorkerGlobalScope

const inFlight = new Map<string, AbortController>()
/**
 * Extractions waiting their turn. They run one at a time — see `JobQueue` for the order — and
 * while they wait they announce themselves as queued on the watermark channel, so a request that
 * is waiting on one hears a live job rather than a silent one. Downloads and warming are not
 * queued: both happen before the frame boots, with nothing to compete against.
 */
const queue = new JobQueue()
let extracting: string | null = null
let heartbeat: ReturnType<typeof setInterval> | null = null
/** Files handed over by the page for local-file packages, kept for the life of the worker. */
const files = new Map<string, Blob>()

function send(message: FromJobsMessage): void {
  scope.postMessage(message)
}

// The large writes happen here, so this is where quota runs out: the policy has to be installed
// here as well as in the Service Worker, or a full disk evicts whatever the browser lists first.
// Nothing to forget on an eviction: this worker keeps no reader or index per package.
installEvictionPolicy(() => {})

/**
 * Doubles as the Web Lock name, which is why it carries the package prefix: while this job holds
 * it, eviction anywhere on the origin leaves the package alone.
 */
function jobKey(pkgId: string, entry?: string): string {
  return packageLockName(pkgId, entry ?? ARCHIVE_ENTRY)
}

scope.addEventListener('message', (event: MessageEvent<ToJobsMessage & { file?: File }>) => {
  const message = event.data
  if (!message) return

  if (message.type === 'abort') {
    queue.drop(message.pkgId)
    syncHeartbeat()
    for (const [key, controller] of inFlight) {
      if (!key.startsWith(packageLockPrefix(message.pkgId))) continue
      controller.abort()
      // Released now, not once the abort has finished unwinding. That takes several tasks — the
      // pipe has to tear down — and a fresh request for the same key can land in between: a
      // second press of Play posts `abort` and `download` back to back. Left in the map, the
      // new one is dropped as a duplicate of a job that is already dying, and nothing answers it.
      inFlight.delete(key)
    }
    return
  }

  if (message.file) files.set(message.pkgId, message.file)

  if (message.type === 'extract') {
    scheduleExtract({
      pkgId: message.pkgId,
      entry: message.entry,
      location: message.location,
      source: message.source,
      prefetch: message.prefetch === true
    })
    return
  }

  void run(message)
})

/* ------------------------------------------------------------------ the extraction queue */

function scheduleExtract(job: ExtractJob): void {
  // Running already: the request is a duplicate, and the running job is never interrupted.
  if (extracting === jobKey(job.pkgId, job.entry)) return
  queue.request(job)
  syncHeartbeat()
  pump()
}

function pump(): void {
  if (extracting !== null) return
  const job = queue.next()
  if (!job) {
    syncHeartbeat()
    return
  }
  const key = jobKey(job.pkgId, job.entry)
  extracting = key
  syncHeartbeat()
  void run({
    type: 'extract',
    pkgId: job.pkgId,
    entry: job.entry,
    location: job.location,
    source: job.source
  }).finally(() => {
    if (extracting === key) extracting = null
    pump()
  })
}

/** While anything waits, every queued entry is announced alive once per liveness interval. */
function syncHeartbeat(): void {
  if (queue.size === 0) {
    if (heartbeat !== null) clearInterval(heartbeat)
    heartbeat = null
    return
  }
  if (heartbeat !== null) return
  const announce = () => {
    for (const job of queue.waiting()) announceQueued(job.pkgId, job.entry)
  }
  announce()
  heartbeat = setInterval(announce, INPUT_LIVENESS_MS)
}

async function run(message: Exclude<ToJobsMessage, { type: 'abort' }>): Promise<void> {
  const entry = message.type === 'extract' ? message.entry : message.type === 'warm' ? WARM_ENTRY : undefined
  const key = jobKey(message.pkgId, entry)

  if (inFlight.has(key)) return

  const controller = new AbortController()
  inFlight.set(key, controller)

  try {
    // Shared across tabs: whoever gets the lock does the work, the others wait and then find the
    // watermark already where they need it.
    await navigator.locks.request(key, { signal: controller.signal }, async () => {
      if (message.type === 'download') {
        await downloadArchive(message.pkgId, message.source, controller.signal)
      } else if (message.type === 'warm') {
        await warmJob(message.pkgId, message.source, message.spans, controller.signal)
      } else {
        await extractEntry(message.pkgId, message.entry, message.location, message.source, controller.signal)
      }
    })
  } catch (error) {
    if (controller.signal.aborted) return
    const code = codeFor(error)
    const text = error instanceof Error ? error.message : String(error)
    // A warm that could not even start is not a failed entry; nothing waits on its record.
    if (entry && entry !== WARM_ENTRY) await recordFailure(message.pkgId, entry, code, text)
    send({ type: 'failed', pkgId: message.pkgId, entry, code, message: text })
  } finally {
    // Only its own entry: an abort may already have handed the key to a successor.
    if (inFlight.get(key) === controller) inFlight.delete(key)
  }
}

/* ------------------------------------------------------------------ download */

/**
 * Downloads an archive into the chunk store. The central directory sits at the end of a zip, so
 * a host that ignores `Range` forces the whole file down before anything can be indexed.
 *
 * A partial download is resumable: the watermark is always a chunk-aligned prefix, so the retry
 * asks for `bytes=N-`. A host that answers `200` to that ignored the header, and the download
 * starts over.
 */
async function downloadArchive(
  pkgId: string,
  source: SourceDescriptor,
  signal: AbortSignal
): Promise<void> {
  if (source.type !== 'chunked') {
    throw new PlayerError('network', 'Only a chunked source is downloaded ahead of play')
  }

  const store = new ChunkStore(pkgId)
  const existing = await store.getArchiveMeta()

  if (existing?.complete) {
    send({ type: 'done', pkgId, size: existing.size ?? existing.available })
    return
  }

  // Only whole chunks can be resumed from: a partial chunk may have been flushed mid-fill.
  let startOffset = existing ? Math.floor(existing.available / CHUNK_SIZE) * CHUNK_SIZE : 0

  let response = await fetch(source.url, {
    signal,
    cache: 'no-store',
    headers: startOffset > 0 ? { Range: `bytes=${startOffset}-` } : undefined
  })

  if (startOffset > 0 && response.status !== 206) {
    // The host ignored the resume request and is sending the whole file again.
    startOffset = 0
    if (response.status !== 200) {
      response = await fetch(source.url, { signal, cache: 'no-store' })
    }
  }

  if (!response.ok && response.status !== 206) {
    throw new PlayerError('network', `${source.url} returned ${response.status}`)
  }
  if (!response.body) {
    throw new PlayerError('network', 'The archive response had no body')
  }

  // The probe's size first: it was measured through a ranged request, which browsers make with
  // `Accept-Encoding: identity`. This response is a plain `GET` when nothing is being resumed,
  // and a host that compresses the archive answers that with the compressed copy's length.
  const declared = response.headers.get('content-length')
  const totalSize = source.size ?? (declared ? Number(declared) + startOffset : null)

  // Index the archive as it passes: a host that ignores `Range` would otherwise keep every entry
  // hostage until the central directory arrives, at the very end. The scanner reads the local
  // headers off the same bytes on their way to the chunk store, and what it has found is
  // published beside the watermark so the Service Worker can start serving from it.
  const scanner = new LocalHeaderScanner()
  if (startOffset > 0) {
    // A resumed download starts mid-archive; the scanner has to have seen the prefix.
    await store.readRange(ARCHIVE_ENTRY, { start: 0, end: startOffset - 1 }).pipeTo(
      new WritableStream({ write: (chunk) => scanner.push(chunk) })
    )
  }

  let published = -1
  let publishing: Promise<void> = Promise.resolve()
  const publishIndex = (final: boolean) => {
    if (final) scanner.finish()
    const snapshot = scanner.snapshot()
    if (!final && snapshot.entries.length === published) return publishing
    published = snapshot.entries.length
    // Serialised: two snapshots racing to the same record could land the older one last.
    publishing = publishing.then(() => store.setForwardIndex(snapshot))
    return publishing
  }

  const indexer = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      scanner.push(chunk)
      controller.enqueue(chunk)
    }
  })

  try {
    await response.body.pipeThrough(indexer).pipeTo(
      createChunkWriter({
        store,
        entry: ARCHIVE_ENTRY,
        totalSize,
        startOffset,
        onProgress: (loaded) => {
          send({ type: 'progress', pkgId, loaded, total: totalSize })
          void publishIndex(false)
        }
      }),
      { signal }
    )
  } catch (error) {
    if (!(error instanceof QuotaError)) throw error
    // The whole archive has to land here — that is what a host without `Range` costs — so the
    // number that matters is the archive's size against what the browser gives the site.
    throw new QuotaError(
      `${await quotaMessage('this package', totalSize)} Its host does not support partial ` +
        'downloads, so the whole archive has to be stored before it can play.'
    )
  }
  await publishIndex(true)

  const meta = await store.getArchiveMeta()
  send({ type: 'done', pkgId, size: meta?.size ?? meta?.available ?? 0 })
}

/* ------------------------------------------------------------------ warming */

/**
 * Pulls the spans the index named into the cache before the frame boots. `warm.ts` holds the
 * walk; this is the job around it: the marker that spares a repeat, the handle, the reports.
 * Whatever stops it short of the end — no room, a host that stops answering, a span that is not
 * what the index said — the frame boots anyway and the virtual server serves the rest on demand,
 * so a warm ends in `done` or in an abort, and only a job that could not start ends in `failed`.
 */
async function warmJob(
  pkgId: string,
  source: SourceDescriptor,
  spans: WarmSpan[],
  signal: AbortSignal
): Promise<void> {
  const store = new ChunkStore(pkgId)
  const marker = await store.getWhole(WARM_ENTRY)
  if (marker) {
    await marker.body?.cancel()
    send({ type: 'done', pkgId, entry: WARM_ENTRY, size: 0 })
    return
  }

  const handle = await openSource(pkgId, source, files.get(pkgId))
  let landed = 0
  try {
    await warmPackage(handle, spans, store, {
      signal,
      onProgress: ({ loaded, total }) => {
        landed = loaded
        send({ type: 'progress', pkgId, entry: WARM_ENTRY, loaded, total })
      }
    })
  } catch (error) {
    if (signal.aborted) return
    console.warn('[h5p-player] warming stopped early; the rest is served on demand:', error)
  }
  if (signal.aborted) return
  send({ type: 'done', pkgId, entry: WARM_ENTRY, size: landed })
}

/* ------------------------------------------------------------------ extraction */

/**
 * Inflates one large deflated entry into chunks. A single pass: zip.js streams the inflate and
 * the chunk writer publishes the watermark behind it, so the Service Worker can start serving a
 * prefix while the rest is still coming.
 */
async function extractEntry(
  pkgId: string,
  entryName: string,
  location: EntryLocation,
  source: SourceDescriptor,
  signal: AbortSignal
): Promise<void> {
  const store = new ChunkStore(pkgId)
  const existing = await store.getMeta(entryName)

  if (existing?.complete) {
    send({ type: 'done', pkgId, entry: entryName, size: existing.size ?? existing.available })
    return
  }

  if (location.method !== STORED && location.method !== DEFLATE) {
    throw new PlayerError('bad-archive', `${entryName} is compressed with a method this player cannot extract`)
  }

  // A job only ever extracts from the archive it was asked about: the Service Worker resolves
  // which archive an entry lives in, addresses the job at that one, and says where in it the
  // entry is. `partial`: an entry the forward index named lies below the watermark of an archive
  // that is still downloading, and is whole there — the index only names an entry once its
  // bytes have all arrived.
  const handle = await openSource(pkgId, source, files.get(pkgId), { partial: true })
  const start = location.dataStart ?? (await dataStartOf(handle, entryName, location))
  const end = start + location.compressedSize - 1
  if (end >= handle.size) {
    throw new PlayerError('bad-archive', `${entryName} extends past the end of the archive`)
  }

  // A deflate stream has no restart points, so a partial extraction is discarded rather than
  // resumed. This is the reason extraction never runs in the Service Worker: a kill mid-inflate
  // would repeat this from zero on every attempt.
  await store.setMeta(entryName, { size: location.size, available: 0, complete: false })

  const stopReporting = reportRunning(handle, pkgId, entryName)
  try {
    await inflated(streamSpan(handle, { start, end }), location).pipeTo(
      createChunkWriter({
        store,
        entry: entryName,
        totalSize: location.size,
        onProgress: (loaded) =>
          send({ type: 'progress', pkgId, entry: entryName, loaded, total: location.size })
      }),
      { signal }
    )
  } catch (error) {
    if (!(error instanceof QuotaError)) throw error
    throw new QuotaError(await quotaMessage('this file', location.size))
  } finally {
    stopReporting()
  }

  send({ type: 'done', pkgId, entry: entryName, size: location.size })
}

/** Where an entry's data begins: its local header, read for the name and extra lengths in front. */
async function dataStartOf(handle: SourceHandle, entryName: string, location: EntryLocation): Promise<number> {
  if (location.header === undefined) {
    throw new PlayerError('bad-archive', `${entryName} has no known location in the archive`)
  }
  const header = await handle.read({
    start: location.header,
    end: location.header + LOCAL_HEADER_FIXED_SIZE - 1
  })
  const start = localHeaderDataStart(location.header, header)
  if (start === null) throw new PlayerError('bad-archive', `${entryName} has a malformed local header`)
  return start
}

/** The entry's bytes as stored, or inflated when it is deflated. */
function inflated(compressed: ReadableStream<Uint8Array>, location: EntryLocation): ReadableStream<Uint8Array> {
  if (location.method === STORED || location.compressedSize === 0) return compressed
  // The lib types the codec's input as `BufferSource`, stricter than the plain views it gets.
  const inflate = new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>
  return compressed.pipeThrough(inflate)
}

/**
 * Announces, every `INPUT_LIVENESS_MS` while a job runs, that it is running — with the bytes it
 * has taken from the network when the source counts them — so the Service Worker's stall bound
 * can tell a job that is alive from one that died with its tab. Whether bytes are arriving is not
 * the question: the job's own reads bound a silent link and give up on their own terms, and a
 * waiter that gave up first ended a media element's response with an error it never recovers
 * from. Nothing is written; the notice rides the watermark channel.
 */
function reportRunning(handle: SourceHandle, pkgId: string, entry: string): () => void {
  const announce = () => announceRunning(pkgId, entry, handle.received)
  announce()
  const timer = setInterval(announce, INPUT_LIVENESS_MS)
  return () => clearInterval(timer)
}

/**
 * Leaves a failed extraction's verdict where the Service Worker will look for it. Its chunks go —
 * a deflate stream cannot be resumed, and until the next attempt they only hold space the rest of
 * the package may need — and the meta stays, carrying the failure, so a request for the entry is
 * answered with it at once rather than after a stall, and retried only once it has aged.
 */
async function recordFailure(pkgId: string, entry: string, code: ErrorCode, message: string): Promise<void> {
  const store = new ChunkStore(pkgId)
  try {
    const existing = await store.getMeta(entry)
    await store.discardChunks(entry)
    await store.setMeta(entry, {
      size: existing?.size ?? null,
      available: 0,
      complete: false,
      error: { code, message, at: Date.now() }
    })
  } catch {
    // A store that cannot even take the note leaves the request to the stall path.
  }
}

function codeFor(error: unknown): ErrorCode {
  if (error instanceof PlayerError) return error.code
  if (error instanceof QuotaError || isQuotaError(error)) return 'quota'
  return 'network'
}
