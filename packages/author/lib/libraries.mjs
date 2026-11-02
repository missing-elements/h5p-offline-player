import { libraryString } from './generator.mjs'
import { SourceError } from './source-error.mjs'
import { localize, translationFiles } from './translate.mjs'
import { patchSemantics } from './types.mjs'

/**
 * The libraries content brings in, loaded as a build loads them, for the build and for a tool
 * beside it that reads or changes content as the build would. No Node import of its own: the pack
 * the libraries come from is handed in.
 */

/**
 * A library as a pack's index lists it.
 * @typedef {{ folder: string, machineName: string, majorVersion: number, minorVersion: number }} LibraryRecord
 */

/**
 * What libraries are loaded from: the pack `openPack` opens, or any other with these members, such
 * as one over a package's own library folders. `newest` is the library served for a machine name
 * and a major; `open` reads a library's `library.json` and `semantics.json`, after whatever check
 * its source makes, and the names of its translation files, which `translation` reads.
 * @typedef {{
 *   libraries: LibraryRecord[],
 *   newest(machineName: string, major?: number): LibraryRecord | null,
 *   open(entry: LibraryRecord): Promise<{ folder: string, library: any, semantics: any[] | null, translations: string[] }>,
 *   translation(part: { folder: string }, name: string): Promise<unknown>
 * }} LibrarySource
 */

/**
 * @typedef {import('./generator.mjs').PackEntry} PackEntry
 * @typedef {import('./translate.mjs').TranslationReport} TranslationReport
 * @typedef {{ entries: Map<string, PackEntry>, main: PackEntry, translations: TranslationReport[] }} LoadedLibraries
 *   `entries` by folder, the map `ContentGenerator` takes; `main` the content type's; `translations`
 *   the translation each runnable library's interface texts came from
 */

/** @param {unknown} value @returns {value is Record<string, any>} */
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * The libraries content brings in, each the newest of its major that the pack has, loaded as the
 * build loads them: the content type, every library its parameters name, and every one a library
 * field names as its default. Each library's semantics come with the interface texts of its own
 * translation for the language and with the fields a layout sets marked optional
 * (`patchSemantics`). Every other library of the pack is in the map too, without its semantics.
 * @param {LibrarySource} pack
 * @param {{ type: string, language: string, params?: unknown }} content `type` a machine name, with
 *   a major and minor when known, `H5P.Blanks` or `H5P.Blanks 1.14`
 * @returns {Promise<LoadedLibraries>}
 * @throws {SourceError} when the pack has no such content type
 */
export async function loadLibraries(pack, { type, language, params }) {
  /** @type {Map<string, PackEntry>} */
  const entries = new Map()
  /** @type {TranslationReport[]} */
  const translations = []
  const main = /^(\S+?)(?:\s+(\d+)\.\d+)?$/.exec(String(type).trim())
  const mainEntry = main ? pack.newest(main[1], main[2] === undefined ? undefined : Number(main[2])) : null
  if (!mainEntry) throw new SourceError([{ path: 'type', message: `the library pack has no content type ${type}` }])
  /** @type {{ machineName: string, major?: number }[]} */
  const queue = [{ machineName: mainEntry.machineName, major: mainEntry.majorVersion }]
  /** @param {unknown} value */
  const named = (value) => {
    if (Array.isArray(value)) value.forEach(named)
    else if (isObject(value)) {
      const match = typeof value.library === 'string' ? /^\s*(\S+?)(?:\s+(\d+)\.\d+)?\s*$/.exec(value.library) : null
      // A name without a version is resolved by the field's options, which may name any major the
      // pack has: each is loaded.
      if (match && match[2] !== undefined) queue.push({ machineName: match[1], major: Number(match[2]) })
      else if (match) for (const entry of pack.libraries) if (entry.machineName === match[1]) queue.push({ machineName: match[1], major: entry.majorVersion })
      Object.values(value).forEach(named)
    }
  }
  named(params)
  /** @param {any[]} fields */
  const defaults = (fields) => {
    for (const field of fields) {
      if (field.type === 'library' && isObject(field.default)) named(field.default)
      if (field.fields) defaults(field.fields)
      if (field.field) defaults([field.field])
    }
  }
  while (queue.length) {
    const { machineName, major } = /** @type {{ machineName: string, major?: number }} */ (queue.shift())
    const entry = pack.newest(machineName, major)
    if (!entry || entries.has(entry.folder)) continue
    const part = await pack.open(entry)
    let semantics = part.semantics
    if (semantics) {
      const files = translationFiles(part.translations, language).map((name) => ({ name, read: () => pack.translation(part, name) }))
      const localized = await localize(semantics, files, libraryString(part.library))
      semantics = patchSemantics(part.library.machineName, localized.semantics)
      // By folder, not identity: a source may build its records anew on each call.
      if (part.library.runnable || entry.folder === mainEntry.folder) translations.push(localized.report)
      defaults(semantics)
    }
    entries.set(entry.folder, { folder: entry.folder, library: part.library, semantics })
  }
  // Every library the index knows stays findable, so a name the pre-pass did not see is reported
  // as a library of the pack and not as an unknown one; its semantics are read when it is found.
  for (const entry of pack.libraries) {
    if (!entries.has(entry.folder)) entries.set(entry.folder, { folder: entry.folder, library: { machineName: entry.machineName, majorVersion: entry.majorVersion, minorVersion: entry.minorVersion, title: entry.machineName }, semantics: null })
  }
  return { entries, main: /** @type {PackEntry} */ (entries.get(mainEntry.folder)), translations }
}
