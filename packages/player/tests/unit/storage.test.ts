import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatBytes, quotaMessage } from '../../src/shared/storage'

describe('formatBytes', () => {
  it('picks the unit and keeps one decimal only below ten', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2_500)).toBe('2.4 kB')
    expect(formatBytes(20_971_520)).toBe('20 MB')
    expect(formatBytes(2_400_000)).toBe('2.3 MB')
    expect(formatBytes(3_222_046_126)).toBe('3.0 GB')
  })
})

describe('quotaMessage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('says what was needed against what the browser reports for the site', async () => {
    vi.stubGlobal('navigator', {
      storage: { estimate: async () => ({ usage: 300_000, quota: 3_222_046_126 }) }
    })

    expect(await quotaMessage('this file', 20_971_520)).toBe(
      'Not enough storage: this file needs 20 MB; this site is using 293 kB of the 3.0 GB the browser allows it.'
    )
  })

  it('still says what it can when the size is unknown', async () => {
    vi.stubGlobal('navigator', {
      storage: { estimate: async () => ({ usage: 1_048_576, quota: 2_097_152 }) }
    })

    expect(await quotaMessage('this package', null)).toBe(
      'Not enough storage for this package; this site is using 1.0 MB of the 2.0 MB the browser allows it.'
    )
  })

  it('leaves the numbers out where the platform has none', async () => {
    vi.stubGlobal('navigator', {})
    expect(await quotaMessage('this file', 1024)).toBe('Not enough storage: this file needs 1.0 kB.')
  })
})
