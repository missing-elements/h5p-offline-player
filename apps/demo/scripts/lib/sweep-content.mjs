/**
 * Content for a content type, made from its own `semantics.json` as H5P's editor would save a form:
 * what is written by hand in `apps/demo/sweep/<machineName>.json` where it says something, and
 * everywhere else every default the semantics give and, for a required field without one, the
 * smallest value the content check accepts. A field that holds another content type takes the
 * library the hand-written value names, filled in the same way, or else the first of its options
 * the pack has. So a hand-written file states only what generation cannot know — a question's
 * right answer, which drop zone an item belongs in — and a list in it is as long as it is written.
 *
 * Pure: the pack is handed in as a map of folders, and a value points at media by the paths in
 * `MEDIA` without writing them, so `tests/sweep-content.test.ts` runs it in Node. The sweep finds
 * the files and the libraries a package uses in its final parameters (`mediaIn`, `librariesIn`).
 */

/** The files a generated value may point at, under `content/`, and what each one is. */
export const MEDIA = {
  image: { path: 'images/sample.png', mime: 'image/png', width: 640, height: 360 },
  video: { path: 'videos/sample.mp4', mime: 'video/mp4' },
  audio: { path: 'audios/sample.wav', mime: 'audio/wav' },
  file: { path: 'files/sample.txt', mime: 'text/plain' }
}

/**
 * Text tried, in order, for a required field whose semantics give a pattern and no default: the
 * first that matches is used. Covers every pattern in the pack on 2026-10-14 — colours, dates,
 * times, coordinates, sizes, an address, a phone number, a URL.
 */
const PATTERNED_SAMPLES = ['Sample', '#808080', 'https://example.org/', 'sample@example.org', '+1 555 0100', '2026/1/1', '12:00', '2026,1,1', '100px', '0', 'a']

/** The nesting depth at which a library field stops choosing content of its own. */
const MAX_DEPTH = 4

/** @typedef {{ folder: string, library: any, semantics: any[] | null }} PackLibrary */

export class ContentGenerator {
  /** @param {Map<string, PackLibrary>} pack every library folder in the pack, by folder name */
  constructor(pack) {
    this.pack = pack
    this.ids = 0
  }

  /**
   * The newest library in the pack with this machine name and, when given, this major — the
   * one the player serves for any minor of it.
   * @param {string} machineName
   * @param {number} [major]
   */
  find(machineName, major) {
    let best = null
    for (const entry of this.pack.values()) {
      const { library } = entry
      if (library.machineName !== machineName) continue
      if (major !== undefined && library.majorVersion !== major) continue
      if (!best || library.majorVersion > best.library.majorVersion || (library.majorVersion === best.library.majorVersion && library.minorVersion > best.library.minorVersion)) best = entry
    }
    return best
  }

  /**
   * The parameters for a library's content, with `written` — the hand-written parameters, if
   * any — laid in.
   * @param {PackLibrary} entry
   * @param {any} [written]
   */
  generate(entry, written) {
    return this.fields(entry.semantics ?? [], written, [entry.library.machineName], false)
  }

  /** A deterministic sub-content id: generated packages are the same bytes every run. */
  nextId() {
    this.ids += 1
    return `00000000-0000-4000-8000-${this.ids.toString(16).padStart(12, '0')}`
  }

  /**
   * @param {any[]} fields
   * @param {any} written the hand-written object for these fields, or undefined
   * @param {string[]} stack the content types this value sits inside, to keep a type out of itself
   * @param {boolean} lenient inside an optional group nobody wrote: defaults only, as the editor
   *   saves a group left closed — and so no sample image for a field required only within it
   */
  fields(fields, written, stack, lenient) {
    const out = {}
    const given = isObject(written) ? written : {}
    for (const field of fields) {
      const value = this.field(field, given[field.name], stack, lenient)
      if (value !== undefined) out[field.name] = value
    }
    // What the semantics do not name is kept as written: the content check removes it, which a
    // file may mean to test.
    for (const [key, value] of Object.entries(given)) if (!(key in out) && value !== null && !fields.some((field) => field.name === key)) out[key] = value
    return out
  }

  /**
   * @param {any} field
   * @param {any} written the hand-written value, `null` to leave the field out, or undefined
   * @param {string[]} stack
   * @param {boolean} lenient
   */
  field(field, written, stack, lenient) {
    if (written === null) return undefined
    const optional = field.optional || lenient
    switch (field.type) {
      case 'group': {
        const children = field.fields ?? []
        // A group of one field is saved as that field's value, as the editor and the content
        // check have it, unless the group is sub-content.
        const flattened = children.length === 1 && !field.isSubContent
        if (written === undefined && field.default !== undefined) return field.default
        if (written !== undefined && !flattened && !isObject(written)) return written
        const value = this.fields(children, flattened ? { [children[0].name]: written } : written, stack, optional && written === undefined)
        // Saved even when optional and untouched, as the editor saves every group in its form:
        // content types read into one without looking (Personality Quiz's `image.file`).
        return flattened ? value[children[0].name] : value
      }
      case 'list': {
        const item = { ...field.field, optional: false }
        if (Array.isArray(written)) return written.map((each) => this.field(item, each, stack, false)).filter((each) => each !== undefined)
        const count = Math.min(Math.max(optional ? 0 : (field.min ?? 0), field.defaultNum ?? (optional ? 0 : 1)), field.max ?? Infinity)
        const items = []
        for (let index = 0; index < count; index++) {
          const value = this.field(item, undefined, stack, lenient)
          if (value !== undefined) items.push(value)
        }
        return items.length > 0 || !optional ? items : undefined
      }
      case 'library':
        if (isObject(written) && typeof written.library === 'string') return this.writtenLibrary(written, stack)
        // A default names the content the editor starts with: Interactive Video's summary task.
        if (written === undefined && isObject(field.default) && typeof field.default.library === 'string') return this.writtenLibrary(field.default, stack)
        return optional ? undefined : this.library(field, stack)
      case 'text':
        if (written !== undefined) return written
        if (field.default !== undefined) return field.default
        return optional ? undefined : sampleText(field)
      case 'number':
        if (written !== undefined) return written
        if (field.default !== undefined) return field.default
        return optional ? undefined : Math.max(field.min ?? 0, Math.min(field.max ?? Infinity, 1))
      case 'boolean':
        // The editor's checkbox saves false when nobody ticked it.
        return written ?? field.default ?? false
      case 'select':
        if (written !== undefined) return written
        if (field.default !== undefined) return field.default
        return optional || !field.options?.length ? undefined : field.options[0].value
      case 'image':
      case 'file':
        if (written !== undefined) return written
        return optional ? undefined : { ...MEDIA[field.type], copyright: { license: 'U' } }
      case 'video':
      case 'audio':
        if (written !== undefined) return written
        return optional ? undefined : [{ path: MEDIA[field.type].path, mime: MEDIA[field.type].mime, copyright: { license: 'U' } }]
      default:
        return written
    }
  }

  /**
   * Sub-content: the first option the pack has and that is not already a parent here, made from
   * its own semantics. None at all is left out, which the content check would do anyway.
   * @param {any} field
   * @param {string[]} stack
   */
  library(field, stack) {
    if (stack.length > MAX_DEPTH) return undefined
    for (const option of field.options ?? []) {
      const name = typeof option === 'string' ? option : option?.name
      const match = /^(\S+) (\d+)\.(\d+)$/.exec(name ?? '')
      if (!match || stack.includes(match[1])) continue
      const entry = this.find(match[1], Number(match[2]))
      if (!entry) continue
      return this.subContent(entry, undefined, stack)
    }
    return undefined
  }

  /**
   * Sub-content written by hand: the library it names, its parameters filled in from that
   * library's semantics. A library the pack does not have is kept as written, for the check to
   * remove or the runtime to refuse.
   * @param {any} written
   * @param {string[]} stack
   */
  writtenLibrary(written, stack) {
    const match = /^(\S+) (\d+)\.(\d+)$/.exec(written.library)
    const entry = match ? this.find(match[1], Number(match[2])) : null
    if (!entry) return written
    return { ...this.subContent(entry, written.params, stack), ...omit(written, ['params']), library: libraryString(entry.library) }
  }

  /**
   * @param {PackLibrary} entry
   * @param {any} written
   * @param {string[]} stack
   */
  subContent(entry, written, stack) {
    return {
      library: libraryString(entry.library),
      params: this.fields(entry.semantics ?? [], written, [...stack, entry.library.machineName], false),
      subContentId: this.nextId(),
      metadata: { contentType: entry.library.title, license: 'U', title: entry.library.title }
    }
  }
}

/** The sample files the parameters point at, by kind. */
export function mediaIn(params) {
  const text = JSON.stringify(params)
  return /** @type {(keyof typeof MEDIA)[]} */ (Object.keys(MEDIA)).filter((kind) => text.includes(`"${MEDIA[kind].path}"`))
}

/** Every `library` string in the parameters: the sub-content a package plays. */
export function librariesIn(params, found = new Set()) {
  if (Array.isArray(params)) for (const item of params) librariesIn(item, found)
  else if (isObject(params)) {
    if (typeof params.library === 'string' && /^\S+ \d+\.\d+$/.test(params.library)) found.add(params.library)
    for (const value of Object.values(params)) librariesIn(value, found)
  }
  return found
}

/** `H5P.MultiChoice 1.16`, the form `library` fields and `h5p.json` use. */
export function libraryString(library) {
  return `${library.machineName} ${library.majorVersion}.${library.minorVersion}`
}

/**
 * Text for a required field: its label, as an editor would show it, as markup for an HTML
 * field, or the first sample its pattern accepts.
 * @param {any} field
 */
function sampleText(field) {
  if (field.regexp?.pattern) {
    const pattern = new RegExp(field.regexp.pattern, field.regexp.modifiers ?? '')
    return PATTERNED_SAMPLES.find((candidate) => pattern.test(candidate)) ?? ''
  }
  const label = typeof field.label === 'string' && field.label.trim() ? field.label.trim() : 'Sample'
  const text = field.maxLength ? label.slice(0, field.maxLength) : label
  return field.widget === 'html' ? `<p>${escapeHtml(text)}</p>` : text
}

function escapeHtml(text) {
  return text.replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character])
}

function omit(object, keys) {
  return Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)))
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
