/**
 * What an H5P site's upload check wants of a package, beyond what plays. H5P core's validator,
 * which Moodle, WordPress and Drupal run on an upload (`H5PValidator::getMissingLibraries`),
 * refuses a package unless every library it carries has its preloaded, dynamic and editor
 * dependencies with it at the exact major.minor, or the site has that version installed already.
 * A fresh site has nothing, so a build carries the closure (#146): the editor libraries, and the
 * older minor a library names where the pack plays a newer one. The pack carries them as parts
 * the player never serves (`installOnly` in its index), and a build writes them after the
 * content, where nothing reads them as the package plays, and in a package with media after the
 * media too: the Node build names them to the normalizer as `last`.
 */

/** @param {{ machineName: string, majorVersion: number | string, minorVersion: number | string }} library */
const key = (library) => `${library.machineName} ${Number(library.majorVersion)}.${Number(library.minorVersion)}`

/** Every dependency a `library.json` names, of the three kinds. @param {any} library */
const dependenciesOf = (library) => [...(library.preloadedDependencies ?? []), ...(library.dynamicDependencies ?? []), ...(library.editorDependencies ?? [])]

/**
 * The parts a package carries for an H5P site's upload check, beyond `selected`, the libraries it
 * plays with: every dependency of a selected or added library at the exact version named, that
 * `selected` does not hold, depth first from each selected library in its order.
 * @param {import('./pack.mjs').Pack} pack
 * @param {Map<string, import('./pack.mjs').PartLibrary>} selected
 * @returns {Promise<Map<string, import('./pack.mjs').PartLibrary>>}
 */
export async function installClosure(pack, selected) {
  const have = new Set([...selected.values()].map((part) => key(part.library)))
  const exact = new Map(pack.libraries.map((entry) => [key(entry), entry]))
  /** @type {Map<string, import('./pack.mjs').PartLibrary>} */
  const added = new Map()
  /** @param {any} library @param {string} from */
  const visit = async (library, from) => {
    for (const dependency of dependenciesOf(library)) {
      const wanted = key(dependency)
      if (have.has(wanted)) continue
      const entry = exact.get(wanted)
      if (!entry) {
        throw new Error(
          `The library pack cannot supply ${wanted}, which ${from} needs to install on an H5P site: ` +
            "a page imports the pack from '@missing-elements/h5p-libraries/install', and a parts/ folder named with --libraries is one of the pack 1.1.0 or later"
        )
      }
      have.add(wanted)
      const part = await pack.open(entry)
      added.set(entry.folder, part)
      await visit(part.library, wanted)
    }
  }
  for (const part of selected.values()) await visit(part.library, key(part.library))
  return added
}

/**
 * What H5P core's upload check would find missing in a package that carries `libraries`, each
 * given as its `library.json`: every dependency a carried library names, preloaded, dynamic or
 * editor, that is not carried at that exact major.minor. Empty for a package a site with no
 * library installed accepts.
 * @param {any[]} libraries
 * @returns {{ library: string, needs: string }[]} `library` and `needs` as `H5P.Name 1.2`
 */
export function missingForInstall(libraries) {
  const carried = new Set(libraries.map(key))
  /** @type {{ library: string, needs: string }[]} */
  const missing = []
  for (const library of libraries) {
    for (const dependency of dependenciesOf(library)) {
      if (!carried.has(key(dependency))) missing.push({ library: key(library), needs: key(dependency) })
    }
  }
  return missing
}

/**
 * The newest H5P core API that `libraries`, each given as its `library.json`, ask for in
 * `coreApi`; one that asks for none asks for 1.0, as H5P reads it. H5P core's upload check
 * (`H5PValidator::isValidH5pData`) refuses a package that carries a library asking for a newer core
 * than the site has, and its message names that library, not the package.
 * @param {Iterable<any>} libraries
 * @returns {CoreApi}
 */
export function coreApiOf(libraries) {
  let newest = { majorVersion: 1, minorVersion: 0 }
  for (const library of libraries) {
    const asked = library?.coreApi
    if (!asked) continue
    // A minor left out is 0; a version that is not two whole numbers is none.
    const major = Number(asked.majorVersion)
    const minor = Number(asked.minorVersion ?? 0)
    if (!Number.isInteger(major) || !Number.isInteger(minor)) continue
    if (major > newest.majorVersion || (major === newest.majorVersion && minor > newest.minorVersion)) newest = { majorVersion: major, minorVersion: minor }
  }
  return newest
}

/**
 * The platforms' first releases with a core, by its version, as checked on 2026-11-19 (#245):
 * Moodle's `h5plib_v128` (MDL-88092) and the WordPress plugin's bundled core. A version not here
 * is said without them.
 */
const CORE_RELEASES = new Map([['1.28', 'Moodle 4.5.11, 5.0.7 or 5.1.4 and later, or the WordPress H5P plugin 1.17 and later']])

/**
 * The line a build says of the core a site needs to take its package (`coreApiOf`).
 * @param {CoreApi} core
 */
export function coreApiLine(core) {
  const version = `${core.majorVersion}.${core.minorVersion}`
  const releases = CORE_RELEASES.get(version)
  return `Needs H5P core ${version} or newer on a site it is uploaded to${releases ? `: ${releases}` : ''}. An older site refuses it.`
}

/** @typedef {{ majorVersion: number, minorVersion: number }} CoreApi a core API version, as a `library.json` names one */
