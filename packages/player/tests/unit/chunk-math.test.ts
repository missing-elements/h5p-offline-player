import { describe, expect, it } from 'vitest'
import { chunksForRange, sliceWithinChunk } from '../../src/shared/chunk-store'
import { CHUNK_SIZE } from '../../src/shared/constants'

/**
 * Serving a range out of the chunk store is arithmetic plus a slice. Getting it wrong shifts a
 * video by a few bytes, which decodes as a corrupt stream rather than a visible error, so the
 * arithmetic is pinned here rather than left to the integration tests.
 */
describe('chunksForRange', () => {
  it('keeps a range inside one chunk in one chunk', () => {
    expect(chunksForRange({ start: 0, end: 99 })).toEqual({ first: 0, last: 0 })
  })

  it('spans the chunks a range crosses', () => {
    expect(chunksForRange({ start: CHUNK_SIZE - 1, end: CHUNK_SIZE })).toEqual({ first: 0, last: 1 })
  })

  it('treats a boundary byte as the start of the next chunk', () => {
    expect(chunksForRange({ start: CHUNK_SIZE, end: CHUNK_SIZE })).toEqual({ first: 1, last: 1 })
  })

  it('covers a long range', () => {
    expect(chunksForRange({ start: 10, end: CHUNK_SIZE * 3 + 5 })).toEqual({ first: 0, last: 3 })
  })
})

describe('sliceWithinChunk', () => {
  it('offsets into the first chunk and runs to its end', () => {
    expect(sliceWithinChunk(0, { start: 10, end: CHUNK_SIZE * 2 })).toEqual({
      from: 10,
      to: CHUNK_SIZE
    })
  })

  it('takes a middle chunk whole', () => {
    expect(sliceWithinChunk(1, { start: 10, end: CHUNK_SIZE * 2 })).toEqual({
      from: 0,
      to: CHUNK_SIZE
    })
  })

  it('stops the last chunk at the end of the range, inclusive', () => {
    expect(sliceWithinChunk(2, { start: 10, end: CHUNK_SIZE * 2 })).toEqual({ from: 0, to: 1 })
  })

  it('reassembles exactly the requested byte count', () => {
    const range = { start: CHUNK_SIZE - 3, end: CHUNK_SIZE * 2 + 7 }
    const { first, last } = chunksForRange(range)

    let total = 0
    for (let index = first; index <= last; index += 1) {
      const { from, to } = sliceWithinChunk(index, range)
      total += to - from
    }

    expect(total).toBe(range.end - range.start + 1)
  })
})
