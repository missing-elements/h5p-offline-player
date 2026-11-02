import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Reader, TextWriter, ZipReader } from '@zip.js/zip.js'

/**
 * The library pack a build takes its libraries from: by default the one this package was released
 * with, `@missing-elements/h5p-libraries` at the version it pins; or a copy of its `parts/` folder.
 * Its index says each library's version, dependencies and part; a part is opened only when a
 * build needs that library, and checked against the index's SHA-256 first, so a damaged or
 * altered part is never read, let alone copied into a package.
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
 * `translation` reads. The part's file stays inside the pack, which copies from it for a build.
 * @typedef {{ folder: string, library: any, semantics: any[] | null, index: IndexEntry, translations: string[] }} PartLibrary
 */

/**
 * A part read from disk by range: the largest, MathDisplay's, need not be held whole.
 * @extends {Reader<string>}
 */
class PartFile extends Reader {
  /** @param {string} path */
  constructor(path) {
    super(path)
    this.path = path
    /** @type {import('node:fs/promises').FileHandle | null} */
    this.handle = null
  }

  async init() {
    await super.init?.()
    this.handle = await open(this.path, 'r')
    this.size = (await this.handle.stat()).size
  }

  /**
   * A span streamed from disk, which zip.js copies an entry through.
   * @param {{ offset?: number, size?: number }} [span]
   * @returns {ReadableStream<Uint8Array>}
   */
  createReadable({ offset = 0, size = this.size - offset } = {}) {
    if (!size) return new ReadableStream({ start(controller) { controller.close() } })
    return /** @type {ReadableStream<Uint8Array>} */ (Readable.toWeb(createReadStream(this.path, { start: offset, end: offset + size - 1 })))
  }

  /** @param {number} offset @param {number} length */
  async readUint8Array(offset, length) {
    if (!this.handle) throw new Error(`Library part not open: ${this.path}`)
    const bytes = new Uint8Array(length)
    let read = 0
    while (read < length) {
      const { bytesRead } = await this.handle.read(bytes, read, length - read, offset + read)
      if (!bytesRead) throw new Error(`Short read from library part: ${this.path}`)
      read += bytesRead
    }
    return bytes
  }

  async close() {
    await this.handle?.close()
    this.handle = null
  }
}

export class Pack {
  /** @type {Map<string, Promise<PartLibrary>>} */
  #opened = new Map()
  /**
   * Each opened part's file, its reader, and its translation files by name.
   * @type {Map<string, { file: PartFile, reader: ZipReader<unknown>, translations: Map<string, import('@zip.js/zip.js').FileEntry> }>}
   */
  #archives = new Map()
  /** @type {string} where the pack came from, for messages */
  #origin

  /**
   * @param {IndexEntry[]} libraries
   * @param {string} origin where the pack came from, for messages
   */
  constructor(libraries, origin) {
    this.libraries = libraries
    this.#origin = origin
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
    const path = fileURLToPath(entry.url)
    const hash = createHash('sha256')
    try {
      for await (const chunk of createReadStream(path)) hash.update(chunk)
    } catch (error) {
      throw new Error(`Cannot read the library part ${entry.folder} from ${this.#origin}`, { cause: error })
    }
    if (hash.digest('hex') !== entry.sha256) throw new Error(`The library part ${entry.folder} does not match the pack's index (SHA-256): reinstall the pack.`)
    const file = new PartFile(path)
    const reader = new ZipReader(file, { checkSignature: true })
    // Kept before anything is read, so that `close` closes a part that then fails to open.
    /** @type {Map<string, import('@zip.js/zip.js').FileEntry>} */
    const translations = new Map()
    this.#archives.set(entry.folder, { file, reader, translations })
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
    return archive.file
  }

  /** Every opened part closed, each on its own, so that one that fails to close leaves no other open. */
  async close() {
    await Promise.allSettled(this.#opened.values())
    await Promise.allSettled([...this.#archives.values()].map(async ({ file, reader }) => {
      try {
        await reader.close()
      } finally {
        // A part that failed to open has its file to close, whatever its reader makes of closing.
        await file.close()
      }
    }))
    this.#archives.clear()
    this.#opened.clear()
  }
}

/**
 * The pack a build reads: the one this package pins, or the `parts/` folder of another copy.
 * @param {string} [folder] a folder holding `index.json` and the parts it names
 */
export async function openPack(folder) {
  if (folder) {
    const directory = resolve(folder)
    let index
    try {
      index = JSON.parse(await readFile(join(directory, 'index.json'), 'utf8'))
    } catch (error) {
      throw new Error(`${directory} is not a library pack's parts folder: it has no readable index.json`, { cause: error })
    }
    if (!Array.isArray(index?.libraries)) throw new Error(`${join(directory, 'index.json')} lists no libraries`)
    const libraries = index.libraries.map((/** @type {IndexEntry} */ entry) => ({ ...entry, url: pathToFileURL(join(directory, `${entry.folder}.h5p`)).href }))
    return new Pack(libraries, directory)
  }
  const { pack } = await import('@missing-elements/h5p-libraries')
  return new Pack(/** @type {IndexEntry[]} */ (pack.libraries), '@missing-elements/h5p-libraries')
}

/** The pinned pack's version, for messages and reports. */
export async function packVersion() {
  const url = import.meta.resolve('@missing-elements/h5p-libraries/package.json')
  return JSON.parse(await readFile(fileURLToPath(url), 'utf8')).version
}
