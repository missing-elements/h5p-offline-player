/**
 * `@missing-elements/h5p-offline-player/plan`: the player's rules for the libraries a package plays
 * with, for the packages that write what it plays, so that they run the player's own rules rather
 * than copies of them: which libraries content names, an addon's patterns and what they match, and
 * which parts of the library pack a package needs. Pure and free of zip.js, for Node and a page
 * alike. Not named in docs/compatibility.md, so it may change in any release: a package that
 * imports it depends on an exact version of the player.
 */

export { addonPatterns, dependenciesIn, librariesNamedIn, textMatches, type LibraryDependency } from './shared/content-libraries.js'
export { planPack, type OwnLibrary, type PlanInput, type ProvidedLibrary } from './sw/pack-plan.js'
export type { PackDependency, PackLibrary, PackPart, PackPlan, RefreshedLibrary } from './shared/protocol.js'
