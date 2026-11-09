import { checkMetadata } from './metadata.mjs'
import { allowedTags, markupText, plainText, takesMarkup } from './text.mjs'

/**
 * Content for a content type, made from its own `semantics.json` as H5P's editor saves a form:
 * what is written where it says something, and everywhere else every default the semantics give.
 * A field that holds another content type takes the library the written value names, filled in
 * the same way. So a source states only what the defaults cannot know, and a list in it is as long
 * as it is written.
 *
 * Three ways to run it. Authoring, the default, checks every written value against its field, as
 * the editor's form would: a field the semantics do not name, a select's unknown option, a list too
 * short or too long, a tag a markup field does not take, a required field with neither a written
 * value nor a default — each a problem named by its path. The content-type sweep runs it
 * `lenient`, taking what is written as it is and filling a required field from `fill`, so that
 * every content type in the pack plays (apps/demo/scripts/sweep-content-types.mjs). And `saved`, as
 * `checkContent` runs it (check.mjs), checks content in the form H5P stores it rather than the form
 * a source writes it: files and sub-content metadata as saved, held to what the platforms keep of
 * them; each sub-content's `subContentId` kept, since the core names a part's statements by it; a
 * markup field's text not wrapped again; and an optional group that holds nothing an author has to
 * write taken as one the editor saved closed. A field the semantics do not name is kept and noted,
 * not a problem, where the content names another minor of its library than the semantics are of:
 * the player upgrades content written for an older minor, which may be what moves it, and plays
 * content written for a newer one without it.
 *
 * The editor is h5p-editor-php-library's form at commit 3bec2594356cf1be4e6401f7e7e557650720aa9b
 * (2026-10-08), and H5PEditor.ShowWhen 1.0.9 at 93678737300e084cb9390a691d3e1ad4e793fbaa for
 * `showWhen`. Each rule taken from them names the script it follows, here and in text.mjs,
 * translate.mjs, schema.mjs and media.mjs; AGENTS.md says how to move them to a newer editor. Where
 * this departs from that editor:
 *
 * - An optional list nobody wrote stays empty. The editor starts every new list with `defaultNum`,
 *   `min` or one item, optional or not, for an author to fill or remove.
 * - A `showWhen` rule on a field that is not a select, a library or a boolean is compared as text,
 *   where ShowWhen leaves the rule out; the pack has none. A value a source writes for a field
 *   that `nullWhenHidden` hides is kept, where the editor clears it.
 *
 * Pure but for the ids: the pack is handed in as a map of folders, each with its `library.json`
 * and `semantics.json`. Media are not read here: a written file is checked for its shape and
 * collected in `media`, for the caller to copy and describe.
 */

/** The nesting depth at which a library field stops choosing content of its own. */
const MAX_DEPTH = 4

/**
 * The shape H5P keeps a sub-content id in (H5PContentValidator's `validateLibrary`, at the commit
 * the runtime's content check names); one in any other is removed, and the part's statements then
 * name it as the content itself.
 */
const SUB_CONTENT_ID = /^\{?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\}?$/

/**
 * What the platforms keep of a saved file beside `path`, `mime` and `copyright`, by its field's
 * type (H5PContentValidator's `_validateFilelike` and its callers); a field's `extraAttributes` add
 * to it.
 * @type {Record<string, string[]>}
 */
const FILE_KEYS = { file: [], image: ['width', 'height', 'originalImage'], video: ['width', 'height', 'codecs', 'quality', 'bitrate'], audio: [] }

/**
 * @typedef {{ folder: string, library: any, semantics: any[] | null }} PackEntry
 * @typedef {{ path: string, message: string }} Problem
 * @typedef {{ field: any, value: any, path: string }} MediaReference
 * @typedef {{
 *   lenient?: boolean,
 *   saved?: boolean,
 *   fill?: (field: any, context: { generator: ContentGenerator, stack: string[], path: string }) => unknown,
 *   id?: (count: number) => string,
 *   metadata?: (entry: PackEntry, written: any, path: string) => any
 * }} GeneratorOptions
 */

export class ContentGenerator {
  /**
   * The library whose parameters are being made, while the content names another minor of it than
   * its semantics are of.
   * @type {{ library: any, minor: number } | null}
   */
  #other = null

  /**
   * @param {Map<string, PackEntry>} pack every library folder the content may use, by folder name
   * @param {GeneratorOptions} [options]
   */
  constructor(pack, options = {}) {
    this.pack = pack
    this.options = options
    this.lenient = options.lenient ?? false
    this.saved = options.saved ?? false
    this.ids = 0
    /** @type {Set<string>} the sub-content ids given, so that no two parts have one */
    this.taken = new Set()
    /** @type {Problem[]} what is wrong with the content, written or saved; never lenient */
    this.problems = []
    /** @type {Problem[]} what is worth saying about it and does not stop a build */
    this.notes = []
    /** @type {MediaReference[]} the files the content names: written, for the caller to copy; saved, as they are */
    this.media = []
    /** @type {WeakSet<object>} fields a content type's own widget draws: numbers take decimals, lists start empty */
    this.drawn = new WeakSet()
    /** @type {{ field: any, path: string }[]} hidden fields left for a content type's layout to set */
    this.unset = []
    /** @type {{ fields: any[], given: Record<string, any> }[]} the levels a `showWhen` path climbs, innermost last */
    this.scopes = []
  }

  /**
   * Whether the editor shows a field, by its `showWhen` rules as H5PEditor.ShowWhen reads them:
   * one of them holds, or every one where the rules say `and`, on the value written for the field
   * a rule names, or its default. Each `../` in that name climbs a level, as h5peditor.js's
   * `findField` climbs from a widget to its parent (see `#level`). A field the editor hides is not
   * asked for.
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

  /**
   * A copy of a field with something changed, drawn by a widget if the field is.
   * @param {any} field
   * @param {Record<string, unknown>} changes
   */
  #copy(field, changes) {
    const copy = { ...field, ...changes }
    if (this.drawn.has(field)) this.drawn.add(copy)
    return copy
  }

  /** A field as optional, for one the editor hides. @param {any} field */
  #optional(field) {
    return this.#copy(field, { optional: true })
  }

  /** A field as it is filled here: optional where the editor hides it. @param {any} field */
  #shown(field) {
    return this.lenient || this.#visible(field) ? field : this.#optional(field)
  }

  /**
   * What a callback generates a level down, for `showWhen`: the fields a rule can name there, and
   * what was written for them. The editor makes a level of every widget that holds others: the
   * form, each group, a group of one field among them, each list and each sub-content. A list's
   * level names no field, so a rule in a list's item reaches what holds the list with `../../`.
   * @template T
   * @param {any[]} fields
   * @param {Record<string, unknown>} given
   * @param {() => T} generate
   * @returns {T}
   */
  #level(fields, given, generate) {
    this.scopes.push({ fields, given })
    try {
      return generate()
    } finally {
      this.scopes.pop()
    }
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
   * @param {number} [minor] the minor of the library the content names, where it may be another
   *   than the entry's, as saved content's may
   */
  generate(entry, written, path = 'params', minor) {
    return this.#of(entry, minor, () => this.fields(entry.semantics ?? [], written, [entry.library.machineName], false, path))
  }

  /**
   * What a callback makes of a library's parameters, knowing whether the content names another
   * minor of the library than its semantics are of.
   * @template T
   * @param {PackEntry} entry
   * @param {number | undefined} minor
   * @param {() => T} generate
   * @returns {T}
   */
  #of(entry, minor, generate) {
    const outer = this.#other
    this.#other = minor === undefined || minor === entry.library.minorVersion ? null : { library: entry.library, minor }
    try {
      return generate()
    } finally {
      this.#other = outer
    }
  }

  /** A sub-content id: random, or the caller's, numbered, where it wants the same bytes every run. */
  nextId() {
    this.ids += 1
    return this.options.id ? this.options.id(this.ids) : newId()
  }

  /**
   * The id of a part: saved, the one it has, unless H5P would not keep it or another part took it
   * first; else a new one, as the editor gives new sub-content one (h5peditor-library.js,
   * `loadLibrary`, and h5peditor-group.js, `initSubContent`).
   * @param {unknown} saved
   * @param {string} path the part's
   */
  #id(saved, path) {
    let id = this.saved && typeof saved === 'string' && SUB_CONTENT_ID.test(saved) && !this.taken.has(saved) ? saved : undefined
    if (this.saved && saved !== undefined && id === undefined) {
      this.note(`${path}.subContentId`, typeof saved === 'string' && this.taken.has(saved)
        ? 'is another part\'s id too, so this part has a new one'
        : 'is not an id H5P keeps, so the part has a new one')
    }
    id ??= this.nextId()
    this.taken.add(id)
    return id
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
   * @param {string[]} [kept] saved, keys these fields do not name that are kept as they are: what
   *   the group's own default carries, and a part's id
   */
  fields(fields, written, stack, lenient, path, kept = []) {
    /** @type {Record<string, unknown>} */
    const out = {}
    if (!this.lenient && written !== undefined && !isObject(written)) {
      this.report(path, `expected an object with the fields ${names(fields)}`)
      return out
    }
    const given = isObject(written) ? written : {}
    this.#level(fields, given, () => {
      for (const field of fields) {
        const value = this.field(this.#shown(field), given[field.name], stack, lenient, `${path}.${field.name}`)
        if (value !== undefined) out[field.name] = value
      }
    })
    for (const [key, value] of Object.entries(given)) {
      if (Object.hasOwn(out, key) || fields.some((field) => field.name === key)) continue
      // Lenient, what the semantics do not name is kept as written: the content check removes
      // it, which a sweep file may mean to test.
      if (this.lenient) {
        if (value !== null) out[key] = value
      } else if (this.saved && kept.includes(key)) out[key] = value
      else if (this.saved && this.#other) {
        out[key] = value
        this.note(`${path}.${key}`, otherMinor(this.#other))
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
        // A group of one field is saved as that field's value, as the editor (h5peditor-group.js)
        // and the content check have it, unless the group is sub-content. It is still a level for
        // `showWhen`, the parent of its one field.
        const flattened = children.length === 1 && !field.isSubContent
        if (written === undefined && field.default !== undefined) return structuredClone(field.default)
        if (flattened) {
          const [only] = children
          return this.#level(children, written === undefined ? {} : { [only.name]: written }, () =>
            this.field(this.#shown(only), written, stack, optional && written === undefined, path))
        }
        if (written !== undefined && !isObject(written)) {
          if (this.lenient) return written
          this.report(path, `expected an object with the fields ${names(children)}`)
          return undefined
        }
        // A group the editor draws with a widget of its own — a duration, a position on an image,
        // a slide — takes numbers as that widget sets them, decimals included, and starts its
        // lists empty.
        if (field.widget && field.widget !== 'showWhen' && field.widget !== 'none') this.#draw(children)
        // Saved even when optional and untouched, as the editor saves every group in its form
        // (h5peditor-group.js): content types read into one without looking (Personality Quiz's
        // `image.file`). Saved, a group that holds nothing an author has to write is one of those,
        // whoever wrote it, and nothing is asked of it either.
        const closed = optional && (written === undefined || (this.saved && !holds(field, written)))
        const kept = isObject(field.default) ? Object.keys(field.default) : []
        if (field.isSubContent) kept.push('subContentId')
        const value = this.fields(children, written, stack, closed, path, kept)
        if (field.isSubContent) value.subContentId = this.#id(isObject(written) ? written.subContentId : undefined, path)
        return value
      }
      case 'list': {
        const item = this.#copy(field.field, { optional: false })
        if (Array.isArray(written)) {
          if (!this.lenient) {
            if (field.min !== undefined && written.length < field.min && !lenient) this.report(path, `has ${written.length} item${written.length === 1 ? '' : 's'}; it takes at least ${field.min}`)
            if (field.max !== undefined && written.length > field.max) this.report(path, `has ${written.length} items; it takes at most ${field.max}`)
          }
          // Saved, an item that holds nothing an author has to write is one the editor started an
          // optional list with, and nobody filled: nothing is asked of it.
          return this.#level([], {}, () => written.map((each, index) =>
            this.field(item, each, stack, lenient || (this.saved && field.optional === true && !holds(item, each)), `${path}[${index}]`)).filter((each) => each !== undefined))
        }
        if (written !== undefined && !this.lenient) {
          this.report(path, 'expected a list')
          return undefined
        }
        const count = !this.lenient && this.drawn.has(field)
          ? optional ? 0 : field.min ?? 0
          : Math.min(Math.max(optional ? 0 : (field.min ?? 0), field.defaultNum ?? (optional ? 0 : 1)), field.max ?? Infinity)
        if (!this.lenient && count > 0) {
          // A required list nobody wrote is what the editor offers a new author
          // (h5peditor-list.js): as many items as it asks for, each with its defaults. Where an
          // item needs something only an author can give, the list itself is what is missing.
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
        // A default names the content the editor starts with (h5peditor.js puts it in the
        // parameters, h5peditor-library.js loads it): Interactive Video's summary task. Left as the
        // editor leaves it for an author who never opens it: what it would ask for is not asked
        // here either, and stays unwritten.
        if (written === undefined && isObject(field.default) && typeof field.default.library === 'string') {
          if (this.lenient) return this.writtenLibrary(field.default, stack, path, null)
          return this.#quietly(() => this.writtenLibrary(structuredClone(field.default), stack, path, null))
        }
        return optional ? undefined : this.missing(field, stack, path)
      case 'text':
        // Within what nothing is asked of, an empty text is what the editor saved there.
        if (written !== undefined) return this.lenient ? written : this.text(lenient ? this.#optional(field) : field, written, path)
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
        // The editor's checkbox saves false when nobody ticked it (h5peditor-boolean.js).
        return written ?? field.default ?? false
      case 'select':
        // Saved, an optional select left at the editor's empty choice holds "".
        if (this.saved && optional && written === '') return written
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
   * A new list's items, each with its defaults, a level below the list's.
   * @param {any} item
   * @param {number} count
   * @param {string[]} stack
   * @param {boolean} lenient
   * @param {string} path
   */
  #items(item, count, stack, lenient, path) {
    return this.#level([], {}, () => {
      const items = []
      for (let index = 0; index < count; index++) {
        const value = this.field(item, undefined, stack, lenient, `${path}[${index}]`)
        if (value !== undefined) items.push(value)
      }
      return items
    })
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
    if (this.saved) {
      // As H5P keeps sub-content (validateLibrary): these four, and what the field adds.
      const keys = ['library', 'params', 'subContentId', 'metadata', ...extraAttributes(field)]
      for (const key of Object.keys(written)) if (!keys.includes(key)) this.report(`${path}.${key}`, `is not part of sub-content; H5P keeps ${keys.join(', ')}`)
      if (written.metadata !== undefined) checkMetadata(written.metadata, `${path}.metadata`, (at, message) => this.report(at, message))
      // Content a field gives as its default, Interactive Video's summary task, is as the editor
      // started it until an author opens it, which saved content does not tell: what it holds is
      // checked, and nothing asked of it.
      const started = isObject(field?.default) && typeof field.default.library === 'string' && field.default.library.trim().split(/\s+/)[0] === machineName
      const minor = match[3] === undefined ? undefined : Number(match[3])
      return this.subContent(entry, written.params, written.metadata, stack, path, { id: written.subContentId, minor, closed: started })
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
   * @param {{ id?: unknown, minor?: number, closed?: boolean }} [saved] saved sub-content's id, the
   *   minor of its library it names, and whether nothing is asked of it
   */
  subContent(entry, written, metadata, stack, path, { id, minor, closed = false } = {}) {
    const params = this.#of(entry, minor, () => this.fields(entry.semantics ?? [], written, [...stack, entry.library.machineName], closed, `${path}.params`))
    return {
      library: libraryString(entry.library),
      params,
      subContentId: this.#id(id, path),
      metadata: this.saved && isObject(metadata)
        ? structuredClone(metadata)
        : this.options.metadata
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
    // Written text is stored as the editor's widget for the field stores what an author types;
    // saved text, as the content check keeps it, which goes by the field's `tags` alone.
    const markup = this.saved ? allowedTags(field) !== null : takesMarkup(field)
    const stored = markup
      ? markupText(written, field, (message) => this.report(path, message), { saved: this.saved })
      : plainText(written, (message) => this.note(path, message), { filtered: allowedTags(field) !== null })
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
    if (!field.optional && stripTags(stored) === '' && !/<(img|iframe|video|audio|hr|table)/i.test(stored)) this.report(path, 'is required and is empty')
    return stored
  }

  /**
   * A number as h5peditor-number.js checks it: within its range; with at most `decimals`
   * decimals, or none where the field has no `decimals` and no widget of its own draws it; and a
   * multiple of `step`, counted from 0 as its `value % step` counts. Where it departs from the
   * editor: a multiple of a fractional step is taken within a rounding error, where the editor's
   * `%` refuses it (`0.3 % 0.1` is `0.0999…`); no library in the pack has a fractional step, and
   * the content check checks none (packages/runtime/src/content-check.ts).
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
    const step = Number(field.step)
    if (field.step !== undefined && step > 0) {
      const steps = written / step
      // The value, the step and their quotient are each rounded once, so the quotient is off by
      // at most about 1.5 Number.EPSILON of itself; the bound is four. A share as loose as 1e-9
      // let 50000000.05 pass in steps of 0.1, half a step off.
      if (Math.abs(steps - Math.round(steps)) > 4 * Number.EPSILON * Math.max(1, Math.abs(steps))) this.report(path, `takes steps of ${field.step}`)
    }
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
   * Checked for its shape here; the caller copies it and fills in its type and size. Saved, a file
   * is as H5P stores it, its path in the package or a web address, and holds what the platforms
   * keep of one.
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
        this.report(at, this.saved
          ? 'expected a file as H5P stores it, { "path": "images/picture.jpg", "mime": "image/jpeg" }'
          : 'expected a file, { "path": "picture.jpg" }, a file beside the source or a web address')
        continue
      }
      if (this.saved) {
        const keys = ['path', 'mime', 'copyright', ...(FILE_KEYS[field.type] ?? []), ...extraAttributes(field)]
        for (const key of Object.keys(each)) if (!keys.includes(key)) this.report(`${at}.${key}`, `is not part of a file as H5P stores it; it keeps ${keys.join(', ')}`)
        if (each.mime !== undefined && typeof each.mime !== 'string') this.report(`${at}.mime`, 'expected a MIME type, such as "image/jpeg"')
        for (const key of ['width', 'height']) if (each[key] !== undefined && !(Number.isInteger(each[key]) && each[key] >= 0)) this.report(`${at}.${key}`, 'expected a whole number of pixels')
      } else for (const key of Object.keys(each)) if (!['path', 'copyright'].includes(key)) this.report(`${at}.${key}`, 'is not part of a file here; write path and, when known, copyright')
      if (each.copyright !== undefined && !isObject(each.copyright)) this.report(`${at}.copyright`, 'expected an object, such as { "license": "CC BY", "author": "…" }')
      const value = this.saved ? structuredClone(each) : { ...each }
      this.media.push({ field, value, path: at })
      files.push(value)
    }
    return many ? files : files[0]
  }
}

/**
 * A new id, random, as H5P's editor gives each part one: crypto's, which Node has, and a page in a
 * secure context only, https, localhost or a Tauri window.
 * @internal
 */
export function newId() {
  if (typeof globalThis.crypto?.randomUUID !== 'function') throw new Error('Content takes ids from crypto.randomUUID, which a page has in a secure context only: https, localhost, or a Tauri window')
  return globalThis.crypto.randomUUID()
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

/** What a field's semantics add to what the platforms keep of its value. @param {any} field @returns {string[]} */
function extraAttributes(field) {
  return Array.isArray(field?.extraAttributes) ? field.extraAttributes.filter((/** @type {unknown} */ name) => typeof name === 'string') : []
}

/**
 * Whether a saved value holds something an author has to write: a value for a required field
 * without a default, in it or in a group or list in it. What the editor saves for an author who
 * never touched it holds nothing of the kind: an optional group left closed, with its defaults
 * alone, and an empty text or list among them, as Interactive Video's editor saves an adaptivity
 * nobody set; the item it starts an optional list with, as its text tracks.
 * @param {any} field
 * @param {unknown} value
 * @returns {boolean}
 */
function holds(field, value) {
  if (value === undefined || value === null || value === '') return false
  if (field.type === 'list') return Array.isArray(value) && value.some((item) => holds(field.field ?? {}, item))
  if (field.type !== 'group' || ((field.fields ?? []).length === 1 && !field.isSubContent)) return true
  return isObject(value) && (field.fields ?? []).some((/** @type {any} */ child) =>
    !child.optional && child.default === undefined && child.type !== 'boolean' && holds(child, value[child.name]))
}

/**
 * Why saved content may hold a field the semantics it is checked against do not name.
 * @param {{ library: any, minor: number }} other
 */
function otherMinor({ library, minor }) {
  const named = `${library.majorVersion}.${minor}`
  const served = `${library.majorVersion}.${library.minorVersion}`
  return minor < library.minorVersion
    ? `is not a field of ${libraryString(library)}; the content names ${named}, which the player upgrades to ${served} as it plays, and that may move it`
    : `is not a field of ${libraryString(library)}; the content names ${named}, newer, which the player plays at ${served} without it`
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
    case 'text': return takesMarkup(field) ? 'markup text' : 'text'
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
  return html.replace(/<[^<>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

/** @param {any} object @param {string[]} keys */
function omit(object, keys) {
  return Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)))
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
