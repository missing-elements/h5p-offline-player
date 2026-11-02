/**
 * Which libraries a package's `h5p.json`, its `library.json` files and its content's parameters
 * name, and which addons go with the content. Pure and free of zip.js, so that the pack plan
 * (`sw/pack-plan.ts`) and the packages that write what the player plays, through `./plan`, take
 * the player's own rules without its archive reader.
 */

export interface LibraryDependency {
  machineName: string
  majorVersion: string | number
  minorVersion: string | number
}

/** The parts of `h5p.json` the player needs. Everything in it comes from an untrusted archive. */
export interface PackageManifest {
  title?: string
  mainLibrary?: string
  preloadedDependencies?: LibraryDependency[]
}

/**
 * Every library a content's parameters name, as sub-content does it: an object whose `library`
 * is `"<machineName> <major>.<minor>"`, anywhere in the tree. In archive order of discovery,
 * each once. Pure, and the parameters are untrusted, so anything else is ignored.
 */
export function librariesNamedIn(params: unknown): LibraryDependency[] {
  const found = new Map<string, LibraryDependency>()
  const walk = (value: unknown, depth: number) => {
    if (depth > 64 || !value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1)
      return
    }
    const library = (value as { library?: unknown }).library
    if (typeof library === 'string') {
      const match = /^([A-Za-z0-9_.-]+) (\d+)\.(\d+)$/.exec(library)
      if (match && !found.has(match[1])) {
        found.set(match[1], { machineName: match[1], majorVersion: Number(match[2]), minorVersion: Number(match[3]) })
      }
    }
    for (const child of Object.values(value)) walk(child, depth + 1)
  }
  walk(params, 0)
  return [...found.values()]
}

/**
 * The patterns an addon's `library.json` gives under `addTo.content.types[].text.regex`, PHP's
 * `/…/flags` form made JavaScript's. A pattern JavaScript cannot read is left out, and so is one
 * with a flag it has no counterpart for.
 */
export function addonPatterns(library: unknown): RegExp[] {
  const types = (library as { addTo?: { content?: { types?: unknown } } } | null)?.addTo?.content?.types
  if (!Array.isArray(types)) return []

  const patterns: RegExp[] = []
  for (const type of types) {
    const source = (type as { text?: { regex?: unknown } } | null)?.text?.regex
    if (typeof source !== 'string' || source.length < 2) continue
    // PCRE takes any delimiter that is not a letter, a digit, a backslash or a space; the
    // bracket pairs are left out, as no addon uses them.
    const delimiter = source[0]
    if (/[\p{L}\p{N}\\\s([{<]/u.test(delimiter)) continue
    const end = source.lastIndexOf(delimiter)
    const flags = source.slice(end + 1)
    if (end < 1 || /[^imsu]/.test(flags)) continue
    try {
      patterns.push(new RegExp(source.slice(1, end), flags))
    } catch {
      // PCRE that JavaScript does not read.
    }
  }
  return patterns
}

/**
 * Whether a string anywhere in the parameters matches one of the patterns: upstream's
 * `textAddonMatches`. The parameters are untrusted, so the walk is bounded in depth.
 */
export function textMatches(params: unknown, patterns: RegExp[]): boolean {
  const walk = (value: unknown, depth: number): boolean => {
    if (typeof value === 'string') return patterns.some((pattern) => pattern.test(value))
    if (depth > 64 || !value || typeof value !== 'object') return false
    return Object.values(value).some((child) => walk(child, depth + 1))
  }
  return patterns.length > 0 && walk(params, 0)
}

/** The well-formed entries of a manifest's or a `library.json`'s `preloadedDependencies`. */
export function dependenciesIn(value: unknown): LibraryDependency[] {
  const dependencies = (value as { preloadedDependencies?: unknown } | null)?.preloadedDependencies
  if (!Array.isArray(dependencies)) return []
  const version = (part: unknown) => typeof part === 'number' || (typeof part === 'string' && /^\d+$/.test(part))
  return dependencies.filter(
    (dependency): dependency is LibraryDependency =>
      typeof dependency?.machineName === 'string' && version(dependency.majorVersion) && version(dependency.minorVersion)
  )
}
