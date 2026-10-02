import { WARM_ENTRY } from './shared/constants'
import { JOBS_READY, type FromJobsMessage, type ToJobsMessage } from './shared/protocol'

/**
 * Where the Jobs worker's script can come from, tried in order. `url` is called once per
 * attempt; `release` gives back whatever it made, once the worker has loaded or failed to.
 */
export interface JobsScript {
  label: string
  url: () => string
  release?: (url: string) => void
}

type Listener = (event: MessageEvent<FromJobsMessage>) => void

/**
 * The Jobs worker, started from the first script the page is allowed to run.
 *
 * The element carries the worker as a string and spawns it from a `blob:` URL, so a host deploys
 * one file fewer. A host page whose policy has no `blob:` in `worker-src` — a `script-src 'self'`
 * with no `worker-src` at all is one — refuses that: Chromium by throwing from `new Worker`,
 * other engines by an `error` event once the load has failed. So each script in turn is tried,
 * and the next one taken on either. Nothing posted to a worker whose script never loaded is
 * delivered, which is why messages wait here until the worker says it is running.
 *
 * When every script is refused, each job asked for answers `failed` with `no-worker`, so a
 * download rejects and an extraction is reported, rather than waiting on a worker that is not
 * there.
 */
export class JobsWorkerHandle {
  private worker: Worker | null = null
  private ready = false
  private failure: string | null = null
  private attempt = 0
  private readonly refused: string[] = []
  private readonly pending: unknown[] = []
  private readonly listeners = new Set<Listener>()

  constructor(
    private readonly scripts: JobsScript[],
    private readonly spawn: (url: string) => Worker = (url) => new Worker(url)
  ) {
    this.next()
  }

  postMessage(message: ToJobsMessage | (ToJobsMessage & { file: File })): void {
    if (this.failure) return this.refuse(message)
    if (!this.ready) {
      this.pending.push(message)
      return
    }
    this.worker!.postMessage(message)
  }

  addEventListener(_type: 'message', listener: Listener): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'message', listener: Listener): void {
    this.listeners.delete(listener)
  }

  terminate(): void {
    this.worker?.terminate()
    this.worker = null
    this.pending.length = 0
    this.listeners.clear()
    this.failure ??= 'terminated'
  }

  private next(): void {
    const script = this.scripts[this.attempt++]
    if (!script) return this.fail()

    let url: string | null = null
    let worker: Worker
    try {
      url = script.url()
      worker = this.spawn(url)
    } catch (error) {
      if (url !== null) script.release?.(url)
      this.refused.push(`${script.label}: ${error instanceof Error ? error.message : String(error)}`)
      return this.next()
    }

    const loaded = url
    let released = false
    const release = () => {
      if (released) return
      released = true
      script.release?.(loaded)
    }

    worker.addEventListener('message', (event: MessageEvent) => {
      if (worker !== this.worker) return
      if (!this.ready) {
        if ((event.data as { type?: unknown } | null)?.type !== JOBS_READY) return
        this.ready = true
        release()
        for (const message of this.pending.splice(0)) worker.postMessage(message)
        return
      }
      for (const listener of [...this.listeners]) listener(event as MessageEvent<FromJobsMessage>)
    })

    // Once the worker runs, an `error` is an exception inside it, which is the job's to report.
    // Before that it is the script failing to load, or to evaluate, and the next one is tried.
    worker.addEventListener('error', (event) => {
      if (worker !== this.worker || this.ready) return
      event.preventDefault()
      worker.terminate()
      release()
      this.worker = null
      this.refused.push(`${script.label}: the script did not load`)
      this.next()
    })

    this.worker = worker
  }

  private fail(): void {
    this.failure =
      `The player's background worker could not start (${this.refused.join('; ')}). ` +
      "A Content-Security-Policy that blocks it needs worker-src 'self' and h5p-jobs.js served beside " +
      'the element, or the `jobs` attribute pointing at a copy on this origin.'
    for (const message of this.pending.splice(0)) this.refuse(message)
  }

  /** Answers a job as the worker would have, had it run and failed. */
  private refuse(message: unknown): void {
    const job = message as ToJobsMessage
    if (job.type === 'abort') return
    const entry = job.type === 'extract' ? job.entry : job.type === 'warm' ? WARM_ENTRY : undefined
    const reply: FromJobsMessage = { type: 'failed', pkgId: job.pkgId, entry, code: 'no-worker', message: this.failure! }
    // Asynchronous, as a worker's reply is: a caller adds its listener around the post.
    queueMicrotask(() => {
      const event = new MessageEvent<FromJobsMessage>('message', { data: reply })
      for (const listener of [...this.listeners]) listener(event)
    })
  }
}
