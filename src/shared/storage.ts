/**
 * What to say when the browser refuses a write for lack of space. The number that matters to
 * whoever reads it is not "quota exceeded" but what was needed against what the browser reports
 * for the site — enough to tell a package that is too big for this browser from a site that has
 * merely filled up. Both workers write the chunk store, so both build this message; the element
 * only relays it.
 */

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '? B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['kB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : String(Math.round(value))} ${units[unit]}`
}

/** `navigator.storage.estimate()`, or `null` where the platform has no answer. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  const storage = typeof navigator === 'undefined' ? undefined : (navigator as { storage?: StorageManager }).storage
  if (typeof storage?.estimate !== 'function') return null
  try {
    const { usage, quota } = await storage.estimate()
    if (typeof usage !== 'number' || typeof quota !== 'number') return null
    return { usage, quota }
  } catch {
    return null
  }
}

/**
 * The message for a write the browser refused. `what` is the thing that needed the space — "this
 * package", "this file" — and `needed` its size when it is known.
 */
export async function quotaMessage(what: string, needed: number | null): Promise<string> {
  const estimate = await storageEstimate()
  const need =
    needed === null
      ? `Not enough storage for ${what}`
      : `Not enough storage: ${what} needs ${formatBytes(needed)}`
  if (!estimate) return `${need}.`
  return (
    `${need}; this site is using ${formatBytes(estimate.usage)} of the ` +
    `${formatBytes(estimate.quota)} the browser allows it.`
  )
}
