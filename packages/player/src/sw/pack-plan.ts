import type { PackDependency, PackLibrary, PackPart, PackPlan, RefreshedLibrary } from '../shared/protocol.js'
import { addonPatterns, textMatches } from './package-reader.js'

/**
 * Which parts of the library pack a package needs, and which of its own library folders the
 * pack's newer versions replace. Pure, so the rules are tested in Node; the worker gathers what a
 * package carries and what its content names, and attaches what this returns.
 *
 * - **Refresh.** A library the package carries plays at the pack's version when the pack has the
 *   same major at a higher version, minor first, then patch, as an H5P site keeps one patch of
 *   each minor, the newest it has seen, and moves content to a newer minor with H5P's content
 *   upgrade. Equal or older in the pack, or only another major there: the package's own. The
 *   own folder is withheld and requests for it resolve to the part's, so a folder is always
 *   served whole from one archive, and the frame upgrades the content to the version served.
 * - **Fill.** What the package needs and does not carry comes from the pack: what `h5p.json`
 *   declares, the sub-content its parameters name, and what each library's `library.json` asks
 *   for in turn. Off while a source listed before the pack is still to be tried.
 * - **What a part needs** always comes from the pack, fill or not: a part is useless without it.
 *   Where the package carries an older minor of such a library, the part's version replaces it.
 * - **Addons**, as the platforms add them when content is saved: a library whose `addTo` pattern
 *   matches a string in the parameters, H5P.MathDisplay for LaTeX. Added when the pack refreshes
 *   or fills anything, the pack standing in for the platform's installed libraries; a package
 *   played as exported, with nothing from the pack, gets none, as on a site without the addon.
 *
 * Taking the newest version of each library satisfies every dependency on both sides, since each
 * side's requests are already met by its own versions: the pack's index is complete in itself.
 */

/** A library folder the package carries, as its `library.json` says, when that was read. */
export interface OwnLibrary {
  folder: string
  machineName: string
  /**
   * `null` for an unversioned folder whose `library.json` was not read: the library at a version
   * unknown, which satisfies any request for it, as the runtime's fallback to the bare name does.
   */
  major: number | null
  minor: number | null
  /** `null` when the `library.json` was not read and the version is the folder name's: no refresh then. */
  patch: number | null
  /** `null` when the `library.json` was not read: its dependencies are followed later. */
  dependencies: PackDependency[] | null
}

/** A library folder an archive already attached provides: a part, or a bundle. */
export interface ProvidedLibrary {
  folder: string
  machineName: string
  major: number
  minor: number
}

export interface PlanInput {
  own: OwnLibrary[]
  provided: ProvidedLibrary[]
  /** What `h5p.json` declares and the parameters name as sub-content. */
  roots: PackDependency[]
  /** The content's parameters, for the addons' patterns; `undefined` when not read. */
  params: unknown
  pack: ReadonlyArray<PackLibrary & { url: string }>
  refresh: boolean
  fill: boolean
}

interface Request {
  dependency: PackDependency
  /** Asked for by the content or the package's own libraries, rather than by a part. */
  fromContent: boolean
}

export function planPack(input: PlanInput): PackPlan | null {
  const byLibrary = new Map(input.pack.map((library) => [libraryKey(library.machineName, library.majorVersion), library]))
  const providedFolders = new Set(input.provided.map(({ folder }) => folder))
  const planned = new Map<string, PackLibrary & { url: string }>()
  const superseded: string[] = []
  const refreshed: RefreshedLibrary[] = []
  let own = [...input.own]

  const supersede = (library: OwnLibrary, by: PackLibrary) => {
    own = own.filter((each) => each !== library)
    superseded.push(library.folder)
    refreshed.push({ library: library.machineName, from: ownVersion(library), to: packVersion(by) })
  }

  /** Plans a part, and returns its own requests, which come from a part. */
  const plan = (library: PackLibrary & { url: string }): Request[] => {
    if (planned.has(library.folder) || providedFolders.has(library.folder)) return []
    planned.set(library.folder, library)
    return (library.preloadedDependencies ?? []).map((dependency) => ({ dependency, fromContent: false }))
  }

  const queue: Request[] = []

  if (input.refresh) {
    for (const library of input.own) {
      if (library.patch === null || library.major === null) continue
      const candidate = byLibrary.get(libraryKey(library.machineName, library.major))
      if (!candidate || !newer(candidate, library)) continue
      // A bundle listed before the pack has this major already, and would answer for the folder
      // withheld: under the part's own folder name, which then is never planned, or at a lower
      // minor, the first a request resolves to. The package keeps its own, as a bundle there
      // fills gaps only, rather than playing the bundle's version reported as the pack's (#58).
      if (input.provided.some((each) => each.machineName === library.machineName && each.major === library.major)) continue
      supersede(library, candidate)
      queue.push(...plan(candidate))
    }
  }

  const satisfies = (version: { machineName: string; major: number | null; minor: number | null }, dependency: PackDependency) =>
    version.machineName === dependency.machineName &&
    (version.major === null || (version.major === dependency.majorVersion && version.minor !== null && version.minor >= dependency.minorVersion))

  const seen = new Set<string>()
  const resolve = () => {
    while (queue.length > 0) {
      const { dependency, fromContent } = queue.shift()!
      const key = `${libraryKey(dependency.machineName, dependency.majorVersion)}.${dependency.minorVersion}:${fromContent}`
      if (seen.has(key)) continue
      seen.add(key)

      const carried = own.find((library) => satisfies(library, dependency))
      if (carried) {
        for (const each of carried.dependencies ?? []) queue.push({ dependency: each, fromContent: true })
        continue
      }
      const ready = [...planned.values()].some((library) =>
        satisfies({ machineName: library.machineName, major: library.majorVersion, minor: library.minorVersion }, dependency)
      )
      if (ready || input.provided.some((library) => satisfies(library, dependency))) continue

      if (fromContent && !input.fill) continue
      const candidate = byLibrary.get(libraryKey(dependency.machineName, dependency.majorVersion))
      if (!candidate || candidate.minorVersion < dependency.minorVersion) continue
      // An older minor the package carries gives way to the version that satisfies both.
      const older = own.find((library) => library.machineName === dependency.machineName && library.major === dependency.majorVersion)
      if (older) supersede(older, candidate)
      queue.push(...plan(candidate))
    }
  }

  queue.push(...input.roots.map((dependency) => ({ dependency, fromContent: true })))
  resolve()

  if (input.refresh || planned.size > 0) {
    for (const addon of input.pack) {
      if (addon.addTo === undefined) continue
      const present = (machineName: string) => machineName === addon.machineName
      if (own.some((library) => present(library.machineName)) || input.provided.some((library) => present(library.machineName))) continue
      if (!textMatches(input.params, addonPatterns({ addTo: addon.addTo }))) continue
      queue.push(...plan(addon))
    }
    resolve()
  }

  if (planned.size === 0 && superseded.length === 0) return null
  return {
    parts: [...planned.values()].map(({ folder, url, size, sha256 }): PackPart => ({ folder, url, size, sha256 })),
    superseded,
    refreshed
  }
}

function libraryKey(machineName: string, major: number): string {
  return `${machineName} ${major}`
}

function newer(candidate: PackLibrary, library: OwnLibrary): boolean {
  if (library.minor === null) return false
  if (candidate.minorVersion !== library.minor) return candidate.minorVersion > library.minor
  return candidate.patchVersion > (library.patch ?? Number.POSITIVE_INFINITY)
}

function ownVersion(library: OwnLibrary): string {
  if (library.major === null) return 'unknown'
  return `${library.major}.${library.minor}${library.patch === null ? '' : `.${library.patch}`}`
}

function packVersion(library: PackLibrary): string {
  return `${library.majorVersion}.${library.minorVersion}.${library.patchVersion}`
}
