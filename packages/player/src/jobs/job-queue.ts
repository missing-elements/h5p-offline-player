import type { EntryLocation, SourceDescriptor } from '../shared/protocol'

/**
 * The order extractions run in. One at a time — two concurrent inflates halve the rate of
 * whichever video the learner is actually looking at — so the order is the whole policy:
 *
 * - A demand request (the runtime asked, through the virtual server) queues behind the demands
 *   already waiting and ahead of every prefetch, however long those have waited.
 * - A repeated demand for a queued entry moves it to the front. The virtual server only asks
 *   again after its dedupe window, so the burst of probes a page fires at boot cannot reorder
 *   itself, while a learner opening a later chapter is heard at once. The running job is never
 *   interrupted: a deflate stream cannot resume, so its progress would be thrown away.
 * - A prefetch request queues at the back and never promotes anything, itself included.
 */

export interface ExtractJob {
  pkgId: string
  entry: string
  location: EntryLocation
  source: SourceDescriptor
  prefetch: boolean
}

export type Placement = 'added' | 'promoted' | 'unchanged'

export class JobQueue {
  private readonly items: ExtractJob[] = []

  request(job: ExtractJob): Placement {
    const index = this.items.findIndex((item) => item.pkgId === job.pkgId && item.entry === job.entry)
    if (index >= 0) {
      if (job.prefetch || index === 0) return 'unchanged'
      const [waiting] = this.items.splice(index, 1)
      this.items.unshift({ ...waiting, prefetch: false })
      return 'promoted'
    }
    if (job.prefetch) {
      this.items.push(job)
    } else {
      const firstPrefetch = this.items.findIndex((item) => item.prefetch)
      this.items.splice(firstPrefetch === -1 ? this.items.length : firstPrefetch, 0, job)
    }
    return 'added'
  }

  next(): ExtractJob | undefined {
    return this.items.shift()
  }

  /** Drops every queued job of a package; the running one is not here and is aborted separately. */
  drop(pkgId: string): void {
    for (let i = this.items.length - 1; i >= 0; i -= 1) {
      if (this.items[i].pkgId === pkgId) this.items.splice(i, 1)
    }
  }

  get size(): number {
    return this.items.length
  }

  waiting(): ReadonlyArray<ExtractJob> {
    return this.items
  }
}
