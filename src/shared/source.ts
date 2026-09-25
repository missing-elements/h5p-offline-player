import { ARCHIVE_ENTRY } from './constants'
import { ChunkStore } from './chunk-store'
import { PlayerError, type RemoteSourceDescriptor, type SourceDescriptor } from './protocol'
import type { ByteRange } from './range'
import { resilientStream } from './resilient-stream'
import { sliceStream } from './stream-utils'

/**
 * Source adapters. One interface — a size and a byte-range read — over the three ways an archive
 * can be reached. The Service Worker and the Jobs worker both build handles from the persisted
 * descriptor, so neither has to know how the package was opened.
 *
 * The zip.js side — the reader that presents a handle to zip.js, and the segmented fetch behind
 * it — lives in `source-reader.ts`, so that the element, which only probes a source, does not
 * pull zip.js into its own bundle.
 */

export interface SourceHandle {
  readonly descriptor: SourceDescriptor
  /** Total size in bytes. Known for every handle by the time one is built. */
  readonly size: number
  /** Reads an inclusive byte range into memory. Callers keep these bounded. */
  read(range: ByteRange): Promise<Uint8Array>
  /** Streams an inclusive byte range. Used to serve large stored entries without buffering. */
  stream(range: ByteRange): Promise<ReadableStream<Uint8Array>>
  /**
   * Bytes taken from the network so far, over every read and stream of this handle. Only a
   * network handle counts: it is how a job shows it is alive while the inflate has produced
   * nothing yet, and a local read has no such silence.
   */
  readonly received?: number
}

/* ------------------------------------------------------------------ probing */

/** Aborts the body of a response we only wanted the headers of. */
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // A cancelled body that errors tells us nothing we act on.
  }
}

function parseContentRangeSize(header: string | null): number | null {
  if (!header) return null
  const match = /\/(\d+)$/.exec(header.trim())
  return match ? Number(match[1]) : null
}

function readValidator(response: Response): string | null {
  // Both need `Access-Control-Expose-Headers` to be readable, so this is usually null. When it
  // is readable, a republished archive at the same URL gets a fresh pkgId instead of stale chunks.
  return response.headers.get('etag') ?? response.headers.get('last-modified')
}

/**
 * Decides how an archive can be reached.
 *
 * A single `GET` with `Range: bytes=0-0` answers both questions that matter: a host without CORS
 * rejects it at the network layer, and a host that ignores `Range` answers `200` with the whole
 * body (which is why the body is cancelled as soon as the headers arrive — a `HEAD` would prove
 * neither, and is often blocked outright).
 */
export async function probeSource(
  url: string,
  signal?: AbortSignal
): Promise<RemoteSourceDescriptor> {
  let response: Response
  try {
    response = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal, cache: 'no-store' })
  } catch (error) {
    if (signal?.aborted) throw error
    // A CORS rejection and a dead host are indistinguishable from here; the actionable one is CORS.
    throw new PlayerError('no-cors', `Cannot read ${url} from the browser (no CORS headers?)`, {
      cause: error
    })
  }

  const validator = readValidator(response)

  if (!response.ok && response.status !== 206) {
    await discardBody(response)
    throw new PlayerError('network', `${url} returned ${response.status}`)
  }

  if (response.status === 206) {
    const size = parseContentRangeSize(response.headers.get('content-range'))
    await discardBody(response)

    // `Content-Range` is not CORS-safelisted; `Content-Length` is. When the host does not expose
    // it, a second ranged request gives the size from `Content-Length` instead.
    const resolved = size ?? (await sizeFromOpenRange(url, signal))
    if (resolved === null) {
      // Range works but the length is unknowable, so the central directory cannot be found from
      // the end. Download it instead.
      return { type: 'chunked', url, size: null, validator }
    }

    return { type: 'range-http', url, size: resolved, validator }
  }

  // Status 200 to a Range request: the host ignores Range and sent the whole archive.
  const declared = response.headers.get('content-length')
  await discardBody(response)
  return { type: 'chunked', url, size: declared ? Number(declared) : null, validator }
}

/**
 * The size of an archive whose host does not expose `Content-Range`: a `206` to `Range: bytes=0-`
 * carries the whole length in `Content-Length`, and the body is dropped as soon as the headers
 * arrive.
 *
 * A ranged request, not the plain `GET` this once was. A host that compresses the archive on the
 * way out — GitHub Pages gzips `application/octet-stream` — answers a plain `GET` with the
 * compressed copy's length, and `Content-Encoding` is not readable cross-origin either, so nothing
 * marks it as the wrong number: an 84.6 MB package measured 84.4 MB, and zip.js looked for the end
 * of the central directory 275 kB short of it. Chromium, Firefox and WebKit all send
 * `Accept-Encoding: identity` on a request that carries a `Range` header, so a ranged answer is
 * measured in the same bytes the ranges will later be served in.
 */
async function sizeFromOpenRange(url: string, signal?: AbortSignal): Promise<number | null> {
  const response = await fetch(url, { headers: { Range: 'bytes=0-' }, signal, cache: 'no-store' })
  const length = response.headers.get('content-length')
  await discardBody(response)
  if (!response.ok) return null
  return length ? Number(length) : null
}

/* ------------------------------------------------------------------ handles */

class RangeHttpHandle implements SourceHandle {
  received = 0

  constructor(
    readonly descriptor: Extract<SourceDescriptor, { type: 'range-http' }>,
    readonly size: number
  ) {}

  /** Counts a body's bytes as they pass, without holding any of them. */
  private counted(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
    return body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform: (chunk, controller) => {
          this.received += chunk.length
          controller.enqueue(chunk)
        }
      })
    )
  }

  private async fetchRange(range: ByteRange, signal: AbortSignal): Promise<Response> {
    // The chunk store is the cache. Letting the browser's HTTP cache keep a second copy of a
    // large archive doubles the storage for nothing.
    const response = await fetch(this.descriptor.url, {
      headers: { Range: `bytes=${range.start}-${range.end}` },
      cache: 'no-store',
      signal
    })
    if (response.status !== 206 && response.status !== 200) {
      await discardBody(response)
      // A `PlayerError` is final; anything else `resilientStream` asks for again. A host that is
      // overloaded, restarting or rate-limiting says so with a status that can change by itself;
      // a missing file or an expired URL does not.
      if (TRANSIENT_STATUSES.has(response.status)) {
        throw new Error(`Range request answered ${response.status}`)
      }
      throw new PlayerError('network', `Range request failed with ${response.status}`)
    }
    return response
  }

  /** One attempt at a range: the request, its body counted, and sliced when the host sent it all. */
  private async attempt(range: ByteRange, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const response = await this.fetchRange(range, signal)
    if (!response.body) throw new PlayerError('network', 'Range response had no body')

    // A host that answered 200 sent the whole archive. Buffering it to take a slice would mean
    // holding hundreds of megabytes — and under `segmentedStream`, four whole files at once — so
    // the body is sliced as it flows instead. The slice ends the pipe, which cancels the body,
    // so the transfer stops there too.
    const body = this.counted(response.body)
    return response.status === 200 ? sliceStream(body, range) : body
  }

  async read(range: ByteRange): Promise<Uint8Array> {
    return new Uint8Array(await new Response(await this.stream(range)).arrayBuffer())
  }

  /**
   * Every range, streamed or read whole, goes through `resilientStream`: a request that goes
   * quiet or fails is opened again from the byte it reached. That covers the segments of a large
   * span, the local header a Service Worker reads before an inline entry, and the central
   * directory alike — a link that drops for a moment costs a moment, not the job.
   */
  async stream(range: ByteRange): Promise<ReadableStream<Uint8Array>> {
    return resilientStream(range, (remaining, signal) => this.attempt(remaining, signal), {
      // Bytes on any request of this archive: a segment waiting its turn behind one that flows
      // is not a stalled link.
      progress: () => this.received
    })
  }
}

/** Statuses a host answers with when it, not the request, is the problem for now. */
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

class ChunkedHandle implements SourceHandle {
  private store: ChunkStore

  constructor(
    readonly descriptor: Extract<SourceDescriptor, { type: 'chunked' }>,
    readonly size: number,
    pkgId: string
  ) {
    this.store = new ChunkStore(pkgId)
  }

  read(range: ByteRange): Promise<Uint8Array> {
    return this.store.readRangeBytes(ARCHIVE_ENTRY, range)
  }

  async stream(range: ByteRange): Promise<ReadableStream<Uint8Array>> {
    return this.store.readRange(ARCHIVE_ENTRY, range)
  }
}

class FileHandle implements SourceHandle {
  constructor(
    readonly descriptor: Extract<SourceDescriptor, { type: 'file' }>,
    private readonly blob: Blob
  ) {}

  get size(): number {
    return this.blob.size
  }

  async read(range: ByteRange): Promise<Uint8Array> {
    const slice = this.blob.slice(range.start, range.end + 1)
    return new Uint8Array(await slice.arrayBuffer())
  }

  async stream(range: ByteRange): Promise<ReadableStream<Uint8Array>> {
    return this.blob.slice(range.start, range.end + 1).stream()
  }
}

/**
 * Builds a handle from a persisted descriptor. A `file` descriptor needs the `File` itself, which
 * only the page holds — the caller fetches it from the page before calling this.
 */
export async function openSource(
  pkgId: string,
  descriptor: SourceDescriptor,
  file?: Blob,
  options: {
    /**
     * Open a chunked archive that is still downloading. Only the forward index can address such
     * a handle — its size is what has arrived so far — so this is for the reader built from that,
     * never for zip.js, which needs the end of the file.
     */
    partial?: boolean
  } = {}
): Promise<SourceHandle> {
  switch (descriptor.type) {
    case 'range-http':
      return new RangeHttpHandle(descriptor, descriptor.size)

    case 'chunked': {
      const meta = await new ChunkStore(pkgId).getArchiveMeta()
      if (!meta || (!meta.complete && !options.partial)) {
        throw new PlayerError('bad-archive', 'Archive has not finished downloading')
      }
      return new ChunkedHandle(descriptor, meta.size ?? meta.available, pkgId)
    }

    case 'file': {
      if (!file) throw new PlayerError('bad-archive', 'The picked file is no longer available')
      return new FileHandle(descriptor, file)
    }
  }
}
