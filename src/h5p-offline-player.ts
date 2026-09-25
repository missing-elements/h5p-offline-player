import jobsWorkerSource from 'virtual:h5p-jobs-worker'
import SHADOW_CSS from './shadow.css?inline'
import { VERSION, WARM_ENTRY } from './shared/constants'
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
  type SourceDescriptor,
  type ToJobsMessage,
  type ToWorkerMessage,
  type WorkerReply
} from './shared/protocol'
import { packageLockName } from './shared/locks'
import { filePkgId, remotePkgId } from './shared/pkg-id'
import { probeSource } from './shared/source'
import { routesFor, type Routes } from './sw/routes'

/**
 * `<h5p-player>` — the package's public surface. It plays a package and nothing else: no URL
 * field, no file picker, no progress bar, no "open in Safari" banner. Those belong to the host
 * page, which builds them out of the events this element emits.
 *
 * Setting `src` or `file` loads, the way it does on `<video>`. Setting it again aborts whatever
 * was in flight for the previous package and starts over.
 */

/** Frame assets ship next to this module. See the note in `vite.config.ts` about `@vite-ignore`. */
const DEV_ASSETS_BASE = '/frame-assets/'

// `@vite-ignore` matters in dev and in a consuming app alike: in dev the file is served by the
// plugin in `vite.config.ts` and Vite must not try to resolve it at transform time; in a build,
// Vite, Rollup and webpack 5 recognise this exact shape and emit the file as an asset with the
// URL rewritten.
const DEFAULT_SW_URL = new URL(/* @vite-ignore */ './h5p-sw.js', import.meta.url).href

const DEFAULT_ASSETS_BASE = import.meta.env.DEV
  ? new URL(DEV_ASSETS_BASE, location.href).href
  : new URL(/* @vite-ignore */ './frame-assets/', import.meta.url).href

/** File names inside the vendored h5p-standalone `dist`, relative to the assets base. */
const ASSET_FILES = {
  mainJs: 'main.bundle.js',
  frameJs: 'frame.bundle.js',
  frameCss: 'styles/h5p.css'
} as const

export type PlayerState = 'idle' | 'probing' | 'downloading' | 'indexing' | 'ready' | 'error'

export interface PlayerErrorDetail {
  code: ErrorCode
  message: string
  /** Present when a package declared libraries it does not carry. See the `libraries` attribute. */
  missingLibraries?: MissingLibraries
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
    return ['src', 'sw', 'assets-base', 'auto-resize', 'libraries', 'allow-origins', 'preload']
  }

  private iframe: HTMLIFrameElement
  private jobs: Worker | null = null
  private jobsUrl: string | null = null
  private routes: Routes | null = null
  private registration: ServiceWorkerRegistration | null = null
  private currentFile: File | null = null
  private currentSource: SourceDescriptor | null = null
  private load: AbortController | null = null
  private connected = false
  private internalState: PlayerState = 'idle'
  private internalPkgId: string | null = null
  /** Large deflated entries, in archive order, waiting to be pulled before the content asks. */
  private prefetchQueue: PrefetchEntry[] = []
  private prefetching: string | null = null

  constructor() {
    super()
    const root = this.attachShadow({ mode: 'open' })
    root.innerHTML = `<div class="viewport"><iframe part="frame" allow="fullscreen" title="H5P content"></iframe></div>`
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

  /** The resolved Service Worker scope the routes live under. Read-only, `null` until registered. */
  get scope(): string | null {
    return this.routes?.base ?? null
  }

  /* ---------------------------------------------------------------- lifecycle */

  connectedCallback(): void {
    this.connected = true
    window.addEventListener('message', this.onWindowMessage)
    navigator.serviceWorker?.addEventListener('message', this.onServiceWorkerMessage)
    if (this.src || this.currentFile) void this.startLoad()
  }

  disconnectedCallback(): void {
    this.connected = false
    window.removeEventListener('message', this.onWindowMessage)
    window.removeEventListener('resize', this.onWindowResize)
    navigator.serviceWorker?.removeEventListener('message', this.onServiceWorkerMessage)
    this.abortLoad()
    this.jobs?.terminate()
    this.jobs = null
    if (this.jobsUrl) URL.revokeObjectURL(this.jobsUrl)
    this.jobsUrl = null
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
    if (name === 'auto-resize' && next === null) this.style.removeProperty('height')
  }

  /* ---------------------------------------------------------------- loading */

  private abortLoad(): void {
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
    this.internalPkgId = null
    this.setState('idle')
  }

  private async startLoad(): Promise<void> {
    this.abortLoad()

    const controller = new AbortController()
    this.load = controller
    const { signal } = controller

    this.iframe.removeAttribute('src')
    this.internalPkgId = null

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

      const frameUrl = `${routes.frame}${pkgId}`
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
      const descriptor = await probeSource(url, signal)
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
    const base = raw ? new URL(raw.endsWith('/') ? raw : `${raw}/`, location.href).href : DEFAULT_ASSETS_BASE

    return {
      mainJs: new URL(ASSET_FILES.mainJs, base).href,
      frameJs: new URL(ASSET_FILES.frameJs, base).href,
      frameCss: new URL(ASSET_FILES.frameCss, base).href
    }
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
  private async send(message: ToWorkerMessage): Promise<WorkerReply> {
    const worker = this.registration?.active
    if (!worker) throw new PlayerError('no-worker', 'The Service Worker is not active')

    const reply = await new Promise<WorkerReply>((resolve, reject) => {
      const channel = new MessageChannel()
      const timer = setTimeout(() => {
        channel.port1.close()
        reject(new PlayerError('no-worker', `The worker did not answer "${message.type}"`))
      }, 30_000)

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

  private ensureJobs(): Worker {
    if (this.jobs) return this.jobs

    const blob = new Blob([jobsWorkerSource], { type: 'text/javascript' })
    this.jobsUrl = URL.createObjectURL(blob)
    this.jobs = new Worker(this.jobsUrl)

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
    if (event.source !== this.iframe.contentWindow) return
    // The frame is same-origin by construction; anything else claiming to be it is not it.
    if (event.origin !== location.origin) return

    if ('context' in data && data.context === 'h5p') {
      this.onResizerMessage(data)
      return
    }

    if (!('channel' in data) || data.channel !== 'h5p-player') return
    if (this.internalPkgId && data.pkgId !== this.internalPkgId) return

    switch (data.type) {
      case 'ready':
        this.setState('ready')
        // Only now: until the content is up, the archive reads that boot it are competing for
        // the same connection, and a 200 MB video would make the player itself slower to appear.
        this.advancePrefetch()
        this.dispatchEvent(new CustomEvent('ready', { detail: { pkgId: data.pkgId } }))
        return

      case 'xapi':
        this.dispatchEvent(
          new CustomEvent('xapi', { detail: { statement: data.statement, verb: data.verb } })
        )
        return

      case 'finished':
        this.dispatchEvent(new CustomEvent('finished', { detail: { statement: data.statement } }))
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
        if (this.hasAttribute('auto-resize') && clientHeight > 0) {
          this.style.height = `${clientHeight}px`
        }
        respond('resizePrepared')
        return
      }

      case 'resize': {
        const height = message.scrollHeight ?? 0
        if (height <= 0) return

        this.dispatchEvent(new CustomEvent('resize', { detail: { height } }))
        if (this.hasAttribute('auto-resize')) this.style.height = `${height}px`
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

/** The entries the worker flagged as needing a background inflate, if it flagged any. */
/** What an index hands the load: the media worth starting early, and the spans worth pulling first. */
interface IndexResult {
  prefetch: PrefetchEntry[]
  warm: WarmSpan[]
}

function nothingIndexed(): IndexResult {
  return { prefetch: [], warm: [] }
}

function indexResultOf(reply: WorkerReply): IndexResult {
  if (!reply.ok || reply.type !== 'indexed') return nothingIndexed()
  return { prefetch: reply.prefetch ?? [], warm: reply.warm ?? [] }
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
