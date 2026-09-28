/**
 * Web Lock names, one prefix per package: `h5p:<pkgId>:<what>`.
 *
 * The Jobs worker holds one per download or extraction for as long as it writes, and the element
 * holds `playing`, shared, for as long as a package is loaded. Eviction reads
 * `navigator.locks.query()` and never picks a package with anything held under its prefix. That
 * is what makes a write in one tab, or a learner mid-video in another, safe from a quota squeeze
 * caused by a package loading in a third — the `packages` table knows what is cold, but only the
 * locks know what is in use right now, across every context on the origin.
 */

export function packageLockName(pkgId: string, what: string): string {
  return `h5p:${pkgId}:${what}`
}

export function packageLockPrefix(pkgId: string): string {
  return `h5p:${pkgId}:`
}

const PACKAGE_LOCK = /^h5p:([^:]+):/

/** Packages with a lock held under their prefix right now, from every tab and worker on the origin. */
export async function busyPackages(): Promise<Set<string>> {
  const busy = new Set<string>()
  const locks = typeof navigator === 'undefined' ? undefined : (navigator as { locks?: LockManager }).locks
  if (!locks?.query) return busy

  try {
    const { held = [] } = await locks.query()
    for (const lock of held) {
      const match = lock.name ? PACKAGE_LOCK.exec(lock.name) : null
      if (match) busy.add(match[1])
    }
  } catch {
    // A platform that cannot answer is treated as having nothing in flight.
  }
  return busy
}
