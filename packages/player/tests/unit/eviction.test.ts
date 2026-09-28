import { afterEach, describe, expect, it, vi } from 'vitest'
import { coldestIdlePackage } from '../../src/shared/eviction'
import { busyPackages, packageLockName } from '../../src/shared/locks'

describe('coldestIdlePackage', () => {
  // Coldest first, as `packagesByAge` returns them.
  const packagesByAge = async () => [{ pkgId: 'a' }, { pkgId: 'b' }, { pkgId: 'c' }]
  const busy = (...ids: string[]) => async () => new Set(ids)

  it('picks the coldest package that is neither the writer nor busy', async () => {
    expect(await coldestIdlePackage('x', { packagesByAge, busyPackages: busy('a') })).toBe('b')
  })

  it('never picks the package doing the writing', async () => {
    expect(await coldestIdlePackage('a', { packagesByAge, busyPackages: busy() })).toBe('b')
  })

  it('returns null when everything else is in use somewhere', async () => {
    expect(await coldestIdlePackage('c', { packagesByAge, busyPackages: busy('a', 'b') })).toBeNull()
  })
})

describe('busyPackages', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads package ids off the locks held under the prefix, whoever holds them', async () => {
    vi.stubGlobal('navigator', {
      locks: {
        query: async () => ({
          held: [
            { name: packageLockName('p1', 'content/videos/a.mp4') },
            { name: packageLockName('p2', 'playing') },
            { name: 'somebody-elses-lock' }
          ],
          // Waiting for a lock is not holding one.
          pending: [{ name: packageLockName('p3', 'playing') }]
        })
      }
    })

    expect([...(await busyPackages())].sort()).toEqual(['p1', 'p2'])
  })

  it('treats a platform without Web Locks as having nothing in flight', async () => {
    vi.stubGlobal('navigator', {})
    expect(await busyPackages()).toEqual(new Set())
  })
})
