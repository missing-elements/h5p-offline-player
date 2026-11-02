import { TextWriter, Uint8ArrayReader, ZipReader } from '@zip.js/zip.js'

/**
 * The library pack a build takes its libraries from: by default, in Node, the one this package was
 * released with, `@missing-elements/h5p-libraries` at the version it pins; a copy of its `parts/`
 * folder; or, in a page, the parts the page can reach. Its index says each library's version,
 * dependencies and part; a part is opened only when a build needs that library, read whole and
 * checked against the index's SHA-256 first, so a damaged or altered part is never read, let alone
 * copied into a package. How a part's bytes are reached is the environment's: `node.mjs` reads them
 * from disk, `browser.mjs` fetches them. The largest part, MathDisplay's, is 2.8 MB.
 */

/**
 * @typedef {{
 *   folder: string, machineName: string, majorVersion: number, minorVersion: number, patchVersion: number,
 *   preloadedDependencies?: { machineName: string, majorVersion: number, minorVersion: number }[],
 *   addTo?: any, size: number, sha256: string, url: string
 * }} IndexEntry
 */

/**
 * A library whose part has been opened: what the generator reads (`folder`, `library`,
 * `semantics`), its record in the index, and the names of its translation files, which
 * `translation` reads. The part's bytes stay inside the pack, which copies from them for a build.
 * @typedef {{ folder: string, library: any, semantics: any[] | null, index: IndexEntry, translations: string[] }} PartLibrary
 */

/** @param {ArrayBuffer} buffer */
const hex = (buffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')

export class Pack {
  /** @type {Map<string, Promise<PartLibrary>>} */
  #opened = new Map()
  /**
   * Each opened part's bytes, its reader, and its translation files by name.
   * @type {Map<string, { bytes: Uint8Array, reader: ZipReader<unknown>, translations: Map<string, import('@zip.js/zip.js').FileEntry> }>}
   */
  #archives = new Map()
  /** @type {(entry: IndexEntry) => Promise<Uint8Array<ArrayBuffer>>} */
  #read
  /** @type {string} */
  #damaged

  /**
   * @param {IndexEntry[]} libraries
   * @param {(entry: IndexEntry) => Promise<Uint8Array<ArrayBuffer>>} read a part's bytes, from wherever the pack is
   * @param {string} damaged what to do about a part that does not match the index, for the message
   */
  constructor(libraries, read, damaged) {
    this.libraries = libraries
    this.#read = read
    this.#damaged = damaged
  }

  /**
   * The library the pack serves for a machine name, and a major when given: the newest, as the
   * player serves it for any minor of that major.
   * @param {string} machineName
   * @param {number} [major]
   */
  newest(machineName, major) {
    let best = null
    for (const entry of this.libraries) {
      if (entry.machineName !== machineName || (major !== undefined && entry.majorVersion !== major)) continue
      if (!best || entry.majorVersion > best.majorVersion || (entry.majorVersion === best.majorVersion && (entry.minorVersion > best.minorVersion || (entry.minorVersion === best.minorVersion && entry.patchVersion > best.patchVersion)))) best = entry
    }
    return best
  }

  /**
   * A library's part, opened once: checked against the index, then its `library.json`,
   * `semantics.json` and the names of its translations read.
   * @param {IndexEntry} entry
   * @returns {Promise<PartLibrary>}
   */
  open(entry) {
    let opened = this.#opened.get(entry.folder)
    if (!opened) {
      opened = this.#open(entry)
      this.#opened.set(entry.folder, opened)
    }
    return opened
  }

  /**
   * @param {IndexEntry} entry
   * @returns {Promise<PartLibrary>}
   */
  async #open(entry) {
    const bytes = await this.#read(entry)
    if (hex(await crypto.subtle.digest('SHA-256', bytes)) !== entry.sha256) throw new Error(`The library part ${entry.folder} does not match the pack's index (SHA-256): ${this.#damaged}.`)
    const reader = new ZipReader(new Uint8ArrayReader(bytes), { checkSignature: true })
    // Kept before anything is read, so that `close` closes a part that then fails to open.
    /** @type {Map<string, import('@zip.js/zip.js').FileEntry>} */
    const translations = new Map()
    this.#archives.set(entry.folder, { bytes, reader, translations })
    const entries = (await reader.getEntries()).filter((item) => !item.directory && item.filename.startsWith(`${entry.folder}/`))
    /** @param {string} name */
    const json = async (name) => {
      const found = entries.find((item) => item.filename === `${entry.folder}/${name}`)
      return found ? JSON.parse(await /** @type {import('@zip.js/zip.js').FileEntry} */ (found).getData(new TextWriter())) : null
    }
    const library = await json('library.json')
    if (!library) throw new Error(`The library part ${entry.folder} has no library.json`)
    if (library.machineName !== entry.machineName || Number(library.majorVersion) !== entry.majorVersion || Number(library.minorVersion) !== entry.minorVersion || Number(library.patchVersion) !== entry.patchVersion) {
      throw new Error(`The library part ${entry.folder} disagrees with the pack's index`)
    }
    const languages = `${entry.folder}/language/`
    for (const item of entries) {
      if (item.filename.startsWith(languages) && item.filename.endsWith('.json')) {
        translations.set(item.filename.slice(languages.length, -'.json'.length), /** @type {import('@zip.js/zip.js').FileEntry} */ (item))
      }
    }
    return { folder: entry.folder, library, semantics: await json('semantics.json'), index: entry, translations: [...translations.keys()] }
  }

  /**
   * A translation file of an opened library, parsed: its `semantics`.
   * @param {{ folder: string }} part
   * @param {string} name
   */
  async translation(part, name) {
    const file = this.#archives.get(part.folder)?.translations.get(name)
    if (!file) return undefined
    try {
      return JSON.parse(await file.getData(new TextWriter())).semantics
    } catch (error) {
      throw new Error(`The translation ${file.filename} is not JSON`, { cause: error })
    }
  }

  /**
   * The part an opened library came from, as zip.js reads it, for a build to copy its files.
   * @param {{ folder: string }} part
   * @internal
   */
  archiveOf(part) {
    const archive = this.#archives.get(part.folder)
    if (!archive) throw new Error(`The library part ${part.folder} is not open`)
    return new Uint8ArrayReader(archive.bytes)
  }

  /** Every opened part closed, each on its own, so that one that fails to close leaves no other open. */
  async close() {
    await Promise.allSettled(this.#opened.values())
    await Promise.allSettled([...this.#archives.values()].map(({ reader }) => reader.close()))
    this.#archives.clear()
    this.#opened.clear()
  }
}
