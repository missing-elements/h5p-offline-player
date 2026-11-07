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
