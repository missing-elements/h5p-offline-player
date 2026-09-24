import { ARCHIVE_ENTRY } from './constants'
import { ChunkStore } from './chunk-store'
import { PlayerError, type RemoteSourceDescriptor, type SourceDescriptor } from './protocol'
import type { ByteRange } from './range'
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

    // `Content-Range` is not CORS-safelisted; `Content-Length` is. When the host exposes neither
    // usable size, a second plain GET gives one from `Content-Length`.
    const resolved = size ?? (await sizeFromPlainGet(url, signal))
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

async function sizeFromPlainGet(url: string, signal?: AbortSignal): Promise<number | null> {
  const response = await fetch(url, { signal, cache: 'no-store' })
  const length = response.headers.get('content-length')
  await discardBody(response)
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

  private async fetchRange(range: ByteRange): Promise<Response> {
    // The chunk store is the cache. Letting the browser's HTTP cache keep a second copy of a
    // large archive doubles the storage for nothing.
    const response = await fetch(this.descriptor.url, {
      headers: { Range: `bytes=${range.start}-${range.end}` },
      cache: 'no-store'
    })
    if (response.status !== 206 && response.status !== 200) {
      throw new PlayerError('network', `Range request failed with ${response.status}`)
    }
    return response
  }

  async read(range: ByteRange): Promise<Uint8Array> {
    const response = await this.fetchRange(range)
    if (response.status !== 200) {
      const bytes = new Uint8Array(await response.arrayBuffer())
      this.received += bytes.length
      return bytes
    }

    // A host that answered 200 sent the whole archive. It is sliced as it flows, exactly as
    // `stream` does it: buffering it to take the slice would hold the whole file — and under
    // `segmentedStream`, four whole files at once. The slice ends the pipe, which cancels the
    // body, so the transfer stops there too.
    if (!response.body) throw new PlayerError('network', 'Range response had no body')
    return new Uint8Array(
      await new Response(sliceStream(this.counted(response.body), range)).arrayBuffer()
    )
  }

  async stream(range: ByteRange): Promise<ReadableStream<Uint8Array>> {
    const response = await this.fetchRange(range)
    if (!response.body) throw new PlayerError('network', 'Range response had no body')

    // A host that answered 200 sent the whole archive. Buffering it to take a slice would mean
    // holding hundreds of megabytes; the body is sliced as it flows instead.
    const body = this.counted(response.body)
    return response.status === 200 ? sliceStream(body, range) : body
  }
}

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
