import { constants, createReadStream, createWriteStream } from 'node:fs'
import { copyFile, lstat, mkdtemp, open, readFile, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ZipWriter } from '@zip.js/zip.js'
import { normalizeArchive } from '@missing-elements/h5p-normalize'
import { composePackage, readSource, writePackage } from './build.mjs'
import { MediaStore } from './media.mjs'
import { Pack } from './pack.mjs'

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
 *   libraries: string[], translations: TranslationReport[], notes: Problem[], media: string[]
 * }} BuildResult what was written, and what is worth telling about it
 * @typedef {{ libraries?: string, base?: string, fetch?: typeof fetch }} BuildOptions
 *   `libraries`, a library pack's parts folder in place of the pinned pack; `base`, the folder a
 *   source's file paths are read from; `fetch`, for media named by web address
 */

/**
 * The pack a build reads: the one this package pins, or the `parts/` folder of another copy.
 * @param {string} [folder] a folder holding `index.json` and the parts it names
 */
export async function openPack(folder) {
  /** @type {import('./pack.mjs').IndexEntry[]} */
  let libraries
  let origin
  if (folder) {
    const directory = resolve(folder)
    let index
    try {
      index = JSON.parse(await readFile(join(directory, 'index.json'), 'utf8'))
    } catch (error) {
      throw new Error(`${directory} is not a library pack's parts folder: it has no readable index.json`, { cause: error })
    }
    if (!Array.isArray(index?.libraries)) throw new Error(`${join(directory, 'index.json')} lists no libraries`)
    libraries = index.libraries.map((/** @type {import('./pack.mjs').IndexEntry} */ entry) => ({ ...entry, url: pathToFileURL(join(directory, `${entry.folder}.h5p`)).href }))
    origin = directory
  } else {
    const { pack } = await import('@missing-elements/h5p-libraries')
    libraries = /** @type {import('./pack.mjs').IndexEntry[]} */ (pack.libraries)
    origin = '@missing-elements/h5p-libraries'
  }
  return new Pack(libraries, async (entry) => {
    try {
      return new Uint8Array(await readFile(fileURLToPath(entry.url)))
    } catch (error) {
      throw new Error(`Cannot read the library part ${entry.folder} from ${origin}`, { cause: error })
    }
  }, 'reinstall the pack')
}

/** The pinned pack's version, for messages and reports. */
export async function packVersion() {
  const url = import.meta.resolve('@missing-elements/h5p-libraries/package.json')
  return JSON.parse(await readFile(fileURLToPath(url), 'utf8')).version
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
    temporary = await mkdtemp(join(dirname(output), '.h5p-author-'))
    const media = new MediaStore(nodeMedia({ base: options.base ?? process.cwd(), temporary }), { fetch: options.fetch })
    const built = await composePackage(source, pack, media)
    const staged = join(temporary, 'package.h5p')
    const file = await open(staged, 'wx')
    try {
      const writer = new ZipWriter(Writable.toWeb(file.createWriteStream()), { useWebWorkers: false })
      await writePackage(writer, built, pack)
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
      manifest: built.manifest,
      content: built.content,
      libraries: [...built.selected.keys()],
      translations: built.translations,
      notes: built.notes,
      media: media.files.map((item) => item.name)
    }
  } finally {
    await pack.close()
    if (temporary) await rm(temporary, { recursive: true, force: true })
  }
}
