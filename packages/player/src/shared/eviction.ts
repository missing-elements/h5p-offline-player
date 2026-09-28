import { setEvictionListener, setEvictionPolicy } from './chunk-store'
import * as db from './idb'
import { busyPackages } from './locks'

/**
 * Which package a quota squeeze may drop: the coldest by `lastPlayed` that is neither the one
 * being written nor under a lock anywhere on the origin.
 *
 * Both the Service Worker and the Jobs worker install this, because both write the chunk store
 * and either can be the one that hits the wall — the Jobs worker most often, since the large
 * writes are its. Before it did, it evicted whichever cache the browser happened to list first.
 */
export async function coldestIdlePackage(
  exceptPkgId: string,
  lookups: {
    packagesByAge?: () => Promise<Array<{ pkgId: string }>>
    busyPackages?: () => Promise<Set<string>>
  } = {}
): Promise<string | null> {
  const [byAge, busy] = await Promise.all([
    (lookups.packagesByAge ?? db.packagesByAge)(),
    (lookups.busyPackages ?? busyPackages)()
  ])
  return byAge.find((record) => record.pkgId !== exceptPkgId && !busy.has(record.pkgId))?.pkgId ?? null
}

/** Points the chunk store's eviction at the `packages` table, and cleans the table up after it. */
export function installEvictionPolicy(onEvicted?: (pkgId: string) => void): void {
  setEvictionPolicy((exceptPkgId) => coldestIdlePackage(exceptPkgId))
  setEvictionListener(async (pkgId) => {
    onEvicted?.(pkgId)
    await db.deletePackage(pkgId)
  })
}
