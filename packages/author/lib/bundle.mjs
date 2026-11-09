import { librariesNamedIn, planPack } from '@missing-elements/h5p-offline-player/plan'
import { libraryOptions } from './generator.mjs'
import { installClosure } from './install.mjs'

/**
 * A content type's bundle: the parts of the pack a build of that type can read, whatever its source
 * holds, for a build where the pack cannot be installed and one file per type can be fetched, as in
 * ChatGPT's sandbox (#166). It is the build's own rules applied to the most a source of the type can
 * name: the content type and every library its library fields offer or give as their default, those
 * libraries' in turn; what they play with, as the player plans it (`planPack`); and what an H5P
 * site's upload check wants with them (`installClosure`). Both rules only ever add for more roots,
 * so whatever one source names is within the bundle.
 *
 * An addon is not in it. A build adds one where a source's text matches its pattern, H5P.MathDisplay
 * (2.8 MB) where the text holds math, which would more than double most bundles. A bundle carries
 * the pack's whole index, so a build from it plans as it would from the pack, and either writes the
 * same package or stops at the part it lacks, by name.
 */

/**
 * @typedef {import('./pack.mjs').Pack} Pack
 * @typedef {import('./pack.mjs').IndexEntry} IndexEntry
 * @typedef {import('./pack.mjs').PartLibrary} PartLibrary
 */

/**
 * The pack's content types: each runnable library at the newest version the pack serves, the one a
 * source's `type` builds.
 * @param {Pack} pack
 * @returns {Promise<PartLibrary[]>} by machine name
 */
export async function contentTypes(pack) {
  /** @type {Map<string, PartLibrary>} */
  const found = new Map()
  for (const { machineName } of pack.libraries) {
    if (found.has(machineName)) continue
    const entry = pack.newest(machineName)
    if (!entry || entry.installOnly) continue
    const part = await pack.open(entry)
    if (part.library.runnable) found.set(machineName, part)
  }
  return [...found.values()].sort((a, b) => a.folder.localeCompare(b.folder))
}

/**
 * Every library field of semantics, in groups and lists at any depth.
 * @param {unknown} semantics
 * @returns {any[]}
 */
function libraryFields(semantics) {
  /** @type {any[]} */
  const found = []
  /** @param {any} field */
  const walk = (field) => {
    if (!field || typeof field !== 'object') return
    if (field.type === 'library') found.push(field)
    if (Array.isArray(field.fields)) field.fields.forEach(walk)
    walk(field.field)
  }
  if (Array.isArray(semantics)) semantics.forEach(walk)
  return found
}

/**
 * The parts of a content type's bundle: the content type's first, then what it plays with, then
 * what an H5P site's upload check wants, each once.
 * @param {Pack} pack
 * @param {string} type a content type's machine name, such as `H5P.QuestionSet`, as a source names it
 * @returns {Promise<IndexEntry[]>}
 */
export async function bundleLibraries(pack, type) {
  const main = pack.newest(String(type).trim())
  if (!main || main.installOnly) {
    const known = (await contentTypes(pack)).map((part) => part.library.machineName)
    throw new Error(`The library pack has no content type ${type}. Its content types: ${known.join(', ')}`)
  }
  if (!(await pack.open(main)).library.runnable) {
    throw new Error(`${main.machineName} is not a content type on its own but a library content types use: bundle the content type you build`)
  }
  // What content of the type can hold: the libraries its library fields offer, and theirs in turn.
  /** @type {Map<string, IndexEntry>} */
  const content = new Map()
  const queue = [main]
  while (queue.length) {
    const entry = /** @type {IndexEntry} */ (queue.shift())
    if (content.has(entry.folder)) continue
    content.set(entry.folder, entry)
    for (const field of libraryFields((await pack.open(entry)).semantics)) {
      const offered = [
        ...libraryOptions(field),
        ...librariesNamedIn(field.default).map(({ machineName, majorVersion }) => ({ machineName, major: Number(majorVersion) }))
      ]
      // Every major the pack has of the name, not only the one offered: a source names a library
      // without its version, and `loadLibraries` then opens each major the pack has of it.
      for (const { machineName } of offered) {
        for (const major of new Set(pack.libraries.filter((entry) => entry.machineName === machineName).map((entry) => entry.majorVersion))) {
          const found = pack.newest(machineName, major)
          if (found && !found.installOnly) queue.push(found)
        }
      }
    }
  }
  const roots = [...content.values()].map(({ machineName, majorVersion, minorVersion }) => ({ machineName, majorVersion, minorVersion }))
  // As the build plans a package (`closure` in build.mjs), with no parameters: an addon is added
  // only for text that matches its pattern, and these are left out.
  const planned = planPack({ own: [], provided: [], roots, params: undefined, pack: pack.libraries, refresh: false, fill: true })?.parts ?? []
  /** @type {Map<string, PartLibrary>} */
  const selected = new Map()
  for (const { folder } of planned) {
    const entry = pack.libraries.find((each) => each.folder === folder)
    if (entry) selected.set(folder, await pack.open(entry))
  }
  const install = await installClosure(pack, selected)
  const parts = [main, ...[...selected.values(), ...install.values()].map((part) => part.index)]
  return [...new Map(parts.map((entry) => [entry.folder, entry])).values()]
}
