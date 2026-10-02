import { describe, expect, it } from 'vitest'
import { JobsWorkerHandle, type JobsScript } from '../../src/jobs-worker-handle'
import { WARM_ENTRY } from '../../src/shared/constants'
import { JOBS_READY, type FromJobsMessage, type ToJobsMessage } from '../../src/shared/protocol'

/** A worker that does nothing until the test says what its script did. */
class FakeWorker extends EventTarget {
  readonly received: unknown[] = []
  terminated = false

  constructor(readonly url: string) {
    super()
  }

  postMessage(message: unknown): void {
    this.received.push(message)
  }

  terminate(): void {
    this.terminated = true
  }

  /** The script ran: it posts `ready`, as `jobs-worker.ts` does once its listener is in. */
  load(): void {
    this.reply({ type: JOBS_READY })
  }

  /** The script never ran: refused by policy, a 404, or a throw at the top level. */
  refuse(): void {
    this.dispatchEvent(new Event('error', { cancelable: true }))
  }

  reply(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }
}

const source = { type: 'range-http', url: 'https://host.example/a.h5p', size: 1 } as const
const location = { header: 0, compressedSize: 1, size: 1, method: 8 }
const download: ToJobsMessage = { type: 'download', pkgId: 'pkg', source }
const extract: ToJobsMessage = { type: 'extract', pkgId: 'pkg', entry: 'content/v.mp4', location, source }
const warm: ToJobsMessage = { type: 'warm', pkgId: 'pkg', source, spans: [] }

function setup(scripts: { label: string; throws?: string }[]) {
  const spawned: FakeWorker[] = []
  const released: string[] = []
  const definitions: JobsScript[] = scripts.map(({ label }) => ({
    label,
    url: () => `${label}-url`,
    release: (url) => released.push(url)
  }))
  const handle = new JobsWorkerHandle(definitions, (url) => {
    const thrown = scripts.find((script) => `${script.label}-url` === url)?.throws
    if (thrown) throw new Error(thrown)
    const worker = new FakeWorker(url)
    spawned.push(worker)
    return worker as unknown as Worker
  })
  const heard: FromJobsMessage[] = []
  handle.addEventListener('message', (event) => heard.push(event.data))
  return { handle, spawned, released, heard }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('JobsWorkerHandle', () => {
  it('holds jobs until the worker says it runs, then delivers them in order', () => {
    const { handle, spawned, released } = setup([{ label: 'blob' }])
    handle.postMessage(download)
    handle.postMessage(extract)
    expect(spawned[0].received).toEqual([])

    spawned[0].load()
    expect(spawned[0].received).toEqual([download, extract])
    expect(released).toEqual(['blob-url'])

    handle.postMessage(warm)
    expect(spawned[0].received).toEqual([download, extract, warm])
  })

  it('takes the next script when one is refused by throwing, as Chromium refuses a blob: worker', () => {
    const { handle, spawned, released } = setup([{ label: 'blob', throws: 'denied by the CSP' }, { label: 'file' }])
    handle.postMessage(download)

    expect(spawned.map((worker) => worker.url)).toEqual(['file-url'])
    expect(released).toEqual(['blob-url'])
    spawned[0].load()
    expect(spawned[0].received).toEqual([download])
  })

  it('takes the next script when one fails to load, and drops the dead worker', () => {
    const { handle, spawned, released } = setup([{ label: 'blob' }, { label: 'file' }])
    handle.postMessage(download)

    spawned[0].refuse()
    expect(spawned[0].terminated).toBe(true)
    expect(released).toEqual(['blob-url'])
    expect(spawned[1].url).toBe('file-url')

    // A late message from the first worker is not the second's.
    spawned[0].reply({ type: JOBS_READY })
    expect(spawned[1].received).toEqual([])

    spawned[1].load()
    expect(spawned[1].received).toEqual([download])
  })

  it('passes the worker’s replies on, but not its ready notice, and keeps it after a later error', () => {
    const { spawned, heard } = setup([{ label: 'blob' }, { label: 'file' }])
    spawned[0].load()

    const done: FromJobsMessage = { type: 'done', pkgId: 'pkg', size: 1 }
    spawned[0].reply(done)
    expect(heard).toEqual([done])

    // An exception inside a running worker is the job's to report, not a reason to start over.
    spawned[0].refuse()
    expect(spawned).toHaveLength(1)
    expect(spawned[0].terminated).toBe(false)
  })

  it('answers every job failed when no script runs, under the entry its replies would carry', async () => {
    const { handle, spawned, heard } = setup([{ label: 'blob', throws: 'denied' }, { label: 'file' }])
    handle.postMessage(download)
    handle.postMessage({ type: 'abort', pkgId: 'pkg' })
    spawned[0].refuse()
    handle.postMessage(extract)
    handle.postMessage(warm)
    await settle()

    expect(heard.map((message) => [message.type, message.entry])).toEqual([
      ['failed', undefined],
      ['failed', 'content/v.mp4'],
      ['failed', WARM_ENTRY]
    ])
    const failure = heard[0] as Extract<FromJobsMessage, { type: 'failed' }>
    expect(failure.code).toBe('no-worker')
    expect(failure.message).toContain('blob: denied')
    expect(failure.message).toContain("worker-src 'self'")
  })
})
