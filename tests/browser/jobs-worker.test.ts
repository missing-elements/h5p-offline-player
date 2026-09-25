import { afterAll, describe, expect, it } from 'vitest'
import jobsWorkerSource from 'virtual:h5p-jobs-worker'
import { cacheNameFor } from '../../src/shared/chunk-store'
import type { FromJobsMessage, ToJobsMessage } from '../../src/shared/protocol'

/**
 * The Jobs worker driven directly, without an element in front of it. The element's own tests
 * cover the happy path; this is for the message-ordering cases that only show up when two
 * messages land in the same breath.
 */

const PKG = 'jobs-worker-race-test'
const source = {
  type: 'chunked',
  url: new URL('/no-range/large-stored.h5p', location.href).href,
  size: null
} as const

function spawn() {
  const url = URL.createObjectURL(new Blob([jobsWorkerSource], { type: 'text/javascript' }))
  const worker = new Worker(url)

  const next = (accept: (message: FromJobsMessage) => boolean, timeoutMs = 20_000) =>
    new Promise<FromJobsMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.removeEventListener('message', onMessage)
        reject(new Error('The Jobs worker never answered'))
      }, timeoutMs)
      const onMessage = (event: MessageEvent<FromJobsMessage>) => {
        if (!accept(event.data)) return
        clearTimeout(timer)
        worker.removeEventListener('message', onMessage)
        resolve(event.data)
      }
      worker.addEventListener('message', onMessage)
    })

  return {
    post: (message: ToJobsMessage) => worker.postMessage(message),
    next,
    dispose: () => {
      worker.terminate()
      URL.revokeObjectURL(url)
    }
  }
}

/** A `range-http` descriptor for a fixture, with its size read off the dev server. */
async function rangeSource(path: string) {
  const url = new URL(path, location.href).href
  const response = await fetch(url, { headers: { Range: 'bytes=0-' }, cache: 'no-store' })
  const size = Number(response.headers.get('content-length'))
  await response.body?.cancel()
  return { type: 'range-http', url, size } as const
}

describe('the Jobs worker', () => {
  afterAll(() => caches.delete(cacheNameFor(PKG)))

  it('extracts one entry at a time, demand before prefetch, and a repeated demand jumps the queue', { timeout: 60_000 }, async () => {
    const one = 'jobs-worker-queue-one'
    const two = 'jobs-worker-queue-two'
    await caches.delete(cacheNameFor(one))
    await caches.delete(cacheNameFor(two))
    const first = await rangeSource('/fixtures/large-deflated.h5p')
    const second = await rangeSource('/fixtures/segmented.h5p')
    const jobs = spawn()
    const finished: string[] = []
    const started = new Set<string>()
    let overlap = false

    try {
      const watch = (message: FromJobsMessage) => {
        if (message.type === 'progress' && message.entry) {
          started.add(`${message.pkgId}:${message.entry}`)
          // Progress from a second entry while the first is still going would be two inflates at once.
          if (started.size > finished.length + 1) overlap = true
        }
        if (message.type === 'done' && message.entry) finished.push(`${message.pkgId}:${message.entry}`)
        return false
      }
      const all = jobs.next(watch, 55_000).catch(() => {})

      // A demand, then two prefetches, then demand for the last one: it goes ahead of the other prefetch.
      jobs.post({ type: 'extract', pkgId: one, entry: 'content/media/big.bin', source: first })
      jobs.post({ type: 'extract', pkgId: one, entry: 'content/media/unused.bin', source: first, prefetch: true })
      jobs.post({ type: 'extract', pkgId: two, entry: 'content/media/big.bin', source: second, prefetch: true })
      jobs.post({ type: 'extract', pkgId: two, entry: 'content/media/big.bin', source: second })

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`only ${finished.length} extractions finished`)), 50_000)
        const tick = setInterval(() => {
          if (finished.length === 3) {
            clearInterval(tick)
            clearTimeout(timer)
            resolve()
          }
        }, 100)
      })
      void all

      expect(finished).toEqual([`${one}:content/media/big.bin`, `${two}:content/media/big.bin`, `${one}:content/media/unused.bin`])
      expect(overlap).toBe(false)
    } finally {
      jobs.dispose()
      await caches.delete(cacheNameFor(one))
      await caches.delete(cacheNameFor(two))
    }
  })

  it('runs a job re-requested right after its abort, rather than dropping it as a duplicate', async () => {
    await caches.delete(cacheNameFor(PKG))
    const jobs = spawn()

    try {
      jobs.post({ type: 'download', pkgId: PKG, source })
      await jobs.next((message) => message.type === 'progress' && message.pkgId === PKG)

      // Back to back, the way a second press of Play sends them. The abort takes several tasks
      // to unwind; a key held until then made the new download look like a duplicate of a job
      // that was already dying, and nothing ever answered it.
      jobs.post({ type: 'abort', pkgId: PKG })
      jobs.post({ type: 'download', pkgId: PKG, source })

      const outcome = await jobs.next(
        (message) => (message.type === 'done' || message.type === 'failed') && message.pkgId === PKG
      )
      expect(outcome.type).toBe('done')
    } finally {
      jobs.dispose()
    }
  })
})
