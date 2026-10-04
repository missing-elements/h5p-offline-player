import jobsWorkerSource from 'virtual:h5p-jobs-worker'
import SHADOW_CSS from './shadow.css?inline'
import { FRAME_FONTS } from './frame-fonts'
import { JobsWorkerHandle, type JobsScript } from './jobs-worker-handle'
import { SAVE_INTERVAL_S, VERSION, WARM_ENTRY } from './shared/constants'
import {
  HUB_CONTENT_TYPE_URL,
  PlayerError,
  type ErrorCode,
  type LibrarySource,
  type MissingLibraries,
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
import { filePkgId, remotePkgId } from './shared/pkg-id'
import { platformOf, withProvenance } from './shared/revision'
import { probeSource } from './shared/source'
import { routesFor, type Routes } from './sw/routes'
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

/** File names inside `frame-assets/`, relative to the assets base. */
const ASSET_FILES = {
  mainJs: 'main.bundle.js',
  frameJs: 'frame.bundle.js',
  frameCss: 'h5p.css'
} as const

// Every file the element needs is named here, one static `new URL('./file', import.meta.url)`
// each, so that Vite, Rollup and webpack 5 in a consuming app emit it as an asset and rewrite the
// URL — nothing for the host to copy. A directory cannot be emitted that way, which is why the
// runtime is not addressed as `./frame-assets/` plus a name, and why each file stands alone:
// `h5p.css` carries its fonts and images inlined (see `sync-h5p-assets.mjs`).
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

/** The runtime inside a directory: the dev server's, or the one an `assets-base` names. */
function assetsIn(base: string): FrameAssets {
  return {
    mainJs: new URL(ASSET_FILES.mainJs, base).href,
    frameJs: new URL(ASSET_FILES.frameJs, base).href,
    frameCss: new URL(ASSET_FILES.frameCss, base).href,
    fonts: FRAME_FONTS.map(({ family, style, weight, file }) => ({ family, style, weight, url: new URL(`fonts/${file}`, base).href }))
  }
}

const DEFAULT_ASSETS: FrameAssets = import.meta.env.DEV
  ? assetsIn(new URL(DEV_ASSETS_BASE, location.href).href)
  : {
      mainJs: unbundled(new URL(/* @vite-ignore */ './frame-assets/main.bundle.js', import.meta.url).href),
      frameJs: unbundled(new URL(/* @vite-ignore */ './frame-assets/frame.bundle.js', import.meta.url).href),
      frameCss: unbundled(new URL(/* @vite-ignore */ './frame-assets/h5p.css', import.meta.url).href),
      fonts: FRAME_FONTS.map(({ family, style, weight, packaged }) => ({ family, style, weight, url: unbundled(packaged) }))
    }

export type PlayerState = 'idle' | 'probing' | 'downloading' | 'indexing' | 'ready' | 'error'

export type { UserDataEntry } from './shared/protocol'

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
  static get observedAttributes(): string[] {
    return ['src', 'sw', 'assets-base', 'auto-resize', 'libraries', 'allow-origins', 'preload', 'resume']
  }

  private iframe: HTMLIFrameElement
  private jobs: JobsWorkerHandle | null = null
  private routes: Routes | null = null
  private registration: ServiceWorkerRegistration | null = null
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
  private heldStatements: HeldStatement[] = []
  /**
   * The package this element played before the current load, and its revision. Removing the
   * iframe's `src` does not unload the document in it, so until the frame navigates to the new
   * package the old one can still send statements — and while the new load is probing,
   * `internalPkgId` is null and the message filter lets them through. They are stamped with the
   * build they came from, not held and released under the next one's.
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
  /** Resume policy belonging to `userDataSession`; the public attribute changes on next load. */
  private userDataMode: ResumeMode = 'off'
  private prefetching: string | null = null

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
   * The content keeps running as it is; set `src` again to start it over. Saves from the running
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

    // `sw` and `assets-base` only take effect on the next load; a running package keeps the
    // worker and assets it was loaded with.
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

  /** Empties the player without an error: what removing `src`, or setting `file` to null, means. */
  private clear(): void {
    this.abortLoad()
    this.iframe.removeAttribute('src')
    this.iframe.title = FRAME_TITLE
    this.forgetPackage()
    this.setState('idle')
  }

  /** No package loaded here any more; what it was is kept only to stamp its stragglers. */
  private forgetPackage(): void {
    if (this.internalPkgId) this.previousStamp = { pkgId: this.internalPkgId, revision: this.internalRevision }
    this.internalPkgId = null
    this.internalRevision = null
  }

  private async startLoad(): Promise<void> {
    this.abortLoad()

    const controller = new AbortController()
    this.load = controller
    const { signal } = controller

    this.iframe.removeAttribute('src')
    this.iframe.title = FRAME_TITLE
    this.forgetPackage()
    this.revisionSettled = false

    try {
      this.setState('probing')

      const routes = await this.ensureWorker()
      if (signal.aborted) return

      const { descriptor, pkgId } = await this.resolveSource(signal)
      if (signal.aborted) return

      this.currentSource = descriptor
      this.internalPkgId = pkgId
      this.holdPackage(pkgId, signal)

      await this.send({ type: 'register', record: this.recordFor(pkgId, descriptor) })
      if (signal.aborted) return

      if (descriptor.type === 'file' && this.currentFile) {
        await this.send({ type: 'file', pkgId, file: this.currentFile })
      }

      // `?resume=1` tells the frame's boot script to ask for the saved state before the runtime
      // initialises. In the URL, not the frame document, so that a worker and an element of
      // different versions each do what they know: see `frame-boot.ts`.
      const frameUrl = `${routes.frame}${pkgId}${this.resume === 'off' ? '' : '?resume=1'}`
      let indexed: IndexResult

      if (descriptor.type === 'chunked') {
        this.setState('downloading')
        indexed = await this.downloadAndIndex(pkgId, descriptor, signal, frameUrl)
      } else {
        this.setState('indexing')
        indexed = await this.index(pkgId, signal)
        if (signal.aborted) return
        // The libraries are pulled into the cache in a few requests before the frame boots;
        // read on demand, they cost the runtime one or two round trips per file. Not a step
        // that can fail the load: the frame boots against whatever landed.
        if (descriptor.type === 'range-http' && indexed.warm.length > 0) {
          await this.runWarm(pkgId, descriptor, indexed.warm, signal)
        }
      }
      if (signal.aborted) return

      this.iframe.title = frameTitle(indexed.title)
      this.internalRevision = indexed.revision ?? null
      this.revisionSettled = true
      this.releaseStatements()
      // A state saved before this answer — by a frame booted early on a host without `Range` —
      // is stamped with the build now that it is known, so the next load can check it.
      if (this.resume === 'device' && this.internalRevision) {
        adoptRevision(pkgId, this.internalRevision).catch(() => {})
      }

      this.prefetchQueue = [...indexed.prefetch]
      // A download that booted early already has its frame; the final index only swapped the
      // worker onto the real one. Otherwise: the registration has to be `activated` before this
      // navigation, or it reaches the server and 404s — there is no such file.
      if (this.iframe.getAttribute('src') !== frameUrl) this.iframe.src = frameUrl
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
    pkgId: string,
    source: SourceDescriptor,
    signal: AbortSignal,
    frameUrl: string
  ): Promise<IndexResult> {
    let booted = false
    let attempt: Promise<void> | null = null

    const tryBoot = () => {
      if (booted || attempt || signal.aborted) return
      attempt = this.send({ type: 'index', pkgId })
        .then((reply) => {
          if (signal.aborted || booted) return
          if (reply.ok && reply.type === 'indexed' && reply.ready !== false) {
            booted = true
            this.iframe.title = frameTitle(reply.title)
            this.iframe.src = frameUrl
          }
        })
        .catch(() => {
          // Too early to index, or the index cannot yet boot: the next progress report asks again.
        })
        .finally(() => {
          attempt = null
        })
    }

    await this.runDownload(pkgId, source, signal, 'download', tryBoot)
    if (signal.aborted) return nothingIndexed()
    if (attempt) await attempt

    // A frame already up keeps its state; the rest of this is the worker's bookkeeping.
    if (!booted) this.setState('indexing')
    return this.index(pkgId, signal)
  }

  /**
   * Indexes the package, and if it turns out to declare libraries it does not carry, fetches them
   * from the configured source and indexes again.
   *
   * Without a `libraries` attribute this is one call that either works or reports exactly what is
   * missing. Reaching out to a third party is never something the element decides on its own.
   */
  private async index(pkgId: string, signal: AbortSignal): Promise<IndexResult> {
    try {
      return indexResultOf(await this.send({ type: 'index', pkgId }))
    } catch (error) {
      const missing = error instanceof PlayerError ? error.missingLibraries : undefined
      const source = this.librarySource()
      if (!missing || !source) throw error

      await this.supplyLibraries(pkgId, missing, source, signal)
      if (signal.aborted) return nothingIndexed()

      // Either it is complete now, or this throws naming what is still absent.
      return indexResultOf(await this.send({ type: 'index', pkgId }))
    }
  }

  /**
   * Registers a second package as the source of the libraries this one is missing.
   *
   * Every failure along the way — an unreachable URL, a bundle that is not an archive, one that
   * turns out not to have them either — is reported as one thing: these libraries are missing and
   * this is where the attempt to supply them stopped.
   */
  private async supplyLibraries(
    pkgId: string,
    missing: MissingLibraries,
    source: LibrarySource,
    signal: AbortSignal
  ): Promise<void> {
    const url = libraryBundleUrl(missing, source)

    try {
      let descriptor: RemoteSourceDescriptor
      try {
        descriptor = await probeSource(url, signal)
      } catch (error) {
        if (signal.aborted) throw error
        // The source cannot be reached — no network, or the hub is down — but a bundle
        // downloaded from it before serves as well now as it did then. This is what lets an
        // installed app play a stripped export offline once it has played one online.
        // Briefly, and a silence is a no: a worker older than 0.1.7 — an `h5p-sw.js` copied
        // before the element was updated — does not know the question and never answers it.
        const reply = await this.send({ type: 'find-downloaded-libraries', url }, 3_000).catch(() => null)
        const earlier = reply?.ok && reply.type === 'downloaded-libraries' ? reply.pkgId : null
        if (!earlier) throw error

        this.setState('indexing')
        await this.send({ type: 'index', pkgId: earlier })
        await this.send({ type: 'attach-libraries', pkgId, libraryPkgId: earlier })
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
        record: { ...this.recordFor(libraryPkgId, bundle), role: 'libraries' }
      })

      this.setState('downloading')
      await this.runDownload(libraryPkgId, bundle, signal, 'libraries')
      if (signal.aborted) return

      this.setState('indexing')
      await this.send({ type: 'index', pkgId: libraryPkgId })
      await this.send({ type: 'attach-libraries', pkgId, libraryPkgId })
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

  private librarySource(): LibrarySource | null {
    const value = this.getAttribute('libraries')?.trim()
    if (!value) return null
    return value === 'hub' ? 'hub' : { url: value }
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
      status: 'registered',
      lastPlayed: Date.now(),
      version: VERSION
    }
  }

  private frameAssets(): FrameAssets {
    const raw = this.getAttribute('assets-base')?.trim()
    if (!raw) return DEFAULT_ASSETS
    return assetsIn(new URL(raw.endsWith('/') ? raw : `${raw}/`, location.href).href)
  }


  /** Runs the pre-play download for a host that does not honour `Range`, reporting progress. */
  private runDownload(
    pkgId: string,
    source: SourceDescriptor,
    signal: AbortSignal,
    phase: 'download' | 'libraries' = 'download',
    onProgress?: () => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const jobs = this.ensureJobs()

      const onMessage = (event: MessageEvent<FromJobsMessage>) => {
        const message = event.data
        if (message.pkgId !== pkgId || message.entry) return

        if (message.type === 'progress') {
          this.emitProgress({
            phase,
            loaded: message.loaded,
            total: message.total,
            fraction: message.total ? message.loaded / message.total : null
          })
          onProgress?.()
          return
        }

        jobs.removeEventListener('message', onMessage)
        if (message.type === 'done') resolve()
        else reject(new PlayerError(message.code, message.message))
      }

      jobs.addEventListener('message', onMessage)
      signal.addEventListener('abort', () => {
        jobs.removeEventListener('message', onMessage)
        resolve()
      })

      this.postToJobs({ type: 'download', pkgId, source })
    })
  }

  /**
   * Has the Jobs worker pull the archive's library spans into the cache, and waits for it. The
   * job answers `done` however it went — a full store or a host that stopped answering only
   * shorten what landed — so this resolves and never rejects; an abort resolves it too.
   */
  private runWarm(pkgId: string, source: SourceDescriptor, spans: WarmSpan[], signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const jobs = this.ensureJobs()

      const onMessage = (event: MessageEvent<FromJobsMessage>) => {
        const message = event.data
        if (message.pkgId !== pkgId || message.entry !== WARM_ENTRY) return

        if (message.type === 'progress') {
          this.emitProgress({
            phase: 'warm',
            loaded: message.loaded,
            total: message.total,
            fraction: message.total ? message.loaded / message.total : null
          })
          return
        }

        jobs.removeEventListener('message', onMessage)
        resolve()
      }

      jobs.addEventListener('message', onMessage)
      signal.addEventListener('abort', () => {
        jobs.removeEventListener('message', onMessage)
        resolve()
      })

      this.postToJobs({ type: 'warm', pkgId, source, spans })
    })
  }

  /* ---------------------------------------------------------------- Service Worker */

  /**
   * Finds the routes, registering our own worker unless a host has already mounted the handlers
   * into theirs. Registration uses an explicit `h5p/` sub-scope, so a host worker living in the
   * same directory — or at `/`, for a root-placed `h5p-sw.js` — is never displaced.
   */
  private async ensureWorker(): Promise<Routes> {
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
    void this.warnOnVersionMismatch()
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
      return null
    }
  }

  /**
   * Asks the worker its version over the control channel rather than over the `_ping` route. The
   * route only answers for a client the worker controls, and the host page deliberately is not
   * one — our scope is a sub-directory it does not sit under. `postMessage` to the registration's
   * own worker has no such requirement.
   */
  private async warnOnVersionMismatch(): Promise<void> {
    try {
      const reply = await this.send({ type: 'ping' })
      if (reply.ok && reply.type === 'pong') warnIfDifferent(reply.version)
    } catch {
      // A version check is a diagnostic; failing it must not fail a load.
    }
  }

  /** Sends a control message to the worker and waits for its reply on a private port. */
  private async send(message: ToWorkerMessage, timeoutMs = 30_000): Promise<WorkerReply> {
    const worker = this.registration?.active
    if (!worker) throw new PlayerError('no-worker', 'The Service Worker is not active')

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
    const file = (href: string): JobsScript => ({ label: href, url: () => new URL(href, location.href).href })
    this.jobs = new JobsWorkerHandle(named ? [file(named), BLOB_JOBS_SCRIPT] : [BLOB_JOBS_SCRIPT, file(DEFAULT_JOBS_URL)])

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
          fraction: message.total ? message.loaded / message.total : null
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
        this.dispatchEvent(new CustomEvent('ready', { detail: { pkgId: data.pkgId } }))
        return

      case 'xapi':
        this.emitStatement({ type: 'xapi', pkgId: data.pkgId, statement: data.statement, verb: data.verb })
        return

      case 'finished':
        this.emitStatement({ type: 'finished', pkgId: data.pkgId, statement: data.statement })
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
    const mode = this.resume
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
      saveInterval: SAVE_INTERVAL_S,
      entries
    }
    this.iframe.contentWindow?.postMessage(preload, location.origin)
  }

  /** The runtime saved a value, or deleted one. Kept here, or handed to the host, and told either way. */
  private onUserData(message: Extract<FromFrameMessage, { type: 'user-data' }>): void {
    if (!this.userDataSession || message.session !== this.userDataSession) return
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

        this.dispatchEvent(new CustomEvent('resize', { detail: { height } }))
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
    this.dispatchEvent(new CustomEvent('statechange', { detail: { state } }))
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
  return { prefetch: reply.prefetch ?? [], warm: reply.warm ?? [], title: reply.title, revision: reply.revision }
}

/**
 * Where to fetch the libraries a package is missing. The hub is keyed on the content type, so it
 * can only answer once `h5p.json` has named one.
 */
function libraryBundleUrl(missing: MissingLibraries, source: LibrarySource): string {
  if (source !== 'hub') return new URL(source.url, location.href).href

  if (!missing.mainLibrary) {
    throw new PlayerError(
      'bad-archive',
      'h5p.json names no mainLibrary, so there is nothing to ask the hub for',
      { missingLibraries: missing }
    )
  }

  return `${HUB_CONTENT_TYPE_URL}${encodeURIComponent(missing.mainLibrary)}`
}

/** A token the frame cannot guess: which document's saves the element accepts. */
function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** False once a registration has been torn down, which clearing site data does silently. */
async function stillRegistered(registration: ServiceWorkerRegistration): Promise<boolean> {
  try {
    const current = await navigator.serviceWorker.getRegistration(registration.scope)
    return current?.active != null
  } catch {
    return false
  }
}

/** Resolves when *this* registration has an activated worker. */
function activated(registration: ServiceWorkerRegistration): Promise<ServiceWorker> {
  const worker = registration.active ?? registration.waiting ?? registration.installing
  if (!worker) return Promise.reject(new PlayerError('no-worker', 'The registration has no worker'))
  if (worker.state === 'activated') return Promise.resolve(worker)

  return new Promise((resolve, reject) => {
    const onChange = () => {
      if (worker.state === 'activated') {
        worker.removeEventListener('statechange', onChange)
        resolve(registration.active ?? worker)
      } else if (worker.state === 'redundant') {
        worker.removeEventListener('statechange', onChange)
        reject(new PlayerError('no-worker', 'The Service Worker became redundant'))
      }
    }
    worker.addEventListener('statechange', onChange)
  })
}

function warnIfDifferent(workerVersion: string | undefined): void {
  if (workerVersion && workerVersion !== VERSION) {
    console.warn(
      `[h5p-player] element is ${VERSION} but the Service Worker is ${workerVersion}. ` +
        'Re-copy h5p-sw.js so the two match.'
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
