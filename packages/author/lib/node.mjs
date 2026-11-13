import { constants, createReadStream, createWriteStream } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, open, readFile, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js'
import { normalizeArchive } from '@missing-elements/h5p-normalize'
import { composePackage, sourceOf, typeNames, writePackage } from './build.mjs'
import { bundleLibraries, contentTypes } from './bundle.mjs'
import { MediaStore } from './media.mjs'
import { Pack } from './pack.mjs'
import { SourceError } from './source-error.mjs'

/**
 * What only Node does of a build: the pack read from disk, a source's files read beside it and
 * downloads kept in a temporary folder, and the package written to a path, laid out to stream by
 * the normalizer, an mp4's index first. Everything else a build does is the page's build's too
 * (`browser.mjs`).
 */

/**
 * @typedef {import('./build.mjs').Problem} Problem
 * @typedef {import('./translate.mjs').TranslationReport} TranslationReport
 * @typedef {{
 *   output: string, manifest: Record<string, unknown>, content: Record<string, unknown>,
 *   libraries: string[], install: string[], translations: TranslationReport[], notes: Problem[], media: string[]
 * }} BuildResult what was written, and what is worth telling about it: `libraries`, the folders the
 *   package plays with; `install`, those carried for an H5P site's upload check
 * @typedef {{ libraries?: string, base?: string, fetch?: typeof fetch }} BuildOptions
 *   `libraries`, a library pack's parts folder in place of the pinned pack; `base`, the folder a
 *   source's file paths are read from; `fetch`, for media named by web address
 * @typedef {{ output: string, type: string, parts: string[], size: number }} BundleResult
 *   `type`, the content type with the version bundled, `H5P.QuestionSet 1.21`; `parts`, the
 *   folders of the parts it holds; `size`, the zip's in bytes
 * @typedef {{ dev: bigint, ino: bigint }} Made a file this module created, by the device and
 *   inode it was given, which a file that takes its name later does not have
 */

/**
 * The parts folder a pack is read from: the one named, or the pinned pack's.
 * @param {string} [folder]
 */
function partsFolder(folder) {
  return folder ? resolve(folder) : dirname(fileURLToPath(import.meta.resolve('@missing-elements/h5p-libraries/parts/index.json')))
}

/**
 * The pack a build reads: the one this package pins, or the `parts/` folder of another copy. Read
 * from its `index.json`, which names the libraries carried for an H5P site's upload check too,
 * where the `pack` export of `index.js` leaves them out.
 * @param {string} [folder] a folder holding `index.json` and the parts it names
 */
export async function openPack(folder) {
  const directory = partsFolder(folder)
  const origin = folder ? directory : '@missing-elements/h5p-libraries'
  let index
  try {
    index = JSON.parse(await readFile(join(directory, 'index.json'), 'utf8'))
  } catch (error) {
    throw new Error(`${directory} is not a library pack's parts folder: it has no readable index.json`, { cause: error })
  }
  if (!Array.isArray(index?.libraries)) throw new Error(`${join(directory, 'index.json')} lists no libraries`)
  /** @type {import('./pack.mjs').IndexEntry[]} */
  const libraries = index.libraries.map((/** @type {import('./pack.mjs').IndexEntry} */ entry) => ({ ...entry, url: pathToFileURL(join(directory, `${entry.folder}.h5p`)).href }))
  return new Pack(libraries, async (entry) => {
    try {
      return new Uint8Array(await readFile(fileURLToPath(entry.url)))
    } catch (error) {
      // A content type's bundle holds what the type can hold, and no addon: a source whose text
      // calls for one, or another type's library, needs its part added.
      if (folder && /** @type {{ code?: unknown }} */ (error)?.code === 'ENOENT') {
        throw new Error(`The parts folder ${directory} has no ${entry.folder}.h5p, which this build needs: add it from the library pack's parts/`)
      }
      throw new Error(`Cannot read the library part ${entry.folder} from ${origin}`, { cause: error })
    }
  }, 'reinstall the pack')
}

/**
 * The pinned pack's version, for messages and reports, from the libraries package's package.json
 * where it is installed beside this one. The command line as one file, which the organisation's
 * site bundles, has no package beside it: there it is the copy its bundler wrote in from the
 * import. The file comes first, since Node before 22.12 warns on a JSON import.
 */
export async function packVersion() {
  try {
    const url = import.meta.resolve('@missing-elements/h5p-libraries/package.json')
    return String(JSON.parse(await readFile(fileURLToPath(url), 'utf8')).version)
  } catch {
    return (await import('@missing-elements/h5p-libraries/package.json', { with: { type: 'json' } })).default.version
  }
}

/**
 * A source's files on disk: beside the source, by their paths from `base`; downloads kept in
 * `temporary`, numbered.
 * @param {{ base: string, temporary: string }} folders
 * @returns {import('./media.mjs').MediaAccess<string>}
 * @internal
 */
export function nodeMedia({ base, temporary }) {
  let downloads = 0
  return {
    what: 'a file beside the source',
    name: (source) => basename(resolve(base, source)),
    async local(source) {
      const from = resolve(base, source)
      try {
        if ((await stat(from)).isFile()) return { file: from }
      } catch {}
      return { missing: `no such file beside the source (${from})` }
    },
    async keep(body, extension) {
      downloads += 1
      const from = join(temporary, `download-${downloads}.${extension}`)
      await body.pipeTo(/** @type {WritableStream<Uint8Array>} */ (Writable.toWeb(createWriteStream(from))))
      return from
    },
    async open(file) {
      const handle = await open(file, 'r')
      return {
        async read(offset, length) {
          const bytes = new Uint8Array(length)
          const { bytesRead } = await handle.read(bytes, 0, length, offset)
          return bytes.subarray(0, bytesRead)
        },
        close: () => handle.close()
      }
    }
  }
}

/**
 * The refusal of an output that exists, with the file system's code, so a caller tells it from
 * a source's problems.
 * @param {string} output
 * @param {string} [what] what refuses
 */
function exists(output, what = 'a build') {
  return Object.assign(new Error(`${output} exists, and ${what} never writes over a file: name a new one`), { code: 'EEXIST' })
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
  const pack = await openPack(options.libraries)
  let temporary
  try {
    // With the pack's names, so that a content type named loosely is known, and the content of a
    // source whose own fields have problems is checked in the same round (#174).
    const read = sourceOf(input, typeNames(pack))
    if (!read.typed) throw new SourceError(read.problems)
    temporary = await mkdtemp(join(dirname(output), '.h5p-author-'))
    const media = new MediaStore(nodeMedia({ base: options.base ?? process.cwd(), temporary }), { fetch: options.fetch })
    const built = await composePackage(read.source, pack, media, read.problems)
    const staged = join(temporary, 'package.h5p')
    const file = await open(staged, 'wx')
    try {
      const writer = new ZipWriter(Writable.toWeb(file.createWriteStream()), { useWebWorkers: false })
      await writePackage(writer, built, pack, async () => {
        for (const item of media.files) {
          await writer.add(`content/${item.name}`, /** @type {ReadableStream<Uint8Array>} */ (Readable.toWeb(createReadStream(item.from))), { level: 0 })
        }
      })
      await writer.close()
    } finally {
      await file.close()
    }
    let final = staged
    if (media.files.length) {
      // Media stored, an mp4's index first: the layout a package streams in. The libraries
      // carried for an H5P site's upload check stay after the media, where `writePackage` put
      // them: a host that ignores `Range` then boots, and plays the media, before they arrive.
      final = join(temporary, 'normalized.h5p')
      await normalizeArchive({ input: staged, output: final, last: [...built.install.keys()] })
    }
    // Unlike a hard link, an exclusive copy also works on FAT/exFAT destinations.
    await copyFile(final, output, constants.COPYFILE_EXCL).catch((error) => {
      throw error?.code === 'EEXIST' ? exists(output) : error
    })
    return {
      output,
      manifest: built.manifest,
      content: built.content,
      libraries: [...built.selected.keys()],
      install: [...built.install.keys()],
      translations: built.translations,
      notes: built.notes,
      media: media.files.map((item) => item.name)
    }
  } finally {
    await pack.close()
    if (temporary) await rm(temporary, { recursive: true, force: true })
  }
}

/** The date on every entry of a bundle, as on the pack's parts: a bundle of the same pack is the same bytes. */
const BUNDLE_DATE = new Date(2000, 0, 1, 2)

/**
 * A content type's bundle (`bundleLibraries`) written to `output`, which must not exist yet: a zip
 * of `parts/`, a parts folder `h5p-author build --libraries parts` reads, with the pack's whole index
 * and the parts a build of the type reads, and of `libraries.txt`, the licences those are used under,
 * as the pack lists them beside its parts folder. Two bundles of the same pack unzipped in one place
 * make one parts folder: their index is the same.
 * @param {string} type a content type's machine name, such as `H5P.QuestionSet`
 * @param {string} output
 * @param {{ libraries?: string }} [options] `libraries`, a pack's parts folder in place of the pinned pack
 * @returns {Promise<BundleResult>}
 */
export async function writeBundle(type, output, options = {}) {
  output = resolve(output)
  if (await lstat(output).then(() => true, () => false)) throw exists(output, 'h5p-author')
  if (!(await stat(dirname(output)).catch(() => null))?.isDirectory()) throw new Error(`${dirname(output)} is not a folder to write the bundle in`)
  const files = await bundleFiles(partsFolder(options.libraries))
  const pack = await openPack(options.libraries)
  try {
    return (await writeZip(pack, files, await bundleLibraries(pack, type), output)).result
  } finally {
    await pack.close()
  }
}

/**
 * Every content type's bundle (`contentTypes`), written as `writeBundle` writes one, to
 * `<machine name>.zip` in `folder`, which is made if it is not there. Nothing is written over: where
 * one of them is there already, nothing is written. All of them or none: one that fails takes those
 * written before it away again, so the call can be run again as it was. A file another process has
 * put at one of those names since is theirs, and stays.
 * @param {string} folder
 * @param {{ libraries?: string }} [options] `libraries`, a pack's parts folder in place of the pinned pack
 * @returns {Promise<BundleResult[]>} by machine name
 */
export async function writeBundles(folder, options = {}) {
  folder = resolve(folder)
  const files = await bundleFiles(partsFolder(options.libraries))
  const pack = await openPack(options.libraries)
  try {
    const types = (await contentTypes(pack)).map((part) => part.library.machineName)
    const outputs = types.map((type) => join(folder, `${type}.zip`))
    for (const output of outputs) if (await lstat(output).then(() => true, () => false)) throw exists(output, 'h5p-author')
    await mkdir(folder, { recursive: true })
    /** @type {{ result: BundleResult, made: Made }[]} */
    const written = []
    try {
      for (const [i, type] of types.entries()) written.push(await writeZip(pack, files, await bundleLibraries(pack, type), outputs[i]))
    } catch (error) {
      // Only what this call made: a name is taken away if it still holds the file this call
      // created, not if another process has replaced that since.
      await Promise.all(written.map(({ result, made }) => removeIfMade(result.output, made)))
      throw error
    }
    return written.map(({ result }) => result)
  } finally {
    await pack.close()
  }
}

/**
 * What every bundle of a pack carries besides its parts: the index as the pack has it, and the
 * licence list beside its parts folder, without which the parts are not handed on.
 * @param {string} directory the pack's parts folder
 */
async function bundleFiles(directory) {
  const index = await readFile(join(directory, 'index.json')).catch((error) => {
    throw new Error(`${directory} is not a library pack's parts folder: it has no readable index.json`, { cause: error })
  })
  const listed = join(dirname(directory), 'libraries.txt')
  const licences = await readFile(listed).catch((error) => {
    throw new Error(`${listed} cannot be read: a bundle carries the licences its libraries are used under, the list a pack keeps beside its parts/ folder`, { cause: error })
  })
  return { index: new Uint8Array(index), licences: new Uint8Array(licences) }
}

/**
 * Takes away a file this module created, unless the name holds another file by now. A file another
 * process has put there since is theirs, and removing by the name alone would take it. A guard,
 * not a lock: the check and the removal are two calls, and Node removes a file by its name, so a
 * file that takes the name in the gap between them is still lost.
 * @param {string} path
 * @param {Made} made
 * @returns {Promise<void>}
 * @internal
 */
export async function removeIfMade(path, made) {
  const now = await lstat(path, { bigint: true }).catch(() => null)
  if (now && now.dev === made.dev && now.ino === made.ino) await rm(path, { force: true })
}

/**
 * A bundle's zip, created at `output`, and removed again if it cannot be written whole.
 * @param {Pack} pack with every part of `parts` opened, and so checked against the index
 * @param {{ index: Uint8Array, licences: Uint8Array }} files
 * @param {import('./pack.mjs').IndexEntry[]} parts the content type's first
 * @param {string} output
 * @returns {Promise<{ result: BundleResult, made: Made }>} `made`, the file as created, for a caller
 *   that takes it away again if a later one fails
 */
async function writeZip(pack, { index, licences }, parts, output) {
  const file = await open(output, 'wx').catch((error) => {
    throw error?.code === 'EEXIST' ? exists(output, 'h5p-author') : error
  })
  /** @type {Made | undefined} */
  let made
  try {
    try {
      const { dev, ino } = await file.stat({ bigint: true })
      made = { dev, ino }
      const writer = new ZipWriter(Writable.toWeb(file.createWriteStream()), { useWebWorkers: false, lastModDate: BUNDLE_DATE, extendedTimestamp: false })
      await writer.add('parts/index.json', new Uint8ArrayReader(index))
      // A part is a zip already: stored as it is, the bytes checked against the index as it opened.
      for (const entry of parts) await writer.add(`parts/${entry.folder}.h5p`, pack.archiveOf(entry), { level: 0 })
      await writer.add('libraries.txt', new Uint8ArrayReader(licences))
      await writer.close()
    } finally {
      await file.close()
    }
  } catch (error) {
    // The file as created, if it is still there; one that could not be looked at was made a moment ago.
    if (made) await removeIfMade(output, made)
    else await rm(output, { force: true })
    throw error
  }
  const [main] = parts
  return {
    result: { output, type: `${main.machineName} ${main.majorVersion}.${main.minorVersion}`, parts: parts.map((entry) => entry.folder), size: (await stat(output)).size },
    made: /** @type {Made} */ (made)
  }
}
