/**
 * How content names a library, and how the libraries a content names are found: shared by the
 * content check and the content upgrade, which once each parsed the string their own way, one
 * taking `H5P.Foo-1.0` and the other only `H5P.Foo 1.0`, so the check could find a library the
 * upgrade never touched.
 */

/** A library as content names it: the machine name and the version its parameters were written for. */
export interface LibraryName {
  machineName: string
  major: number
  minor: number
}

/** `H5PCore::libraryFromString`: `H5P.Foo 1.2`, or `H5P.Foo-1.2` as its folder is named. */
export function parseLibrary(value: unknown): LibraryName | null {
  if (typeof value !== 'string') return null
  const match = /^([\w\-.]{1,255})[- ]([0-9]{1,5})\.([0-9]{1,5})$/i.exec(value)
  return match ? { machineName: match[1], major: Number(match[2]), minor: Number(match[3]) } : null
}

/** The library string as the core writes it, `H5P.Foo 1.2`. */
export const libraryKey = (library: LibraryName): string => `${library.machineName} ${library.major}.${library.minor}`

/** Sub-content nests, but not this deep; the parameters are the package's, so the walk is bounded. */
export const MAX_DEPTH = 64

/**
 * Every library the content names, once, found by shape — an object whose `library` is a library
 * string — in every field, not only in the ones the semantics call a library: a superset of what
 * the check reaches, so their semantics can be loaded before it, and what the upgrade looks into.
 */
export function librariesIn(params: unknown): LibraryName[] {
  const found = new Map<string, LibraryName>()
  const walk = (value: unknown, depth: number): void => {
    if (depth > MAX_DEPTH || !value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1)
      return
    }
    const library = parseLibrary((value as { library?: unknown }).library)
    if (library) found.set(libraryKey(library), library)
    for (const child of Object.values(value)) walk(child, depth + 1)
  }
  walk(params, 0)
  return [...found.values()]
}
