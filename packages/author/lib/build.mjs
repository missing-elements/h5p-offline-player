import { TextReader } from '@zip.js/zip.js'
import { librariesNamedIn, planPack } from '@missing-elements/h5p-offline-player/plan'
import { checkContent, layoutContext, valueAt } from './check.mjs'
import { ContentGenerator, libraryString } from './generator.mjs'
import { installClosure } from './install.mjs'
import { loadLibraries } from './libraries.mjs'
import { CC_VERSIONS, LICENSES, ROLES } from './metadata.mjs'
import { quizProblems, quizSource } from './quiz.mjs'
import { SourceError } from './source-error.mjs'
import { escapeText } from './text.mjs'
import { LAYOUTS, placesOf } from './types.mjs'

export { SourceError }

/**
 * A source made a package: validated, filled in from the pack's semantics and translations,
 * its media copied and described, checked as saved content is and laid out, and written with the
 * libraries it needs, each part checked against the pack's index. Nothing is written unless all of
 * it is right: every problem the source has is listed at once, each by its path, so a fix takes one
 * round. All of it but where the files are and where the package goes is the same in Node
 * (`node.mjs`) and in a page (`browser.mjs`), and is here.
 */

/**
 * @typedef {{ name: string, role: string }} Author
 * @typedef {{
 *   type: string, title: string, language: string, license: string, licenseVersion?: string,
 *   authors: Author[], source?: string, yearFrom?: number, yearTo?: number, params: Record<string, unknown>
 * }} Source a package's source: the content type, its metadata, and the parameters that differ from the defaults
 * @typedef {{ path: string, message: string }} Problem
 * @typedef {import('./translate.mjs').TranslationReport} TranslationReport
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
  // Planned without the parameters, nothing matches an addon's pattern: what they add are the
  // addons, and of what they add, the addons alone, not what an addon would need in turn.
  const plain = new Set(plan(undefined).map((entry) => entry.folder))
  const addons = planned.filter((entry) => entry.addTo !== undefined && !plain.has(entry.folder)).map((entry) => `${entry.machineName} ${entry.majorVersion}.${entry.minorVersion}`)
  return { selected, addons }
}

/**
 * A source made what a package holds, its media resolved through `media`: the manifest, the content,
 * the libraries' parts in the order the package lists them, and what is worth telling. Nothing is
 * written: the caller writes the package (`writePackage`) and its media.
 * @template F
 * @param {Source} source as `readSource` returned it
 * @param {import('./pack.mjs').Pack} pack
 * @param {import('./media.mjs').MediaStore<F>} media
 * @returns {Promise<{ manifest: Record<string, unknown>, content: Record<string, unknown>, selected: Map<string, import('./pack.mjs').PartLibrary>, install: Map<string, import('./pack.mjs').PartLibrary>, translations: TranslationReport[], notes: Problem[] }>}
 *   `selected`, the libraries the package plays with; `install`, those an H5P site's upload check wants with them
 * @internal
 */
export async function composePackage(source, pack, media) {
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

  // Layouts that turn what a source writes into what H5P stores, before it is generated.
  const layout = layoutContext(entries, report, note)
  const written = structuredClone(source.params)
  for (const place of placesOf(main, written)) LAYOUTS[place.library]?.before?.(place.params, place.path, layout(place.library))

  const generated = generator.generate(mainLibrary, written)
  problems.push(...generator.problems)
  notes.push(...generator.notes)

  // Media: copied, described, put in place of what was written.
  for (const { field, value, path } of generator.media) {
    const resolved = await media.resolve(field, value, path, report)
    for (const key of Object.keys(value)) delete value[key]
    Object.assign(value, resolved)
  }

  // Checked last as saved content is, as a tool that changes a package checks it: the layouts set
  // what the editor's widgets set and check what they would not let pass. Where the source has a
  // problem already, the check finds the same one again, or the gap it left: a value missing
  // where the generator refused what was written inside it. Only what it finds elsewhere is added.
  const checked = checkContent({ entries, main: mainLibrary, translations }, { type: libraryString(mainLibrary.library), params: generated })
  const fromSource = [...problems]
  const known = (/** @type {Problem} */ problem) => fromSource.some(({ path }) => path === problem.path || inside(problem.path, path) ||
    (inside(path, problem.path) && valueAt(checked.params, problem.path) === undefined))
  for (const problem of checked.problems) if (!known(problem)) problems.push(problem)
  for (const added of checked.notes) if (!notes.some(({ path, message }) => path === added.path && message === added.message)) notes.push(added)
  if (problems.length) throw new SourceError(problems)
  const content = checked.params

  const { selected, addons } = await closure(pack, mainLibrary.library, content)
  if (addons.length) notes.push({ path: 'params', message: `its text matches ${addons.join(', ')}, which the package carries, as a site with it installed would add it` })
  // What an H5P site's upload check wants with them, at the exact versions (#146); not in
  // `h5p.json`, which lists what plays, as the platforms' own exports write it.
  const install = await installClosure(pack, selected)

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
  return { manifest, content, selected, install, translations, notes }
}

/**
 * What a package holds but its media, in the order a package streams in: its manifest, the
 * libraries it plays with, each part's own files copied as they are, the content, then the
 * libraries an H5P site's upload check wants, which nothing reads as the package plays, so the
 * frame boots before they arrive on a host without `Range`, unless the normalizer, which a package
 * with media goes through, sorts library folders before the content. The caller adds the media
 * after it, last.
 * @param {import('@zip.js/zip.js').ZipWriter<unknown>} writer
 * @param {{ manifest: Record<string, unknown>, content: Record<string, unknown>, selected: Map<string, import('./pack.mjs').PartLibrary>, install: Map<string, import('./pack.mjs').PartLibrary> }} built
 * @param {import('./pack.mjs').Pack} pack
 * @internal
 */
export async function writePackage(writer, { manifest, content, selected, install }, pack) {
  /** @param {import('./pack.mjs').PartLibrary} part */
  const copy = (part) => writer.appendZip(pack.archiveOf(part), { filter: (entry) => !entry.directory && entry.filename.startsWith(`${part.folder}/`) })
  await writer.add('h5p.json', new TextReader(JSON.stringify(manifest)))
  for (const part of selected.values()) await copy(part)
  await writer.add('content/content.json', new TextReader(JSON.stringify(content)))
  for (const part of install.values()) await copy(part)
}

/**
 * Whether a path lies inside another: `params.a[0].b` inside `params.a`.
 * @param {string} inner
 * @param {string} outer
 */
function inside(inner, outer) {
  return inner.startsWith(`${outer}.`) || inner.startsWith(`${outer}[`)
}
