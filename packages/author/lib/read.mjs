import { composePackage, sourceOf, typeNames } from './build.mjs'
import { checkContent, layoutContext, valueAt } from './check.mjs'
import { ContentGenerator, librariesIn } from './generator.mjs'
import { loadLibraries } from './libraries.mjs'
import { MediaStore, writtenCopyright } from './media.mjs'
import { CC_VERSIONS, LICENSES, ROLES } from './metadata.mjs'
import { SourceError } from './source-error.mjs'
import { sourceSchema } from './source-schema.mjs'
import { hasMarkup, wrapText } from './text.mjs'
import { LAYOUTS, placesOf } from './types.mjs'

/**
 * A package read back into a source (#236): the source a build would take to make the package
 * again, to change it and build it again. Its own fields come from `h5p.json`; its parameters from
 * `content.json`, less what a build fills in, by the generator's own rule walked back
 * (`ContentGenerator.written`) and the layouts' `read`. The source is then built in memory, and a
 * value that comes back otherwise is written as stored. No Node import of its own: the package's
 * files are read by the caller and the pack is handed in, as a build's are.
 */

/**
 * @typedef {import('./build.mjs').Source} Source
 * @typedef {import('./build.mjs').Problem} Problem
 * @typedef {{ source: Source, files: string[], notes: Problem[] }} ReadContent
 *   `files`, the package's media the source names, by their paths in its `content/` folder, as
 *   the source names them; `notes`, what was left out or could not be read back as it is
 */

/** @param {unknown} value @returns {value is Record<string, any>} */
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** What `h5p.json` may hold that a source has no field for. */
const UNWRITTEN = /** @type {const} */ ({
  authorComments: 'the author\'s comments',
  changes: 'the change log',
  licenseExtras: 'the licence\'s extra terms',
  a11yTitle: 'the title for screen readers'
})

/** What a part's metadata may say of its own, where a build gives every part the source's. */
const OWN_METADATA = ['license', 'licenseVersion', 'authors', 'source', 'yearFrom', 'yearTo', 'changes', 'authorComments', 'licenseExtras']

/** Whether a value says something: not empty text, an empty list or nothing. @param {unknown} value */
const says = (value) => value !== undefined && value !== null && !(typeof value === 'string' && !value.trim()) && !(Array.isArray(value) && !value.length)

/**
 * The media a build of the read source is given: each file as the package stores it, found by the
 * path the source names it by, its copyright as a build makes one. Nothing is read: the check
 * compares content, and the files' bytes are the package's.
 * @extends {MediaStore<never>}
 */
class SavedMedia extends MediaStore {
  /** @param {Map<string, Record<string, any>>} saved the files the content names, by path */
  constructor(saved) {
    super({
      what: 'a file in the package',
      name: (source) => source,
      local: async () => ({ missing: 'is not read here' }),
      keep: async () => { throw new Error('nothing is downloaded here') },
      open: async () => { throw new Error('nothing is opened here') }
    })
    this.saved = saved
  }

  /**
   * @param {any} field
   * @param {{ path: string, copyright?: any }} value as the source writes it
   * @param {string} at
   * @param {(path: string, message: string) => void} report
   * @returns {Promise<Record<string, unknown>>}
   */
  async resolve(field, value, at, report) {
    const stored = { ...(this.saved.get(value.path) ?? { path: value.path }) }
    delete stored.copyright
    return { ...stored, copyright: this.copyright(value.copyright, `${at}.copyright`, report) }
  }
}

/**
 * A package's content and metadata read back into a source.
 * @param {import('./pack.mjs').Pack} pack the pack a build of the source would use
 * @param {{ manifest: unknown, content: unknown }} saved the package's `h5p.json` and
 *   `content/content.json`, parsed
 * @returns {Promise<ReadContent>}
 * @throws {Error} where the package names no main library, or its content is for other versions
 *   of its libraries than the pack's
 */
export async function readContent(pack, { manifest, content }) {
  if (!isObject(manifest)) throw new Error('h5p.json is not an object')
  if (!isObject(content)) throw new Error('content/content.json is not an object')
  const main = typeof manifest.mainLibrary === 'string' ? manifest.mainLibrary : ''
  const named = (Array.isArray(manifest.preloadedDependencies) ? manifest.preloadedDependencies : [])
    .find((/** @type {unknown} */ each) => isObject(each) && each.machineName === main)
  if (!main || !named || !/^\d+$/.test(String(named.majorVersion)) || !/^\d+$/.test(String(named.minorVersion))) {
    throw new Error('h5p.json names no main library with its version: it is not an H5P package')
  }
  const type = `${main} ${Number(named.majorVersion)}.${Number(named.minorVersion)}`

  // The pack's versions only. A build makes content for those, and content for another minor is
  // moved to the pack's by the library's own upgrade, which H5P runs as it plays or opens it.
  /** @type {string[]} */
  const other = []
  for (const library of new Set([type, ...librariesIn(content)])) {
    const [machineName, version] = library.split(' ')
    const [major, minor] = version.split('.').map(Number)
    const entry = pack.newest(machineName, major)
    if (!entry) other.push(`${library}, of which the pack has no ${major}.x`)
    else if (entry.minorVersion !== minor) other.push(`${library}, where the pack has ${major}.${entry.minorVersion}`)
  }
  if (other.length) {
    throw new Error(`This package's content is made for other versions of its libraries than the library pack has: ${other.join('; ')}. A read takes content made for the pack's versions. H5P moves content to a newer version as it plays it, so the package, saved again on a site that has the pack's versions, reads.`)
  }

  /** @type {Problem[]} */
  const notes = []
  const note = (/** @type {string} */ path, /** @type {string} */ message) => notes.push({ path, message })

  // The content's language: H5P's strings follow `defaultLanguage`, and the metadata's is `language`.
  const tags = [manifest.defaultLanguage, manifest.language].filter((each) => typeof each === 'string' && each.trim())
  const language = tags.find((each) => sourceSchema.shape.language.safeParse(each).success) ?? 'en'
  if (!tags.includes(language)) note('language', tags.length ? `${JSON.stringify(tags[0])} is no language tag a source takes: written as "en"` : 'is not in h5p.json: written as "en"')
  else if (tags.length === 2 && tags[0] !== tags[1]) note('language', `is the content's, ${tags[0]}; h5p.json gives the metadata ${tags[1]}, and a source has one language for both`)

  const libraries = await loadLibraries(pack, { type, language, params: content })
  const checked = checkContent(libraries, { type, params: content })
  // What the content holds beside its fields is not read. Any other problem of the content as
  // saved, a build of the source asks about, below.
  for (const { path, message } of checked.problems) {
    if (/^is not (?:a field here|part of)/.test(message)) note(path, 'is no field of its content type: left out')
  }

  const generator = new ContentGenerator(libraries.entries)
  const params = generator.written(libraries.main, checked.params)
  for (const { path, message } of generator.notes) note(path, message)
  const layout = layoutContext(libraries.entries, () => {}, () => {})
  for (const place of placesOf(main, params)) LAYOUTS[place.library]?.read?.(place.params, place.path, layout(place.library))

  const source = /** @type {Source} */ ({ type: main, ...ownFields(manifest, language, note), params })
  partsMetadata(checked.params, source, note)

  // Built again in memory, the package's files standing for themselves: a value that comes back
  // otherwise is written as stored, where it is a value a source writes as stored.
  const saved = new Map(generator.stored.map((file) => [String(file.path), file]))
  const read = sourceOf(source, typeNames(pack))
  for (const { path, message } of read.problems) note(path, message)
  for (let round = 0; round < 2; round++) {
    let built
    try {
      built = await composePackage(read.source, pack, new SavedMedia(saved), [])
    } catch (error) {
      if (!(error instanceof SourceError)) throw error
      for (const { path, message } of error.problems) note(path, `${message}: a build of this source asks for it`)
      break
    }
    // A list H5P's editor started for nobody is left out of the source: it is what a build makes.
    for (const path of generator.unfilled) setAt(checked.params, path, valueAt(built.content, path))
    const differ = differences(built.content, checked.params, new Set(generator.stored))
    if (!differ.length) break
    const left = []
    for (const path of differ) {
      const value = valueAt(checked.params, path)
      // A text, a number, a flag or a title: written as stored. Anything else is said.
      if (round === 0 && value !== undefined && (value === null || typeof value !== 'object')) setAt(params, path, value)
      else left.push(path)
    }
    if (left.length || round === 1) {
      for (const path of round === 1 ? differ : left) note(path, 'reads back otherwise: a build of this source writes it differently from the package')
      break
    }
  }

  const files = [...new Set(generator.stored.map((file) => String(file.path)))].filter((path) => !/^[a-z][a-z0-9+.-]*:/i.test(path))
  return { source, files, notes }
}

/**
 * A source's own fields from `h5p.json`, as a build takes them, and a note of what a source has no
 * field for, or what is not in a form it takes.
 * @param {Record<string, any>} manifest
 * @param {string} language
 * @param {(path: string, message: string) => void} note
 */
function ownFields(manifest, language, note) {
  const title = typeof manifest.title === 'string' && manifest.title.trim() ? manifest.title : 'Untitled'
  if (title === 'Untitled' && manifest.title !== 'Untitled') note('title', 'is not in h5p.json: written as "Untitled"')
  const license = LICENSES.includes(manifest.license) ? manifest.license : 'U'
  if (says(manifest.license) && license !== manifest.license) note('license', `${JSON.stringify(manifest.license)} is no licence H5P names: written as "U"`)
  const versioned = license.startsWith('CC BY') && CC_VERSIONS.includes(manifest.licenseVersion)
  if (says(manifest.licenseVersion) && !versioned) note('licenseVersion', `${JSON.stringify(manifest.licenseVersion)} is no version a source takes, which writes one for a CC BY licence only, as ${CC_VERSIONS.join(', ')}: left out`)
  /** @type {{ name: string, role: string }[]} */
  const authors = []
  const listed = Array.isArray(manifest.authors) ? manifest.authors : []
  for (const [i, author] of listed.entries()) {
    if (!isObject(author) || typeof author.name !== 'string' || !author.name.trim()) {
      note(`authors[${i}]`, 'is no author with a name: left out')
      continue
    }
    const role = ROLES.includes(author.role) ? author.role : 'Author'
    if (says(author.role) && role !== author.role) note(`authors[${i}].role`, `${JSON.stringify(author.role)} is no role H5P names: written as "Author"`)
    authors.push({ name: author.name, role })
  }
  if (!authors.length) {
    authors.push({ name: 'Unknown', role: 'Author' })
    const why = manifest.authors === undefined || manifest.authors === null ? 'are not in h5p.json'
      : !Array.isArray(manifest.authors) ? 'are not a list'
        : listed.length ? 'have no name among them' : 'are an empty list'
    note('authors', `${why}: written as "Unknown", since a source names one`)
  }
  /** @type {Record<string, unknown>} */
  const own = { title, language, license, ...(versioned ? { licenseVersion: manifest.licenseVersion } : {}), authors }
  if (typeof manifest.source === 'string' && sourceSchema.shape.source.safeParse(manifest.source).success) own.source = manifest.source
  else if (says(manifest.source)) note('source', `${JSON.stringify(manifest.source)} is no web address: left out`)
  for (const key of /** @type {const} */ (['yearFrom', 'yearTo'])) {
    const year = typeof manifest[key] === 'string' && /^\s*\d+\s*$/.test(manifest[key]) ? Number(manifest[key]) : manifest[key]
    if (Number.isInteger(year)) own[key] = year
    else if (says(manifest[key])) note(key, `${JSON.stringify(manifest[key])} is no year: left out`)
  }
  for (const [key, what] of Object.entries(UNWRITTEN)) {
    if (says(manifest[key])) note(key, `is ${what}, which a source has no field for: left out`)
  }
  return own
}

/**
 * A note of the parts whose metadata says something of its own, a licence or authors, which a
 * build replaces with the source's. One that says nothing, the licence "U" and no authors as H5P's
 * editor saves a part, is not named.
 * @param {Record<string, any>} params as checked
 * @param {Source} source
 * @param {(path: string, message: string) => void} note
 */
function partsMetadata(params, source, note) {
  /** @type {string[]} */
  const parts = []
  /** @param {unknown} value @param {string} path */
  const walk = (value, path) => {
    if (Array.isArray(value)) value.forEach((each, i) => walk(each, `${path}[${i}]`))
    else if (isObject(value)) {
      if (typeof value.library === 'string' && isObject(value.metadata) && ownMetadata(value.metadata, source)) parts.push(`${path}.metadata`)
      for (const [key, each] of Object.entries(value)) walk(each, `${path}.${key}`)
    }
  }
  walk(params, 'params')
  if (!parts.length) return
  const shown = parts.slice(0, 3).join(', ')
  note(parts[0], `${parts.length === 1 ? 'is a part\'s metadata' : `and ${parts.length - 1} more are parts' metadata`} with a licence, authors or more of their own, which a source has no field for: a build gives every part the source's${parts.length > 1 ? ` (${shown}${parts.length > 3 ? ', …' : ''})` : ''}`)
}

/**
 * Whether a part's metadata says something of its own that the source does not.
 * @param {Record<string, any>} metadata
 * @param {Source} source
 */
function ownMetadata(metadata, source) {
  return OWN_METADATA.some((key) => {
    const value = metadata[key]
    if (!says(value)) return false
    if (key === 'license') return value !== 'U' && value !== source.license
    if (key === 'licenseVersion') return value !== source.licenseVersion
    // Anything but a list of authors says something of its own too, if not in a form a build takes.
    if (key === 'authors') return !Array.isArray(value) || JSON.stringify(value.map((/** @type {any} */ author) => [author?.name, author?.role])) !== JSON.stringify(source.authors.map((author) => [author.name, author.role]))
    return true
  })
}

/**
 * The paths at which content built from the read source is not the package's: equal but for each
 * part's id and the metadata a build gives it, its title apart, and a file's bytes, which are the
 * package's own.
 * @param {unknown} built
 * @param {unknown} saved
 * @param {Set<unknown>} files the saved content's files, as the generator collected them
 * @param {string} [path]
 * @param {string[]} [found]
 * @returns {string[]}
 */
function differences(built, saved, files, path = 'params', found = []) {
  if (Array.isArray(built) && Array.isArray(saved) && built.length === saved.length) {
    built.forEach((each, i) => differences(each, saved[i], files, `${path}[${i}]`, found))
  } else if (isObject(built) && isObject(saved)) {
    if (files.has(saved)) {
      if (built.path !== saved.path || copyrightOf(built.copyright) !== copyrightOf(saved.copyright)) found.push(path)
      return found
    }
    const part = typeof saved.library === 'string'
    for (const key of new Set([...Object.keys(built), ...Object.keys(saved)])) {
      if (key === 'subContentId') continue
      if (part && key === 'metadata') {
        // A part saved without a title, as older content is, gets its content type's from a build.
        if (isObject(saved.metadata) && saved.metadata.title !== undefined && built.metadata?.title !== saved.metadata.title) found.push(`${path}.metadata.title`)
        continue
      }
      differences(built[key], saved[key], files, `${path}.${key}`, found)
    }
  } else if (!Object.is(built, saved) && !sameText(built, saved)) found.push(path)
  return found
}

/**
 * A file's copyright as a source writes it, for comparing: its parts in one order, H5P's editor
 * saving them in its own, and a licence left out being the "U" a build gives.
 * @param {unknown} copyright
 */
function copyrightOf(copyright) {
  const written = writtenCopyright(copyright)
  return written ? JSON.stringify(Object.entries({ license: 'U', ...written }).sort()) : ''
}

/**
 * Whether a built text is the saved one as an author would write it: an empty text where nothing
 * is built, as H5P's editor saves a field nobody typed in; and text without markup in a markup
 * field, which a build wraps as the editor wraps typing, where a package made elsewhere kept it
 * bare. A learner sees the same.
 * @param {unknown} built
 * @param {unknown} saved
 */
function sameText(built, saved) {
  if (built === undefined) return saved === ''
  if (typeof built !== 'string' || typeof saved !== 'string' || hasMarkup(saved)) return false
  return built === wrapText(saved, 'p') || built === wrapText(saved, 'div')
}

/**
 * Sets a value at a content path in a source's parameters, which are in the same shape, making
 * the objects on the way that a source left out.
 * @param {Record<string, any>} params
 * @param {string} path `params.a[0].b`
 * @param {unknown} value
 */
function setAt(params, path, value) {
  const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.').slice(1)
  /** @type {any} */
  let at = params
  keys.forEach((key, i) => {
    if (i === keys.length - 1) at[key] = value
    else {
      if (at[key] === undefined || at[key] === null) at[key] = /^\d+$/.test(keys[i + 1]) ? [] : {}
      at = at[key]
    }
  })
}
