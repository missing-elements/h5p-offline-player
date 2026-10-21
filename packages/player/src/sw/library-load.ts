import type { LibraryLoad } from '../shared/protocol.js'
import { dependenciesIn, type LibraryDependency, type PackageManifest } from './package-reader.js'

/**
 * What the frame loads, and in what order: every library the content needs, its scripts and its
 * stylesheets, dependencies first. Until the core was vendored (#37) h5p-standalone worked this out
 * in the frame, asking the virtual server for each `library.json` in turn, after a probe of
 * whether the package names its folders with versions; the worker has the archives and the rules
 * by which a folder answers, so it answers the frame with the result instead, on the `boot` route.
 *
 * The order is h5p-standalone's to the letter — the same walk, the same topological sort with the
 * same tie-breaks — because it is the order every content type has been played in here, the
 * sweep's included, and the order among libraries that do not depend on each other is a choice
 * the content was tested against. Two things differ, neither of which changes the order of any
 * package measured on 2026-10-18 (the demo's, the fixtures and the sweep's 55): a library is named
 * by the folder it is served from, so two requests that one folder answers — content asking for
 * 1.0 where 1.1 is served, and a library asking for 1.1 — load it once rather than twice; and a
 * dependency cycle, which h5p-standalone threw on, is broken where it closes.
 */

/** One library as the walk found it: the folder that answered, and what its `library.json` says. */
export interface WalkedLibrary {
  folder: string
  machineName: string
  major: number
  minor: number
  /** Its `preloadedDependencies`, as the dependencies were written. */
  dependencies: LibraryDependency[]
  /** Its `preloadedJs` and `preloadedCss`, as entry names under the package's root. */
  scripts: string[]
  styles: string[]
}

/** How the walk finds a library: the folder that answers for it and its parsed `library.json`, or null. */
export type LibraryLookup = (dependency: LibraryDependency) => Promise<{ folder: string; library: unknown } | null>

/** A dependency by name and version, as a map key; a folder may answer for more than one. */
const keyOf = (dependency: LibraryDependency) => `${dependency.machineName} ${dependency.majorVersion}.${dependency.minorVersion}`

/**
 * The libraries `roots` need, in the order h5p-standalone's `loadDependencies` found them: the roots
 * first, then a level at a time, each level the dependencies the one before it named that are not
 * found yet. The lookups of a level run together. A library nothing answers for is named in
 * `missing`, as the folder its version would have, and its own dependencies go unwalked.
 */
export async function walkLibraries(
  roots: readonly LibraryDependency[],
  lookup: LibraryLookup
): Promise<{ libraries: WalkedLibrary[]; folderOf: Map<string, string>; missing: string[] }> {
  const libraries: WalkedLibrary[] = []
  const byFolder = new Map<string, WalkedLibrary>()
  /** Which folder answered for each dependency, by `keyOf`. */
  const folderOf = new Map<string, string>()
  const missing: string[] = []
  const asked = new Set<string>()
  /** Those not asked for yet, each once, and from now on asked. */
  const unasked = (dependencies: LibraryDependency[]) =>
    dependencies.filter((dependency) => {
      const key = keyOf(dependency)
      if (asked.has(key)) return false
      asked.add(key)
      return true
    })

  let level = unasked([...roots])
  while (level.length > 0) {
    const answers = await Promise.all(level.map((dependency) => lookup(dependency)))
    const found: WalkedLibrary[] = []
    answers.forEach((answer, index) => {
      const dependency = level[index]
      if (!answer) {
        missing.push(`${dependency.machineName}-${dependency.majorVersion}.${dependency.minorVersion}`)
        return
      }
      folderOf.set(keyOf(dependency), answer.folder)
      if (byFolder.has(answer.folder)) return
      const library = walkedLibrary(answer.folder, answer.library, dependency)
      byFolder.set(answer.folder, library)
      libraries.push(library)
      found.push(library)
    })
    level = unasked(found.flatMap((library) => library.dependencies))
  }
  return { libraries, folderOf, missing }
}

/**
 * The scripts and stylesheets of `libraries`, dependencies first: h5p-standalone's
 * `sortDependencies`, edge for edge. A library with no dependencies is an edge of one, whose missing
 * end `toposort` takes for a node of its own; that node decides nothing but the tie-breaks, and it is
 * kept so that they come out the same.
 */
export function loadOrder(libraries: readonly WalkedLibrary[], folderOf: ReadonlyMap<string, string>): { scripts: string[]; styles: string[] } {
  const edges: Array<[string, string | undefined]> = []
  const byFolder = new Map(libraries.map((library) => [library.folder, library]))
  for (const library of libraries) {
    const dependencies = library.dependencies.flatMap((dependency) => folderOf.get(keyOf(dependency)) ?? [])
    if (dependencies.length === 0) edges.push([library.folder, undefined])
    for (const dependency of dependencies) edges.push([library.folder, dependency])
  }

  const scripts: string[] = []
  const styles: string[] = []
  for (const folder of toposort(edges).reverse()) {
    const library = folder === undefined ? undefined : byFolder.get(folder)
    if (!library) continue
    scripts.push(...library.scripts)
    styles.push(...library.styles)
  }
  return { scripts, styles }
}

/**
 * What the frame loads for a package whose libraries `walkLibraries` found from `manifest`'s
 * dependencies: the main library at the version served, the files in order, and the folders the
 * core's `H5P.getLibraryPath` cannot name by version — `libraryDirectories`, for a package that
 * keeps a library in a folder named without one. `null` when the main library is not among them.
 */
export function libraryLoad(
  manifest: PackageManifest,
  walk: { libraries: readonly WalkedLibrary[]; folderOf: ReadonlyMap<string, string> }
): Omit<LibraryLoad, 'upgrades'> | null {
  const main = (manifest.preloadedDependencies ?? []).find((dependency) => dependency.machineName === manifest.mainLibrary)
  const mainFolder = main && walk.folderOf.get(keyOf(main))
  const served = mainFolder === undefined ? undefined : walk.libraries.find((library) => library.folder === mainFolder)
  if (!served) return null

  const directories: Record<string, string> = {}
  for (const library of walk.libraries) {
    const named = `${library.machineName}-${library.major}.${library.minor}`
    if (library.folder !== named) directories[named] = library.folder
  }
  return { library: `${served.machineName} ${served.major}.${served.minor}`, ...loadOrder(walk.libraries, walk.folderOf), directories }
}

/** A `library.json` as the walk needs it; untrusted, so every field is held to its shape. */
function walkedLibrary(folder: string, library: unknown, asked: LibraryDependency): WalkedLibrary {
  const json = (library ?? {}) as Record<string, unknown>
  const version = (part: unknown, fallback: number) =>
    typeof part === 'number' && Number.isInteger(part) && part >= 0 ? part : typeof part === 'string' && /^\d+$/.test(part) ? Number(part) : fallback
  return {
    folder,
    machineName: typeof json.machineName === 'string' ? json.machineName : asked.machineName,
    major: version(json.majorVersion, Number(asked.majorVersion)),
    minor: version(json.minorVersion, Number(asked.minorVersion)),
    dependencies: dependenciesIn(json),
    scripts: filesIn(folder, json.preloadedJs),
    styles: filesIn(folder, json.preloadedCss)
  }
}

/**
 * A `preloadedJs` or `preloadedCss` as entry names under the package's root, `<folder>/<path>`, in
 * order. A path that would leave the folder — absolute, with a scheme, or climbing out with `..` —
 * is left out: the file comes from an archive, and a page names it as a script.
 */
export function filesIn(folder: string, files: unknown): string[] {
  if (!Array.isArray(files)) return []
  return files.flatMap((file) => {
    const path = (file as { path?: unknown } | null)?.path
    if (typeof path !== 'string' || !path || /^[\\/]|^[a-z][a-z\d+.-]*:|(?:^|[\\/])\.\.(?:[\\/]|$)/i.test(path)) return []
    return [`${folder}/${path}`]
  })
}

/**
 * `toposort` 2.0.2 by Marcel Klehr (MIT), the sort h5p-standalone bundles, ported as it is but for a
 * cycle: where it threw, the edge that closes one is passed over, since a node counts as visited
 * from the moment it is entered, and the rest still sorts. Every node comes out before the nodes
 * its edges point at; the last node first seen is visited first, and a node's edges last to first.
 */
export function toposort<T>(edges: ReadonlyArray<readonly [T, T]>): T[] {
  const nodes = [...new Set(edges.flatMap(([from, to]) => [from, to]))]
  const outgoing = new Map<T, Set<T>>()
  for (const [from, to] of edges) {
    if (!outgoing.has(from)) outgoing.set(from, new Set())
    if (!outgoing.has(to)) outgoing.set(to, new Set())
    outgoing.get(from)!.add(to)
  }

  let cursor = nodes.length
  const sorted = new Array<T>(cursor)
  const visited = new Set<T>()
  const visit = (node: T) => {
    if (visited.has(node)) return
    visited.add(node)
    const children = [...(outgoing.get(node) ?? [])]
    for (let child = children.length - 1; child >= 0; child--) visit(children[child])
    sorted[--cursor] = node
  }
  for (let index = nodes.length - 1; index >= 0; index--) visit(nodes[index])
  return sorted
}
