import type { ContentMetadata } from './metadata.js'

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
 * Where to look for libraries a package does not carry: `pack`, the library pack (see
 * `PackLibrary`), or the URL of a `.h5p` that carries them.
 */
export type LibrarySource = 'pack' | { url: string }

/** A dependency as `library.json` and `h5p.json` declare it, versions as numbers. */
export interface PackDependency {
  machineName: string
  majorVersion: number
  minorVersion: number
}

/**
 * One library of the library pack, as its `parts/index.json` describes it: the pack is split into
 * one archive per library folder, `<folder>.h5p`, so a package downloads only the libraries it
 * needs, each checked against its hash.
 */
export interface PackLibrary {
  /** `<machineName>-<major>.<minor>`, the one folder the part holds. */
  folder: string
  machineName: string
  majorVersion: number
  minorVersion: number
  patchVersion: number
  /** The dependencies its `library.json` declares. */
  preloadedDependencies?: PackDependency[]
  /** For an addon, the content the platforms add it to (`addTo` in its `library.json`). */
  addTo?: unknown
  /** The part's size in bytes. */
  size: number
  /** The part's SHA-256, lower-case hex. */
  sha256: string
}

/**
 * The pack, offered with an `index` so the worker can say which parts the package needs. `pinned`:
 * the version this release pins, whose index the worker carries; otherwise the element hands over
 * the index of a copy the host named, with each part's URL.
 */
export type PackOffer = {
  /** Play the pack's newer version of a library the package carries. */
  refresh: boolean
  /** Supply from the pack what the package does not carry. Off while an earlier source is still to be tried. */
  fill: boolean
  /**
   * Supply the newest older minor the pack has of a library the content names at a newer one than
   * any source has. Sent only once every source has been tried for the version named.
   */
  downgrade?: boolean
} & ({ pinned: true } | { libraries: Array<PackLibrary & { url: string }> })

/** A part to download and attach. */
export interface PackPart {
  folder: string
  url: string
  size: number
  sha256: string
}

/** A library the package carries that plays at the pack's newer version instead. */
export interface RefreshedLibrary {
  /** The machine name, `H5P.QuestionSet`. */
  library: string
  /** The version the package carries, `1.20.3`. */
  from: string
  /** The pack's, `1.21.2`. */
  to: string
}

/**
 * A library the content names at a newer minor than any library source has, played at the newest
 * older minor of the same major instead (`downgrade-libraries`, #85).
 */
export interface DowngradedLibrary {
  /** The machine name, `H5P.MultiChoice`. */
  library: string
  /** The version the content names, `1.17`: a major and a minor, as content names a library. */
  from: string
  /** The version that played, `1.16.27`. */
  to: string
}

/**
 * What the pack has to supply before the package can play: the parts to attach, and the package's
 * own folders that the newer versions among them replace.
 */
export interface PackPlan {
  parts: PackPart[]
  /** The package's own library folders to withhold, each replaced by a part. */
  superseded: string[]
  refreshed: RefreshedLibrary[]
}

/** What an archive declared but does not contain. */
export interface MissingLibraries {
  /** `mainLibrary` from `h5p.json`: the content type, for the error a host shows. */
  mainLibrary?: string
  /** Folder names as the runtime will ask for them, e.g. `H5P.InteractiveVideo-1.27`. */
  folders: string[]
  /** True when the archive carries no libraries at all — the usual content-only export. */
  all: boolean
  /**
   * True when the package is played `untrusted` and carries these itself: its own copy would
   * supply them, and only its own code is refused. A host can offer to play it trusted.
   */
  carried?: boolean
}

/** One row of the IndexedDB `packages` table. */
/**
 * What the host asked the frame to show and load, by h5p-standalone's own option names, so a
 * reader of its documentation finds the same words here. `activityId` is its `xAPIObjectIRI`.
 * Written into the package's record, so a restarted worker synthesizes the same frame.
 */
export interface FrameOptions {
  /** The H5P action bar under the content, which the three buttons below live in. */
  frame?: boolean
  copyright?: boolean
  /** The download button; shown only with `downloadUrl`. */
  export?: boolean
  icon?: boolean
  /** The embed button; shown only with `embedCode`. */
  embed?: boolean
  fullScreen?: boolean
  downloadUrl?: string
  /** The code the embed button offers, `:w` and `:h` standing for the size. */
  embedCode?: string
  /** The script the embed dialog offers under "advanced", for sizing the embed; h5p-standalone's `resizeCode`. */
  resizeCode?: string
  /** Absolute URLs of stylesheets and scripts the frame loads after the runtime's own. */
  customCss?: string[]
  customJs?: string[]
  /**
   * The submit button, in content types that have one. The frame hands it to the top-level
   * instance as `extras.isReportingEnabled`, since this core never does (see frame-boot).
   */
  reportingIsEnabled?: boolean
  /** The id statements carry as their object. Default: the package URL, or the frame's own for a file. */
  activityId?: string
}

/** The learner, as H5P names the xAPI actor; h5p-standalone's `user`. */
export interface FrameUser {
  name: string
  mail: string
}

export interface PackageRecord {
  pkgId: string
  source: SourceDescriptor
  /**
   * A second package whose libraries fill this one's gaps. Stored rather than held in memory so
   * a restarted worker reattaches it without asking the page again.
   */
  libraryPkgId?: string
  /** The parts of the library pack attached, in the order they were; see `LoadSettings.parts`. */
  parts?: string[]
  /** The package's own library folders a part replaces; see `LoadSettings.superseded`. */
  superseded?: string[]
  /** An older minor answers for a newer one; see `LoadSettings.downgrade`. */
  downgrade?: boolean
  /**
   * `libraries` marks an archive registered only to supply library folders to another package.
   * It is never played, so it is not held to carrying everything its own `h5p.json` declares.
   */
  role?: 'content' | 'libraries'
  /** Absolute URLs of the frame assets, resolved by the element and used to synthesize the frame. */
  frameAssets: FrameAssets
  /** Extra CSP host-sources the host page vouches for. See the `allow-origins` attribute. */
  allowOrigins?: string[]
  /** The display and loading options the host set; absent from a record an older element wrote. */
  frameOptions?: FrameOptions
  /** The language tag the element was in when it loaded the package; absent when none was declared, and from a record an older element wrote. */
  language?: string
  /**
   * Played as data: none of the package's own code runs. Library folders come only from the
   * attached bundle, `content/` serves only H5P's own list of file types, and the frame's policy
   * names exact script paths. See the `untrusted` attribute.
   */
  untrusted?: boolean
  status: PackageStatus
  title?: string
  /** `h5p.json`'s licence, authors and the rest, for the frame's copyright dialog; absent from an older row. */
  metadata?: ContentMetadata
  lastPlayed: number
  /** The element version that wrote the row. Read by nothing today; a future migration keys on it. */
  version: string
  /**
   * What each load asked for, by its load key: the settings above as that load set them, and the
   * bundle attached for it. The fields above are the last registration's, and serve only a frame
   * an older element opened, whose URLs carry no load key. See `LoadSettings`.
   */
  views?: Record<string, LoadSettings>
}

/**
 * What one load asked for, apart from the bytes. The row is the package's, and two players can
 * show the same package at once with different settings — one untrusted and one trusted, one in
 * French and one in German — so each load's are kept under a random key of its own, which its
 * frame's URLs carry. Random rather than a hash of the settings: two loads that asked for the
 * same thing would share a reader, and one reloading would detach the other's bundle.
 */
export interface LoadSettings {
  frameAssets: FrameAssets
  allowOrigins?: string[]
  frameOptions?: FrameOptions
  language?: string
  untrusted?: boolean
  /** The bundle attached for this load; see `PackageRecord.libraryPkgId`. */
  libraryPkgId?: string
  /** The library pack's parts attached for this load, by their package ids, consulted before the bundle. */
  parts?: string[]
  /**
   * The package's own library folders withheld because a part carries a newer version of the
   * library: requests for them resolve to the part's folder, by the rule `get()` serves with.
   */
  superseded?: string[]
  /**
   * A library named at a newer minor than any source has is served from the newest older minor of
   * the same major. Set by the load with an `attach-libraries`, once every library source has been
   * tried for the version named, and kept here so that a worker started again serves the same
   * folders the frame was booted with.
   */
  downgrade?: boolean
  /** When a load last registered these, for keeping the newest few. */
  registered: number
}

/**
 * Where the runtime's files are: `@missing-elements/h5p-runtime`'s `dist/`, resolved by the host
 * (its `runtime` export, under a bundler), by the element against an `assets-base`, or against
 * the default `frame-assets/` beside the element. The runtime is a package of its own because it
 * is GPL-3.0 and the player is MIT; the player carries none of these files and only names them.
 */
export interface FrameAssets {
  /**
   * h5p-standalone's `main.bundle.js`, the loader of the runtime up to 0.2, which walked the
   * libraries in the frame and booted the core: present in a record an element wrote with such a
   * runtime, whose frame document the worker still writes the way it expects. A later runtime has
   * none; its boot script loads what the worker's `boot` route names (`LibraryLoad`).
   */
  mainJs?: string
  /** `frame.bundle.js` — the H5P core's scripts, jQuery and h5p.js among them. */
  frameJs: string
  /** `h5p.css`, the core's stylesheets rebuilt to stand alone: icon fonts and images inlined. */
  frameCss: string
  /**
   * The frame's boot script, `frame-boot.js`, which the worker names in the frame document.
   * Absent from a record an element before 0.5 wrote, when the script was inlined; the worker
   * then looks for it beside `mainJs`.
   */
  bootJs?: string
  /**
   * The text faces taken out of that sheet, which the frame document declares itself. Absent
   * from a record an older element wrote, whose `frameCss` still declares them.
   */
  fonts?: FrameFont[]
  /**
   * The core's strings in every language the runtime has, `l10n.js`, which the worker names in
   * the frame document when the element's language is not English; the boot script picks the
   * language. Absent from a record an older element wrote, and from a `runtime` older than the
   * translations: the frame is then English.
   */
  l10nJs?: string
}

export interface FrameFont {
  family: string
  style: string
  weight: string
  url: string
}

/**
 * What a frame loads, as the worker's `boot` route answers it (`sw/library-load.ts`): the boot
 * script of a runtime after 0.2 asks for it and builds `H5PIntegration` from it, where h5p-standalone
 * walked the libraries itself. A contract between the player and the runtime, like the boot
 * configuration: a field the boot script needs is one every worker it pairs with writes.
 */
export interface LibraryLoad {
  /** The main library at the version served, `H5P.QuestionSet 1.21`: `H5PIntegration`'s `library`. */
  library: string
  /** Every library's scripts, dependencies first, as entry names under the package's root. */
  scripts: string[]
  /** Every library's stylesheets, in the same order. */
  styles: string[]
  /**
   * The core's `libraryDirectories`: for a library served from a folder its version does not name,
   * `H5P.Foo-1.2` → `H5P.Foo`, so that `H5P.getLibraryPath` finds it.
   */
  directories: Record<string, string>
  /** The library folders, reachable from the package, that carry an `upgrades.js`. */
  upgrades: string[]
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
  /**
   * `view`: the load's key, under which the worker keeps the record's settings for this load
   * alone. A worker that knows it answers `ack` with `views`; one that does not ignores it.
   */
  | { type: 'register'; record: PackageRecord; view?: string }
  /**
   * `deep`: also follow each library's own dependencies, as the runtime will, and refuse what
   * none of them provides. Asked for once the library files are local or cached.
   * `pack`: the library pack is a source; the reply carries a `plan` when it has parts to supply.
   */
  | { type: 'index'; pkgId: string; view?: string; deep?: boolean; pack?: PackOffer }
  /** Answer to a `need-file` request: the page hands back the `File` the worker lost on restart. */
  | { type: 'file'; pkgId: string; file: File }
  /**
   * Points a package at other ones, already registered and indexed, for its libraries: a bundle,
   * which replaces the one before, or parts of the pack, which are added, with the package's own
   * folders they replace. `downgrade`: from now on an older minor answers for a newer one nothing
   * provides (`LoadSettings.downgrade`).
   */
  | { type: 'attach-libraries'; pkgId: string; libraryPkgId?: string; parts?: string[]; superseded?: string[]; downgrade?: true; view?: string }
  /**
   * Asks for a library bundle already downloaded whole from `url`, for when `url` cannot be
   * reached now. Answered `downloaded-libraries`, with `null` when there is none.
   */
  | { type: 'find-downloaded-libraries'; url: string }

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
  location: EntryLocation
}

/**
 * Where an entry's compressed bytes are, as the Service Worker's index knows it, so the Jobs
 * worker can extract the entry without an index of its own. An entry from the central directory
 * is named by its local header, which the worker reads for the name and extra lengths in front
 * of the data; one from the forward index of a downloading archive has had that header read
 * already and carries where the data begins.
 */
export interface EntryLocation {
  /** Offset of the local header in the archive. */
  header?: number
  /** Where the compressed bytes begin, when the local header has already been read. */
  dataStart?: number
  compressedSize: number
  /** Uncompressed size. */
  size: number
  method: number
}

/** One entry inside a warm span: where its local header is, and what follows it. */
export interface WarmEntry {
  name: string
  /** Offset of the local header in the archive. */
  offset: number
  compressedSize: number
  /** Uncompressed size. */
  size: number
  method: number
}

/**
 * A run of the archive worth pulling whole before the frame boots: small entries — the libraries'
 * scripts, styles and JSON, and whatever small files sit between them — that the runtime would
 * otherwise ask for one by one, at one or two ranged requests each. Named in the `indexed` reply
 * for a host that honours `Range`; the Jobs worker walks each span in one request and lands every
 * entry in the cache.
 */
export interface WarmSpan {
  start: number
  /** Exclusive. */
  end: number
  /** In archive order. */
  entries: WarmEntry[]
}

export type WorkerReply =
  | { ok: true; type: 'pong'; version: string }
  | {
      ok: true
      type: 'indexed'
      pkgId: string
      title?: string
      prefetch?: PrefetchEntry[]
      /** Spans to pull whole before booting. Only for a host that honours `Range`. */
      warm?: WarmSpan[]
      /** For a partial index: whether everything the runtime needs to boot has arrived. */
      ready?: boolean
      /**
       * The xAPI `context.revision` for this package: its index fingerprint and any attached
       * bundle's. Absent for a partial index, which has no central directory yet.
       */
      revision?: string
      /** `h5p.json`'s licence, authors and the rest, as the element's `metadata` shows them. */
      metadata?: ContentMetadata
      /** `h5p.json`'s `mainLibrary`, the content type, when the manifest names one. */
      mainLibrary?: string
      /**
       * Parts of the library pack to attach before the package can play, for an `index` that
       * offered the pack. The reply carries nothing else then: index again once they are attached.
       */
      plan?: PackPlan
      /**
       * For a `deep` index: the libraries served at an older minor than the content or a library
       * asks for, which only a load that asked for the downgrade gets. Absent when none was.
       */
      downgraded?: DowngradedLibrary[]
    }
  /** `views`: the register named a load key and the worker kept the settings under it. */
  | { ok: true; type: 'ack'; views?: true }
  | { ok: true; type: 'downloaded-libraries'; pkgId: string | null }
  | { ok: false; code: ErrorCode; message: string; missingLibraries?: MissingLibraries }

/* ------------------------------------------------------------------ Service Worker → page */

/**
 * Sent to the frame client, which relays it to its parent element. The Service Worker cannot run
 * a job itself: browsers kill a worker event after a few minutes and a killed inflate cannot
 * resume, so every long extraction is handed back to the page.
 */
export type FromWorkerMessage =
  | { type: 'need-job'; pkgId: string; entry: string; location: EntryLocation }
  | { type: 'need-file'; pkgId: string }

/* ------------------------------------------------------------------ element → Jobs worker */

/**
 * A job, with the picked `File` when the package is one: the element sends the file with every
 * job for such a package, and the worker keeps it by package for the life of the worker.
 */
export type ToJobsMessage = ToJobsRequest & { file?: File }

type ToJobsRequest =
  /** `sha256`: what the downloaded bytes must hash to, for a part of the library pack. */
  | { type: 'download'; pkgId: string; source: SourceDescriptor; sha256?: string }
  /** `prefetch`: asked for ahead of demand, so it queues behind anything the runtime is waiting on. */
  | {
      type: 'extract'
      pkgId: string
      entry: string
      location: EntryLocation
      source: SourceDescriptor
      prefetch?: true
    }
  /** Pulls the spans into the cache. Reports under the reserved entry name `WARM_ENTRY`. */
  | { type: 'warm'; pkgId: string; source: SourceDescriptor; spans: WarmSpan[] }
  | { type: 'abort'; pkgId: string }

/**
 * The first thing the Jobs worker posts. Messages sent to a worker whose script never loaded are
 * dropped, so the page holds its jobs until this arrives; see `JobsWorkerHandle`.
 */
export const JOBS_READY = 'jobs-ready'

export type FromJobsMessage =
  | { type: 'progress'; pkgId: string; entry?: string; loaded: number; total: number | null }
  | { type: 'done'; pkgId: string; entry?: string }
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
  /** Sent before the runtime initialises, when the frame was opened with `resume`. Answered `user-data`. */
  | { channel: 'h5p-player'; type: 'need-user-data'; pkgId: string }
  /**
   * The runtime saved a state, or deleted one (`data: null`). `session` is the token the element
   * handed this document at boot; a save from a document the element has since told to forget —
   * `clearUserData()` — carries a token it no longer accepts.
   */
  | { channel: 'h5p-player'; type: 'user-data'; pkgId: string; session: string } & UserDataEntry

/* ------------------------------------------------------------------ element → frame */

/**
 * One saved value, as H5P core keeps it: a data type (`state`, for what `getCurrentState()`
 * returns), the sub-content it belongs to (`'0'` for the content itself) and the value as the
 * JSON string the runtime produced. `null` means: in a preload, the state was saved against
 * another build of this package, and the runtime shows its "content has changed, starting over"
 * dialog; in a save, the runtime deleted the value.
 */
export interface UserDataEntry {
  dataType: string
  subContentId: string
  data: string | null
}

/** The answer to `need-user-data`: what to preload, how often to save, and the token to save under. */
export interface UserDataPreload {
  channel: 'h5p-player'
  type: 'user-data'
  session: string
  /** Seconds between saves; what H5P core calls `saveFreq`. */
  saveInterval: number
  entries: UserDataEntry[]
  /**
   * The learner the host named, for the statements' actor. It travels here, in a message to the
   * frame, rather than in the package's record: a name and an address are not for the worker's
   * database, and this reply is already the one thing the frame waits for before it boots.
   */
  user?: FrameUser
}
