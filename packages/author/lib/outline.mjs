import { isInterfaceText } from './schema.mjs'
import { decodeEntities, editorWidget, tagsIn, takesMarkup } from './text.mjs'

/**
 * A built content as plain text, for a review before a package is handed over: what an author
 * wrote, one line each, indented by the list it sits in, read through the libraries' semantics.
 * Only text a learner reads is written: a text field the editor draws as a text box, a textarea or
 * rich text, which is not an interface text (`isInterfaceText`) and holds more than its default,
 * which in loaded semantics is the content language's. Where a text breaks, a paragraph, a line, a
 * list item, ` / ` keeps the parts apart. Settings (selects, numbers, booleans, colours, hidden
 * fields) are left out, but for what says which answer is right: a ✓ before an item whose
 * `correct` is true, and the answer a `correct` select names; and a score range before its
 * feedback, in a list the editor draws as H5P's RangeList. Sub-content gets its own library's
 * semantics and its title where an author gave one; media are named by kind and path. What a few
 * types say only by position or by number is written out as `TYPES` says.
 */

/** @param {unknown} value @returns {value is Record<string, any>} */
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** The widgets that draw text an author writes and a learner reads. */
const PROSE = new Set(['text', 'textarea', 'html'])

/** Fields whose text is the item itself, written without a label. */
const UNLABELLED = new Set(['text', 'question'])

/**
 * What a few types say only by position or by number, written out. Paths are where a list or a
 * field sits in the type's parameters, as `a.b[].c`.
 * - `right`: lists whose first item is the right one, which each type's semantics say in words
 *   alone: "Alternatives - first alternative is the correct one" (Single Choice Set), "the first
 *   statement is correct" (Summary).
 * - `items`: lists whose items get a numbered header, as their editors show them one at a time:
 *   slides, chapters, questions, a scenario's content, which its links name by that number.
 * - `times`: lists whose items start with the time the video shows them: an interaction's
 *   `duration`, a bookmark's or an end screen's `time`.
 * - `links`: a scenario's `nextContentId`, the index of the content a choice or a content leads
 *   to, negative for the end; and `endScreenScore`, the score an end gives.
 * - `labels`: a label for a field whose semantics give none.
 * @type {Record<string, { right?: string[], items?: Record<string, string>, times?: Record<string, 'duration' | 'time'>, links?: boolean, labels?: Record<string, string> }>}
 */
const TYPES = {
  'H5P.SingleChoiceSet': { right: ['choices[].answers'] },
  'H5P.Summary': { right: ['summaries[].summary'] },
  'H5P.QuestionSet': { items: { questions: 'Question' } },
  'H5P.InteractiveBook': { items: { chapters: 'Chapter' } },
  'H5P.CoursePresentation': { items: { 'presentation.slides': 'Slide' }, labels: { 'presentation.slides[].keywords[].main': 'Keyword' } },
  'H5P.BranchingScenario': { items: { 'branchingScenario.content': 'Content', 'branchingScenario.endScreens': 'End screen' }, links: true },
  'H5P.BranchingQuestion': { links: true },
  'H5P.InteractiveVideo': {
    times: { 'interactiveVideo.assets.interactions': 'duration', 'interactiveVideo.assets.bookmarks': 'time', 'interactiveVideo.assets.endscreens': 'time' }
  }
}

/** The kinds of file field, as a line names them. */
const MEDIA = /** @type {Record<string, string>} */ ({ image: 'Image', video: 'Video', audio: 'Audio', file: 'File' })

/** A tag where rich text breaks: a line break, and the end of a paragraph, a heading, a list item or a cell. */
const BREAK = /^<\s*br\b|^<\/\s*(?:p|div|h[1-6]|li|pre|blockquote|tr|td|th|dt|dd|figcaption)\s*>$/i

/**
 * Stored text as a learner reads it, its parts ` / ` apart: rich text's split where a tag breaks
 * it, each tag a space, tags read as `stripTags` reads them, so a `>` or a `</p>` inside a quoted
 * attribute is part of its tag; plain text's split at its line breaks, `\r` alone among them.
 * Entities are read in each part after the split, so no text, an encoded one included, can pass
 * for a break.
 * @param {string} stored
 * @param {boolean} markup whether the field holds markup
 */
function readable(stored, markup) {
  /** @type {string[]} */
  let parts
  if (markup) {
    parts = ['']
    let at = 0
    for (const tag of tagsIn(stored)) {
      const index = tag.index ?? 0
      parts[parts.length - 1] += `${stored.slice(at, index)} `
      at = index + tag[0].length
      if (BREAK.test(tag[0])) parts.push('')
    }
    parts[parts.length - 1] += stored.slice(at)
  } else {
    parts = stored.split(/\r\n?|\n/)
  }
  return parts.map((part) => decodeEntities(part).replace(/\s+/g, ' ').trim()).filter(Boolean).join(' / ')
}

/** A time in a video, `m:ss`, with tenths where it has them. @param {number} seconds */
function clock(seconds) {
  const tenths = Math.round(seconds * 10)
  const whole = Math.floor(tenths / 10)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}${tenths % 10 ? `.${tenths % 10}` : ''}`
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
  // A mark for the next line: ✓, a score range, or a time.
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
    for (const field of fields) walk(field, params[field.name], depth, type, path ? `${path}.${field.name}` : field.name, bare, params)
  }

  /**
   * The mark a list's item starts with: ✓ for the right one, or the time a video shows it.
   * @param {string} type @param {string} path the list's @param {unknown} item @param {number} index
   */
  const markOf = (type, path, item, index) => {
    const rules = TYPES[type]
    if (index === 0 && rules?.right?.includes(path)) return '✓ '
    const time = rules?.times?.[path]
    if (!time || !isObject(item)) return ''
    if (time === 'time') return typeof item.time === 'number' ? `${clock(item.time)} ` : ''
    const { from, to } = isObject(item.duration) ? item.duration : {}
    return typeof from === 'number' && typeof to === 'number' ? `${clock(from)}–${clock(to)} ` : ''
  }

  /**
   * @param {any} field
   * @param {unknown} value
   * @param {number} depth
   * @param {string} type
   * @param {string} path
   * @param {boolean} bare whether its text is written without a label: a list's item, a score range's feedback
   * @param {Record<string, unknown>} [holder] the parameters the value is one of
   */
  const walk = (field, value, depth, type, path, bare, holder) => {
    if (value === undefined || value === null || isInterfaceText(field)) return
    switch (field.type) {
      case 'text': {
        if (typeof value !== 'string' || !PROSE.has(editorWidget(field))) return
        const markup = takesMarkup(field)
        const text = readable(value, markup)
        if (!text || (typeof field.default === 'string' && text === readable(field.default, markup))) return
        // A label as plain text too, where a library writes one with an entity or a tag.
        const label = TYPES[type]?.labels?.[path] ?? (typeof field.label === 'string' ? readable(field.label, true) : '')
        emit(depth, bare || UNLABELLED.has(field.name) || !label ? text : `${label}: ${text}`)
        return
      }
      case 'select':
        if (field.name === 'correct') {
          const option = (field.options ?? []).find((/** @type {any} */ each) => String(each?.value) === String(value))
          emit(depth, `Correct answer: ${option?.label ?? value}`)
        }
        return
      case 'number':
        if (!TYPES[type]?.links || typeof value !== 'number') return
        // Where a scenario goes is its shape, default or not; a score only where an author gave one.
        // A question leads where its alternatives do, and its content's own link is not read.
        if (field.name === 'nextContentId') {
          const library = isObject(holder?.type) && typeof holder.type.library === 'string' ? holder.type.library.trim().split(/\s+/)[0] : ''
          if (library !== 'H5P.BranchingQuestion') emit(depth, value < 0 ? 'Next: the end' : `Next: Content ${value + 1}`)
        }
        else if (field.name === 'endScreenScore' && value !== field.default) emit(depth, `Score: ${value}`)
        return
      case 'group': {
        const children = field.fields ?? []
        // A group of one field is stored as that field's value, as the editor stores it.
        if (children.length === 1 && !field.isSubContent) return walk(children[0], value, depth, type, path, bare, holder)
        if (!isObject(value)) return
        const marked = children.some((/** @type {any} */ child) => child.name === 'correct' && child.type === 'boolean') && value.correct === true
        if (marked) pending = '✓ '
        // A list's item that is a group writes its fields with their labels.
        walkFields(children, value, depth, type, path)
        // A mark the group did not use is not passed on to the next line.
        if (marked) pending = ''
        return
      }
      case 'list': {
        if (!Array.isArray(value) || !field.field) return
        const header = TYPES[type]?.items?.[path]
        const ranges = (field.widgets ?? []).some((/** @type {any} */ widget) => widget?.name === 'RangeList') && field.field.type === 'group'
        value.forEach((item, index) => {
          let at = depth + 1
          if (header) {
            pending = ''
            emit(at, `${header} ${index + 1}`)
            at += 1
          }
          if (ranges && isObject(item) && typeof item.from === 'number' && typeof item.to === 'number') {
            pending = `${item.from}–${item.to}%: `
            walkFields(field.field.fields ?? [], item, at, type, `${path}[]`, true)
          } else {
            pending = markOf(type, path, item, index)
            walk(field.field, item, at, type, `${path}[]`, true)
          }
          pending = ''
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
