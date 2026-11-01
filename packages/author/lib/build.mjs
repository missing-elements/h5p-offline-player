import { constants, createReadStream } from 'node:fs'
import { copyFile, mkdtemp, open, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { TextReader, ZipWriter } from '@zip.js/zip.js'
import { normalizeArchive } from '@missing-elements/h5p-normalize'
import { ContentGenerator, librariesIn, libraryString } from './generator.mjs'
import { MediaStore } from './media.mjs'
import { openPack } from './pack.mjs'
import { quizSource, validateQuiz } from './quiz.mjs'
import { escapeText } from './text.mjs'
import { localize, translationFiles } from './translate.mjs'
import { LAYOUTS, patchSemantics, placesOf } from './types.mjs'

/**
 * A source made a package: validated, filled in from the pack's semantics and translations,
 * laid out, its media copied and described, and written with the libraries it needs, each part
 * checked against the pack's index. Nothing is written unless all of it is right: every problem
 * the source has is listed at once, each by its path, so a fix takes one round.
 */

/** The licences H5P's metadata takes. */
const LICENSES = ['U', 'CC BY', 'CC BY-SA', 'CC BY-ND', 'CC BY-NC', 'CC BY-NC-SA', 'CC BY-NC-ND', 'CC0 1.0', 'CC PDM', 'GNU GPL', 'PD', 'ODC PDDL', 'C']
const CC_VERSIONS = ['4.0', '3.0', '2.5', '2.0', '1.0']
const ROLES = ['Author', 'Editor', 'Licensee', 'Originator']

/**
 * @typedef {{ name: string, role: string }} Author
 * @typedef {{
 *   type: string, title: string, language: string, license: string, licenseVersion?: string,
 *   authors: Author[], source?: string, yearFrom?: number, yearTo?: number, params: Record<string, unknown>
 * }} Source a package's source: the content type, its metadata, and the parameters that differ from the defaults
 * @typedef {{ path: string, message: string }} Problem
 * @typedef {import('./translate.mjs').TranslationReport} TranslationReport
 * @typedef {{
 *   output: string, manifest: Record<string, unknown>, content: Record<string, unknown>,
 *   libraries: string[], translations: TranslationReport[], notes: Problem[], media: string[]
 * }} BuildResult what was written, and what is worth telling about it
 * @typedef {{ libraries?: string, base?: string, fetch?: typeof fetch }} BuildOptions
 *   `libraries`, a library pack's parts folder in place of the pinned pack; `base`, the folder a
 *   source's file paths are read from; `fetch`, for media named by web address
 */

/** A source's problems, all of them, each named by its path. */
export class SourceError extends Error {
  /** @param {Problem[]} problems */
  constructor(problems) {
    super(`The source has ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n${problems.map(({ path, message }) => `  ${path}: ${message}`).join('\n')}`)
    this.name = 'SourceError'
    this.problems = problems
  }
}

/** @param {unknown} value @returns {value is Record<string, any>} */
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * The general source checked for its own fields; a quiz in the published format mapped onto it.
 * @param {unknown} input
 * @returns {Source}
 * @internal
 */
export function readSource(input) {
  if (isObject(input) && 'kind' in input) {
    validateQuiz(input)
    return /** @type {Source} */ (quizSource(input))
  }
  /** @type {Problem[]} */
  const problems = []
  const report = (/** @type {string} */ path, /** @type {string} */ message) => problems.push({ path, message })
  if (!isObject(input)) throw new SourceError([{ path: 'source', message: 'expected an object: { "type", "title", "language", "license", "authors", "params" }' }])
  const known = ['type', 'title', 'language', 'license', 'licenseVersion', 'authors', 'source', 'yearFrom', 'yearTo', 'params']
  for (const key of Object.keys(input)) if (!known.includes(key)) report(key, `is not a field of a source; the fields are ${known.join(', ')}`)
  if (typeof input.type !== 'string' || !/^\S+$/.test(input.type.trim())) report('type', 'expected a content type\'s machine name, such as "H5P.Blanks"')
  if (typeof input.title !== 'string' || !input.title.trim()) report('title', 'expected the activity\'s title')
  else if (input.title.length > 255) report('title', 'takes at most 255 characters')
  if (typeof input.language !== 'string') report('language', 'expected a BCP 47 language tag, such as "en" or "de-AT"')
  else {
    try {
      Intl.getCanonicalLocales(input.language)
    } catch {
      report('language', 'expected a BCP 47 language tag, such as "en" or "de-AT"')
    }
  }
  if (!LICENSES.includes(/** @type {string} */ (input.license))) report('license', `use one of ${LICENSES.map((each) => JSON.stringify(each)).join(', ')}; "U" when it is not known`)
  if (input.licenseVersion !== undefined) {
    if (!String(input.license).startsWith('CC ') || input.license === 'CC0 1.0' || input.license === 'CC PDM') report('licenseVersion', 'is for a Creative Commons BY licence only')
    else if (!CC_VERSIONS.includes(input.licenseVersion)) report('licenseVersion', `use one of ${CC_VERSIONS.join(', ')}`)
  }
  if (!Array.isArray(input.authors) || !input.authors.length) report('authors', 'name at least one author: [{ "name": "…", "role": "Author" }]')
  else input.authors.forEach((/** @type {unknown} */ author, /** @type {number} */ i) => {
    if (!isObject(author) || typeof author.name !== 'string' || !author.name.trim()) report(`authors[${i}].name`, 'expected the author\'s name')
    else if (!ROLES.includes(author.role)) report(`authors[${i}].role`, `use one of ${ROLES.join(', ')}`)
    else for (const key of Object.keys(author)) if (key !== 'name' && key !== 'role') report(`authors[${i}].${key}`, 'is not part of an author; write name and role')
  })
  if (input.source !== undefined && (typeof input.source !== 'string' || !/^https?:\/\/\S+$/i.test(input.source))) report('source', 'expected the address the content comes from')
  for (const key of ['yearFrom', 'yearTo']) if (input[key] !== undefined && !Number.isInteger(input[key])) report(key, 'expected a year')
  if (input.params !== undefined && !isObject(input.params)) report('params', 'expected an object of the content type\'s fields')
  if (problems.length) throw new SourceError(problems)
  return /** @type {Source} */ ({ ...input, type: String(input.type).trim(), params: input.params ?? {} })
}

/**
 * The libraries a source can bring in, opened and localized before generation: the content type,
 * every library the written parameters name, and every one a library field names as its default.
 * @param {import('./pack.mjs').Pack} pack
 * @param {Source} source
 * @param {(path: string, message: string) => void} report
 */
async function loadLibraries(pack, source, report) {
  /** @type {Map<string, { folder: string, library: any, semantics: any[] | null }>} */
  const entries = new Map()
  /** @type {TranslationReport[]} */
  const translations = []
  /** @type {Map<string, import('./pack.mjs').PartLibrary>} */
  const parts = new Map()
  const main = /^(\S+?)(?:\s+(\d+)\.\d+)?$/.exec(source.type)
  const mainEntry = main ? pack.newest(main[1], main[2] === undefined ? undefined : Number(main[2])) : null
  if (!mainEntry) {
    report('type', `the library pack has no content type ${source.type}`)
    return null
  }
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
  named(source.params)
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
    if (!entry || parts.has(entry.folder)) continue
    const part = await pack.open(entry)
    parts.set(entry.folder, part)
    let semantics = part.semantics
    if (semantics) {
      const files = translationFiles([...part.translations.keys()], source.language).map((name) => ({ name, read: () => pack.translation(part, name) }))
      const localized = await localize(semantics, files, libraryString(part.library))
      semantics = patchSemantics(part.library.machineName, localized.semantics)
      if (part.library.runnable || entry === mainEntry) translations.push(localized.report)
      defaults(semantics)
    }
    entries.set(entry.folder, { folder: entry.folder, library: part.library, semantics })
  }
  // Every library the index knows stays findable, so a name the pre-pass did not see is reported
  // as a library of the pack and not as an unknown one; its semantics are read when it is found.
  for (const entry of pack.libraries) {
    if (!entries.has(entry.folder)) entries.set(entry.folder, { folder: entry.folder, library: { machineName: entry.machineName, majorVersion: entry.majorVersion, minorVersion: entry.minorVersion, title: entry.machineName }, semantics: null })
  }
  return { entries, mainEntry, translations, parts }
}

/**
 * The libraries a package carries: what the content names, its dependencies, and the addons the
 * pack has whose pattern its text matches, as a site with the addon installed exports it.
 * @param {import('./pack.mjs').Pack} pack
 * @param {string[]} named library strings, the main library first
 * @param {Record<string, unknown>} content
 */
async function closure(pack, named, content) {
  /** @type {Map<string, import('./pack.mjs').PartLibrary>} */
  const selected = new Map()
  /** @param {string} machineName @param {number} [major] @param {number} [minor] */
  const use = async (machineName, major, minor = 0) => {
    const entry = pack.newest(machineName, major)
    if (!entry || entry.minorVersion < minor) throw new Error(`The library pack cannot supply ${machineName} ${major ?? ''}.${minor}`)
    if (selected.has(entry.folder)) return
    const part = await pack.open(entry)
    selected.set(entry.folder, part)
    for (const dependency of [...(part.library.preloadedDependencies ?? []), ...(part.library.dynamicDependencies ?? [])]) {
      await use(dependency.machineName, Number(dependency.majorVersion), Number(dependency.minorVersion))
    }
  }
  for (const name of named) {
    const [machineName, version] = name.split(' ')
    const [major, minor] = version.split('.').map(Number)
    await use(machineName, major, minor)
  }
  const addons = []
  for (const entry of pack.libraries) {
    const patterns = entry.addTo?.content?.types ?? []
    for (const type of patterns) {
      const regex = type?.text?.regex
      if (typeof regex !== 'string') continue
      const match = /^\/(.*)\/([a-z]*)$/s.exec(regex)
      if (!match) continue
      let pattern
      try {
        pattern = new RegExp(match[1], match[2].replace(/[^imsuy]/g, ''))
      } catch {
        continue
      }
      if (strings(content).some((each) => pattern.test(each))) {
        addons.push(entry)
        break
      }
    }
  }
  for (const addon of addons) await use(addon.machineName, addon.majorVersion, addon.minorVersion)
  return { selected, addons: addons.map((addon) => `${addon.machineName} ${addon.majorVersion}.${addon.minorVersion}`) }
}

/** Every string in a value. @param {unknown} value @param {string[]} [found] */
function strings(value, found = []) {
  if (typeof value === 'string') found.push(value)
  else if (Array.isArray(value)) value.forEach((item) => strings(item, found))
  else if (isObject(value)) Object.values(value).forEach((item) => strings(item, found))
  return found
}

/**
 * Builds a package from a source and writes it to `output`, which must not exist yet.
 * @param {unknown} input the source: `{ type, title, language, license, authors, params }`, or a quiz in the published quiz format
 * @param {string} output
 * @param {BuildOptions} [options]
 * @returns {Promise<BuildResult>}
 */
export async function buildPackage(input, output, options = {}) {
  const source = readSource(input)
  const pack = await openPack(options.libraries)
  output = resolve(output)
  let temporary
  try {
    /** @type {Problem[]} */
    const problems = []
    /** @type {Problem[]} */
    const notes = []
    const report = (/** @type {string} */ path, /** @type {string} */ message) => problems.push({ path, message })
    const note = (/** @type {string} */ path, /** @type {string} */ message) => notes.push({ path, message })
    const loaded = await loadLibraries(pack, source, report)
    if (!loaded) throw new SourceError(problems)
    const { entries, mainEntry, translations } = loaded
    const authors = source.authors.map((author) => ({ name: escapeText(author.name), role: author.role }))
    const generator = new ContentGenerator(entries, {
      metadata(entry, written, path) {
        const title = written?.title
        if (title !== undefined && (typeof title !== 'string' || !title.trim())) report(`${path}.metadata.title`, 'expected a title')
        else if (typeof title === 'string' && title.length > 255) report(`${path}.metadata.title`, 'takes at most 255 characters')
        return {
          contentType: escapeText(String(entry.library.title ?? entry.library.machineName)),
          license: source.license,
          ...(source.licenseVersion ? { licenseVersion: source.licenseVersion } : {}),
          authors: authors.map((author) => ({ ...author })),
          ...(typeof title === 'string' && title.trim() ? { title: escapeText(title) } : {})
        }
      }
    })
    const main = /** @type {NonNullable<typeof mainEntry>} */ (mainEntry)
    const mainLibrary = /** @type {{ folder: string, library: any, semantics: any[] | null }} */ (entries.get(main.folder))
    if (!mainLibrary.semantics) report('type', `${source.type} has no semantics: it is not a content type an author fills in`)
    else if (!mainLibrary.library.runnable) report('type', `${mainLibrary.library.machineName} is a part other content holds, not a content type on its own: put it in one, such as H5P.Column`)

    // Layouts that adjust what is written, before it is generated.
    const context = (/** @type {string} */ machineName) => {
      const entry = [...entries.values()].find((each) => each.library.machineName === machineName && each.semantics)
      return {
        report, note,
        semantics: entry?.semantics ?? [],
        library: entry?.library,
        title: (/** @type {string} */ library) => {
          const name = String(library).split(' ')[0]
          const found = [...entries.values()].find((each) => each.library.machineName === name && each.semantics)
          return String(found?.library.title ?? name)
        }
      }
    }
    const written = structuredClone(source.params)
    for (const place of placesOf(main.machineName, written)) LAYOUTS[place.library]?.before?.(place.params, place.path, context(place.library))

    const content = generator.generate(mainLibrary, written)
    problems.push(...generator.problems)
    notes.push(...generator.notes)

    // Media: copied, described, put in place of what was written.
    temporary = await mkdtemp(join(dirname(output), '.h5p-author-'))
    const media = new MediaStore({ base: options.base ?? process.cwd(), temporary, fetch: options.fetch })
    for (const { field, value, path } of generator.media) {
      const resolved = await media.resolve(field, value, path, report)
      for (const key of Object.keys(value)) delete value[key]
      Object.assign(value, resolved)
    }

    // Layouts that set what the editor's widgets set, and check what they would not let pass.
    for (const place of placesOf(main.machineName, content)) LAYOUTS[place.library]?.after?.(place.params, place.path, context(place.library))
    for (const place of placesOf(main.machineName, content)) {
      if (place.holder && isObject(place.holder.metadata) && place.holder.metadata.title === undefined) place.holder.metadata.title = place.holder.metadata.contentType
    }
    for (const { field, path } of generator.unset) {
      if (valueAt(content, path) === undefined && !problems.some((problem) => problem.path === path)) report(path, `is required (${field.type}), and nothing set it`)
    }
    if (problems.length) throw new SourceError(problems)

    const named = [libraryString(mainLibrary.library), ...[...librariesIn(content)].filter((name) => name !== libraryString(mainLibrary.library))]
    const { selected, addons } = await closure(pack, named, content)
    if (addons.length) notes.push({ path: 'params', message: `its text matches ${addons.join(', ')}, which the package carries, as a site with it installed would add it` })

    // As H5P's exports write it, unescaped: the platforms check it when they load content.
    const manifest = {
      title: source.title,
      language: source.language,
      defaultLanguage: source.language,
      license: source.license,
      ...(source.licenseVersion ? { licenseVersion: source.licenseVersion } : {}),
      authors: source.authors.map(({ name, role }) => ({ name, role })),
      ...(source.source ? { source: source.source } : {}),
      ...(source.yearFrom !== undefined ? { yearFrom: source.yearFrom } : {}),
      ...(source.yearTo !== undefined ? { yearTo: source.yearTo } : {}),
      mainLibrary: mainLibrary.library.machineName,
      embedTypes: ['div'],
      preloadedDependencies: [...selected.values()].map((part) => ({
        machineName: part.library.machineName, majorVersion: String(part.library.majorVersion), minorVersion: String(part.library.minorVersion)
      }))
    }

    const staged = join(temporary, 'package.h5p')
    const file = await open(staged, 'wx')
    try {
      const writer = new ZipWriter(Writable.toWeb(file.createWriteStream()), { useWebWorkers: false })
      await writer.add('h5p.json', new TextReader(JSON.stringify(manifest)))
      for (const part of selected.values()) {
        await writer.appendZip(part.file, { filter: (entry) => !entry.directory && entry.filename.startsWith(`${part.folder}/`) })
      }
      await writer.add('content/content.json', new TextReader(JSON.stringify(content)))
      for (const item of media.files) {
        await writer.add(`content/${item.name}`, /** @type {ReadableStream<Uint8Array>} */ (Readable.toWeb(createReadStream(item.from))), { level: 0 })
      }
      await writer.close()
    } finally {
      await file.close()
    }
    let final = staged
    if (media.files.length) {
      // Media stored and last, an mp4's index first: the layout a package streams in.
      final = join(temporary, 'normalized.h5p')
      await normalizeArchive({ input: staged, output: final })
    }
    // Unlike a hard link, an exclusive copy also works on FAT/exFAT destinations.
    await copyFile(final, output, constants.COPYFILE_EXCL)
    return {
      output,
      manifest,
      content,
      libraries: [...selected.keys()],
      translations,
      notes,
      media: media.files.map((item) => item.name)
    }
  } finally {
    await pack.close()
    if (temporary) await rm(temporary, { recursive: true, force: true })
  }
}

/**
 * The value at a generator path, `params.a[0].b`, in the content.
 * @param {any} content
 * @param {string} path
 */
function valueAt(content, path) {
  let value = { params: content }
  for (const part of path.replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (value === undefined || value === null) return undefined
    value = /** @type {any} */ (value)[part]
  }
  return value
}
