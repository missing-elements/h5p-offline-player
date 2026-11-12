import { TextReader } from '@zip.js/zip.js'
import { librariesNamedIn, planPack } from '@missing-elements/h5p-offline-player/plan'
import { checkContent, layoutContext, valueAt } from './check.mjs'
import { ContentGenerator, libraryString } from './generator.mjs'
import { installClosure } from './install.mjs'
import { loadLibraries } from './libraries.mjs'
import { CC_VERSIONS, LICENSES, ROLES } from './metadata.mjs'
import { machineNameOf, NAMING_KEYS, namingKey, nearestNames } from './names.mjs'
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

/** A source's fields. */
const FIELDS = ['type', 'title', 'language', 'license', 'licenseVersion', 'authors', 'source', 'yearFrom', 'yearTo', 'params']
/** Those a source says of itself, which H5P keeps in an object of their own, `metadata`. */
const OWN = FIELDS.filter((name) => name !== 'type' && name !== 'params')

/**
 * The machine names a source's `type` may be: the pack's libraries but those carried only for an
 * H5P site's upload check. Which of them are content types the index does not say; the build does.
 * @param {import('./pack.mjs').Pack} pack
 * @returns {string[]}
 * @internal
 */
export const typeNames = (pack) => [...new Set(pack.libraries.filter((entry) => !entry.installOnly).map((entry) => entry.machineName))]

/**
 * A source read for a build: its own fields checked, and what it plainly means taken where it is
 * written another way, so that its content is checked in the same build (#174). A chat with no
 * skill beside it writes a source's outer shape its own way, and each of these cost it a round in
 * which nothing inside was looked at:
 *
 * - the content type under another key, `contentType` or `library`, or named loosely as `type`,
 *   "interactive-book", which only `names` can tell;
 * - the title, language, licence and authors in `metadata`, where H5P keeps them;
 * - the content's fields beside `type`, with no `params` around them.
 *
 * Each is a problem, said once with what to write. `typed` is whether the content type is known,
 * and so whether the content can be checked: `source` then stands for the source as it would be
 * written right, with a stand-in for what is missing, and is not for building while `problems`
 * has any.
 * @param {unknown} input
 * @param {string[]} [names] the machine names `type` may be, to tell a name written loosely
 * @returns {{ source: Source, problems: Problem[], typed: boolean }}
 * @internal
 */
export function sourceOf(input, names) {
  if (isObject(input) && 'kind' in input) {
    const problems = quizProblems(input)
    if (problems.length) throw new SourceError(problems)
    return { source: /** @type {Source} */ (quizSource(/** @type {import('./quiz.mjs').Quiz} */ (input))), problems: [], typed: true }
  }
  /** @type {Problem[]} */
  const problems = []
  const report = (/** @type {string} */ path, /** @type {string} */ message) => problems.push({ path, message })
  if (!isObject(input)) throw new SourceError([{ path: 'source', message: 'expected an object: { "type", "title", "language", "license", "authors", "params" }' }])
  const fields = `the fields are ${FIELDS.join(', ')}`
  /** @type {Record<string, any>} what is written for each field */
  const given = Object.fromEntries(FIELDS.filter((name) => input[name] !== undefined).map((name) => [name, input[name]]))
  /** @type {Record<string, string>} where each is written */
  const at = Object.fromEntries(FIELDS.map((name) => [name, name]))
  let rest = Object.keys(input).filter((key) => !FIELDS.includes(key))

  // The content type under another key, `contentType` or `library`: the one that names one.
  let named = ''
  if (given.type === undefined) {
    const others = Object.fromEntries(rest.map((key) => [key, input[key]]))
    const keys = names ? [] : rest.filter((key) => NAMING_KEYS.includes(key) && typeof input[key] === 'string' && input[key].length <= 64 && /^\s*H5P\.[^\s.]+(?:\s+\d+\.\d+)?\s*$/.test(input[key]))
    const found = names ? namingKey(others, names) : keys.length === 1 ? { key: keys[0], machineName: input[keys[0]].trim().split(/\s+/)[0] } : null
    if (found) {
      named = found.machineName
      report(found.key, `is not a field of a source: the content type is its type: write "type": "${named}"`)
      given.type = named
      rest = rest.filter((each) => each !== found.key)
    }
  }
  // What a source says of itself, in an object of its own: `metadata`, as H5P keeps it. Only
  // there, since a field of the content, Question Set's `introPage`, may have a title too.
  const value = rest.includes('metadata') && isObject(input.metadata) ? input.metadata : null
  const own = value ? OWN.filter((name) => given[name] === undefined && value[name] !== undefined) : []
  if (value && own.length) {
    report('metadata', `is not a field of a source: ${own.join(', ')} ${own.length === 1 ? 'is' : 'are'} written beside type, not in an object: write ${own.map((name) => `"${name}": …`).join(', ')} at the top`)
    for (const name of own) {
      given[name] = value[name]
      at[name] = `metadata.${name}`
    }
    for (const inner of Object.keys(value)) {
      if (!own.includes(inner)) report(`metadata.${inner}`, OWN.includes(inner) ? 'is written beside type already' : `is not a field of a source; ${fields}`)
    }
    rest = rest.filter((each) => each !== 'metadata')
  }
  // The content's fields beside `type`.
  if (rest.length && given.params === undefined) {
    report('params', `is not written: the content's fields go in it, not beside type: write "params": { ${rest.map((key) => `"${key}": …`).join(', ')} }`)
    given.params = Object.fromEntries(rest.map((key) => [key, input[key]]))
  } else for (const key of rest) report(key, `is not a field of a source; ${fields}`)

  let typed = false
  const type = typeof given.type === 'string' ? given.type.trim() : ''
  if (named) typed = true
  else if (!type) report(at.type, 'expected a content type\'s machine name, such as "H5P.Blanks"')
  else if (names) {
    const found = machineNameOf(type, names)
    if (!found) {
      const nearest = nearestNames(type, names)
      report(at.type, `the library pack has no content type ${type}${nearest.length ? `; nearest: ${nearest.join(', ')}` : ''}`)
    } else {
      typed = true
      // checkContent takes a version, as saved content names one; a build takes the pack's newest.
      if (found.exact && /\s/.test(type)) report(at.type, `takes the machine name alone, "${found.machineName}": the version is the pack's newest`)
      else if (!found.exact) report(at.type, `takes the machine name, "${found.machineName}"`)
      given.type = found.machineName
    }
  } else if (/^\S+\s+\d+\.\d+$/.test(type)) {
    const [name] = type.split(/\s/)
    report(at.type, `takes the machine name alone, "${name}": the version is the pack's newest`)
    given.type = name
    typed = true
  } else if (!/^\S+$/.test(type)) report(at.type, 'expected a content type\'s machine name, such as "H5P.Blanks"')
  else typed = true

  /** @type {Record<string, any>} */
  const source = { type: typed ? String(given.type).trim() : '', title: '', language: 'en', license: 'U', authors: [], params: {} }
  if (typeof given.title !== 'string' || !given.title.trim()) report(at.title, 'expected the activity\'s title')
  else if (given.title.length > 255) report(at.title, 'takes at most 255 characters')
  else source.title = given.title
  let tag = typeof given.language === 'string'
  try {
    if (tag) Intl.getCanonicalLocales(given.language)
  } catch {
    tag = false
  }
  if (tag) source.language = given.language
  else report(at.language, 'expected a BCP 47 language tag, such as "en" or "de-AT"')
  // A licence written with its version, "CC BY 4.0", as it is spoken of: H5P keeps the version in
  // a field of its own. The names alone, which this problem used to list, had a chat drop the
  // version to fit them.
  const versioned = typeof given.license === 'string' ? /^CC[ -](BY(?:-(?:NC-SA|NC-ND|NC|ND|SA))?)[ -]v?(\d\.\d)$/i.exec(given.license.trim()) : null
  const license = versioned ? `CC ${versioned[1].toUpperCase()}` : given.license
  if (LICENSES.includes(given.license)) source.license = given.license
  else if (versioned) {
    const written = JSON.stringify(given.license)
    if (given.licenseVersion !== undefined) report(at.license, `${written} holds the version too, which licenseVersion names: write "license": "${license}"`)
    else if (CC_VERSIONS.includes(versioned[2])) report(at.license, `${written} holds the version too: write "license": "${license}" and "licenseVersion": "${versioned[2]}"`)
    else report(at.license, `${written} holds a version too: write "license": "${license}" and "licenseVersion", one of ${CC_VERSIONS.join(', ')}`)
    source.license = license
    if (given.licenseVersion === undefined && CC_VERSIONS.includes(versioned[2])) source.licenseVersion = versioned[2]
  } else report(at.license, `use one of ${LICENSES.map((each) => JSON.stringify(each)).join(', ')}; "U" when it is not known`)
  if (given.licenseVersion !== undefined) {
    if (!String(license).startsWith('CC ') || license === 'CC0 1.0' || license === 'CC PDM') report(at.licenseVersion, 'is for a Creative Commons BY licence only')
    else if (!CC_VERSIONS.includes(given.licenseVersion)) report(at.licenseVersion, `use one of ${CC_VERSIONS.join(', ')}`)
    else source.licenseVersion = given.licenseVersion
  }
  if (!Array.isArray(given.authors) || !given.authors.length) report(at.authors, 'name at least one author: [{ "name": "…", "role": "Author" }]')
  else given.authors.forEach((/** @type {unknown} */ author, /** @type {number} */ i) => {
    const before = problems.length
    if (!isObject(author) || typeof author.name !== 'string' || !author.name.trim()) report(`${at.authors}[${i}].name`, 'expected the author\'s name')
    else if (!ROLES.includes(author.role)) report(`${at.authors}[${i}].role`, `use one of ${ROLES.join(', ')}`)
    else for (const key of Object.keys(author)) if (key !== 'name' && key !== 'role') report(`${at.authors}[${i}].${key}`, 'is not part of an author; write name and role')
    if (problems.length === before) source.authors.push(author)
  })
  if (given.source !== undefined && (typeof given.source !== 'string' || !/^https?:\/\/\S+$/i.test(given.source))) report(at.source, 'expected the address the content comes from')
  else if (given.source !== undefined) source.source = given.source
  for (const key of ['yearFrom', 'yearTo']) {
    if (given[key] !== undefined && !Number.isInteger(given[key])) report(at[key], 'expected a year')
    else if (given[key] !== undefined) source[key] = given[key]
  }
  if (given.params !== undefined && !isObject(given.params)) report('params', 'expected an object of the content type\'s fields')
  else if (given.params !== undefined) source.params = given.params
  return { source: /** @type {Source} */ (source), problems, typed }
}

/**
 * The general source checked for its own fields; a quiz in the published format mapped onto it.
 * @param {unknown} input
 * @returns {Source}
 * @throws {SourceError} with every problem of its own fields
 * @internal
 */
export function readSource(input) {
  const { source, problems } = sourceOf(input)
  if (problems.length) throw new SourceError(problems)
  return source
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
 * @param {Source} source as `readSource` returned it, or `sourceOf` with its content type known
 * @param {import('./pack.mjs').Pack} pack
 * @param {import('./media.mjs').MediaStore<F>} media
 * @param {Problem[]} [said] the problems `sourceOf` found in the source's own fields, which come
 *   first among the content's: all of them in one round (#174)
 * @returns {Promise<{ manifest: Record<string, unknown>, content: Record<string, unknown>, selected: Map<string, import('./pack.mjs').PartLibrary>, install: Map<string, import('./pack.mjs').PartLibrary>, translations: TranslationReport[], notes: Problem[] }>}
 *   `selected`, the libraries the package plays with; `install`, those an H5P site's upload check wants with them
 * @internal
 */
export async function composePackage(source, pack, media, said = []) {
  /** @type {Problem[]} */
  const problems = []
  /** @type {Problem[]} */
  const notes = []
  const report = (/** @type {string} */ path, /** @type {string} */ message) => problems.push({ path, message })
  const note = (/** @type {string} */ path, /** @type {string} */ message) => notes.push({ path, message })
  const { entries, main: mainLibrary, translations } = await loadLibraries(pack, source).catch((error) => {
    throw error instanceof SourceError ? new SourceError([...said, ...error.problems]) : error
  })
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
  // Since #172 it is named by where the source has it, which is another place than the content's
  // for what the generator moved to its field; such a move is a problem of the source's, but
  // nothing was refused there, so what the check finds inside it is added like any other. And
  // what it says of a list an item of which was refused, or of anything in one, is left out: the
  // list it counted is shorter than the one written, its items at other indices, so a book whose
  // chapters were all refused had "0 items" besides.
  const checked = checkContent({ entries, main: mainLibrary, translations }, { type: libraryString(mainLibrary.library), params: generated })
  const fromSource = [...problems]
  const moves = new Set(generator.moved.map(({ from }) => from))
  const inSource = (/** @type {string} */ path) => generator.moved.reduce((at, { from, to }) => at === to || inside(at, to) ? from + at.slice(to.length) : at, path)
  const shortened = (/** @type {string} */ path) => generator.shortened.some((list) => path === list || inside(path, list))
  for (const { path: inContent, message } of checked.problems) {
    const path = inSource(inContent)
    const known = fromSource.some((problem) => problem.path === path || (inside(path, problem.path) && !moves.has(problem.path)) ||
      (inside(problem.path, path) && valueAt(checked.params, inContent) === undefined))
    if (!known && !shortened(path)) problems.push({ path, message })
  }
  for (const added of checked.notes) if (!notes.some(({ path, message }) => path === added.path && message === added.message)) notes.push(added)
  if (said.length || problems.length) throw new SourceError([...said, ...problems])
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
 * libraries it plays with, each part's own files copied as they are, the content, the media
 * `media` writes, then the libraries an H5P site's upload check wants, which nothing reads as the
 * package plays: on a host without `Range` the frame boots and the media arrive before them. A
 * page's build writes the package once, so the order is this one; Node's has the normalizer keep
 * it (`last`) as it moves an mp4's index first.
 * @param {import('@zip.js/zip.js').ZipWriter<unknown>} writer
 * @param {{ manifest: Record<string, unknown>, content: Record<string, unknown>, selected: Map<string, import('./pack.mjs').PartLibrary>, install: Map<string, import('./pack.mjs').PartLibrary> }} built
 * @param {import('./pack.mjs').Pack} pack
 * @param {() => Promise<void>} media adds the media to `writer`
 * @internal
 */
export async function writePackage(writer, { manifest, content, selected, install }, pack, media) {
  /** @param {import('./pack.mjs').PartLibrary} part */
  const copy = (part) => writer.appendZip(pack.archiveOf(part), { filter: (entry) => !entry.directory && entry.filename.startsWith(`${part.folder}/`) })
  await writer.add('h5p.json', new TextReader(JSON.stringify(manifest)))
  for (const part of selected.values()) await copy(part)
  await writer.add('content/content.json', new TextReader(JSON.stringify(content)))
  await media()
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
