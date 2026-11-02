/**
 * Which folder serves a library, and the walk through what the libraries need in turn. Pure and
 * free of zip.js, like `content-libraries.ts`, so that the reader, the plan and the packages that
 * write what the player plays, through `./plan`, decide by one rule. Out of package-reader.ts on
 * 2026-11-02 (#109); `bootReady`, `mergedManifest`, `get` and the missing-library checks there
 * still decide by `reachableFolder`.
 */

import { dependenciesIn, type LibraryDependency, type PackageManifest } from './content-libraries.js'

export interface LibraryFolder {
  machineName: string
  major: number
  minor: number
  folder: string
}

/** Splits `H5P.Text-1.1` into its parts, or returns `null` for a folder that is not a library. */
export function parseLibraryFolder(folder: string): LibraryFolder | null {
  const match = /^(.+)-(\d+)\.(\d+)$/.exec(folder)
  if (!match) return null
  return {
    machineName: match[1],
    major: Number(match[2]),
    minor: Number(match[3]),
    folder
  }
}

/** Every library folder in a set of entry names, grouped by machine name. */
export function indexLibraryFolders(entryNames: Iterable<string>): Map<string, LibraryFolder[]> {
  const byName = new Map<string, LibraryFolder[]>()

  for (const name of entryNames) {
    const slash = name.indexOf('/')
    if (slash < 0 || name.slice(slash + 1) !== 'library.json') continue

    const parsed = parseLibraryFolder(name.slice(0, slash))
    if (!parsed) continue

    const existing = byName.get(parsed.machineName)
    if (existing) existing.push(parsed)
    else byName.set(parsed.machineName, [parsed])
  }

  return byName
}

/**
 * The two folder names a library may be stored under: the versioned one, and the bare machine
 * name older packages use. Each is tried in that order, as h5p-standalone tried them.
 */
export function libraryFolderNames(dependency: LibraryDependency): string[] {
  return [
    `${dependency.machineName}-${dependency.majorVersion}.${dependency.minorVersion}`,
    dependency.machineName
  ]
}

/**
 * Picks the folder that satisfies a dependency: the same major version, and a minor at least as
 * high as the one asked for. H5P bumps the major for a change content cannot follow, and gives a
 * minor that changed the shape of a library's parameters a step in its `upgrades.js`; the frame
 * runs those steps on content written for an older minor before the runtime starts
 * (`content-upgrade.ts` in the runtime package), as the platforms do when they install a newer one.
 *
 * This matters whenever libraries come from somewhere other than the package: the library pack ships
 * the current `H5P.Text-1.1` while content authored earlier asks for `H5P.Text-1.0`, and without
 * this every such request is a 404.
 *
 * The lowest satisfying version wins, as the closest to what the content was written against.
 *
 * With `downgrade`, a dependency nothing satisfies is served by the newest older minor of the same
 * major: content made on h5p.com after a minor bump the library pack has not caught up with (#85).
 * Three bumps in four add fields the older code ignores; the fourth moved some, which the older
 * code then does not find. The element asks for it only once every library source has been tried
 * for the version named, and never for an archive still arriving, which may yet carry it.
 */
export function resolveLibraryFolder(
  available: Map<string, LibraryFolder[]>,
  dependency: { machineName: string; major: number; minor: number },
  downgrade = false
): string | undefined {
  const sameMajor = (available.get(dependency.machineName) ?? []).filter((candidate) => candidate.major === dependency.major)
  const satisfying = sameMajor.filter((candidate) => candidate.minor >= dependency.minor).sort((a, b) => a.minor - b.minor)
  if (satisfying.length > 0 || !downgrade) return satisfying[0]?.folder

  return [...sameMajor].sort((a, b) => b.minor - a.minor)[0]?.folder
}

/**
 * The folder a dependency is served from: its name as written, or the bare machine name
 * h5p-standalone falls back to, when that folder's `library.json` is among `names`; else a
 * compatible newer minor of the same major from `available`, the rule `get()` serves library
 * files by, or with `downgrade` an older one. `bootReady`, `mergedManifest` and
 * `findMissingLibraries` all decide by this, so it lives once; so does the SCORM writer, for the
 * zip it writes (#109).
 */
export function reachableFolder(
  dependency: LibraryDependency,
  names: ReadonlySet<string>,
  available: Map<string, LibraryFolder[]>,
  downgrade = false
): string | undefined {
  return (
    libraryFolderNames(dependency).find((folder) => names.has(`${folder}/library.json`)) ??
    resolveLibraryFolder(
      available,
      {
        machineName: dependency.machineName,
        major: Number(dependency.majorVersion),
        minor: Number(dependency.minorVersion)
      },
      downgrade
    )
  )
}

/**
 * The dependencies `h5p.json` declares that the archive does not actually carry. Pure, so the
 * rule can be checked without building a zip.
 */
export function findMissingLibraries(
  entryNames: ReadonlySet<string>,
  manifest: PackageManifest,
  downgrade = false
): LibraryDependency[] {
  const dependencies = manifest.preloadedDependencies
  if (!Array.isArray(dependencies)) return []

  const available = indexLibraryFolders(entryNames)

  return dependencies.filter((dependency) => reachableFolder(dependency, entryNames, available, downgrade) === undefined)
}

/**
 * The walk the player makes before the runtime boots (`PackageReader.checkDependencies`), and the
 * SCORM writer before it writes a zip: from `roots`, what `h5p.json` declares and the parameters
 * name, through each library's own `preloadedDependencies`, a level of the tree at a time, so a
 * server can answer each level's `library.json` reads from its cache. `locate` says what serves a
 * dependency, by `reachableFolder` or a reader's lookup, or `undefined` for nothing; `read` gives
 * the `library.json` of what it located, parsed. Returns what nothing served, each dependency once
 * by the folder it would be in, and what was served with its `library.json`, for the caller to look
 * at: the reader reports the versions served below the minor asked. A `read` that throws ends the
 * walk with its error: counted as having no dependencies, the walk would pass a tree it did not see.
 */
export async function walkDependencies<T>(
  roots: Iterable<LibraryDependency>,
  locate: (dependency: LibraryDependency) => T | undefined,
  read: (located: T, dependency: LibraryDependency) => Promise<unknown>
): Promise<{ missing: LibraryDependency[]; found: Array<{ dependency: LibraryDependency; located: T; library: unknown }> }> {
  const missing: LibraryDependency[] = []
  const found: Array<{ dependency: LibraryDependency; located: T; library: unknown }> = []
  const seen = new Set<string>()
  let level = [...roots]

  while (level.length > 0) {
    const next: LibraryDependency[] = []
    await Promise.all(
      level.map(async (dependency) => {
        const key = libraryFolderNames(dependency)[0]
        if (seen.has(key)) return
        seen.add(key)
        const located = locate(dependency)
        if (located === undefined) {
          missing.push(dependency)
          return
        }
        const library = await read(located, dependency)
        found.push({ dependency, located, library })
        next.push(...dependenciesIn(library))
      })
    )
    level = next
  }

  return { missing, found }
}
