import { afterEach, describe, expect, it, vi } from 'vitest'
import { IndexPublisher } from '../../src/jobs/index-publisher'
import type { ForwardEntry, ForwardIndexSnapshot } from '../../src/shared/forward-index'

/**
 * The forward index a download publishes, and the progress reports after it (#144). The element
 * asks the Service Worker whether the frame can boot on each report, and the worker answers from
 * the stored snapshot: a report that overtook its write was answered from the one before.
 */

/** A scanner the test feeds entries to by name. */
function scanner() {
  const names: string[] = []
  let finished = false
  return {
    add: (name: string) => void names.push(name),
    get finished() {
      return finished
    },
    finish: () => void (finished = true),
    snapshot: (): ForwardIndexSnapshot => ({
      entries: names.map((name) => ({ name }) as unknown as ForwardEntry),
      parsedTo: names.length,
      done: finished,
      stopped: null
    })
  }
}

/** A store whose writes land when the test says, each named by how many entries it holds. */
function store() {
  const writes: Array<{ entries: number; land: () => void; refuse: (error: unknown) => void }> = []
  const write = (snapshot: ForwardIndexSnapshot) =>
    new Promise<void>((land, refuse) => writes.push({ entries: snapshot.entries.length, land, refuse }))
  return { writes, write }
}

/** Long enough for every settled promise's callbacks to have run. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('IndexPublisher', () => {
  afterEach(() => vi.restoreAllMocks())

  it('sends a report only once the snapshot it reports is stored', async () => {
    const found = scanner()
    const { writes, write } = store()
    const index = new IndexPublisher(found, write)
    const sent: string[] = []

    found.add('h5p.json')
    index.report(() => sent.push('256 kB'))
    await settled()
    // The write is under way: a report now would be answered from no snapshot at all.
    expect(writes.map((each) => each.entries)).toEqual([1])
    expect(sent).toEqual([])

    writes[0].land()
    await settled()
    expect(sent).toEqual(['256 kB'])
  })

  it('keeps the reports in order: one with nothing new waits for the writes under way', async () => {
    const found = scanner()
    const { writes, write } = store()
    const index = new IndexPublisher(found, write)
    const sent: string[] = []

    found.add('h5p.json')
    index.report(() => sent.push('first'))
    // Nothing new: no write of its own, and it goes out after the first.
    index.report(() => sent.push('second'))
    found.add('content/content.json')
    index.report(() => sent.push('third'))
    await settled()
    // One write at a time: the third's starts once the first's has landed.
    expect(writes.map((each) => each.entries)).toEqual([1])

    writes[0].land()
    await settled()
    expect(sent).toEqual(['first', 'second'])
    expect(writes.map((each) => each.entries)).toEqual([1, 2])

    writes[1].land()
    await settled()
    expect(sent).toEqual(['first', 'second', 'third'])
  })

  it('still sends the report when the store refuses the snapshot, and says so once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const found = scanner()
    const { writes, write } = store()
    const index = new IndexPublisher(found, write)
    const sent: string[] = []

    found.add('h5p.json')
    index.report(() => sent.push('first'))
    found.add('content/content.json')
    index.report(() => sent.push('second'))
    await settled()
    writes[0].refuse(new Error('QuotaExceededError'))
    await settled()
    writes[1].refuse(new Error('QuotaExceededError'))
    await settled()

    expect(sent).toEqual(['first', 'second'])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('publishes the finished scan at the end, after every write before it, even with nothing new', async () => {
    const found = scanner()
    const { writes, write } = store()
    const index = new IndexPublisher(found, write)

    found.add('h5p.json')
    index.report(() => {})
    let ended = false
    const end = index.publish(true).then(() => void (ended = true))
    await settled()
    expect(found.finished).toBe(true)
    expect(writes.map((each) => each.entries)).toEqual([1])

    writes[0].land()
    await settled()
    // The final snapshot is written although it holds no entry more: it is the one marked done.
    expect(writes.map((each) => each.entries)).toEqual([1, 1])
    expect(ended).toBe(false)
    writes[1].land()
    await end
    expect(ended).toBe(true)
  })
})
