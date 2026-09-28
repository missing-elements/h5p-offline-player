import { describe, expect, it } from 'vitest'
import { contentRange, parseRange } from '../../src/shared/range'

describe('parseRange', () => {
  it('returns none when there is no header', () => {
    expect(parseRange(null, 100)).toBe('none')
    expect(parseRange('', 100)).toBe('none')
  })

  it('parses a closed range', () => {
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 })
  })

  it('parses an open-ended range', () => {
    expect(parseRange('bytes=10-', 100)).toEqual({ start: 10, end: 99 })
  })

  it('parses a suffix range, which is how a player reads a media trailer', () => {
    expect(parseRange('bytes=-20', 100)).toEqual({ start: 80, end: 99 })
  })

  it('clamps a suffix longer than the resource', () => {
    expect(parseRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 })
  })

  it('clamps an end past the last byte', () => {
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 })
  })

  it('reports a start past the end as unsatisfiable', () => {
    expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable')
    expect(parseRange('bytes=-0', 100)).toBe('unsatisfiable')
  })

  it('treats a multi-range request as absent, which is a legal answer', () => {
    expect(parseRange('bytes=0-10,20-30', 100)).toBe('none')
  })

  it('ignores a unit it does not speak', () => {
    expect(parseRange('items=0-10', 100)).toBe('none')
  })
})

describe('contentRange', () => {
  it('formats the header the way a media element expects', () => {
    expect(contentRange({ start: 0, end: 9 }, 100)).toBe('bytes 0-9/100')
  })
})
