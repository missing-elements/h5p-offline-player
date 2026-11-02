/**
 * `@missing-elements/h5p-offline-player/plan`: the player's rules for the libraries a package plays
 * with, for the packages that write what it plays, so that they run the player's own rules rather
 * than copies of them: which libraries content names, an addon's patterns and what they match,
 * which folder serves a library and the walk through what the libraries need in turn, what a
 * package carries of its libraries, which parts of the library pack it needs, and a pack's index
 * held to its shape. Pure and free of zip.js, for Node and a page alike. Not named in
 * docs/compatibility.md, so it may change in any release: a package that imports it depends on an
 * exact version of the player (h5p-author since #106, embed since #109).
 */

export { addonPatterns, dependenciesIn, librariesNamedIn, textMatches, type LibraryDependency, type PackageManifest } from './shared/content-libraries.js'
export {
  findMissingLibraries,
  indexLibraryFolders,
  libraryFolderNames,
  parseLibraryFolder,
  reachableFolder,
  resolveLibraryFolder,
  walkDependencies,
  type LibraryFolder
} from './shared/library-folders.js'
export { packLibrariesIn } from './shared/pack.js'
export { ownLibraries, planPack, type OwnLibrary, type PlanInput, type ProvidedLibrary } from './sw/pack-plan.js'
export type { PackDependency, PackLibrary, PackPart, PackPlan, RefreshedLibrary } from './shared/protocol.js'
