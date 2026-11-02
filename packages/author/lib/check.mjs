import { ContentGenerator, libraryString } from './generator.mjs'
import { LAYOUTS, placesOf } from './types.mjs'

/**
 * Content checked in the form H5P stores it, as the build checks what it writes: every value
 * against its field in the libraries' semantics, the hidden fields the editor's widgets set, and
 * what those widgets would not let an author save. A tool that changes a saved package runs it on
 * what it is about to write, and the build runs it last, on what it is about to write, so that the
 * two hold content to one set of rules. No Node import of its own: the libraries are handed in.
 */

/**
 * @typedef {import('./generator.mjs').PackEntry} PackEntry
 * @typedef {import('./libraries.mjs').LoadedLibraries} LoadedLibraries
 * @typedef {{ path: string, message: string }} Problem
 * @typedef {{ params: Record<string, any>, problems: Problem[], notes: Problem[] }} CheckedContent
 *   `params` the content as checked, which a tool writes; `problems` what H5P or the content type
 *   would not take; `notes` what is worth saying and is no reason not to write it
 */

/** @param {unknown} value @returns {value is Record<string, any>} */
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * What a content type's layout is handed: where to report and note, the semantics and record of
 * its library, and a library's title by its name.
 * @param {Map<string, PackEntry>} entries
 * @param {(path: string, message: string) => void} report
 * @param {(path: string, message: string) => void} note
 * @returns {(machineName: string) => import('./types.mjs').LayoutContext}
 * @internal
 */
export function layoutContext(entries, report, note) {
  const loaded = (/** @type {string} */ machineName) => [...entries.values()].find((each) => each.library.machineName === machineName && each.semantics)
  return (machineName) => {
    const entry = loaded(machineName)
    return {
      report,
      note,
      semantics: entry?.semantics ?? [],
      library: entry?.library,
      title: (library) => {
        const name = String(library).split(' ')[0]
        return String(loaded(name)?.library.title ?? name)
      }
    }
  }
}

/**
 * Saved content checked, and what the editor's widgets would have set on it set. Files and
 * sub-content metadata are taken as saved and held to what the platforms keep of them; each part
 * keeps its `subContentId`, and one that has none, or one another part has, gets a new one; a text
 * is held to what its field takes as stored, and a markup field's is not wrapped again. Then each
 * content type's layout runs, placing what nobody placed and checking what its editor would check,
 * a part without a title takes its content type's, and a hidden field nothing set is a problem.
 *
 * The libraries are loaded for the content by `loadLibraries`: from a package's own folders where
 * it carries them (`packageLibraries`), since content is in the shape of the version it was saved
 * with. Where the content names an older minor of a library than the one checked against, as a
 * package without its libraries checked against the pack's does, a field the newer semantics do not
 * name is noted rather than refused: the player upgrades such content as it plays, with the
 * library's own steps, which this cannot run, being the runtime's (GPL) and run in its frame.
 * @param {LoadedLibraries} libraries as `loadLibraries` loaded them for this content
 * @param {{ type: string, params: unknown }} content `type` the content type, with the major and
 *   minor it was saved with, `H5P.QuestionSet 1.20`, as `h5p.json` names it; `params` its
 *   parameters, `content.json`, left as they are
 * @returns {CheckedContent}
 */
export function checkContent(libraries, { type, params }) {
  /** @type {Problem[]} */
  const problems = []
  /** @type {Problem[]} */
  const notes = []
  const report = (/** @type {string} */ path, /** @type {string} */ message) => problems.push({ path, message })
  const note = (/** @type {string} */ path, /** @type {string} */ message) => notes.push({ path, message })
  const { entries, main } = libraries
  const named = /^\s*(\S+?)(?:\s+(\d+)\.(\d+))?\s*$/.exec(String(type))
  if (!named || named[1] !== main.library.machineName || (named[2] !== undefined && Number(named[2]) !== main.library.majorVersion)) {
    report('type', `is ${type}, and the libraries were loaded for ${libraryString(main.library)}`)
    return { params: isObject(params) ? structuredClone(params) : {}, problems, notes }
  }
  if (!main.semantics) report('type', `${libraryString(main.library)} has no semantics: it is not a content type an author fills in`)
  const generator = new ContentGenerator(entries, { saved: true })
  const content = generator.generate(main, structuredClone(params), 'params', named[3] === undefined ? undefined : Number(named[3]))
  problems.push(...generator.problems)
  notes.push(...generator.notes)

  // Layouts that set what the editor's widgets set, and check what they would not let pass.
  const layout = layoutContext(entries, report, note)
  const places = placesOf(main.library.machineName, content)
  for (const place of places) LAYOUTS[place.library]?.after?.(place.params, place.path, layout(place.library))
  for (const place of places) {
    if (place.holder && isObject(place.holder.metadata) && place.holder.metadata.title === undefined) place.holder.metadata.title = place.holder.metadata.contentType
  }
  for (const { field, path } of generator.unset) {
    if (valueAt(content, path) === undefined && !problems.some((problem) => problem.path === path)) report(path, `is required (${field.type}), and nothing set it`)
  }
  return { params: content, problems, notes }
}

/**
 * The value at a generator path, `params.a[0].b`, in the content.
 * @param {any} content
 * @param {string} path
 * @internal
 */
export function valueAt(content, path) {
  let value = { params: content }
  for (const part of path.replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (value === undefined || value === null) return undefined
    value = /** @type {any} */ (value)[part]
  }
  return value
}
