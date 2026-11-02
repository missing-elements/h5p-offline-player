import { constants, createReadStream } from 'node:fs'
import { copyFile, lstat, mkdtemp, open, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { TextReader, ZipWriter } from '@zip.js/zip.js'
import { normalizeArchive } from '@missing-elements/h5p-normalize'
import { librariesNamedIn, planPack } from '@missing-elements/h5p-offline-player/plan'
import { ContentGenerator } from './generator.mjs'
import { loadLibraries } from './libraries.mjs'
import { MediaStore } from './media.mjs'
import { openPack } from './pack.mjs'
import { quizProblems, quizSource } from './quiz.mjs'
import { SourceError } from './source-error.mjs'
import { escapeText } from './text.mjs'
import { LAYOUTS, placesOf } from './types.mjs'

export { SourceError }

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
    const problems = quizProblems(input)
    if (problems.length) throw new SourceError(problems)
    return /** @type {Source} */ (quizSource(/** @type {import('./quiz.mjs').Quiz} */ (input)))
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
 * The libraries a package carries: what the content names, what those need in turn, and the addons
 * the pack has whose pattern its text matches, as a site with the addon installed exports it. It is
 * the player's own plan (`planPack`) for a package that carries nothing yet, so that a package
 * carries the parts the player would take from the pack for it. The plan leaves out what the pack
 * cannot supply, which a package would then miss as it played, so that is checked.
 * @param {import('./pack.mjs').Pack} pack
 * @param {any} main the content type's `library.json`
 * @param {Record<string, unknown>} content
 */
async function closure(pack, main, content) {
  const roots = [main, ...librariesNamedIn(content)].map(({ machineName, majorVersion, minorVersion }) => ({ machineName, majorVersion: Number(majorVersion), minorVersion: Number(minorVersion) }))
  /** @param {unknown} params */
  const plan = (params) => (planPack({ own: [], provided: [], roots, params, pack: pack.libraries, refresh: false, fill: true })?.parts ?? [])
    .map((part) => /** @type {import('./pack.mjs').IndexEntry} */ (pack.libraries.find((entry) => entry.folder === part.folder)))
  const planned = plan(content)
  /** @param {{ machineName: string, majorVersion: string | number, minorVersion: string | number }} dependency */
  const supplied = (dependency) => planned.some((entry) => entry.machineName === dependency.machineName && entry.majorVersion === Number(dependency.majorVersion) && entry.minorVersion >= Number(dependency.minorVersion))
  for (const dependency of [...roots, ...planned.flatMap((entry) => entry.preloadedDependencies ?? [])]) {
    if (!supplied(dependency)) throw new Error(`The library pack cannot supply ${dependency.machineName} ${dependency.majorVersion}.${dependency.minorVersion}`)
  }
  // Listed as the build has always listed them, depth first from the content type with each
  // library's dependencies after it, the addons last: the runtime sorts libraries by their
  // dependencies and keeps this order between two that do not depend on each other, which decides
  // whose stylesheet comes later.
  const byLibrary = new Map(planned.map((entry) => [`${entry.machineName} ${entry.majorVersion}`, entry]))
  /** @type {Map<string, import('./pack.mjs').IndexEntry>} */
  const ordered = new Map()
  /** @param {{ machineName: string, majorVersion: string | number }} dependency */
  const visit = (dependency) => {
    const entry = byLibrary.get(`${dependency.machineName} ${Number(dependency.majorVersion)}`)
    if (!entry || ordered.has(entry.folder)) return
    ordered.set(entry.folder, entry)
    for (const each of entry.preloadedDependencies ?? []) visit(each)
  }
  for (const each of [...roots, ...planned]) visit(each)
  /** @type {Map<string, import('./pack.mjs').PartLibrary>} */
  const selected = new Map()
  for (const entry of ordered.values()) selected.set(entry.folder, await pack.open(entry))
  // Planned without the parameters, nothing matches an addon's pattern: what they add are the addons.
  const plain = new Set(plan(undefined).map((entry) => entry.folder))
  const addons = planned.filter((entry) => !plain.has(entry.folder)).map((entry) => `${entry.machineName} ${entry.majorVersion}.${entry.minorVersion}`)
  return { selected, addons }
}

/**
 * The refusal of an output that exists, with the file system's code, so a caller tells it from
 * a source's problems.
 * @param {string} output
 */
function exists(output) {
  return Object.assign(new Error(`${output} exists, and a build never writes over a file: name a new one`), { code: 'EEXIST' })
}

/**
 * Builds a package from a source and writes it to `output`, which must not exist yet.
 * @param {unknown} input the source: `{ type, title, language, license, authors, params }`, or a quiz in the published quiz format
 * @param {string} output
 * @param {BuildOptions} [options]
 * @returns {Promise<BuildResult>}
 */
export async function buildPackage(input, output, options = {}) {
  output = resolve(output)
  // Before any work, and again as the package lands, for a file that appears in between.
  if (await lstat(output).then(() => true, () => false)) throw exists(output)
  if (!(await stat(dirname(output)).catch(() => null))?.isDirectory()) throw new Error(`${dirname(output)} is not a folder to write the package in`)
  const source = readSource(input)
  const pack = await openPack(options.libraries)
  let temporary
  try {
    /** @type {Problem[]} */
    const problems = []
    /** @type {Problem[]} */
    const notes = []
    const report = (/** @type {string} */ path, /** @type {string} */ message) => problems.push({ path, message })
    const note = (/** @type {string} */ path, /** @type {string} */ message) => notes.push({ path, message })
    const { entries, main: mainLibrary, translations } = await loadLibraries(pack, source)
    const main = mainLibrary.library.machineName
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
    for (const place of placesOf(main, written)) LAYOUTS[place.library]?.before?.(place.params, place.path, context(place.library))

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
    for (const place of placesOf(main, content)) LAYOUTS[place.library]?.after?.(place.params, place.path, context(place.library))
    for (const place of placesOf(main, content)) {
      if (place.holder && isObject(place.holder.metadata) && place.holder.metadata.title === undefined) place.holder.metadata.title = place.holder.metadata.contentType
    }
    for (const { field, path } of generator.unset) {
      if (valueAt(content, path) === undefined && !problems.some((problem) => problem.path === path)) report(path, `is required (${field.type}), and nothing set it`)
    }
    if (problems.length) throw new SourceError(problems)

    const { selected, addons } = await closure(pack, mainLibrary.library, content)
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
        await writer.appendZip(pack.archiveOf(part), { filter: (entry) => !entry.directory && entry.filename.startsWith(`${part.folder}/`) })
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
    await copyFile(final, output, constants.COPYFILE_EXCL).catch((error) => {
      throw error?.code === 'EEXIST' ? exists(output) : error
    })
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
