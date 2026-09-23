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

describe('the Jobs worker', () => {
  afterAll(() => caches.delete(cacheNameFor(PKG)))

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
