import jobsWorkerSource from 'virtual:h5p-jobs-worker'
import SHADOW_CSS from './shadow.css?inline'
import { FRAME_FONTS } from './frame-fonts'
import { languageTag } from './shared/language'
import type { ContentMetadata } from './shared/metadata'
import { JobsWorkerHandle, type JobsScript } from './jobs-worker-handle'
import { parseLibrarySources } from './shared/library-sources'
import { packLibrariesIn } from './shared/pack'
import {
  CONTROL_TIMEOUT_MS,
  LIBRARY_PACK_BASE,
  MAJOR_VERSION,
  PACK_INDEX_CACHE,
  SAVE_INTERVAL_S,
  SILENT_ANSWER_TIMEOUT_MS,
  VERSION,
  WARM_ENTRY,
  WORKER_MAJOR_UPDATE_TIMEOUT_MS,
  WORKER_UPDATE_TIMEOUT_MS
} from './shared/constants'
import {
  PlayerError,
  type ErrorCode,
  type LibrarySource,
  type MissingLibraries,
  type PackLibrary,
  type PackOffer,
  type PackPlan,
  type RefreshedLibrary,
  type FrameOptions,
  type FrameUser,
  type FrameAssets,
  type FromFrameMessage,
  type FromJobsMessage,
  type WarmSpan,
  type FromWorkerMessage,
  type H5PResizerMessage,
  type PackageRecord,
  type PrefetchEntry,
  type RemoteSourceDescriptor,
  type SourceDescriptor,
  type ToJobsMessage,
  type ToWorkerMessage,
  type UserDataEntry,
  type UserDataPreload,
  type WorkerReply
} from './shared/protocol'
import { packageLockName } from './shared/locks'
import { filePkgId, loadKey, partPkgId, randomHex, remotePkgId } from './shared/pkg-id'
import { platformOf, withProvenance } from './shared/revision'
import { probeSource } from './shared/source'
import { loadSegment, routesFor, type LoadRef, type Routes } from './sw/routes'
import { adoptRevision, clearUserData, readUserData, removeUserData, writeUserData } from './user-data-store'

/**
 * `<h5p-player>` — the package's public surface. It plays a package and nothing else: no URL
 * field, no file picker, no progress bar, no "open in Safari" banner. Those belong to the host
 * page, which builds them out of the events this element emits.
 *
 * Setting `src` or `file` loads, the way it does on `<video>`. Setting it again aborts whatever
 * was in flight for the previous package and starts over.
 */

/** In dev the runtime is served from `public/frame-assets/`, the same flat layout as `dist/`. */
const DEV_ASSETS_BASE = '/frame-assets/'

/** File names inside the runtime's directory, relative to the assets base. */
const ASSET_FILES = {
  frameJs: 'frame.bundle.js',
  frameCss: 'h5p.css',
  bootJs: 'frame-boot.js',
  l10nJs: 'l10n.js'
} as const

// The two files this package ships beside the element are named here, one static
// `new URL('./file', import.meta.url)` each, so that Vite, Rollup and webpack 5 in a consuming
// app emit it as an asset and rewrite the URL — nothing for the host to copy.
//
// The runtime is not: it is `@missing-elements/h5p-runtime`, a package of its own because it is
// GPL-3.0 and this one is MIT, and a static `new URL` here would have a bundler emit files this
// package does not carry. A bundled host imports that package and hands its `runtime` export to
// the element; a host serving files sets `assets-base`; and with neither, the element looks in
// `frame-assets/` beside its own script — the layout of a served `dist/` with the runtime copied
// in, which is what the demo site and the verifier serve. That default is built from a variable,
// not a literal, so no bundler tries to resolve it.
//
// `@vite-ignore` matters in dev and in a consuming app alike: in dev the worker is served by the
// plugin in `vite.plugins.ts` and Vite must not try to resolve the file at transform time. The
// comment does not survive the minifying pass in `build-workers.mjs`, and a consumer does not
// need it: there the files exist beside the module.
//
// One consumer needs help: Vite's dev server pre-bundles dependencies into
// `node_modules/.vite/deps/`, rewriting each of these URLs to a file that was never put there.
// The package's own copy is still served at its real path, so a URL that landed in the
// pre-bundle directory is pointed back at it. A Vite build, Rollup and webpack never produce
// such a URL, and neither does Vite with the package in `optimizeDeps.exclude`.
const VITE_DEPS = '/node_modules/.vite/deps/'
const PACKAGE_DIST = '/node_modules/@missing-elements/h5p-offline-player/dist/'

function unbundled(href: string): string {
  const url = new URL(href)
  const at = url.pathname.indexOf(VITE_DEPS)
  if (at < 0) return href
  url.pathname = url.pathname.slice(0, at) + PACKAGE_DIST + url.pathname.slice(at + VITE_DEPS.length)
  url.search = ''
  return url.href
}

const DEFAULT_SW_URL = unbundled(new URL(/* @vite-ignore */ './h5p-sw.js', import.meta.url).href)

/**
 * The Jobs worker as a file, for a page whose policy refuses a `blob:` worker. The same script
 * the element carries as a string; a bundler emits it beside the element like the Service Worker.
 */
const DEFAULT_JOBS_URL = unbundled(new URL(/* @vite-ignore */ './h5p-jobs.js', import.meta.url).href)

const BLOB_JOBS_SCRIPT: JobsScript = {
  label: 'blob: URL',
  url: () => URL.createObjectURL(new Blob([jobsWorkerSource], { type: 'text/javascript' })),
  release: (url) => URL.revokeObjectURL(url)
}

/** The runtime inside a directory: the dev server's, the default beside the element, or an `assets-base`. */
function assetsIn(base: string): FrameAssets {
  return {
    frameJs: new URL(ASSET_FILES.frameJs, base).href,
    frameCss: new URL(ASSET_FILES.frameCss, base).href,
    bootJs: new URL(ASSET_FILES.bootJs, base).href,
    l10nJs: new URL(ASSET_FILES.l10nJs, base).href,
    fonts: FRAME_FONTS.map(({ family, style, weight, file }) => ({ family, style, weight, url: new URL(`fonts/${file}`, base).href }))
  }
}

/**
 * A `runtime`'s `l10nJs`, resolved against the page: the worker takes it only as an absolute
 * http(s) URL, as it does the host's own scripts, and a relative one would otherwise be dropped
 * there without a word. Absent, or not a URL, it leaves the frame English.
 */
function l10nFile(url: unknown): { l10nJs?: string } {
  if (typeof url !== 'string' || !url) return {}
  try {
    return { l10nJs: new URL(url, location.href).href }
  } catch {
    return {}
  }
}

/** See the note above `unbundled`: a variable, so that no bundler resolves the directory. */
const DEFAULT_ASSETS_DIR = 'frame-assets/'

const DEFAULT_ASSETS: FrameAssets = import.meta.env.DEV
  ? assetsIn(new URL(DEV_ASSETS_BASE, location.href).href)
  : assetsIn(unbundled(new URL(DEFAULT_ASSETS_DIR, import.meta.url).href))

/**
 * The language an element is in: its own `lang`, or the nearest one above it, across a shadow
 * root to its host, as HTML resolves an element's language. An empty `lang` says the language is
 * unknown, which reads as none.
 */
function declaredLanguage(element: Element): string | undefined {
  for (let node: Node | null = element; node; node = node.parentNode instanceof ShadowRoot ? node.parentNode.host : node.parentNode) {
    if (node instanceof Element && node.hasAttribute('lang')) return node.getAttribute('lang')?.trim() || undefined
  }
  return undefined
}

export type PlayerState = 'idle' | 'probing' | 'downloading' | 'indexing' | 'ready' | 'error'

export type { UserDataEntry } from './shared/protocol'

/**
 * The package's own account of itself: `h5p.json`'s metadata as the runtime's copyright dialog
 * reads it — title, licence, authors — plus `mainLibrary`, the content type. What a page shows
 * beside the player ("Interactive Video, CC BY 4.0, by …"). The manifest is untrusted and the
 * fields are held to their shapes on the way here; a licence H5P has no name for is left out.
 */
export interface PackageMetadata extends ContentMetadata {
  mainLibrary?: string
}

/** Where the package's bytes come from, as the probe classified it. See `source`. */
export type PackageSource = SourceDescriptor

/**
 * What supplied libraries the package did not carry, or newer versions of those it did: the URL
 * that answered (the `libraries` source that won; for `pack`, where its parts are — jsDelivr's
 * address, a `pack-base`, or the `pack` property's), its origin, and whether it was read from a
 * copy downloaded earlier rather than fetched now. `fromCache` is what a page needs for "nothing
 * left this origin": a bundle on the page's own origin, or one served from cache, meant no
 * request to a third party. `refreshed`, for the pack: the libraries the package carries that
 * played at the pack's newer version.
 */
export interface LibraryBundle {
  url: string
  origin: string
  fromCache: boolean
  refreshed?: RefreshedLibrary[]
}

export type { RefreshedLibrary } from './shared/protocol'

/** Each library of a pack, with where its part is: the `pack` export of `@missing-elements/h5p-libraries`. */
export interface LibraryPack {
  libraries: Array<PackLibrary & { url: string }>
}

/**
 * Where `libraries="pack"` finds the pack: the version this release pins, on jsDelivr, whose index
 * the worker carries; a copy at `pack-base`, whose index is read from there; or the `pack`
 * property, which carries its index. `url` is what `libraryBundle` reports.
 */
type PackLocation =
  | { kind: 'pinned'; url: string }
  | { kind: 'base'; url: string }
  | { kind: 'given'; url: string; libraries: Array<PackLibrary & { url: string }> }

/** How many rounds of parts one index may ask for before it is taken to be going round in circles. */
const PLAN_ROUNDS = 4

/** What the `ready` event carries: everything the element knows about the package by then. */
export interface ReadyDetail {
  pkgId: string
  source: PackageSource | null
  metadata: PackageMetadata | null
  revision: string | null
  libraryBundle: LibraryBundle | null
}

export interface PlayerErrorDetail {
  code: ErrorCode
  message: string
  /** Present when a package declared libraries it does not carry. See the `libraries` attribute. */
  missingLibraries?: MissingLibraries
}

/**
 * What `resume` does with the state the content saves. `off`: nothing, a reload starts over.
 * `device`: kept in this browser's storage, keyed by the package and the build it was saved
 * against, and handed back on the next load. `host`: the host page keeps it — it gets a
 * `userdata` event on every save and sets `userData` before a load — and nothing is stored here.
 */
export type ResumeMode = 'off' | 'device' | 'host'

/** The `userdata` event: one value the content saved, or deleted (`data: null`). */
export interface UserDataDetail extends UserDataEntry {
  pkgId: string
  /** The build it was saved against, as the statements say it; `null` before the index has said. */
  revision: string | null
}

/** `resize`: the content's height, which the element follows unless `auto-resize="off"`. */
export interface PlayerResizeDetail {
  height: number
}

/** `statechange`: the state the element has just moved to, the same as its `state` property. */
export interface PlayerStateChangeDetail {
  state: PlayerState
}

export interface PlayerProgressDetail {
  /** 0–1, or `null` while the total is unknown (a host that exposes no length). */
  fraction: number | null
  loaded: number
  total: number | null
  /** `warm`: the libraries being pulled into the cache before the frame boots, on a host that honours `Range`. */
  phase: 'download' | 'libraries' | 'warm' | 'extract'
  entry?: string
}

/**
 * The element's own box, `shadow.css`, adopted as a constructable stylesheet rather than written
 * as an inline `<style>`: under a host page's `style-src 'self'` the inline element is blocked
 * without a word and the frame collapses to an iframe's intrinsic 150px, while
 * `CSSStyleSheet.replaceSync` is CSSOM and not subject to it. One sheet is shared by every
 * instance on the page. The rules and the reasons behind them are in the stylesheet itself:
 * `?inline` hands it over as a string, minified for the build, comments and all gone.
 */
let shadowSheet: CSSStyleSheet | null = null

function adoptShadowStyles(root: ShadowRoot): void {
  if ('adoptedStyleSheets' in root && typeof CSSStyleSheet.prototype.replaceSync === 'function') {
    if (!shadowSheet) {
      shadowSheet = new CSSStyleSheet()
      shadowSheet.replaceSync(SHADOW_CSS)
    }
    root.adoptedStyleSheets = [shadowSheet]
    return
  }
  // A browser without constructable stylesheets: the inline element, and the CSP caveat above.
  const style = document.createElement('style')
  style.textContent = SHADOW_CSS
  root.prepend(style)
}

export class H5PPlayerElement extends HTMLElement {
  /**
   * The two attributes a change of which does something at once. Every other one — `sw`,
   * `assets-base`, `jobs`, `libraries`, `pack-base`, `refresh-libraries`, `preload`, `resume`, the
   * frame options — is read when a load starts or when the package is registered, so a change
   * takes effect on the next load and needs no callback.
   */
  static get observedAttributes(): string[] {
    return ['src', 'auto-resize']
  }

  private iframe: HTMLIFrameElement
  private jobs: JobsWorkerHandle | null = null
  private routes: Routes | null = null
  private registration: ServiceWorkerRegistration | null = null
  /** The worker being found or brought up to date, while it is: every load meanwhile waits on it. */
  private workerSetup: Promise<Routes> | null = null
  private currentFile: File | null = null
  private currentSource: SourceDescriptor | null = null
  private load: AbortController | null = null
  private connected = false
  private internalState: PlayerState = 'idle'
  private internalPkgId: string | null = null
  /** The package's xAPI `context.revision`, once its index says. See `revision`. */
  private internalRevision: string | null = null
  /**
   * Whether the index has answered for the revision — with one, or without, for a worker too old
   * to compute it. Until then statements are held, so that every one carries it: on a host
   * without `Range` the frame boots from the forward index, before the central directory the
   * fingerprint is taken from has arrived.
   */
  private revisionSettled = false
  /** `h5p.json`'s metadata and content type, once the index has read them. See `metadata`. */
  private internalMetadata: PackageMetadata | null = null
  /** The bundle that supplied the libraries, once one has. See `libraryBundle`. */
  private internalLibraryBundle: LibraryBundle | null = null
  private heldStatements: HeldStatement[] = []
  /**
   * The package this element played before the current load, and its revision. Emptying the
   * frame navigates it to `about:blank`, and a statement the old document sent just before it
   * left arrives after that — while the new load is probing, `internalPkgId` is null and the
   * message filter lets it through. Such a statement is stamped with the build it came from, not
   * held and released under the next one's.
   */
  private previousStamp: { pkgId: string; revision: string | null } | null = null
  /** Large deflated entries, in archive order, waiting to be pulled before the content asks. */
  private prefetchQueue: PrefetchEntry[] = []
  /** What the host handed in for the next load under `resume="host"`. */
  private hostUserData: UserDataEntry[] | null = null
  /**
   * The token the frame's document saves under, handed to it when it asked for its state. A save
   * carrying any other token is dropped: `clearUserData()` withdraws the token so that the
   * document still running — and its last save, sent as it goes away — cannot bring back what
   * the host just cleared before the next load reads the store.
   */
  private userDataSession: string | null = null
  /**
   * The resume mode this load started with. `resume` takes effect on the next load, so a load
   * reads it once and keeps the value for everything it decides later: the frame's URL, the
   * state handed to the frame, and the stamping of saves made before the index answered. Read
   * live, a host switching the attribute mid-load got a frame started under one mode and
   * answered under another.
   */
  private loadResumeMode: ResumeMode = 'off'
  /** `saveInterval` as this load read it, for the same reason. */
  private loadSaveInterval = SAVE_INTERVAL_S
  /** The learner the host named, for the statements' actor; handed to the frame as it boots. */
  private userValue: FrameUser | null = null
  private runtimeValue: FrameAssets | null = null
  private packValue: Array<PackLibrary & { url: string }> | null = null
  /**
   * The mode the frame holding `userDataSession` was answered under, which its saves follow.
   * Kept apart from `loadResumeMode`: a straggler save from the previous document can arrive
   * after the next load has begun and before its frame has asked for its state.
   */
  private userDataMode: ResumeMode = 'off'
  private prefetching: string | null = null
  /**
   * Where this element sent its frame, or `null` while the frame shows nothing. Not the frame's
   * `src`, which is set only for a frame out of the document: see `navigateFrame`.
   */
  private frameLocation: string | null = null

  constructor() {
    super()
    const root = this.attachShadow({ mode: 'open' })
    root.innerHTML = `<div class="viewport"><iframe part="frame" allow="fullscreen" title="${FRAME_TITLE}"></iframe></div>`
    adoptShadowStyles(root)
    this.iframe = root.querySelector('iframe')!
  }

  /* ---------------------------------------------------------------- public surface */

  get src(): string | null {
    return this.getAttribute('src')
  }

  set src(value: string | null) {
    if (value === null) this.removeAttribute('src')
    else this.setAttribute('src', value)
  }

  /**
   * Whether to pull large deflated media before the content asks for it. `none` (the default)
   * fetches an entry when the runtime requests it; `auto` starts once the content is up.
   *
   * Off by default because `auto` spends a learner's bandwidth on a video they may never reach —
   * the host's call, not the element's. It is worth making for a package whose media cannot be
   * streamed: see `PrefetchEntry`.
   */
  get preload(): 'none' | 'auto' {
    return this.getAttribute('preload') === 'auto' ? 'auto' : 'none'
  }

  set preload(value: 'none' | 'auto') {
    this.setAttribute('preload', value)
  }

  /**
   * Whether the content resumes where the learner left off. Off by default: a browser is not a
   * learner, and on a shared machine the state one student leaves would be picked up by the
   * next. Takes effect on the next load. See `ResumeMode`.
   */
  get resume(): ResumeMode {
    const value = this.getAttribute('resume')
    if (value === null || value === 'off') return 'off'
    return value === 'host' ? 'host' : 'device'
  }

  set resume(value: ResumeMode) {
    if (value === 'off') this.removeAttribute('resume')
    else this.setAttribute('resume', value)
  }

  /**
   * Seconds between the saves `resume` makes while the content runs: what the H5P plugins call
   * the user data save interval, and H5P core `saveFreq`. The content is also saved shortly after
   * each `completed` or `progressed` statement, and as the page goes away. 10 by default, which
   * costs little on the device; a host that sends each save to a server may want the plugins'
   * 30. At least 1. Takes effect on the next load.
   */
  get saveInterval(): number {
    const value = Number(this.getAttribute('save-interval'))
    return Number.isFinite(value) && value >= 1 ? value : SAVE_INTERVAL_S
  }

  set saveInterval(value: number) {
    this.setAttribute('save-interval', String(value))
  }
  /**
   * Plays the package as data, for one the host did not make: none of its own code runs. Its
   * library folders are ignored and the libraries come from `libraries` — the pack when that is
   * not set — `content/` serves only H5P's own list of content file types, and the frame's policy
   * names script paths exactly instead of the whole origin. A package that needs a library the
   * sources do not have is refused, and the error's `missingLibraries.carried` says when its own
   * copy would have played it. Takes effect on the next load.
   */
  get untrusted(): boolean {
    return this.hasAttribute('untrusted')
  }

  set untrusted(value: boolean) {
    this.toggleAttribute('untrusted', Boolean(value))
  }


  /**
   * Under `resume="host"`, the state to hand the content on the next load: what earlier
   * `userdata` events carried, as the host kept it. Read by the load, so set it before `src`.
   */
  get userData(): UserDataEntry[] | null {
    return this.hostUserData
  }

  set userData(value: UserDataEntry[] | null) {
    this.hostUserData = value
  }

  /**
   * Forgets the state kept on this device for the package loaded now, or the one loaded last.
   * The content keeps running as it is; remove `src` and set it again to start it over. Saves from the running
   * document are dropped from here on, so what was cleared stays cleared until the next load.
   */
  async clearUserData(): Promise<void> {
    const pkgId = this.internalPkgId ?? this.previousStamp?.pkgId
    this.userDataSession = null
    this.userDataMode = 'off'
    if (pkgId) await clearUserData(pkgId)
  }

  /** A `File` from a picker. Setting it loads, and takes precedence over `src`. */
  get file(): File | null {
    return this.currentFile
  }

  set file(value: File | null) {
    this.currentFile = value
    // Like `src`: a value set before the element is connected loads on connection, and clearing
    // it empties the player rather than failing it.
    if (!this.connected) return
    if (value) void this.startLoad()
    else this.clear()
  }

  get state(): PlayerState {
    return this.internalState
  }

  get pkgId(): string | null {
    return this.internalPkgId
  }

  /**
   * Which build is playing, as every `xapi` and `finished` statement's `context.revision` says
   * it: `sha256:…` over the archive's index, then any attached library bundle's. For a host's own
   * records of what it published. `null` until the package is indexed.
   */
  get revision(): string | null {
    return this.internalRevision
  }

  /**
   * Where the package's bytes come from, as the probe classified it: `range-http` (read in
   * place, the host honours `Range`), `chunked` (downloaded whole first, the host does not) or
   * `file` (picked from disk), with the size and the host's validator. What a page shows as
   * "streams" versus "downloads"; `null` before a package is loaded.
   */
  get source(): PackageSource | null {
    return this.internalPkgId && this.currentSource ? { ...this.currentSource } : null
  }

  /** `h5p.json`'s metadata and content type, `null` until the package is indexed. See `PackageMetadata`. */
  get metadata(): PackageMetadata | null {
    return this.internalMetadata ? { ...this.internalMetadata } : null
  }

  /**
   * The bundle that supplied the libraries this package did not carry, or `null` when it carried
   * its own, or none have been supplied yet. See `LibraryBundle`.
   */
  get libraryBundle(): LibraryBundle | null {
    return this.internalLibraryBundle ? { ...this.internalLibraryBundle } : null
  }

  /** The resolved Service Worker scope the routes live under. Read-only, `null` until registered. */
  get scope(): string | null {
    return this.routes?.base ?? null
  }

  /* ---------------------------------------------------------------- lifecycle */

  connectedCallback(): void {
    this.connected = true
    window.addEventListener('message', this.onWindowMessage)
    window.addEventListener('pagehide', this.onPageHidden)
    document.addEventListener('visibilitychange', this.onPageHidden)
    navigator.serviceWorker?.addEventListener('message', this.onServiceWorkerMessage)
    if (this.src || this.currentFile) void this.startLoad()
  }

  disconnectedCallback(): void {
    this.connected = false
    window.removeEventListener('message', this.onWindowMessage)
    window.removeEventListener('pagehide', this.onPageHidden)
    document.removeEventListener('visibilitychange', this.onPageHidden)
    window.removeEventListener('resize', this.onWindowResize)
    navigator.serviceWorker?.removeEventListener('message', this.onServiceWorkerMessage)
    this.abortLoad()
    this.jobs?.terminate()
    this.jobs = null
    // Out of the document the frame has no browsing context, so this navigates nothing; put back,
    // it would otherwise load whatever its `src` last named before the next load could say.
    this.iframe.removeAttribute('src')
    this.frameLocation = null
  }

  attributeChangedCallback(name: string, previous: string | null, next: string | null): void {
    if (previous === next) return
    if (!this.connected) return

    if (name === 'src') {
      // A new `src` wins over a file picked earlier, the way a new `src` wins on `<video>`.
      this.currentFile = null

      // Removing `src` clears the player rather than trying to load nothing. A host that wants
      // to reload the same URL removes and re-sets it, and that must not emit an error in between.
      if (next === null) {
        this.clear()
        return
      }

      void this.startLoad()
      return
    }

    // Handing the height back to the host: the inline height this element wrote would otherwise
    // outlive the choice, since an inline style beats any rule in the host's stylesheet.
    if (name === 'auto-resize' && next === 'off') this.style.removeProperty('height')
  }

  /**
   * Whether the element follows the content's height, which it does unless told
   * `auto-resize="off"`. On by default because every host wants it and the alternative is a
   * 150px frame; off for a host that sizes the element itself, from a stylesheet or the `resize`
   * event, since the inline height written here beats any rule of theirs. A bare `auto-resize`
   * is what pages written while it was opt-in carry, and it means the default.
   */
  private get autoResizes(): boolean {
    return this.getAttribute('auto-resize') !== 'off'
  }

  /* ---------------------------------------------------------------- loading */

  private abortLoad(): void {
    // Statements the content sent before the load ended are still the learner's record: they go
    // out now, without a revision if none was ever known, rather than nowhere.
    this.releaseStatements()
    this.load?.abort()
    this.load = null
    this.prefetchQueue = []
    this.prefetching = null
    if (this.internalPkgId) {
      this.postToJobs({ type: 'abort', pkgId: this.internalPkgId })
    }
  }

  /**
   * Holds a shared lock on the package for as long as it is loaded here. Eviction — in this tab
   * or any other — never picks a package with a lock under its prefix, so a learner mid-video is
   * safe from a quota squeeze caused by a package loading somewhere else. Shared, so two tabs on
   * the same package both hold it. Released when the load is aborted, which a new `src`,
   * `clear()` and disconnection all do.
   */
  private holdPackage(pkgId: string, signal: AbortSignal): void {
    const locks = (navigator as { locks?: LockManager }).locks
    if (!locks) return

    const untilAborted = new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => resolve(), { once: true })
    })
    // Rejects only when aborted before it was granted, which is nothing to report.
    void locks
      .request(packageLockName(pkgId, 'playing'), { mode: 'shared', signal }, () => untilAborted)
      .catch(() => {})
  }

  /**
   * Sends the frame to `url`, or empties it with `null`, without a step in the page's history.
   * Every navigation of a frame that already holds a document adds an entry to the page's session
   * history: setting `src` for each package after the first added two, one emptying the frame and
   * one loading the next, and emptying it added one, so a learner's Back walked the frame through
   * old packages before it left the page, and a page's own history steps lost what lay ahead of
   * them. Found on 2026-10-12 by the installable app, whose Back closes a file. `location.replace`
   * navigates the frame in place, the first navigation included; only a frame out of the
   * document, which has no window to navigate, gets `src`, which loads as the frame is inserted
   * and adds no step.
   */
  private navigateFrame(url: string | null): void {
    if (url === this.frameLocation) return
    this.frameLocation = url
    // Replaced, the first navigation too: setting `src` on a frame whose first document has
    // loaded adds a step to the page's history in WebKit, and Back then empties the frame.
    const frame = this.iframe.contentWindow
    if (frame) frame.location.replace(url ?? 'about:blank')
    else if (url !== null) this.iframe.src = url
  }

  /** Empties the player without an error: what removing `src`, or setting `file` to null, means. */
  private clear(): void {
    this.abortLoad()
    this.navigateFrame(null)
    this.iframe.title = FRAME_TITLE
    this.forgetPackage()
    this.setState('idle')
  }

  /** No package loaded here any more; what it was is kept only to stamp its stragglers. */
  private forgetPackage(): void {
    if (this.internalPkgId) this.previousStamp = { pkgId: this.internalPkgId, revision: this.internalRevision }
    this.internalPkgId = null
    this.internalRevision = null
    this.internalMetadata = null
    this.internalLibraryBundle = null
    this.currentSource = null
  }

  private async startLoad(): Promise<void> {
    this.abortLoad()

    const controller = new AbortController()
    this.load = controller
    const { signal } = controller

    this.navigateFrame(null)
    this.iframe.title = FRAME_TITLE
    this.forgetPackage()
    this.revisionSettled = false
    this.loadResumeMode = this.resume
    this.loadSaveInterval = this.saveInterval

    try {
      this.setState('probing')

      const routes = await this.ensureWorker()
      if (signal.aborted) return

      const { descriptor, pkgId } = await this.resolveSource(signal)
      if (signal.aborted) return

      this.currentSource = descriptor
      this.internalPkgId = pkgId
      this.holdPackage(pkgId, signal)

      // Under a key of this load's own: another player on the origin may be showing the same
      // package with other settings — trusted where this one is not, in another language — and
      // the package's row is shared. A worker older than the element keeps the row's alone, and
      // its routes name no key.
      const view = loadKey()
      const registered = await this.send({ type: 'register', record: this.recordFor(pkgId, descriptor), view })
      if (signal.aborted) return
      const load: LoadRef = registered.ok && registered.type === 'ack' && registered.views ? { pkgId, view } : { pkgId }

      if (descriptor.type === 'file' && this.currentFile) {
        await this.send({ type: 'file', pkgId, file: this.currentFile })
      }

      // `?resume=1` tells the frame's boot script to ask for the saved state before the runtime
      // initialises. In the URL, not the frame document, so that a worker and an element of
      // different versions each do what they know: see `frame-boot.ts`.
      // `?user=1` the same way: the host named a learner, and the frame asks for it in the same
      // reply, before the runtime reads its actor.
      const flags = [this.loadResumeMode === 'off' ? '' : 'resume=1', this.userValue ? 'user=1' : ''].filter(Boolean)
      const frameUrl = `${routes.frame}${loadSegment(load)}${flags.length ? `?${flags.join('&')}` : ''}`
      let indexed: IndexResult

      if (descriptor.type === 'chunked') {
        this.setState('downloading')
        indexed = await this.downloadAndIndex(load, descriptor, signal, frameUrl)
      } else {
        this.setState('indexing')
        // A picked file is local, so the libraries' own dependencies are followed at once; over
        // HTTP each `library.json` would be two requests, so they are followed once warmed.
        const remote = descriptor.type === 'range-http'
        indexed = await this.index(load, signal, !remote)
        if (signal.aborted) return
        // The libraries are pulled into the cache in a few requests before the frame boots;
        // read on demand, they cost the runtime one or two round trips per file. Not a step
        // that can fail the load: the frame boots against whatever landed.
        if (remote && indexed.warm.length > 0) {
          await this.runWarm(pkgId, descriptor, indexed.warm, signal)
          if (signal.aborted) return
        }
        if (remote) indexed = await this.index(load, signal, true)
      }
      if (signal.aborted) return

      this.iframe.title = frameTitle(indexed.title)
      this.internalRevision = indexed.revision ?? null
      this.internalMetadata =
        indexed.metadata || indexed.mainLibrary
          ? { ...indexed.metadata, ...(indexed.mainLibrary ? { mainLibrary: indexed.mainLibrary } : {}) }
          : null
      this.revisionSettled = true
      this.releaseStatements()
      // A state saved before this answer — by a frame booted early on a host without `Range` —
      // is stamped with the build now that it is known, so the next load can check it. A stamp
      // that cannot be written leaves the row one the next load hands over unchecked, as it would
      // have anyway while the build was unknown; that is not worth failing a load that is up.
      if (this.loadResumeMode === 'device' && this.internalRevision) {
        adoptRevision(pkgId, this.internalRevision).catch(() => {})
      }

      this.prefetchQueue = [...indexed.prefetch]
      // A download that booted early already has its frame; the final index only swapped the
      // worker onto the real one. Otherwise: the registration has to be `activated` before this
      // navigation, or it reaches the server and 404s — there is no such file.
      if (this.frameLocation !== frameUrl) this.navigateFrame(frameUrl)
      else if (this.internalState === 'ready') this.advancePrefetch()
    } catch (error) {
      if (signal.aborted) return
      this.fail(error)
    }
  }

  /**
   * Downloads a package from a host that ignores `Range`, and boots as soon as the worker's
   * forward index says the runtime has what it needs — for a libraries-first export, long before
   * the media has finished. Each progress report is a chance to ask; a "not yet" is not an error.
   * The final index after the download is the real one, from the central directory: it swaps the
   * worker onto it, and is where a package missing libraries is found out.
   */
  private async downloadAndIndex(
    load: LoadRef,
    source: SourceDescriptor,
    signal: AbortSignal,
    frameUrl: string
  ): Promise<IndexResult> {
    let booted = false
    let downloaded = false
    let attempt: Promise<void> | null = null
    // The pack's parts are attached while the package still arrives, once the worker can say
    // which, so the frame boots early with them. A part that will not come leaves the rest of
    // the download to boot without the pack, and the final index to decide.
    const sources = this.librarySources()
    let pack = sources.includes('pack') ? this.packLocation() : null
    const fill = sources[0] === 'pack'

    const tryBoot = () => {
      if (booted || attempt || signal.aborted) return
      let again = false
      attempt = (async () => {
        const offer = pack ? await this.packOffer(pack, { refresh: this.refreshesLibraries, fill }) : undefined
        const reply = await this.send({ type: 'index', ...load, ...(offer ? { pack: offer } : {}) })
        if (signal.aborted || booted || !reply.ok || reply.type !== 'indexed') return
        if (reply.plan && pack) {
          const location = pack
          // Not again on the next report, should the parts fail: the final index will try.
          pack = null
          await this.supplyParts(load, reply.plan, location, signal, { quiet: true })
          pack = location
          // At once, not on the next report: a small archive may send no other.
          again = true
          return
        }
        // Only a partial index says `ready`, and only after the dependency walk. Once the
        // download is whole the worker answers from the central directory with no `ready` and
        // no walk, which is the final index's job below: booting on that answer let the runtime
        // ask for a library before the bundle that supplies it was attached.
        if (reply.ready === true) {
          booted = true
          this.iframe.title = frameTitle(reply.title)
          this.navigateFrame(frameUrl)
        }
      })()
        .catch(() => {
          // Too early to index, or the index cannot yet boot: the next progress report asks again.
        })
        .finally(() => {
          attempt = null
          // Once the download is whole, the final index below is the one to ask.
          if (again && !downloaded) tryBoot()
        })
    }

    await this.runDownload(load.pkgId, source, signal, 'download', tryBoot)
    downloaded = true
    if (signal.aborted) return nothingIndexed()
    if (attempt) await attempt

    // A frame already up keeps its state; the rest of this is the worker's bookkeeping. And it
    // keeps its libraries: a folder the runtime has read is not replaced under it.
    if (!booted) this.setState('indexing')
    return this.index(load, signal, true, booted ? false : this.refreshesLibraries)
  }

  /**
   * Indexes the package, and if it turns out to declare libraries it does not carry, fetches them
   * from the configured sources, in order, indexing again after each.
   *
   * Without a `libraries` attribute this is one call that either works or reports exactly what is
   * missing. Reaching out to a third party is never something the element decides on its own.
   * With a list — `libraries="/libraries.h5p pack"` — the first source that covers the package
   * wins, and the next is tried only for what the one before still left absent. A source that
   * cannot be reached at all — the bundle's host down, and no copy of it downloaded before — is
   * passed over the same way while another remains, since the point of naming a second one is to
   * have it when the first is not there; only the last source's failure is the load's. The last
   * bundle attached stays attached: the worker keeps one bundle per package, and a later bundle
   * in the list is expected to cover the earlier.
   *
   * The pack is offered with every index, and the worker answers with the parts it has to supply
   * (`supplyParts`): with `refresh`, the newer versions of libraries the package carries from the
   * start, and what the package lacks once every source before the pack has been tried. A refresh
   * that cannot be had — a part that will not download, or does not match its hash — is given up
   * and the package plays as exported; a load is never failed for it.
   *
   * With `deep`, the worker also follows each library's own dependencies, as the runtime will,
   * and what none of the package's folders provides is fetched the same way.
   */
  private async index(load: LoadRef, signal: AbortSignal, deep = false, refresh = this.refreshesLibraries): Promise<IndexResult> {
    const sources = this.librarySources()
    const packAt = sources.indexOf('pack')
    let pack = packAt >= 0 ? this.packLocation() : null
    let fill = packAt === 0
    let next = fill ? 1 : 0
    let packFailure: unknown = null
    let rounds = 0

    for (;;) {
      try {
        let offer: PackOffer | undefined
        if (pack) {
          try {
            offer = await this.packOffer(pack, { refresh, fill })
          } catch (error) {
            // The index of the host's copy cannot be read, and none was read before: on without
            // the pack, which a package that carries its libraries does not need.
            if (signal.aborted) throw error
            packFailure = error
            pack = null
          }
        }
        const reply = await this.send({ type: 'index', ...load, ...(deep ? { deep } : {}), ...(offer ? { pack: offer } : {}) })
        if (!(reply.ok && reply.type === 'indexed' && reply.plan && pack)) return indexResultOf(reply)

        if (++rounds > PLAN_ROUNDS) throw new PlayerError('bad-archive', 'The library pack kept asking for parts it had already supplied')
        try {
          await this.supplyParts(load, reply.plan, pack, signal)
        } catch (error) {
          if (signal.aborted) throw error
          if (refresh && reply.plan.refreshed.length > 0) {
            refresh = false
            continue
          }
          packFailure = error
          pack = null
        }
        if (signal.aborted) return nothingIndexed()
      } catch (error) {
        const missing = error instanceof PlayerError ? error.missingLibraries : undefined
        if (!missing) throw error
        const source = sources[next++]
        if (source === 'pack') {
          if (pack) fill = true
          continue
        }
        if (!source) {
          if (!packFailure) throw error
          const reason = packFailure instanceof Error ? packFailure.message : String(packFailure)
          throw new PlayerError(
            'bad-archive',
            `This package is missing ${missing.folders.join(', ')}, and the library pack did not supply them: ${reason}`,
            { cause: packFailure, missingLibraries: missing }
          )
        }

        try {
          await this.supplyLibraries(load, missing, source, signal)
        } catch (failure) {
          if (signal.aborted || next >= sources.length) throw failure
        }
        if (signal.aborted) return nothingIndexed()
        // Round again: either it is complete now, or the index names what is still absent and
        // the next source, if there is one, is asked for that.
      }
    }
  }

  /** `refresh-libraries`: on unless `off`. Read by the load. */
  private get refreshesLibraries(): boolean {
    return this.getAttribute('refresh-libraries')?.trim() !== 'off'
  }

  /** Where `libraries="pack"` is: the `pack` property, else a `pack-base`, else the pinned pack on jsDelivr. */
  private packLocation(): PackLocation {
    if (this.packValue?.length) {
      return { kind: 'given', url: new URL('.', this.packValue[0].url).href, libraries: this.packValue }
    }
    const base = this.getAttribute('pack-base')?.trim()
    if (base) return { kind: 'base', url: new URL(base.endsWith('/') ? base : `${base}/`, location.href).href }
    return { kind: 'pinned', url: LIBRARY_PACK_BASE }
  }

  /** The pack as an `index` offers it: the worker's own index for the pinned one, else the copy's. */
  private async packOffer(pack: PackLocation, { refresh, fill }: { refresh: boolean; fill: boolean }): Promise<PackOffer> {
    if (pack.kind === 'pinned') return { pinned: true, refresh, fill }
    return { libraries: pack.kind === 'given' ? pack.libraries : await packIndexAt(pack.url), refresh, fill }
  }

  /**
   * Downloads the parts of the pack an index asked for, all at once, each checked against its
   * hash, and attaches them with the package's own folders they replace. A part kept from before
   * is used with no request: its id is its hash. Each is held like the package, so eviction
   * leaves it alone while the package plays. `quiet` leaves the state to a download under way.
   */
  private async supplyParts(load: LoadRef, plan: PackPlan, pack: PackLocation, signal: AbortSignal, { quiet = false } = {}): Promise<void> {
    const parts = await Promise.all(
      plan.parts.map(async (part) => ({
        pkgId: await partPkgId(part.sha256),
        sha256: part.sha256,
        source: { type: 'chunked', url: part.url, size: part.size, validator: null } satisfies SourceDescriptor
      }))
    )
    await Promise.all(
      parts.map(({ pkgId, source }) =>
        // The pack is the host's choice: it serves its libraries whatever the package's trust.
        this.send({ type: 'register', record: { ...this.recordFor(pkgId, source), role: 'libraries', untrusted: undefined } })
      )
    )
    for (const { pkgId } of parts) this.holdPackage(pkgId, signal)

    if (!quiet) this.setState('downloading')
    const fetched = await this.runPartDownloads(parts, signal)
    if (signal.aborted) return

    if (!quiet) this.setState('indexing')
    await Promise.all(parts.map(({ pkgId }) => this.send({ type: 'index', pkgId })))
    await this.send({ type: 'attach-libraries', ...load, parts: parts.map(({ pkgId }) => pkgId), superseded: plan.superseded })

    const before = this.internalLibraryBundle?.refreshed ? this.internalLibraryBundle : null
    this.internalLibraryBundle = {
      url: pack.url,
      origin: new URL(pack.url).origin,
      fromCache: !fetched && (before?.fromCache ?? true),
      refreshed: [...(before?.refreshed ?? []), ...plan.refreshed]
    }
  }

  /**
   * Has the Jobs worker download the parts, all at once, and reports them as one `libraries`
   * progress. Resolves whether a byte came over the network: a part kept from before answers at once.
   */
  private runPartDownloads(parts: Array<{ pkgId: string; sha256: string; source: SourceDescriptor & { type: 'chunked' } }>, signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const pending = new Set(parts.map(({ pkgId }) => pkgId))
      if (pending.size === 0) return resolve(false)
      const jobs = this.ensureJobs()
      const total = parts.reduce((sum, { source }) => sum + (source.size ?? 0), 0)
      const loaded = new Map<string, number>()
      let fetched = false

      const finish = (error?: PlayerError) => {
        jobs.removeEventListener('message', onMessage)
        if (error) reject(error)
        else resolve(fetched)
      }
      const onMessage = (event: MessageEvent<FromJobsMessage>) => {
        const message = event.data
        if (!pending.has(message.pkgId) || message.entry) return
        if (message.type === 'progress') {
          fetched = true
          loaded.set(message.pkgId, message.loaded)
          const sum = [...loaded.values()].reduce((a, b) => a + b, 0)
          this.emitProgress({ phase: 'libraries', loaded: sum, total, fraction: fractionOf({ loaded: sum, total }) })
          return
        }
        pending.delete(message.pkgId)
        if (message.type === 'failed') finish(new PlayerError(message.code, message.message))
        else if (pending.size === 0) finish()
      }

      jobs.addEventListener('message', onMessage)
      signal.addEventListener('abort', () => finish(), { once: true })
      for (const { pkgId, sha256, source } of parts) this.postToJobs({ type: 'download', pkgId, source, sha256 })
    })
  }

  /**
   * Registers a second package as the source of the libraries this one is missing.
   *
   * Every failure along the way — an unreachable URL, a bundle that is not an archive, one that
   * turns out not to have them either — is reported as one thing: these libraries are missing and
   * this is where the attempt to supply them stopped.
   */
  private async supplyLibraries(
    load: LoadRef,
    missing: MissingLibraries,
    source: { url: string },
    signal: AbortSignal
  ): Promise<void> {
    const url = new URL(source.url, location.href).href

    try {
      let descriptor: RemoteSourceDescriptor
      try {
        descriptor = await probeSource(url, signal)
      } catch (error) {
        if (signal.aborted) throw error
        // The source cannot be reached — no network, or its host is down — but a bundle
        // downloaded from it before serves as well now as it did then. This is what lets an
        // installed app play a stripped export offline once it has played one online.
        // Briefly, and a silence is a no: a worker older than 0.1.7 — an `h5p-sw.js` copied
        // before the element was updated — does not know the question and never answers it.
        const reply = await this.send({ type: 'find-downloaded-libraries', url }, SILENT_ANSWER_TIMEOUT_MS).catch(() => null)
        const earlier = reply?.ok && reply.type === 'downloaded-libraries' ? reply.pkgId : null
        if (!earlier) throw error

        this.setState('indexing')
        await this.send({ type: 'index', pkgId: earlier })
        await this.send({ type: 'attach-libraries', ...load, libraryPkgId: earlier })
        this.holdPackage(earlier, signal)
        this.internalLibraryBundle = { url, origin: new URL(url).origin, fromCache: true }
        return
      }
      const libraryPkgId = await remotePkgId(url, descriptor.validator)

      // Downloaded once rather than read over `Range`, even when the host supports ranges. A
      // library bundle is read exhaustively — every library's JSON, scripts and styles — so a
      // few hundred ranged round-trips cost far more than fetching the few megabytes in one go.
      const bundle: SourceDescriptor = {
        type: 'chunked',
        url,
        size: descriptor.size,
        validator: descriptor.validator
      }

      await this.send({
        type: 'register',
        // The bundle is the host's choice: it serves its libraries whatever the package's trust.
        record: { ...this.recordFor(libraryPkgId, bundle), role: 'libraries', untrusted: undefined }
      })

      this.setState('downloading')
      await this.runDownload(libraryPkgId, bundle, signal, 'libraries')
      if (signal.aborted) return

      this.setState('indexing')
      await this.send({ type: 'index', pkgId: libraryPkgId })
      await this.send({ type: 'attach-libraries', ...load, libraryPkgId })
      // Held like the package: eviction would otherwise be free to take the bundle it reads from.
      this.holdPackage(libraryPkgId, signal)
      this.internalLibraryBundle = { url, origin: new URL(url).origin, fromCache: false }
    } catch (error) {
      if (signal.aborted) throw error
      const reason = error instanceof Error ? error.message : String(error)
      throw new PlayerError(
        'bad-archive',
        `This package is missing ${missing.folders.join(', ')}, and ${url} did not supply them: ` +
          `${reason}`,
        { cause: error, missingLibraries: missing }
      )
    }
  }

  /**
   * Origins the host vouches for, added to the frame's policy. For content that reaches somewhere
   * the built-in list cannot know about — a tenant's own Panopto host, an in-house CDN. The
   * worker drops anything that is not plainly a host.
   */
  private allowOrigins(): string[] {
    const value = this.getAttribute('allow-origins')?.trim()
    return value ? value.split(/\s+/) : []
  }

  /**
   * The `libraries` attribute, read by `parseLibrarySources`. An untrusted package's own folders do
   * not count, so without the attribute it takes the pack: otherwise nothing could play it.
   */
  private librarySources(): LibrarySource[] {
    return parseLibrarySources(this.getAttribute('libraries')?.trim() || (this.untrusted ? 'pack' : null))
  }

  private async resolveSource(
    signal: AbortSignal
  ): Promise<{ descriptor: SourceDescriptor; pkgId: string }> {
    if (this.currentFile) {
      const file = this.currentFile
      const descriptor: SourceDescriptor = {
        type: 'file',
        name: file.name,
        size: file.size,
        lastModified: file.lastModified
      }
      return { descriptor, pkgId: await filePkgId(file) }
    }

    const src = this.src
    if (!src) throw new PlayerError('network', 'No src or file was set')

    const url = new URL(src, location.href).href
    const descriptor = await probeSource(url, signal)
    return { descriptor, pkgId: await remotePkgId(url, descriptor.validator) }
  }

  private recordFor(pkgId: string, source: SourceDescriptor): PackageRecord {
    return {
      pkgId,
      source,
      frameAssets: this.frameAssets(),
      allowOrigins: this.allowOrigins(),
      frameOptions: this.frameOptions(source),
      language: this.frameLanguage(),
      ...(this.untrusted ? { untrusted: true } : {}),
      status: 'registered',
      lastPlayed: Date.now(),
      version: VERSION
    }
  }

  /**
   * The learner, as the actor of every statement the content sends: `{ name, mail }`, what
   * h5p-standalone calls `user`. Read by the load, so set it before `src`. Not stored anywhere:
   * it goes to the frame in the reply it waits for before booting.
   */
  get user(): FrameUser | null {
    return this.userValue
  }

  set user(value: FrameUser | null) {
    this.userValue = value && typeof value.name === 'string' && typeof value.mail === 'string' ? { name: value.name, mail: value.mail } : null
  }

  /**
   * The display and loading options, h5p-standalone's by name, read when the package is
   * registered so they ride in its record and a restarted worker synthesizes the same frame. A
   * bare attribute turns a thing on; `fullscreen="off"` turns off the one that is on by default.
   * `export` needs a file to offer: `download-url`, or the package URL when there is one. The
   * activity id defaults to the package URL for the same reason: the frame's own URL, which the
   * runtime would use, carries the package hash and changes with every build.
   */
  private frameOptions(source: SourceDescriptor): FrameOptions | undefined {
    const text = (name: string) => this.getAttribute(name)?.trim() || undefined
    const flag = (name: string) => (this.hasAttribute(name) ? this.getAttribute(name)?.trim() !== 'off' : undefined)
    const resolve = (value: string) => {
      try {
        return new URL(value, location.href).href
      } catch {
        // Not a URL: left out here, as the worker's sanitising of the record would drop it.
        return undefined
      }
    }
    const urls = (name: string) => (text(name) ?? '').split(/\s+/).filter(Boolean).flatMap((value) => resolve(value) ?? [])
    const sourceUrl = 'url' in source && typeof source.url === 'string' ? source.url : undefined

    const options: FrameOptions = {}
    const flags = { frame: 'frame', copyright: 'copyright', icon: 'icon', embed: 'embed', export: 'export', fullScreen: 'fullscreen', reportingIsEnabled: 'reporting' } as const
    for (const [key, name] of Object.entries(flags) as Array<[keyof typeof flags, string]>) {
      const value = flag(name)
      if (value !== undefined) options[key] = value
    }
    const downloadUrl = text('download-url') ?? (options.export ? sourceUrl : undefined)
    if (downloadUrl) {
      const resolved = resolve(downloadUrl)
      if (resolved) options.downloadUrl = resolved
    }
    const embedCode = text('embed-code')
    if (embedCode) options.embedCode = embedCode
    const resizeCode = text('resize-code')
    if (resizeCode) options.resizeCode = resizeCode
    const customCss = urls('custom-css')
    if (customCss.length) options.customCss = customCss
    const customJs = urls('custom-js')
    if (customJs.length) options.customJs = customJs
    const activityId = text('activity-id') ?? sourceUrl
    if (activityId) options.activityId = activityId
    return Object.keys(options).length ? options : undefined
  }

  /**
   * The runtime's files, resolved by the host: the `runtime` export of
   * `@missing-elements/h5p-runtime`, which a bundler emits beside the host's own code. Read by the
   * load, so set it before `src`; it takes precedence over `assets-base`. A value missing any of
   * the four files is refused, since a frame without one of them is a frame that never boots;
   * `l10nJs` may be missing, as from a runtime older than the translations, and the frame is then
   * English.
   */
  get runtime(): FrameAssets | null {
    return this.runtimeValue
  }

  set runtime(value: FrameAssets | null) {
    // A runtime up to 0.2 names h5p-standalone's loader as well, `mainJs`, and is kept with it:
    // the worker still writes the frame document such a runtime's boot script expects.
    const files = value && [value.frameJs, value.frameCss, value.bootJs]
    this.runtimeValue = files && files.every((url) => typeof url === 'string' && url)
      ? {
          ...(typeof value.mainJs === 'string' && value.mainJs ? { mainJs: value.mainJs } : {}),
          frameJs: value.frameJs,
          frameCss: value.frameCss,
          bootJs: value.bootJs,
          ...l10nFile(value.l10nJs),
          fonts: Array.isArray(value.fonts)
            ? value.fonts.filter((font) => font && typeof font === 'object').map(({ family, style, weight, url }) => ({ family, style, weight, url }))
            : []
        }
      : null
  }

  /**
   * The library pack, as a bundler emits it: the `pack` export of `@missing-elements/h5p-libraries`,
   * its index with the URL of each part. `libraries="pack"` then plays from these, and nothing is
   * asked of jsDelivr. Read by the load, so set it before `src`; it takes precedence over
   * `pack-base`. Entries that are not well formed are dropped, and a value left with none is none.
   */
  get pack(): LibraryPack | null {
    return this.packValue ? { libraries: this.packValue } : null
  }

  set pack(value: LibraryPack | null) {
    const libraries = Array.isArray(value?.libraries)
      ? packLibrariesIn(
          value.libraries.map((library) => {
            try {
              return { ...library, url: new URL(library.url, location.href).href }
            } catch {
              return null
            }
          })
        )
      : []
    this.packValue = libraries.length ? libraries : null
  }

  /** The `runtime` property, else an `assets-base`, else `frame-assets/` beside the element. */
  private frameAssets(): FrameAssets {
    if (this.runtimeValue) return this.runtimeValue
    const raw = this.getAttribute('assets-base')?.trim()
    if (!raw) return DEFAULT_ASSETS
    return assetsIn(new URL(raw.endsWith('/') ? raw : `${raw}/`, location.href).href)
  }

  /**
   * The element's language, read by the load like the attributes the record keeps: its `lang`,
   * or the one it inherits from the page. The frame is in the content's own language, the one
   * `h5p.json` names, and H5P's own strings with it; this one is the frame's only for a package
   * that names none, and the runtime's boot script then picks its translation of the core's
   * strings for it, or leaves them English.
   */
  private frameLanguage(): string | undefined {
    return languageTag(declaredLanguage(this))
  }


  /** Runs the pre-play download for a host that does not honour `Range`, reporting progress. */
  private runDownload(
    pkgId: string,
    source: SourceDescriptor,
    signal: AbortSignal,
    phase: 'download' | 'libraries',
    onProgress?: () => void
  ): Promise<void> {
    return this.awaitJob({ type: 'download', pkgId, source }, undefined, phase, signal, { onProgress, failureRejects: true })
  }

  /**
   * Has the Jobs worker pull the archive's library spans into the cache, and waits for it. The
   * job answers `done` however it went — a full store or a host that stopped answering only
   * shorten what landed — so this resolves and never rejects; an abort resolves it too.
   */
  private runWarm(pkgId: string, source: SourceDescriptor, spans: WarmSpan[], signal: AbortSignal): Promise<void> {
    return this.awaitJob({ type: 'warm', pkgId, source, spans }, WARM_ENTRY, 'warm', signal, { failureRejects: false })
  }

  /**
   * Posts a job to the Jobs worker and waits for its end, relaying its progress as `phase`. The
   * job's messages are the package's with `entry` — none for a download, `WARM_ENTRY` for the
   * warm. `done` resolves; `failed` rejects with the job's error, or resolves where a shortened
   * job is as good as a whole one; an abort of the load resolves and stops listening.
   */
  private awaitJob(
    job: Extract<ToJobsMessage, { type: 'download' | 'warm' }>,
    entry: string | undefined,
    phase: PlayerProgressDetail['phase'],
    signal: AbortSignal,
    { onProgress, failureRejects }: { onProgress?: () => void; failureRejects: boolean }
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const jobs = this.ensureJobs()

      const onMessage = (event: MessageEvent<FromJobsMessage>) => {
        const message = event.data
        if (message.pkgId !== job.pkgId || (message.entry || undefined) !== entry) return

        if (message.type === 'progress') {
          this.emitProgress({ phase, loaded: message.loaded, total: message.total, fraction: fractionOf(message) })
          onProgress?.()
          return
        }

        jobs.removeEventListener('message', onMessage)
        if (message.type === 'done' || !failureRejects) resolve()
        else reject(new PlayerError(message.code, message.message))
      }

      jobs.addEventListener('message', onMessage)
      signal.addEventListener('abort', () => {
        jobs.removeEventListener('message', onMessage)
        resolve()
      })

      this.postToJobs(job)
    })
  }

  /* ---------------------------------------------------------------- Service Worker */

  /**
   * Finds the routes, registering our own worker unless a host has already mounted the handlers
   * into theirs. Registration uses an explicit `h5p/` sub-scope, so a host worker living in the
   * same directory — or at `/`, for a root-placed `h5p-sw.js` — is never displaced. One setup at
   * a time: a load that starts while an earlier one is still bringing the worker up to the
   * element's version — up to thirty seconds across a major, on a slow host — waits on that setup.
   * The routes are kept before the version is asked, and a load that began meanwhile took them as
   * kept and went ahead with the worker of the major before (#49, found in review).
   */
  private ensureWorker(): Promise<Routes> {
    if (!this.workerSetup) {
      this.workerSetup = this.setUpWorker().finally(() => {
        this.workerSetup = null
      })
    }
    return this.workerSetup
  }

  private async setUpWorker(): Promise<Routes> {
    if (this.routes && this.registration) {
      if (await stillRegistered(this.registration)) return this.routes

      // Clearing site data unregisters the worker without telling anyone. The cached handle
      // still looks fine, and every route it used to answer then falls through to the origin —
      // which happily returns its own index.html, so the frame ends up showing the host page
      // nested inside itself instead of the content.
      this.routes = null
      this.registration = null
    }

    if (!('serviceWorker' in navigator)) {
      throw new PlayerError(
        'no-worker',
        'This browser has no Service Worker support, or the page is not on https/localhost'
      )
    }

    const mounted = await this.findMountedRoutes()
    if (mounted) {
      this.routes = mounted.routes
      this.registration = mounted.registration
      return mounted.routes
    }

    const swUrl = this.getAttribute('sw')?.trim() || DEFAULT_SW_URL
    const resolved = new URL(swUrl, location.href)

    if (resolved.origin !== location.origin) {
      throw new PlayerError('no-worker', 'The Service Worker script must be served same-origin')
    }

    const scope = new URL('h5p/', resolved).href

    let registration: ServiceWorkerRegistration
    try {
      registration = await navigator.serviceWorker.register(resolved.href, { scope })
    } catch (error) {
      throw new PlayerError('no-worker', `Could not register ${resolved.href}`, { cause: error })
    }

    // Not `navigator.serviceWorker.ready`: that tracks the page's own controller, and for a
    // nested scope like this one it may never resolve.
    await activated(registration)

    this.registration = registration
    this.routes = routesFor(registration.scope)
    await this.ensureCurrentWorker(registration)
    return this.routes
  }

  /** A host that enforces one worker mounts our handlers in theirs; those routes answer `_ping`. */
  private async findMountedRoutes(): Promise<
    { routes: Routes; registration: ServiceWorkerRegistration } | null
  > {
    if (!navigator.serviceWorker.controller) return null

    try {
      const registration = await navigator.serviceWorker.ready
      const routes = routesFor(registration.scope)
      const response = await fetch(routes.ping, { cache: 'no-store' })
      if (!response.ok) return null

      const body = (await response.json()) as { version?: string }
      warnIfDifferent(body.version)
      return { routes, registration }
    } catch {
      // No worker controls the page, or what controls it does not answer the ping as the mounted
      // handlers do: not the single-worker setup, and the element registers a worker of its own.
      return null
    }
  }

  /**
   * Brings the worker up to the element's version before the frame boots. Registering again with
   * an unchanged script URL returns the existing registration without fetching the script, so the
   * first load after an update would boot against the old worker — and the frame's navigation,
   * being in scope, would then make the browser fetch the new one and swap it in about a second
   * into the boot, under a frame document the old version wrote. So a version that differs asks
   * for the update itself and waits for it, bounded: offline, or on a slow host, the load goes
   * ahead with the worker it has. A script that is still old after the update is the host's copy,
   * which only the host can replace; that stays a warning. A worker of another major cannot serve
   * this element at all, so for one the load waits as long as the update takes, within
   * `WORKER_MAJOR_UPDATE_TIMEOUT_MS`.
   */
  private async ensureCurrentWorker(registration: ServiceWorkerRegistration): Promise<void> {
    const before = await this.workerVersion()
    if (before === null || before === VERSION) return

    const wait = majorOf(before) === MAJOR_VERSION ? WORKER_UPDATE_TIMEOUT_MS : WORKER_MAJOR_UPDATE_TIMEOUT_MS
    await withTimeout(updateWorker(registration, wait), wait, undefined)
    // Asked again rather than trusting what the update reported: with `skipWaiting`, a new
    // worker can be active before `update()` has resolved, leaving nothing in `installing`.
    warnIfDifferent((await this.workerVersion()) ?? before)
  }

  /**
   * The worker's version, over the control channel rather than over the `_ping` route. The
   * route only answers for a client the worker controls, and the host page deliberately is not
   * one — our scope is a sub-directory it does not sit under. `postMessage` to the registration's
   * own worker has no such requirement. `null` when it cannot be learnt: a version check must not
   * fail a load.
   */
  private async workerVersion(): Promise<string | null> {
    try {
      const reply = await this.send({ type: 'ping' }, WORKER_UPDATE_TIMEOUT_MS)
      return reply.ok && reply.type === 'pong' ? reply.version : null
    } catch {
      return null
    }
  }

  /** Sends a control message to the worker and waits for its reply on a private port. */
  private async send(message: ToWorkerMessage, timeoutMs = CONTROL_TIMEOUT_MS): Promise<WorkerReply> {
    const worker = this.registration?.active
    if (!worker) throw new PlayerError('no-worker', 'The Service Worker is not active')

    // A timer of its own rather than `withTimeout`: the port has to be closed when the time is
    // up, or it stays entangled for the GC to find.
    const reply = await new Promise<WorkerReply>((resolve, reject) => {
      const channel = new MessageChannel()
      const timer = setTimeout(() => {
        channel.port1.close()
        reject(new PlayerError('no-worker', `The worker did not answer "${message.type}"`))
      }, timeoutMs)

      channel.port1.onmessage = (event: MessageEvent<WorkerReply>) => {
        clearTimeout(timer)
        // Closed, or every control message leaves an entangled port behind for the GC to find.
        channel.port1.close()
        resolve(event.data)
      }

      worker.postMessage(message, [channel.port2])
    })

    // The structured part travels with the error: deciding to fetch missing libraries needs to
    // know which ones, and for which content type.
    if (!reply.ok) {
      throw new PlayerError(reply.code, reply.message, { missingLibraries: reply.missingLibraries })
    }
    return reply
  }

  /* ---------------------------------------------------------------- Jobs worker */

  /**
   * The carried script first, from a `blob:` URL, and `h5p-jobs.js` if the page's policy refuses
   * that. A host that names its own copy with `jobs` gets that first instead, so a strict policy
   * never sees the `blob:` attempt — which would otherwise land in its violation reports.
   */
  private ensureJobs(): JobsWorkerHandle {
    if (this.jobs) return this.jobs

    const named = this.getAttribute('jobs')?.trim()
    const scriptAt = (href: string): JobsScript => ({ label: href, url: () => new URL(href, location.href).href })
    this.jobs = new JobsWorkerHandle(named ? [scriptAt(named), BLOB_JOBS_SCRIPT] : [BLOB_JOBS_SCRIPT, scriptAt(DEFAULT_JOBS_URL)])

    this.jobs.addEventListener('message', (event: MessageEvent<FromJobsMessage>) => {
      const message = event.data
      // A warm reports under a reserved entry name; `runWarm` is listening for it, and a report
      // that reached here as an extraction would surface as one.
      if (message.entry === WARM_ENTRY) return
      if (message.type === 'progress' && message.entry) {
        this.emitProgress({
          phase: 'extract',
          entry: message.entry,
          loaded: message.loaded,
          total: message.total,
          fraction: fractionOf(message)
        })
      }
      if ((message.type === 'done' || message.type === 'failed') && message.entry) {
        if (message.entry === this.prefetching) {
          this.prefetching = null
          this.advancePrefetch()
        }
      }
      if (message.type === 'failed' && message.entry) {
        // An entry that fails to extract is a broken media file, not a broken package: the
        // runtime keeps going, so this is reported without tearing the player down.
        this.dispatchEvent(
          new CustomEvent<PlayerErrorDetail>('error', {
            detail: { code: message.code, message: `${message.entry}: ${message.message}` }
          })
        )
      }
    })

    return this.jobs
  }

  /**
   * Starts the next queued entry, one at a time. Serial rather than parallel: these are whole
   * videos, and running two halves the rate of the one the learner reaches first. A demand
   * request from the runtime is not queued behind this — it is posted straight through, and the
   * Jobs worker's in-flight map collapses the two if they name the same entry.
   */
  private advancePrefetch(): void {
    if (this.preload !== 'auto') return
    if (this.prefetching) return

    const next = this.prefetchQueue.shift()
    if (!next) return

    const pkgId = this.internalPkgId
    const source = this.currentSource
    if (!pkgId || !source) return

    this.prefetching = next.entry
    // Marked, so it queues behind anything the runtime is actually waiting on.
    this.postToJobs({ type: 'extract', pkgId, entry: next.entry, location: next.location, source, prefetch: true })
  }

  private postToJobs(message: ToJobsMessage): void {
    if (message.type === 'abort' && !this.jobs) return

    const jobs = this.ensureJobs()
    // A local-file package needs the `File` itself; it is cloned once per job message.
    if (message.type !== 'abort' && this.currentFile && this.currentSource?.type === 'file') {
      jobs.postMessage({ ...message, file: this.currentFile })
      return
    }
    jobs.postMessage(message)
  }

  /* ---------------------------------------------------------------- messages in */

  private onWindowMessage = (event: MessageEvent<FromFrameMessage | H5PResizerMessage>): void => {
    const data = event.data
    if (!data) return
    // The frame is same-origin by construction; anything else claiming to be it is not it.
    if (event.origin !== location.origin) return

    // Before the source check and the package filter: the runtime saves as its document goes
    // away, which for the previous package happens when the frame navigates to the next one —
    // after `internalPkgId` has moved on, and by the time the message is handled the document
    // that sent it is gone and `event.source` no longer names it. The token it carries says
    // which document it was, and nothing outside that document ever had the token.
    if ('channel' in data && data.channel === 'h5p-player' && data.type === 'user-data') {
      this.onUserData(data)
      return
    }

    // A statement the previous package's document sent just before the next load replaced it.
    // Removing the iframe's `src` takes it to `about:blank` in Chromium, and a message from the
    // document that left arrives with `event.source` null, so the check below cannot place it.
    // Only a statement, only for the package just replaced: anything else from a document that
    // is gone has nothing left to act on. A null source proves no more than a same-origin sender,
    // and same-origin script can dispatch an `xapi` event on this element directly anyway.
    if (
      event.source === null &&
      'channel' in data &&
      data.channel === 'h5p-player' &&
      (data.type === 'xapi' || data.type === 'finished') &&
      data.pkgId !== this.internalPkgId &&
      data.pkgId === this.previousStamp?.pkgId
    ) {
      this.emitStatement(heldStatement(data))
      return
    }

    if (event.source !== this.iframe.contentWindow) return

    if ('context' in data && data.context === 'h5p') {
      this.onResizerMessage(data)
      return
    }

    if (!('channel' in data) || data.channel !== 'h5p-player') return
    if (this.internalPkgId && data.pkgId !== this.internalPkgId) return

    switch (data.type) {
      case 'need-user-data':
        void this.answerUserData(data.pkgId)
        return

      case 'ready':
        this.setState('ready')
        // Only now: until the content is up, the archive reads that boot it are competing for
        // the same connection, and a 200 MB video would make the player itself slower to appear.
        this.advancePrefetch()
        this.dispatchEvent(
          new CustomEvent<ReadyDetail>('ready', {
            detail: {
              pkgId: data.pkgId,
              source: this.source,
              metadata: this.metadata,
              revision: this.internalRevision,
              libraryBundle: this.libraryBundle
            }
          })
        )
        return

      case 'xapi':
      case 'finished':
        this.emitStatement(heldStatement(data))
        return

      case 'error':
        this.dispatchEvent(
          new CustomEvent<PlayerErrorDetail>('error', {
            detail: { code: 'runtime', message: data.message }
          })
        )
        // Before `ready` a runtime error is the boot failing. After it the content is up and
        // very likely still working — H5P content types throw non-fatal exceptions routinely,
        // on resize in particular — so it is reported and the state is left alone: a host that
        // hides the player on `error` must not hide working content.
        if (this.internalState !== 'ready') this.setState('error')
        return

      case 'relay':
        this.handleWorkerRequest(data.payload)
    }
  }

  /**
   * The frame asked for the saved state before initialising the runtime. From this device's
   * store, or from what the host handed in; either way with a fresh token for this document's
   * saves. A value saved against another build of the package is handed over as `null`, which
   * the runtime shows as "this content has changed, you'll be starting over" and then deletes
   * — H5P's own answer to the situation, rather than a silent restart or a state the content
   * was not written for. Not checked while the build is unknown: on a host without `Range` the
   * frame boots before the index can say, and the package id already separates builds on any
   * host that sends a validator.
   */
  private async answerUserData(pkgId: string): Promise<void> {
    const mode = this.loadResumeMode
    let entries: UserDataEntry[] = []
    if (mode === 'host') {
      entries = (this.hostUserData ?? []).map(({ dataType, subContentId, data }) => ({
        dataType: String(dataType),
        subContentId: String(subContentId),
        data: data === null ? null : String(data)
      }))
    } else if (mode === 'device') {
      let rows: Awaited<ReturnType<typeof readUserData>> = []
      try {
        rows = await readUserData(pkgId)
      } catch {
        // No store, no state: the content starts over, and the saves to come will fail the same way.
      }
      if (pkgId !== this.internalPkgId) return
      const revision = this.internalRevision
      entries = rows.map((row) => ({
        dataType: row.dataType,
        subContentId: row.subContentId,
        data: revision && row.revision && row.revision !== revision ? null : row.data
      }))
    }

    const session = createNonce()
    this.userDataMode = mode
    this.userDataSession = session
    const preload: UserDataPreload = {
      channel: 'h5p-player',
      type: 'user-data',
      session,
      saveInterval: this.loadSaveInterval,
      entries,
      ...(this.userValue ? { user: this.userValue } : {})
    }
    this.iframe.contentWindow?.postMessage(preload, location.origin)
  }

  /** The runtime saved a value, or deleted one. Kept here, or handed to the host, and told either way. */
  private onUserData(message: Extract<FromFrameMessage, { type: 'user-data' }>): void {
    if (!this.userDataSession || message.session !== this.userDataSession) return
    // A frame booted for a named learner carries the shim without `resume`, and a content type
    // may save through it; with `resume` off the host asked for no `userdata` events.
    if (this.userDataMode === 'off') return
    const { pkgId, dataType, subContentId, data } = message
    const previous = this.previousStamp
    const revision =
      pkgId === this.internalPkgId
        ? this.internalRevision
        : previous && previous.pkgId === pkgId
          ? previous.revision
          : null

    if (this.userDataMode === 'device') {
      const write =
        data === null
          ? removeUserData(pkgId, dataType, subContentId)
          : writeUserData({ pkgId, dataType, subContentId, revision, data, updatedAt: Date.now() })
      write.catch(() => {
        // Storage refused or gone. The content keeps running; the host hears the save below and
        // can keep it itself.
      })
    }

    this.dispatchEvent(
      new CustomEvent<UserDataDetail>('userdata', {
        detail: { pkgId, revision, dataType, subContentId, data }
      })
    )
  }

  /** The worker can also reach the element directly when the page itself is controlled. */
  private onServiceWorkerMessage = (event: MessageEvent<FromWorkerMessage>): void => {
    if (event.data?.type === 'need-job' || event.data?.type === 'need-file') {
      this.handleWorkerRequest(event.data)
    }
  }

  private handleWorkerRequest(message: FromWorkerMessage): void {
    if (message.pkgId !== this.internalPkgId) return

    if (message.type === 'need-file') {
      if (!this.currentFile) return
      // The worker is waiting on this with a timeout of its own; a failure here surfaces there.
      this.send({ type: 'file', pkgId: message.pkgId, file: this.currentFile }).catch(() => {})
      return
    }

    if (!this.currentSource) return
    this.postToJobs({
      type: 'extract',
      pkgId: message.pkgId,
      entry: message.entry,
      location: message.location,
      source: this.currentSource
    })
  }

  /* ---------------------------------------------------------------- H5P's resizer protocol */

  /**
   * The embedder half of H5P's own iframe resizing, the same exchange `h5p-resizer.js` implements
   * for a site embedding h5p.org content.
   *
   * H5P drives it from the `resize` events content types raise when they actually change — a
   * dialog opening, an interaction loading, an image arriving. Watching the frame's DOM from the
   * outside would both miss those and fire on changes that are not resizes.
   */
  private onResizerMessage(message: H5PResizerMessage): void {
    const respond = (action: string, payload: Record<string, unknown> = {}) => {
      this.iframe.contentWindow?.postMessage({ ...payload, context: 'h5p', action }, location.origin)
    }

    switch (message.action) {
      case 'hello':
        // Until this is answered the frame keeps its document at full height and never reports a
        // content size. Answering it is what starts the exchange. The measurement whose result is
        // dropped is a forced layout, copied from h5p-resizer.js: without it Chrome can hand the
        // content a stale frame width, and its first measurement comes out wrong.
        this.iframe.getBoundingClientRect()
        window.addEventListener('resize', this.onWindowResize)
        respond('hello')
        return

      case 'prepareResize': {
        const { scrollHeight = 0, clientHeight = 0 } = message
        if (this.iframe.clientHeight === scrollHeight && scrollHeight === clientHeight) return

        // Let the content fall back to its own height before it measures, so a shrink is seen.
        if (this.autoResizes && clientHeight > 0) {
          this.style.height = `${clientHeight}px`
        }
        respond('resizePrepared')
        return
      }

      case 'resize': {
        const height = message.scrollHeight ?? 0
        if (height <= 0) return

        this.dispatchEvent(new CustomEvent<PlayerResizeDetail>('resize', { detail: { height } }))
        if (this.autoResizes) this.style.height = `${height}px`
        return
      }
    }
  }

  /** Tells the content to lay out again when the window changes, as the reference embedder does. */
  private onWindowResize = (): void => {
    this.iframe.contentWindow?.postMessage({ context: 'h5p', action: 'resize' }, location.origin)
  }

  /* ---------------------------------------------------------------- events out */

  private setState(state: PlayerState): void {
    if (this.internalState === state) return
    this.internalState = state
    this.setAttribute('state', state)
    this.dispatchEvent(new CustomEvent<PlayerStateChangeDetail>('statechange', { detail: { state } }))
  }

  /** Dispatches a statement from the content, or holds it until the revision is known. */
  private emitStatement(held: HeldStatement): void {
    const previous = this.previousStamp
    if (previous && held.pkgId === previous.pkgId && held.pkgId !== this.internalPkgId) {
      this.dispatchStatement(held, previous.revision)
      return
    }
    if (!this.revisionSettled) {
      this.heldStatements.push(held)
      return
    }
    this.dispatchStatement(held, this.internalRevision)
  }

  private releaseStatements(): void {
    const held = this.heldStatements
    this.heldStatements = []
    for (const each of held) this.dispatchStatement(each, this.internalRevision)
  }

  /**
   * The page is going away, or may be: a tab hidden on a phone is often never shown again. A
   * held statement goes out now, without its revision, because a learner's record lost with the
   * tab is worse than one that cannot prove its build. `visibilitychange` as well as `pagehide`,
   * since mobile browsers fire only the first reliably.
   */
  private onPageHidden = (event: Event): void => {
    if (event.type === 'visibilitychange' && document.visibilityState !== 'hidden') return
    this.releaseStatements()
  }

  /** `context.revision` and `context.platform` go in here, the one place a statement leaves. */
  private dispatchStatement({ type, statement, verb }: HeldStatement, revision: string | null): void {
    const stamped = withProvenance(statement, revision, platformOf(VERSION))
    const detail = type === 'xapi' ? { statement: stamped, verb } : { statement: stamped }
    this.dispatchEvent(new CustomEvent(type, { detail }))
  }

  private emitProgress(detail: PlayerProgressDetail): void {
    this.dispatchEvent(new CustomEvent<PlayerProgressDetail>('progress', { detail }))
  }

  private fail(error: unknown): void {
    const code: ErrorCode = error instanceof PlayerError ? error.code : 'network'
    const message = error instanceof Error ? error.message : String(error)
    const missingLibraries = error instanceof PlayerError ? error.missingLibraries : undefined

    // A package that failed to load is not loaded: its `playing` lock goes, so another load —
    // here or in another tab — may evict what it left in the store, and any job still running
    // for it is stopped.
    this.abortLoad()
    this.setState('error')
    this.dispatchEvent(
      new CustomEvent<PlayerErrorDetail>('error', { detail: { code, message, missingLibraries } })
    )
  }
}

/* ------------------------------------------------------------------ helpers */

/** A statement from the content, and the package whose frame sent it. */
interface HeldStatement {
  type: 'xapi' | 'finished'
  pkgId: string
  statement: unknown
  verb?: string
}

/** The entries the worker flagged as needing a background inflate, if it flagged any. */
/** What an index hands the load: the media worth starting early, and the spans worth pulling first. */
interface IndexResult {
  prefetch: PrefetchEntry[]
  warm: WarmSpan[]
  /** `h5p.json`'s title, which names the frame for assistive technology. */
  title?: string
  /** The xAPI `context.revision`; absent from a worker older than the element. */
  revision?: string
  /** `h5p.json`'s metadata and content type; absent from a worker older than the element. */
  metadata?: ContentMetadata
  mainLibrary?: string
}

/**
 * What a screen reader announces for the frame: "frame, <title>". The package's own title says
 * which content it is; the generic name is for before a package has been indexed, and for one
 * whose `h5p.json` has no title.
 */
const FRAME_TITLE = 'H5P content'

function frameTitle(title: string | undefined): string {
  const trimmed = title?.trim()
  return trimmed ? trimmed : FRAME_TITLE
}

function nothingIndexed(): IndexResult {
  return { prefetch: [], warm: [] }
}

function indexResultOf(reply: WorkerReply): IndexResult {
  if (!reply.ok || reply.type !== 'indexed') return nothingIndexed()
  return {
    prefetch: reply.prefetch ?? [],
    warm: reply.warm ?? [],
    title: reply.title,
    revision: reply.revision,
    metadata: reply.metadata,
    mainLibrary: reply.mainLibrary
  }
}

/** The indexes of pack copies read on this page, by folder: a load indexes several times. */
const packIndexes = new Map<string, Promise<Array<PackLibrary & { url: string }>>>()

/**
 * The index of a pack copy at `base`, `index.json` there, each part's URL beside it, read once a
 * page. Kept in the Cache API as last read, so a package that needs the pack plans the same with
 * no network; the network is asked first, so a copy the host has replaced is read anew on the
 * next page. One that cannot be read is asked for again by the next load.
 */
function packIndexAt(base: string): Promise<Array<PackLibrary & { url: string }>> {
  let reading = packIndexes.get(base)
  if (!reading) {
    reading = readPackIndex(base)
    packIndexes.set(base, reading)
    reading.catch(() => packIndexes.delete(base))
  }
  return reading
}

async function readPackIndex(base: string): Promise<Array<PackLibrary & { url: string }>> {
  const url = new URL('index.json', base).href
  const cache = await caches.open(PACK_INDEX_CACHE).catch(() => null)
  let response: Response
  try {
    response = await fetch(url, { cache: 'no-cache' })
    if (!response.ok) throw new PlayerError('network', `${url} returned ${response.status}`)
    await cache?.put(url, response.clone()).catch(() => {})
  } catch (error) {
    const kept = await cache?.match(url).catch(() => undefined)
    if (!kept) throw error instanceof PlayerError ? error : new PlayerError('network', `${url} could not be read`, { cause: error })
    response = kept
  }
  const index = (await response.json().catch(() => null)) as { libraries?: unknown } | null
  const entries = Array.isArray(index?.libraries) ? index.libraries : []
  const libraries = packLibrariesIn(
    entries.map((entry: unknown) =>
      entry && typeof entry === 'object' && typeof (entry as { folder?: unknown }).folder === 'string'
        ? { ...entry, url: new URL(`${(entry as { folder: string }).folder}.h5p`, base).href }
        : null
    )
  )
  if (libraries.length === 0) throw new PlayerError('bad-archive', `${url} is not the index of a library pack`)
  return libraries
}

/** A statement from the frame in the shape `emitStatement` holds it. */
function heldStatement(data: Extract<FromFrameMessage, { type: 'xapi' | 'finished' }>): HeldStatement {
  return data.type === 'xapi'
    ? { type: 'xapi', pkgId: data.pkgId, statement: data.statement, verb: data.verb }
    : { type: 'finished', pkgId: data.pkgId, statement: data.statement }
}

/**
 * How far a job has got, for a progress event. Capped: a download's total is the probe's, and
 * jsDelivr answers a ranged request with the length of its compressed copy, so the whole file
 * arrives past it.
 */
function fractionOf(message: { loaded: number; total: number | null }): number | null {
  return message.total ? Math.min(1, message.loaded / message.total) : null
}

/** A token the frame cannot guess: which document's saves the element accepts. */
function createNonce(): string {
  return randomHex(16)
}

/** False once a registration has been torn down, which clearing site data does silently. */
async function stillRegistered(registration: ServiceWorkerRegistration): Promise<boolean> {
  try {
    const current = await navigator.serviceWorker.getRegistration(registration.scope)
    return current?.active != null
  } catch {
    // A registration that cannot be asked about is as good as gone: the load registers again.
    return false
  }
}

/**
 * Resolves when *this* registration's newest worker is activated. Newest first: a registration
 * whose script changed has the new worker installing beside the old active one, and resolving on
 * the old would boot the frame against the version about to be replaced. The wait for a newer
 * worker is bounded while an older one can serve: a host's own worker that does not skip
 * waiting sits in `waiting` until every client of the old one has closed, and the load must not
 * wait with it. A newest worker that turns redundant falls back to the one running for the same
 * reason.
 */
function activated(registration: ServiceWorkerRegistration, wait = WORKER_UPDATE_TIMEOUT_MS): Promise<ServiceWorker> {
  const running = registration.active?.state === 'activated' ? registration.active : null
  const worker = registration.installing ?? registration.waiting ?? registration.active
  if (!worker) return Promise.reject(new PlayerError('no-worker', 'The registration has no worker'))
  if (worker.state === 'activated') return Promise.resolve(worker)

  const settled = new Promise<ServiceWorker>((resolve, reject) => {
    const onChange = () => {
      if (worker.state === 'activated') {
        worker.removeEventListener('statechange', onChange)
        resolve(registration.active ?? worker)
      } else if (worker.state === 'redundant') {
        worker.removeEventListener('statechange', onChange)
        if (running && running !== worker) resolve(running)
        else reject(new PlayerError('no-worker', 'The Service Worker became redundant'))
      }
    }
    worker.addEventListener('statechange', onChange)
  })
  return running && running !== worker ? withTimeout(settled, wait, running) : settled
}

/**
 * Fetches the registration's script and, when its bytes changed, waits for the new worker to
 * take over (`mountH5P` skips waiting), for up to `wait`. Settles without a word when nothing new
 * was installed: the network failed, or the script is the same bytes as before.
 */
async function updateWorker(registration: ServiceWorkerRegistration, wait: number): Promise<void> {
  try {
    await registration.update()
    if (registration.installing || registration.waiting) await activated(registration, wait)
  } catch {
    // Offline, a refused script, a worker that failed to install: the running one serves.
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms)
  })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}

/** A version's major, `0` of `0.10.0`; `NaN` for what is not a version, which matches no major. */
function majorOf(version: string): number {
  return Number(/^(\d+)\./.exec(version)?.[1] ?? NaN)
}

function warnIfDifferent(workerVersion: string | undefined): void {
  if (workerVersion && workerVersion !== VERSION) {
    console.warn(
      `[h5p-player] element is ${VERSION} but the Service Worker is ${workerVersion}. ` +
        'If this persists after a reload, re-copy h5p-sw.js so the two match.'
    )
  }
}

if (!customElements.get('h5p-player')) {
  customElements.define('h5p-player', H5PPlayerElement)
}

declare global {
  interface HTMLElementTagNameMap {
    'h5p-player': H5PPlayerElement
  }
}

export default H5PPlayerElement
