import { describe, expect, it } from 'vitest'
import { JobQueue } from '../../src/jobs/job-queue'

const source = { type: 'range-http', url: 'https://host.example/a.h5p', size: 1 } as const
const location = { header: 0, compressedSize: 1, size: 1, method: 8 }
const job = (entry: string, prefetch = false, pkgId = 'pkg') => ({ pkgId, entry, location, source, prefetch })
const order = (queue: JobQueue) => queue.waiting().map((item) => item.entry)

describe('JobQueue', () => {
  it('keeps demands in the order they arrived, ahead of every prefetch', () => {
    const queue = new JobQueue()
    expect(queue.request(job('p1', true))).toBe('added')
    expect(queue.request(job('a'))).toBe('added')
    expect(queue.request(job('p2', true))).toBe('added')
    expect(queue.request(job('b'))).toBe('added')
    expect(order(queue)).toEqual(['a', 'b', 'p1', 'p2'])
  })

  it('moves a queued entry to the front when demand asks for it again', () => {
    const queue = new JobQueue()
    queue.request(job('a'))
    queue.request(job('b'))
    queue.request(job('p', true))
    expect(queue.request(job('p'))).toBe('promoted')
    expect(order(queue)).toEqual(['p', 'a', 'b'])
    // Promoted once, it is a demand now: a later prefetch request for it changes nothing.
    expect(queue.request(job('p', true))).toBe('unchanged')
    expect(order(queue)).toEqual(['p', 'a', 'b'])
  })

  it('leaves the front alone when asked for the entry that is already first', () => {
    const queue = new JobQueue()
    queue.request(job('a'))
    queue.request(job('b'))
    expect(queue.request(job('a'))).toBe('unchanged')
    expect(order(queue)).toEqual(['a', 'b'])
  })

  it('never lets a prefetch request reorder anything', () => {
    const queue = new JobQueue()
    queue.request(job('a'))
    queue.request(job('p', true))
    queue.request(job('b'))
    expect(queue.request(job('p', true))).toBe('unchanged')
    expect(order(queue)).toEqual(['a', 'b', 'p'])
  })

  it('hands jobs out from the front and drops a package without touching the others', () => {
    const queue = new JobQueue()
    queue.request(job('a', false, 'one'))
    queue.request(job('b', false, 'two'))
    queue.request(job('c', false, 'one'))
    expect(queue.next()?.entry).toBe('a')
    queue.drop('one')
    expect(order(queue)).toEqual(['b'])
    expect(queue.size).toBe(1)
  })
})
