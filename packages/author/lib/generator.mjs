import { randomUUID } from 'node:crypto'
import { markupText, plainText } from './text.mjs'

/**
 * Content for a content type, made from its own `semantics.json` as H5P's editor saves a form:
 * what is written where it says something, and everywhere else every default the semantics give.
 * A field that holds another content type takes the library the written value names, filled in
 * the same way. So a source states only what the defaults cannot know, and a list in it is as long
 * as it is written.
 *
 * Two ways to run it. Authoring, the default, checks every written value against its field, as the
 * editor's form would: a field the semantics do not name, a select's unknown option, a list too
 * short or too long, a tag a markup field does not take, a required field with neither a written
 * value nor a default — each a problem named by its path. The content-type sweep runs it
 * `lenient`, taking what is written as it is and filling a required field from `fill`, so that
 * every content type in the pack plays (apps/demo/scripts/sweep-content-types.mjs).
 *
 * Pure but for the ids: the pack is handed in as a map of folders, each with its `library.json`
 * and `semantics.json`. Media are not read here: a written file is checked for its shape and
 * collected in `media`, for the caller to copy and describe.
 */

/** The nesting depth at which a library field stops choosing content of its own. */
const MAX_DEPTH = 4

/**
 * @typedef {{ folder: string, library: any, semantics: any[] | null }} PackEntry
 * @typedef {{ path: string, message: string }} Problem
 * @typedef {{ field: any, value: any, path: string }} MediaReference
 * @typedef {{
 *   lenient?: boolean,
 *   fill?: (field: any, context: { generator: ContentGenerator, stack: string[], path: string }) => unknown,
 *   id?: (count: number) => string,
 *   metadata?: (entry: PackEntry, written: any, path: string) => any
 * }} GeneratorOptions
 */

export class ContentGenerator {
  /**
   * @param {Map<string, PackEntry>} pack every library folder the content may use, by folder name
   * @param {GeneratorOptions} [options]
   */
  constructor(pack, options = {}) {
    this.pack = pack
    this.options = options
    this.lenient = options.lenient ?? false
    this.ids = 0
    /** @type {Problem[]} what is wrong with the written content, authoring only */
    this.problems = []
    /** @type {Problem[]} what is worth saying about it and does not stop a build */
    this.notes = []
    /** @type {MediaReference[]} the files the written content names, for the caller to copy */
    this.media = []
    /** @type {WeakSet<object>} fields a content type's own widget draws: numbers take decimals, lists start empty */
    this.drawn = new WeakSet()
    /** @type {{ field: any, path: string }[]} hidden fields left for a content type's layout to set */
    this.unset = []
    /** @type {{ fields: any[], given: Record<string, any> }[]} the groups being filled, innermost last, for `showWhen` */
    this.scopes = []
  }

  /**
   * Whether the editor shows a field, by its `showWhen` rules: one of them holds, on the value
   * written for the field they name, or its default. A field the editor hides is not asked for.
   * @param {any} field
   */
  #visible(field) {
    const rules = field.showWhen?.rules
    if (!Array.isArray(rules) || !rules.length) return true
    const results = rules.map((/** @type {any} */ rule) => {
      let name = String(rule.field ?? '')
      let level = this.scopes.length - 1
      while (name.startsWith('../')) {
        name = name.slice(3)
        level -= 1
      }
      const scope = this.scopes[level]
      if (!scope) return true
      const sibling = scope.fields.find((each) => each.name === name)
      let value = scope.given[name] ?? sibling?.default
      if (value === undefined && sibling?.type === 'boolean') value = false
      if (isObject(value) && typeof value.library === 'string') value = value.library.trim().split(/\s+/)[0]
      return [rule.equals].flat().some((/** @type {unknown} */ wanted) => {
        if (typeof value === 'string' && typeof wanted === 'string' && /^\S+ \d+\.\d+$/.test(wanted)) return wanted.split(' ')[0] === value
        return String(wanted) === String(value)
      })
    })
    return field.showWhen.type === 'and' ? results.every(Boolean) : results.some(Boolean)
  }

  /** A field as optional, for one the editor hides. @param {any} field */
  #optional(field) {
    const optional = { ...field, optional: true }
    if (this.drawn.has(field)) this.drawn.add(optional)
    return optional
  }

  /**
   * The newest library in the pack with this machine name and, when given, this major — the
   * one the player serves for any minor of it.
   * @param {string} machineName
   * @param {number} [major]
   */
  find(machineName, major) {
    /** @type {PackEntry | null} */
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
   * The parameters for a library's content, with `written` — the authored parameters, if any —
   * laid in.
   * @param {PackEntry} entry
   * @param {any} [written]
   * @param {string} [path] where the parameters sit, for problems: `params` by default
   */
  generate(entry, written, path = 'params') {
    return this.fields(entry.semantics ?? [], written, [entry.library.machineName], false, path)
  }

  /** A sub-content id: random, or the caller's, numbered, where it wants the same bytes every run. */
  nextId() {
    this.ids += 1
    return this.options.id ? this.options.id(this.ids) : randomUUID()
  }

  /** @param {string} path @param {string} message */
  report(path, message) {
    this.problems.push({ path, message })
  }

  /** @param {string} path @param {string} message */
  note(path, message) {
    this.notes.push({ path, message })
  }

  /**
   * @param {any[]} fields
   * @param {any} written the written object for these fields, or undefined
   * @param {string[]} stack the content types this value sits inside, to keep a type out of itself
   * @param {boolean} lenient inside an optional group nobody wrote: defaults only, as the editor
   *   saves a group left closed — and so nothing asked for a field required only within it
   * @param {string} path
   */
  fields(fields, written, stack, lenient, path) {
    /** @type {Record<string, unknown>} */
    const out = {}
    if (!this.lenient && written !== undefined && !isObject(written)) {
      this.report(path, `expected an object with the fields ${names(fields)}`)
      return out
    }
    const given = isObject(written) ? written : {}
    this.scopes.push({ fields, given })
    try {
      for (const field of fields) {
        const value = this.field(this.lenient || this.#visible(field) ? field : this.#optional(field), given[field.name], stack, lenient, `${path}.${field.name}`)
        if (value !== undefined) out[field.name] = value
      }
    } finally {
      this.scopes.pop()
    }
    for (const [key, value] of Object.entries(given)) {
      if (key in out || fields.some((field) => field.name === key)) continue
      // Lenient, what the semantics do not name is kept as written: the content check removes
      // it, which a sweep file may mean to test.
      if (this.lenient) {
        if (value !== null) out[key] = value
      } else this.report(`${path}.${key}`, `is not a field here; the fields are ${names(fields)}`)
    }
    return out
  }

  /**
   * @param {any} field
   * @param {any} written the written value, `null` to leave the field out, or undefined
   * @param {string[]} stack
   * @param {boolean} lenient
   * @param {string} path
   * @returns {any}
   */
  field(field, written, stack, lenient, path) {
    const optional = field.optional || lenient
    if (written === null) {
      if (!this.lenient && !field.optional && field.default === undefined && field.type !== 'boolean') this.report(path, 'is required and cannot be null')
      return undefined
    }
    switch (field.type) {
      case 'group': {
        const children = field.fields ?? []
        // A group of one field is saved as that field's value, as the editor and the content
        // check have it, unless the group is sub-content.
        const flattened = children.length === 1 && !field.isSubContent
        if (written === undefined && field.default !== undefined) return structuredClone(field.default)
        if (flattened) return this.field(children[0], written, stack, optional && written === undefined, path)
        if (written !== undefined && !isObject(written)) {
          if (this.lenient) return written
          this.report(path, `expected an object with the fields ${names(children)}`)
          return undefined
        }
        // A group the editor draws with a widget of its own — a duration, a position on an image,
        // a slide — takes numbers as that widget sets them, decimals included, and starts its
        // lists empty.
        if (field.widget && field.widget !== 'showWhen' && field.widget !== 'none') this.#draw(children)
        // Saved even when optional and untouched, as the editor saves every group in its form:
        // content types read into one without looking (Personality Quiz's `image.file`).
        return this.fields(children, written, stack, optional && written === undefined, path)
      }
      case 'list': {
        const item = { ...field.field, optional: false }
        if (Array.isArray(written)) {
          if (!this.lenient) {
            if (field.min !== undefined && written.length < field.min) this.report(path, `has ${written.length} item${written.length === 1 ? '' : 's'}; it takes at least ${field.min}`)
            if (field.max !== undefined && written.length > field.max) this.report(path, `has ${written.length} items; it takes at most ${field.max}`)
          }
          return written.map((each, index) => this.field(item, each, stack, false, `${path}[${index}]`)).filter((each) => each !== undefined)
        }
        if (written !== undefined && !this.lenient) {
          this.report(path, 'expected a list')
          return undefined
        }
        const count = !this.lenient && this.drawn.has(field)
          ? optional ? 0 : field.min ?? 0
          : Math.min(Math.max(optional ? 0 : (field.min ?? 0), field.defaultNum ?? (optional ? 0 : 1)), field.max ?? Infinity)
        if (!this.lenient && count > 0) {
          // A required list nobody wrote is what the editor offers a new author: as many items as
          // it asks for, each with its defaults. Where an item needs something only an author can
          // give, the list itself is what is missing.
          const before = this.problems.length
          const items = this.#items(item, count, stack, lenient, path)
          if (this.problems.length > before) {
            this.problems.length = before
            this.report(path, `is required: write at least ${Math.max(field.min ?? 1, 1)} item${Math.max(field.min ?? 1, 1) === 1 ? '' : 's'}`)
            return undefined
          }
          return items
        }
        const items = this.#items(item, count, stack, lenient, path)
        return items.length > 0 || !optional ? items : undefined
      }
      case 'library':
        if (isObject(written) && typeof written.library === 'string') return this.writtenLibrary(written, stack, path, field)
        if (written !== undefined && !this.lenient) {
          this.report(path, `expected sub-content, { "library": "${optionNames(field)[0] ?? 'H5P.…'}", "params": { … } }`)
          return undefined
        }
        // A default names the content the editor starts with: Interactive Video's summary task.
        // Left as the editor leaves it for an author who never opens it: what it would ask for
        // is not asked here either, and stays unwritten.
        if (written === undefined && isObject(field.default) && typeof field.default.library === 'string') {
          if (this.lenient) return this.writtenLibrary(field.default, stack, path, null)
          return this.#quietly(() => this.writtenLibrary(structuredClone(field.default), stack, path, null))
        }
        return optional ? undefined : this.missing(field, stack, path)
      case 'text':
        if (written !== undefined) return this.lenient ? written : this.text(field, written, path)
        // A default of null, which Course Presentation gives its colours, is stored as nothing: the
        // platforms' check would turn it into an empty text.
        if (field.default === null && !this.lenient) return undefined
        if (field.default !== undefined) return field.default
        return optional ? undefined : this.missing(field, stack, path)
      case 'number':
        if (written !== undefined) return this.lenient ? written : this.number(field, written, path)
        if (field.default !== undefined) return field.default
        return optional ? undefined : this.missing(field, stack, path)
      case 'boolean':
        if (written !== undefined && !this.lenient && typeof written !== 'boolean') this.report(path, 'expected true or false')
        // The editor's checkbox saves false when nobody ticked it.
        return written ?? field.default ?? false
      case 'select':
        if (written !== undefined) return this.lenient ? written : this.select(field, written, path)
        if (field.default !== undefined) return structuredClone(field.default)
        return optional ? undefined : this.missing(field, stack, path)
      case 'image':
      case 'file':
      case 'video':
      case 'audio':
        if (written !== undefined) return this.lenient ? written : this.file(field, written, path)
        return optional ? undefined : this.missing(field, stack, path)
      default:
        return written
    }
  }

  /**
   * What a callback generates, with nothing it would report: problems, notes and hidden fields.
   * @template T
   * @param {() => T} generate
   * @returns {T}
   */
  #quietly(generate) {
    const counts = [this.problems.length, this.notes.length, this.unset.length]
    try {
      return generate()
    } finally {
      this.problems.length = counts[0]
      this.notes.length = counts[1]
      this.unset.length = counts[2]
    }
  }

  /** Fields, and all within them, as a widget of the editor's draws them. @param {any[]} fields */
  #draw(fields) {
    for (const field of fields) {
      if (!field || this.drawn.has(field)) continue
      this.drawn.add(field)
      if (field.fields) this.#draw(field.fields)
      if (field.field) this.#draw([field.field])
    }
  }

  /**
   * @param {any} item
   * @param {number} count
   * @param {string[]} stack
   * @param {boolean} lenient
   * @param {string} path
   */
  #items(item, count, stack, lenient, path) {
    const items = []
    for (let index = 0; index < count; index++) {
      const value = this.field(item, undefined, stack, lenient, `${path}[${index}]`)
      if (value !== undefined) items.push(value)
    }
    return items
  }

  /**
   * A required field with neither a written value nor a default: the caller's to fill, or a
   * problem.
   * @param {any} field
   * @param {string[]} stack
   * @param {string} path
   */
  missing(field, stack, path) {
    if (this.options.fill) return this.options.fill(field, { generator: this, stack, path })
    // A field the editor hides is its own bookkeeping, a position it sets when an author drags
    // something: a content type's layout sets it here, and what none sets is a problem then.
    if (field.widget === 'none') {
      this.unset.push({ field, path })
      return undefined
    }
    this.report(path, `is required (${describe(field)})`)
    return undefined
  }

  /**
   * Sub-content: the first option the pack has and that is not already a parent here, made from
   * its own semantics. None at all is left out, which the content check would do anyway. The
   * sweep's fill, for a field it has to fill to make a content type play.
   * @param {any} field
   * @param {string[]} stack
   * @param {string} [path]
   */
  library(field, stack, path = '') {
    if (stack.length > MAX_DEPTH) return undefined
    for (const option of field.options ?? []) {
      const name = typeof option === 'string' ? option : option?.name
      const match = /^(\S+) (\d+)\.(\d+)$/.exec(name ?? '')
      if (!match || stack.includes(match[1])) continue
      const entry = this.find(match[1], Number(match[2]))
      if (!entry) continue
      return this.subContent(entry, undefined, undefined, stack, path)
    }
    return undefined
  }

  /**
   * Written sub-content: the library it names, its parameters filled in from that library's
   * semantics. Lenient, a library the pack does not have is kept as written, for the check to
   * remove or the runtime to refuse; authoring, it is a problem, as is one the field does not take.
   * @param {any} written
   * @param {string[]} stack
   * @param {string} path
   * @param {any} field the library field, or null for a default the semantics give
   */
  writtenLibrary(written, stack, path, field) {
    if (this.lenient) {
      const match = /^(\S+) (\d+)\.(\d+)$/.exec(written.library)
      const entry = match ? this.find(match[1], Number(match[2])) : null
      if (!entry) return written
      return { ...this.subContent(entry, written.params, undefined, stack, path), ...omit(written, ['params']), library: libraryString(entry.library) }
    }
    const match = /^\s*(\S+?)(?:\s+(\d+)\.(\d+))?\s*$/.exec(written.library)
    if (!match) {
      this.report(`${path}.library`, `expected a library's machine name, such as ${optionNames(field)[0] ?? '"H5P.MultiChoice"'}`)
      return undefined
    }
    const machineName = match[1]
    let major = match[2] === undefined ? undefined : Number(match[2])
    if (field) {
      const options = libraryOptions(field)
      const option = options.find((each) => each.machineName === machineName && (major === undefined || each.major === major))
      if (!option) {
        this.report(`${path}.library`, `${machineName} is not one this field takes; it takes ${[...new Set(options.map((each) => each.machineName))].join(', ')}`)
        return undefined
      }
      major = option.major
    }
    const entry = this.find(machineName, major)
    if (!entry) {
      this.report(`${path}.library`, `the library pack has no ${machineName}${major === undefined ? '' : ` ${major}.x`}`)
      return undefined
    }
    for (const key of Object.keys(written)) {
      if (!['library', 'params', 'metadata'].includes(key)) this.report(`${path}.${key}`, 'is not part of sub-content; write library, params and metadata')
    }
    if (written.metadata !== undefined && !isObject(written.metadata)) this.report(`${path}.metadata`, 'expected an object, such as { "title": "…" }')
    else if (isObject(written.metadata)) {
      for (const key of Object.keys(written.metadata)) if (key !== 'title') this.report(`${path}.metadata.${key}`, 'is not set per sub-content here; write only its title, the rest comes from the source')
    }
    return this.subContent(entry, written.params, written.metadata, stack, path)
  }

  /**
   * @param {PackEntry} entry
   * @param {any} written its parameters
   * @param {any} metadata its written metadata
   * @param {string[]} stack
   * @param {string} path
   */
  subContent(entry, written, metadata, stack, path) {
    return {
      library: libraryString(entry.library),
      params: this.fields(entry.semantics ?? [], written, [...stack, entry.library.machineName], false, `${path}.params`),
      subContentId: this.nextId(),
      metadata: this.options.metadata
        ? this.options.metadata(entry, metadata, path)
        : { contentType: entry.library.title, license: 'U', title: entry.library.title }
    }
  }

  /**
   * @param {any} field
   * @param {unknown} written
   * @param {string} path
   */
  text(field, written, path) {
    if (typeof written !== 'string') {
      this.report(path, `expected text${typeof written === 'number' ? `, such as "${written}"` : ''}`)
      return undefined
    }
    const stored = field.tags === undefined || field.tags === null
      ? plainText(written, (message) => this.note(path, message))
      : markupText(written, field, (message) => this.report(path, message))
    const length = Array.from(stored).length
    if (typeof field.maxLength === 'number' && length > field.maxLength) this.report(path, `is ${length} characters as stored; it takes at most ${field.maxLength}`)
    if (field.regexp?.pattern && !(stored === '' && field.optional)) {
      let pattern = null
      try {
        pattern = new RegExp(field.regexp.pattern, (field.regexp.modifiers ?? '').replace(/[^gimsuy]/g, ''))
      } catch {
        // A pattern JavaScript cannot read is the content check's to apply, not ours.
      }
      if (pattern && !pattern.test(stored)) this.report(path, `"${written.slice(0, 40)}" is not in the form this field takes${field.description ? ` (${stripTags(field.description).slice(0, 120)})` : ''}`)
    }
    if (!field.optional && stored.replace(/<[^>]*>/g, '').trim() === '' && !/<(img|iframe|video|audio|hr|table)/i.test(stored)) this.report(path, 'is required and is empty')
    return stored
  }

  /**
   * @param {any} field
   * @param {unknown} written
   * @param {string} path
   */
  number(field, written, path) {
    if (typeof written !== 'number' || !Number.isFinite(written)) {
      this.report(path, 'expected a number')
      return undefined
    }
    if (field.min !== undefined && written < Number(field.min)) this.report(path, `is ${written}; the least it takes is ${field.min}`)
    if (field.max !== undefined && written > Number(field.max)) this.report(path, `is ${written}; the most it takes is ${field.max}`)
    if (field.decimals !== undefined && Number(field.decimals) >= 0) {
      const factor = 10 ** Number(field.decimals)
      if (Math.round(written * factor) / factor !== written) this.report(path, `takes ${field.decimals ? `at most ${field.decimals} decimals` : 'a whole number'}`)
    } else if (!field.widget && !this.drawn.has(field) && !Number.isInteger(written)) this.report(path, 'takes a whole number')
    if (field.step !== undefined && Number(field.step) > 0 && (written - Number(field.min ?? 0)) % Number(field.step) !== 0) this.report(path, `takes steps of ${field.step}`)
    return written
  }

  /**
   * @param {any} field
   * @param {unknown} written
   * @param {string} path
   */
  select(field, written, path) {
    const values = selectValues(field)
    const check = (/** @type {unknown} */ value) => {
      if (values.length && !values.includes(String(value))) this.report(path, `${JSON.stringify(value)} is not an option; the options are ${values.map((each) => JSON.stringify(each)).join(', ')}`)
    }
    if (field.multiple) {
      if (!Array.isArray(written)) this.report(path, 'expected a list of options')
      else written.forEach(check)
    } else if (typeof written !== 'string' && typeof written !== 'number' && typeof written !== 'boolean') this.report(path, 'expected one of its options')
    else check(written)
    return written
  }

  /**
   * A written file: `{ "path": … }`, a file beside the source or a web address, with `copyright`
   * when known. A video or an audio field takes a list of them, one per format, or one alone.
   * Checked for its shape here; the caller copies it and fills in its type and size.
   * @param {any} field
   * @param {unknown} written
   * @param {string} path
   */
  file(field, written, path) {
    const many = field.type === 'video' || field.type === 'audio'
    const list = many && Array.isArray(written) ? written : [written]
    if (many && Array.isArray(written) && !written.length) {
      this.report(path, 'expected at least one file')
      return undefined
    }
    if (!many && Array.isArray(written)) {
      this.report(path, 'expected one file, { "path": "…" }')
      return undefined
    }
    const files = []
    for (const [index, each] of list.entries()) {
      const at = many && Array.isArray(written) ? `${path}[${index}]` : path
      if (!isObject(each) || typeof each.path !== 'string' || !each.path.trim()) {
        this.report(at, `expected a file, { "path": "picture.jpg" }, a file beside the source or a web address`)
        continue
      }
      for (const key of Object.keys(each)) if (!['path', 'copyright'].includes(key)) this.report(`${at}.${key}`, 'is not part of a file here; write path and, when known, copyright')
      if (each.copyright !== undefined && !isObject(each.copyright)) this.report(`${at}.copyright`, 'expected an object, such as { "license": "CC BY", "author": "…" }')
      const value = { ...each }
      this.media.push({ field, value, path: at })
      files.push(value)
    }
    return many ? files : files[0]
  }
}

/** Every `library` string in the parameters: the sub-content a package plays. */
export function librariesIn(/** @type {any} */ params, found = new Set()) {
  if (Array.isArray(params)) for (const item of params) librariesIn(item, found)
  else if (isObject(params)) {
    if (typeof params.library === 'string' && /^\S+ \d+\.\d+$/.test(params.library)) found.add(params.library)
    for (const value of Object.values(params)) librariesIn(value, found)
  }
  return found
}

/** `H5P.MultiChoice 1.16`, the form `library` fields and `h5p.json` use. */
export function libraryString(/** @type {any} */ library) {
  return `${library.machineName} ${library.majorVersion}.${library.minorVersion}`
}

/** @param {any} field @returns {{ machineName: string, major: number, minor: number }[]} */
function libraryOptions(field) {
  return (field?.options ?? [])
    .map((/** @type {any} */ option) => /^(\S+) (\d+)\.(\d+)$/.exec(typeof option === 'string' ? option : option?.name ?? ''))
    .filter(Boolean)
    .map((/** @type {RegExpExecArray} */ match) => ({ machineName: match[1], major: Number(match[2]), minor: Number(match[3]) }))
}

/** @param {any} field */
function optionNames(field) {
  return libraryOptions(field).map((option) => option.machineName)
}

/** @param {any} field @returns {string[]} */
function selectValues(field) {
  /** @type {string[]} */
  const values = []
  for (const option of field.options ?? []) {
    if (option?.type === 'optgroup') for (const sub of option.options ?? []) values.push(String(sub.value))
    else if (option?.value !== undefined && option?.value !== null) values.push(String(option.value))
  }
  return values
}

/** A field's kind, as a problem names it. @param {any} field */
function describe(field) {
  switch (field.type) {
    case 'text': return field.tags ? 'markup text' : 'text'
    case 'select': return `one of ${selectValues(field).map((value) => JSON.stringify(value)).join(', ')}`
    case 'library': return `sub-content: ${optionNames(field).join(', ')}`
    case 'image': case 'file': return `a file, { "path": "…" }`
    case 'video': case 'audio': return `a list of files, [{ "path": "…" }]`
    default: return field.type
  }
}

/** @param {any[]} fields */
function names(fields) {
  return fields.map((field) => field.name).join(', ')
}

/** @param {string} html */
function stripTags(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

/** @param {any} object @param {string[]} keys */
function omit(object, keys) {
  return Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)))
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
