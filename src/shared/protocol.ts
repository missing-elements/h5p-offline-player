/**
 * The shapes crossing the three contexts: the page (element), the Service Worker and the Jobs
 * worker. Everything here is structured-cloneable.
 */

/** How the bytes of an archive are reached. Persisted, so the worker can rebuild it after a restart. */
export type SourceDescriptor =
  | {
      /** Host honours `Range`: read straight from the network, store nothing but extracted entries. */
      type: 'range-http'
      url: string
      size: number
      validator?: string | null
    }
  | {
      /** Host has CORS but ignores `Range`: the archive is downloaded into the chunk store first. */
      type: 'chunked'
      url: string
      /** `null` until the download finishes for a host that exposes no length. */
      size: number | null
      validator?: string | null
    }
  | {
      /** A `File` from a picker. The handle cannot be persisted; the page re-sends it on request. */
      type: 'file'
      name: string
      size: number
      lastModified: number
    }

/** The two descriptors a URL can produce. Both carry a validator; a picked file has none. */
export type RemoteSourceDescriptor = Exclude<SourceDescriptor, { type: 'file' }>

/** What a row has been through. Written for whoever is looking at the table; read by nothing. */
export type PackageStatus = 'registered' | 'indexed'

/**
 * Where to look for libraries a package does not carry. `hub` resolves per content type against
 * the official H5P content-type server; anything else is the URL of a `.h5p` that carries them.
 */
export type LibrarySource = 'hub' | { url: string }

/** The official H5P content-type server. It answers with CORS and honours `Range`. */
export const HUB_CONTENT_TYPE_URL = 'https://api.h5p.org/v1/content-types/'

/** What an archive declared but does not contain. */
export interface MissingLibraries {
  /** `mainLibrary` from `h5p.json`, which is what the hub is keyed on. */
  mainLibrary?: string
  /** Folder names as the runtime will ask for them, e.g. `H5P.InteractiveVideo-1.27`. */
  folders: string[]
  /** True when the archive carries no libraries at all — the usual content-only export. */
  all: boolean
}

/** One row of the IndexedDB `packages` table. */
export interface PackageRecord {
  pkgId: string
  source: SourceDescriptor
  /**
   * A second package whose libraries fill this one's gaps. Stored rather than held in memory so
   * a restarted worker reattaches it without asking the page again.
   */
  libraryPkgId?: string
  /**
   * `libraries` marks an archive registered only to supply library folders to another package.
   * It is never played, so it is not held to carrying everything its own `h5p.json` declares.
   */
  role?: 'content' | 'libraries'
  /** Absolute URLs of the frame assets, resolved by the element and used to synthesize the frame. */
  frameAssets: FrameAssets
  /** Extra CSP host-sources the host page vouches for. See the `allow-origins` attribute. */
  allowOrigins?: string[]
  status: PackageStatus
  title?: string
  lastPlayed: number
  /** The element version that wrote the row. Read by nothing today; a future migration keys on it. */
  version: string
}

export interface FrameAssets {
  /** h5p-standalone `main.bundle.js` — the loader that walks dependencies and boots the runtime. */
  mainJs: string
  /** h5p-standalone `frame.bundle.js` — h5p.js, jQuery and the core runtime. */
  frameJs: string
  /** h5p-standalone `styles/h5p.css`. */
  frameCss: string
}

export type ErrorCode =
  | 'no-cors'
  | 'no-worker'
  | 'network'
  | 'quota'
  | 'bad-archive'
  | 'runtime'

export class PlayerError extends Error {
  code: ErrorCode
  /** Set when the failure is a package that declared libraries it does not carry. */
  missingLibraries?: MissingLibraries

  constructor(
    code: ErrorCode,
    message: string,
    options?: { cause?: unknown; missingLibraries?: MissingLibraries }
  ) {
    super(message, options)
    this.name = 'PlayerError'
    this.code = code
    this.missingLibraries = options?.missingLibraries
  }
}

/* ------------------------------------------------------------------ page → Service Worker */

export type ToWorkerMessage =
  | { type: 'ping' }
  | { type: 'register'; record: PackageRecord }
  | { type: 'index'; pkgId: string }
  /** Answer to a `need-file` request: the page hands back the `File` the worker lost on restart. */
  | { type: 'file'; pkgId: string; file: File }
  /** Points a package at another one, already registered and indexed, for its libraries. */
  | { type: 'attach-libraries'; pkgId: string; libraryPkgId: string }

/**
 * An entry a cold load cannot serve without a background inflate: large and deflated, so there is
 * no byte in it a `Range` request can reach without the whole stream up to that point.
 *
 * These are named in the `indexed` reply so the work can be started before the content asks for
 * it. That is the only lever there is on a non-faststart mp4, whose index sits at the very end:
 * the first frame is undecodable until the last byte lands, so the wait cannot be shortened, only
 * moved somewhere the learner is not watching it.
 */
export interface PrefetchEntry {
  entry: string
  /** Uncompressed size — the number that decides whether starting it early is worth the bytes. */
  size: number
}

export type WorkerReply =
  | { ok: true; type: 'pong'; version: string }
  | {
      ok: true
      type: 'indexed'
      pkgId: string
      entryCount: number
      title?: string
      prefetch?: PrefetchEntry[]
      /** Built from the forward index of an archive still downloading, not its central directory. */
      partial?: boolean
      /** For a partial index: whether everything the runtime needs to boot has arrived. */
      ready?: boolean
    }
  | { ok: true; type: 'ack' }
  | { ok: false; code: ErrorCode; message: string; missingLibraries?: MissingLibraries }

/* ------------------------------------------------------------------ Service Worker → page */

/**
 * Sent to the frame client, which relays it to its parent element. The Service Worker cannot run
 * a job itself: browsers kill a worker event after a few minutes and a killed inflate cannot
 * resume, so every long extraction is handed back to the page.
 */
export type FromWorkerMessage =
  | { type: 'need-job'; pkgId: string; entry: string }
  | { type: 'need-file'; pkgId: string }

/* ------------------------------------------------------------------ element → Jobs worker */

export type ToJobsMessage =
  | { type: 'download'; pkgId: string; source: SourceDescriptor }
  | { type: 'extract'; pkgId: string; entry: string; source: SourceDescriptor; file?: File }
  | { type: 'abort'; pkgId: string }

export type FromJobsMessage =
  | { type: 'progress'; pkgId: string; entry?: string; loaded: number; total: number | null }
  | { type: 'done'; pkgId: string; entry?: string; size: number }
  | { type: 'failed'; pkgId: string; entry?: string; code: ErrorCode; message: string }

/* ------------------------------------------------------------------ frame → element */

/**
 * H5P's own iframe-resizing protocol, spoken between the content and whatever embeds it. The
 * frame sends these to `window.parent`; the element answers them. See `h5p-resizer.js` in
 * h5p-php-library, which is the reference implementation of this side.
 */
export interface H5PResizerMessage {
  context: 'h5p'
  action: 'hello' | 'prepareResize' | 'resize' | 'resizePrepared' | 'ready'
  scrollHeight?: number
  clientHeight?: number
}

export type FromFrameMessage =
  | { channel: 'h5p-player'; type: 'ready'; pkgId: string }
  | { channel: 'h5p-player'; type: 'xapi'; pkgId: string; statement: unknown; verb?: string }
  | { channel: 'h5p-player'; type: 'finished'; pkgId: string; statement: unknown }
  | { channel: 'h5p-player'; type: 'error'; pkgId: string; message: string }
  | { channel: 'h5p-player'; type: 'relay'; pkgId: string; payload: FromWorkerMessage }
