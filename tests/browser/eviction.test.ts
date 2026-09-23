import { describe, expect, it } from 'vitest'
import '../../src/h5p-offline-player'
import { coldestIdlePackage } from '../../src/shared/eviction'
import { busyPackages, packageLockName } from '../../src/shared/locks'
import { FIXTURES, play, waitFor } from './utils'

/**
 * Eviction against real Web Locks and the real `packages` table. What is being checked is the
 * cross-context promise: a package in use anywhere on the origin is never the victim.
 */
describe('eviction and Web Locks', () => {
  it('counts a loaded package as busy for exactly as long as it is loaded', async () => {
    const player = await play(FIXTURES.basic)
    const pkgId = player.pkgId!

    await waitFor(async () => (await busyPackages()).has(pkgId))

    player.removeAttribute('src')
    await waitFor(async () => !(await busyPackages()).has(pkgId))
  })

  it('never evicts a package another context holds a lock on', async () => {
    const victim = (await play(FIXTURES.largeStored)).pkgId!
    // Replaces the first player, which releases its own lock on `victim`.
    const writer = (await play(FIXTURES.basic)).pkgId!

    // The lock a Jobs worker in another tab holds while it extracts.
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    await new Promise<void>((granted) => {
      void navigator.locks.request(packageLockName(victim, 'content/media/big.bin'), () => {
        granted()
        return held
      })
    })

    const onlyCandidate = { packagesByAge: async () => [{ pkgId: victim }] }
    expect(await coldestIdlePackage(writer, onlyCandidate)).toBeNull()

    release()
    await waitFor(async () => (await coldestIdlePackage(writer, onlyCandidate)) === victim)
  })
})
