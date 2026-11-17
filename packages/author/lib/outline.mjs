import { isInterfaceText } from './schema.mjs'
import { decodeEntities, editorWidget, stripTags, takesMarkup } from './text.mjs'

/**
 * A built content as plain text, for a review before a package is handed over: what an author
 * wrote, one line each, indented by the list it sits in, read through the libraries' semantics.
 * Only text a learner reads is written: a text field the editor draws as a text box, a textarea or
 * rich text, which is not an interface text (`isInterfaceText`) and holds more than its default,
 * which in loaded semantics is the content language's. Settings (selects, numbers, booleans,
 * colours, hidden fields) are left out, but for what says which answer is right: a ✓ before an
 * item whose `correct` is true or that a type takes as the right one, and the answer a `correct`
 * select names; a score range before its feedback. Sub-content gets its own library's semantics and
 * its title where an author gave one, which a book shows as a chapter's; media are named by kind
 * and path.
 */

/** @param {unknown} value @returns {value is Record<string, any>} */
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** The widgets that draw text an author writes and a learner reads. */
const PROSE = new Set(['text', 'textarea', 'html'])

/** Fields whose text is the item itself, written without a label. */
const UNLABELLED = new Set(['text', 'question'])

/**
 * Lists whose first item is the right one, by type and by where the list sits in its parameters.
 * Each type's semantics say so in words alone: "Alternatives - first alternative is the correct
 * one" (Single Choice Set), "the first statement is correct" (Summary).
 */
const FIRST_RIGHT = /** @type {Record<string, string>} */ ({
  'H5P.SingleChoiceSet': 'choices[].answers',
  'H5P.Summary': 'summaries[].summary'
})

/** The kinds of file field, as a line names them. */
const MEDIA = /** @type {Record<string, string>} */ ({ image: 'Image', video: 'Video', audio: 'Audio', file: 'File' })

/**
 * Stored text as a learner reads it.
 * @param {string} stored
 * @param {boolean} markup whether the field holds markup, whose tags are taken out first
 */
function readable(stored, markup) {
  return decodeEntities(markup ? stripTags(stored) : stored).replace(/\s+/g, ' ').trim()
}

/**
 * @typedef {{ library: { machineName: string, majorVersion: number, minorVersion: number }, semantics: any[] | null }} OutlineEntry
 */

/**
 * @param {unknown} content a built package's `content.json`
 * @param {{ entries: Map<string, OutlineEntry>, main: OutlineEntry }} libraries the semantics, as
 *   `loadLibraries` gives them: the content type's, and each sub-content's by its library
 * @param {{ limit?: number }} [options] `limit`, the most lines written (default 400); the rest are counted
 * @returns {string}
 */
export function outlineOf(content, { entries, main }, { limit = 400 } = {}) {
  /** @type {string[]} */
  const lines = []
  let more = 0
  // A mark for the next line: ✓, or the score range of an overall feedback.
  let pending = ''

  /** @param {number} depth @param {string} text */
  const emit = (depth, text) => {
    if (lines.length >= limit) more += 1
    else lines.push(`${'  '.repeat(depth)}${pending}${text}`)
    pending = ''
  }

  /** A sub-content's library, by the string its value names, at that version where the pack has it. @param {string} named */
  const libraryOf = (named) => {
    const [name, version = ''] = named.trim().split(/\s+/)
    const [major, minor] = version.split('.').map(Number)
    /** @type {OutlineEntry | undefined} */
    let other
    for (const entry of entries.values()) {
      if (entry.library.machineName !== name || !entry.semantics) continue
      if (entry.library.majorVersion === major && entry.library.minorVersion === minor) return entry
      other ??= entry
    }
    return other
  }

  /**
   * @param {any[]} fields
   * @param {unknown} params
   * @param {number} depth
   * @param {string} type the library the fields are of
   * @param {string} path where they sit in its parameters, as `a.b[].c`
   * @param {boolean} [bare] their text written without labels: a score range's feedback
   */
  const walkFields = (fields, params, depth, type, path, bare = false) => {
    if (!isObject(params)) return
    for (const field of fields) walk(field, params[field.name], depth, type, path ? `${path}.${field.name}` : field.name, bare)
  }

  /**
   * @param {any} field
   * @param {unknown} value
   * @param {number} depth
   * @param {string} type
   * @param {string} path
   * @param {boolean} bare whether its text is written without a label: a list's item, a score range's feedback
   */
  const walk = (field, value, depth, type, path, bare) => {
    if (value === undefined || value === null || isInterfaceText(field)) return
    switch (field.type) {
      case 'text': {
        if (typeof value !== 'string' || !PROSE.has(editorWidget(field))) return
        const markup = takesMarkup(field)
        const text = readable(value, markup)
        if (!text || (typeof field.default === 'string' && text === readable(field.default, markup))) return
        emit(depth, bare || UNLABELLED.has(field.name) || !field.label ? text : `${field.label}: ${text}`)
        return
      }
      case 'select':
        if (field.name === 'correct') {
          const option = (field.options ?? []).find((/** @type {any} */ each) => String(each?.value) === String(value))
          emit(depth, `Correct answer: ${option?.label ?? value}`)
        }
        return
      case 'group': {
        const children = field.fields ?? []
        // A group of one field is stored as that field's value, as the editor stores it.
        if (children.length === 1 && !field.isSubContent) return walk(children[0], value, depth, type, path, bare)
        if (!isObject(value)) return
        let mark = ''
        const range = ['from', 'to'].every((name) => children.some((/** @type {any} */ child) => child.name === name && child.type === 'number')) &&
          typeof value.from === 'number' && typeof value.to === 'number'
        if (children.some((/** @type {any} */ child) => child.name === 'correct' && child.type === 'boolean') && value.correct === true) mark = '✓ '
        else if (range) mark = `${value.from}–${value.to}%: `
        if (mark) pending = mark
        // A list's item that is a group writes its fields with their labels: only a score range's go bare.
        walkFields(children, value, depth, type, path, range)
        // A mark the group did not use is not passed on to the next line.
        if (mark) pending = ''
        return
      }
      case 'list': {
        if (!Array.isArray(value) || !field.field) return
        const firstRight = FIRST_RIGHT[type] === path
        value.forEach((each, index) => {
          if (firstRight && index === 0) pending = '✓ '
          walk(field.field, each, depth + 1, type, `${path}[]`, true)
          if (firstRight && index === 0) pending = ''
        })
        return
      }
      case 'library': {
        if (!isObject(value) || typeof value.library !== 'string') return
        // Its title, where an author gave one: not the content type's name, which a build gives.
        const title = typeof value.metadata?.title === 'string' ? readable(value.metadata.title, false) : ''
        const typeName = typeof value.metadata?.contentType === 'string' ? readable(value.metadata.contentType, false) : ''
        if (title && title !== typeName) emit(depth, `Title: ${title}`)
        const entry = libraryOf(value.library)
        if (entry?.semantics) walkFields(entry.semantics, value.params, depth, entry.library.machineName, '')
        return
      }
      default: {
        const kind = MEDIA[field.type]
        if (!kind) return
        const files = Array.isArray(value) ? value : [value]
        const paths = files.map((file) => (isObject(file) && typeof file.path === 'string' ? file.path : '')).filter(Boolean)
        if (paths.length) emit(depth, `${kind}: ${paths.join(', ')}`)
      }
    }
  }

  if (main.semantics) walkFields(main.semantics, content, 0, main.library.machineName, '')
  if (more) lines.push(`… ${more} more line${more === 1 ? '' : 's'}`)
  return lines.join('\n')
}
