/**
 * Entry-name normalisation. Archives are untrusted: an entry may try to escape the package root
 * with `..`, an absolute path, a Windows drive letter or a backslash separator. Anything that
 * cannot be expressed as a plain relative path under the package root is rejected outright
 * rather than sanitised, so a hostile name can never silently become a different valid name.
 */

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

/**
 * Returns the canonical form of a zip entry name, or `null` if the name is unusable.
 * Canonical means: forward slashes, no leading slash, no `.` or `..` segments, no empty
 * segments, no trailing slash.
 */
export function normalizeEntryName(raw: string): string | null {
  if (!raw || CONTROL_CHARS.test(raw)) return null

  // Backslashes are a separator in archives written on Windows, never a literal in H5P names.
  const withSlashes = raw.replace(/\\/g, '/')

  // Absolute paths and drive letters escape the package root.
  if (withSlashes.startsWith('/')) return null
  if (/^[a-zA-Z]:/.test(withSlashes)) return null

  const segments: string[] = []
  for (const segment of withSlashes.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') return null
    segments.push(segment)
  }

  if (segments.length === 0) return null
  return segments.join('/')
}

/**
 * Normalises the path taken from a virtual-server URL. The path arrives percent-encoded from the
 * URL; it is decoded first so that `%2e%2e` is rejected like a literal `..`.
 */
export function normalizeRequestPath(raw: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null
  }
  return normalizeEntryName(decoded)
}

/**
 * Builds the entry index from raw zip names. Directory entries are dropped, unusable names are
 * dropped, and a name that normalises onto one already taken is dropped rather than overwriting
 * it — first occurrence wins, so a duplicate cannot shadow a library file already indexed.
 */
export function indexEntryNames<T extends { filename: string; directory?: boolean }>(
  entries: T[]
): { index: Map<string, T>; rejected: string[] } {
  const index = new Map<string, T>()
  const rejected: string[] = []

  for (const entry of entries) {
    if (entry.directory) continue
    const name = normalizeEntryName(entry.filename)
    if (name === null || index.has(name)) {
      rejected.push(entry.filename)
      continue
    }
    index.set(name, entry)
  }

  return { index, rejected }
}
