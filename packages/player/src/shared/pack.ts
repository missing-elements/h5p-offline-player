import type { PackDependency, PackLibrary } from './protocol.js'

/**
 * The entries of a library pack's index that are well formed. The index of a copy the host names
 * is read from the network, and what the element and the worker do with it — register parts,
 * fetch them, withhold a package's own folders — must not be steered by a malformed one. A kept
 * entry's folder is its library's own name, its hash is hex, and its part's URL is http(s).
 * Imports nothing at run time, since the element carries it.
 */
export function packLibrariesIn(value: unknown): Array<PackLibrary & { url: string }> {
  if (!Array.isArray(value)) return []
  const version = (part: unknown): part is number => typeof part === 'number' && Number.isInteger(part) && part >= 0
  const kept: Array<PackLibrary & { url: string }> = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const { folder, machineName, majorVersion, minorVersion, patchVersion, preloadedDependencies, addTo, size, sha256, url } = entry as Record<string, unknown>
    if (typeof machineName !== 'string' || !/^[A-Za-z0-9._-]+$/.test(machineName)) continue
    if (!version(majorVersion) || !version(minorVersion) || !version(patchVersion)) continue
    if (folder !== `${machineName}-${majorVersion}.${minorVersion}`) continue
    if (!version(size) || typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) continue
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) continue
    const dependencies = Array.isArray(preloadedDependencies)
      ? preloadedDependencies
          .filter(
            (dependency): dependency is PackDependency =>
              typeof dependency?.machineName === 'string' && version(dependency.majorVersion) && version(dependency.minorVersion)
          )
          .map(({ machineName: name, majorVersion: major, minorVersion: minor }) => ({ machineName: name, majorVersion: major, minorVersion: minor }))
      : []
    kept.push({
      folder,
      machineName,
      majorVersion,
      minorVersion,
      patchVersion,
      ...(dependencies.length ? { preloadedDependencies: dependencies } : {}),
      ...(addTo !== undefined ? { addTo } : {}),
      size,
      sha256,
      url
    })
  }
  return kept
}
