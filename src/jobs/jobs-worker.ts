/// <reference lib="webworker" />
import { configure } from '@zip.js/zip.js'
import { ARCHIVE_ENTRY, CHUNK_SIZE, INPUT_LIVENESS_MS } from '../shared/constants'
import { ChunkStore, QuotaError, announceActivity, isQuotaError } from '../shared/chunk-store'
import { installEvictionPolicy } from '../shared/eviction'
import { LocalHeaderScanner } from '../shared/forward-index'
import { packageLockName, packageLockPrefix } from '../shared/locks'
import {
  PlayerError,
  type ErrorCode,
  type FromJobsMessage,
  type SourceDescriptor,
  type ToJobsMessage
} from '../shared/protocol'
import { openSource, type SourceHandle } from '../shared/source'
import { quotaMessage } from '../shared/storage'
import { PackageReader } from '../sw/package-reader'
import { createChunkWriter } from './chunk-writer'

/**
 * The Jobs worker. Everything that takes longer than a Service Worker event is allowed to lives
 * here: downloading an archive from a host that ignores `Range`, and inflating a large deflated
 * entry into chunks. It runs in the page, so it lives as long as the tab and can be killed only
 * by the user navigating away.
 *
 * Jobs are guarded by a Web Lock named after the package and entry, so two tabs playing the same
 * package share one extraction instead of racing to write the same chunks.
 */

// Inflate here rather than in a nested worker: this worker already exists to be long-lived,
// and `DecompressionStream` does the deflate without another thread hop.
configure({ useWebWorkers: false })

const scope = self as unknown as DedicatedWorkerGlobalScope

const inFlight = new Map<string, AbortController>()
/** Files handed over by the page for local-file packages, kept for the life of the worker. */
const files = new Map<string, Blob>()
/**
 * Readers by package, kept for the life of the worker. A central directory does not change, and
 * opening one is a round of ranged requests plus an inflate of `h5p.json` — paid per extraction
 * job before this, for an answer the previous job already had.
 */
const readers = new Map<string, Promise<PackageReader>>()

function readerFor(pkgId: string, source: SourceDescriptor): Promise<PackageReader> {
  const known = readers.get(pkgId)
  if (known) return known

  const opening = (async () => {
    const handle = await openSource(pkgId, source, files.get(pkgId))
    return PackageReader.open(pkgId, handle, { requireLibraries: false })
  })()
  readers.set(pkgId, opening)
  opening.catch(() => readers.delete(pkgId))
  return opening
}

function send(message: FromJobsMessage): void {
  scope.postMessage(message)
}

// The large writes happen here, so this is where quota runs out: the policy has to be installed
// here as well as in the Service Worker, or a full disk evicts whatever the browser lists first.
installEvictionPolicy((pkgId) => {
  readers.delete(pkgId)
})

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

  void run(message)
})

async function run(message: Exclude<ToJobsMessage, { type: 'abort' }>): Promise<void> {
  const entry = message.type === 'extract' ? message.entry : undefined
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
      } else {
        await extractEntry(message.pkgId, message.entry, message.source, controller.signal)
      }
    })
  } catch (error) {
    if (controller.signal.aborted) return
    const code = codeFor(error)
    const text = error instanceof Error ? error.message : String(error)
    if (entry) await recordFailure(message.pkgId, entry, code, text)
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

  const declared = response.headers.get('content-length')
  const totalSize = declared ? Number(declared) + startOffset : source.size

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

/* ------------------------------------------------------------------ extraction */

/**
 * Inflates one large deflated entry into chunks. A single pass: zip.js streams the inflate and
 * the chunk writer publishes the watermark behind it, so the Service Worker can start serving a
 * prefix while the rest is still coming.
 */
async function extractEntry(
  pkgId: string,
  entryName: string,
  source: SourceDescriptor,
  signal: AbortSignal
): Promise<void> {
  const store = new ChunkStore(pkgId)
  const existing = await store.getMeta(entryName)

  if (existing?.complete) {
    send({ type: 'done', pkgId, entry: entryName, size: existing.size ?? existing.available })
    return
  }

  // A job only ever extracts from the archive it was asked about: the Service Worker resolves
  // which archive an entry lives in and addresses the job at that one.
  const reader = await readerFor(pkgId, source)
  const located = reader.get(entryName)

  if (!located) {
    throw new PlayerError('bad-archive', `${entryName} is not in the archive`)
  }
  const { entry } = located

  // A deflate stream has no restart points, so a partial extraction is discarded rather than
  // resumed. This is the reason extraction never runs in the Service Worker: a kill mid-inflate
  // would repeat this from zero on every attempt.
  await store.setMeta(entryName, { size: entry.size, available: 0, complete: false })

  const stopReporting = reportInput(reader.handle, pkgId, entryName)
  try {
    await reader.inflate(entry).pipeTo(
      createChunkWriter({
        store,
        entry: entryName,
        totalSize: entry.size,
        onProgress: (loaded) =>
          send({ type: 'progress', pkgId, entry: entryName, loaded, total: entry.size })
      }),
      { signal }
    )
  } catch (error) {
    if (!(error instanceof QuotaError)) throw error
    throw new QuotaError(await quotaMessage('this file', entry.size))
  } finally {
    stopReporting()
  }

  send({ type: 'done', pkgId, entry: entryName, size: entry.size })
}

/**
 * Announces, while a job runs, the bytes it has taken from the network, so the Service Worker's
 * stall bound can tell a slow start from a dead job. Only for a network handle: a local read has
 * no silence worth reporting. Nothing is written; the notice rides the watermark channel.
 */
function reportInput(handle: SourceHandle, pkgId: string, entry: string): () => void {
  if (handle.received === undefined) return () => {}
  let last = handle.received
  const timer = setInterval(() => {
    const now = handle.received ?? last
    if (now === last) return
    last = now
    announceActivity(pkgId, entry, now)
  }, INPUT_LIVENESS_MS)
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
