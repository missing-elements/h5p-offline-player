import { BlobReader, BlobWriter, ZipWriter } from '@zip.js/zip.js'
import { crc32 } from '@missing-elements/h5p-normalize/crc32'
import { packLibrariesIn } from '@missing-elements/h5p-offline-player/plan'
import { composePackage, readSource, writePackage } from './build.mjs'
import { MediaStore } from './media.mjs'
import { Pack } from './pack.mjs'

export * from './core.mjs'

/**
 * @missing-elements/h5p-author/browser: the build in a page, or a Tauri window. The same build as
 * Node's, the source checked, generated, laid out and checked as saved content, but for three
 * things: the pack is one the page can reach, each part fetched whole and checked against the
 * index's SHA-256; a source's files are `File`s or `Blob`s the page was given, by name; and the
 * package comes back as a `Blob`, its media stored with their sizes and CRC in their local headers,
 * as embed's SCORM writer stores its entries since #92, so that the player reads each one's size
 * off its header on a host without `Range`. An mp4 goes in as it was given: moving its index to
 * the front is the normalizer's, which runs in Node. It needs a secure context, https, localhost or
 * a Tauri window, for `crypto.subtle` and `crypto.randomUUID`.
 */

/**
 * @typedef {{ libraries: import('./pack.mjs').IndexEntry[] }} PackIndex
 *   the `pack` export of `@missing-elements/h5p-libraries` as a bundler emits it: the index, each
 *   library with its part's URL
 * @typedef {{
 *   blob: Blob, manifest: Record<string, unknown>, content: Record<string, unknown>, libraries: string[],
 *   translations: import('./translate.mjs').TranslationReport[], notes: import('./build.mjs').Problem[], media: string[]
 * }} BuildResult the package, and what is worth telling about it
 * @typedef {{ libraries: Pack | PackIndex | string | URL, files?: Map<string, Blob> | Record<string, Blob>, fetch?: typeof fetch }} BuildOptions
 *   `libraries`, a pack `openPack` opened, which a page keeps for its builds, or what to open one
 *   from; `files`, the files a source names, by the names it gives them; `fetch`, for media named by
 *   web address
 */

/** What a page's build takes from the browser, which it has in a secure context only. */
function secure() {
  if (!globalThis.crypto?.subtle || typeof globalThis.crypto.randomUUID !== 'function') {
    throw new Error('A page builds packages in a secure context only, https, localhost or a Tauri window: it needs crypto.subtle and crypto.randomUUID, which a page has nowhere else')
  }
}

/**
 * The pack a page's build reads: the `pack` export of `@missing-elements/h5p-libraries` as a
 * bundler emits it, or the address of a copy of its `parts/` folder, served as a site serves it to
 * `<h5p-player>`'s `pack-base`, whose `index.json` is read from there and held to its shape by the
 * player's own rule (`packLibrariesIn`). A part is fetched whole when a build first needs it, and
 * checked against the index's SHA-256 before it is read. Keep it open for the page's builds, and
 * close it when they are done.
 * @param {PackIndex | string | URL} pack
 * @param {{ fetch?: typeof fetch }} [options] `fetch`, for the index and the parts
 */
export async function openPack(pack, { fetch: fetchImpl = globalThis.fetch } = {}) {
  secure()
  /** @type {import('./pack.mjs').IndexEntry[]} */
  let libraries
  if (typeof pack === 'string' || pack instanceof URL) {
    const written = String(pack)
    const base = new URL(written.endsWith('/') ? written : `${written}/`, globalThis.location?.href)
    if (base.protocol !== 'https:' && base.protocol !== 'http:') {
      throw new Error(`${base.href} is not an http(s) address: a copy of the pack's parts/ folder is read over http(s), as the player reads one; give the pack export instead`)
    }
    const url = new URL('index.json', base).href
    let index
    try {
      const response = await fetchImpl(url)
      if (!response.ok) throw new Error(`it answered ${response.status}`)
      index = await response.json()
    } catch (error) {
      throw new Error(`${url} is not a library pack's index: ${error instanceof Error ? error.message : error}`, { cause: error })
    }
    libraries = packLibrariesIn((Array.isArray(index?.libraries) ? index.libraries : []).map((/** @type {any} */ entry) => (
      entry && typeof entry === 'object' && typeof entry.folder === 'string' ? { ...entry, url: new URL(`${entry.folder}.h5p`, base).href } : null
    )))
    if (!libraries.length) throw new Error(`${url} is not a library pack's index: it lists no library as the pack's index does`)
  } else if (Array.isArray(pack?.libraries) && pack.libraries.every((entry) => typeof entry?.url === 'string')) {
    libraries = pack.libraries.map((entry) => ({ ...entry, url: new URL(entry.url, globalThis.location?.href).href }))
  } else {
    throw new TypeError('Name the library pack: the pack export of @missing-elements/h5p-libraries, or the address of a copy of its parts/ folder')
  }
  return new Pack(libraries, async (entry) => {
    let response
    try {
      response = await fetchImpl(entry.url)
    } catch (error) {
      throw new Error(`Cannot fetch the library part ${entry.folder} from ${entry.url}`, { cause: error })
    }
    if (!response.ok) throw new Error(`Cannot fetch the library part ${entry.folder}: ${entry.url} answered ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  }, 'serve the parts of the pack this index belongs to')
}

/**
 * A source's files in a page: the `File`s or `Blob`s it was given, by the names the source gives
 * them; downloads kept as `Blob`s.
 * @param {Map<string, Blob> | Record<string, Blob>} files
 * @returns {import('./media.mjs').MediaAccess<Blob>}
 */
function pageMedia(files) {
  const named = files instanceof Map ? files : new Map(Object.entries(files))
  return {
    what: 'the name of a file given',
    name: (source) => source.slice(source.lastIndexOf('/') + 1),
    async local(source) {
      const file = named.get(source)
      if (file instanceof Blob) return { file }
      if (file !== undefined) return { missing: 'is not a File or a Blob' }
      const names = [...named.keys()]
      return { missing: `no such file among those given (${names.length ? `${names.slice(0, 10).join(', ')}${names.length > 10 ? ', …' : ''}` : 'none'})` }
    },
    keep: (body) => new Response(body).blob(),
    async open(file) {
      return {
        read: async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()),
        close: async () => {}
      }
    }
  }
}

/**
 * A `Blob`'s CRC-32, read as a stream.
 * @param {Blob} blob
 */
async function crcOf(blob) {
  const reader = blob.stream().getReader()
  let crc = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return crc
    crc = crc32(value, crc)
  }
}

/**
 * The page's own `fetch` for media named by web address, saying what a failure most likely is: a
 * page reads another site's file only where that site allows it (CORS), and most do not.
 * @type {typeof fetch}
 */
const pageFetch = (input, init) => globalThis.fetch(input, init).catch((error) => {
  if (init?.signal?.aborted || !(error instanceof TypeError)) throw error
  throw new Error(`${error.message}; a page reads a file from another site only where that site allows it (CORS), so give the file itself instead`, { cause: error })
})

/**
 * Builds a package from a source in a page, and returns it as a `Blob`.
 * @param {unknown} input the source: `{ type, title, language, license, authors, params }`, or a quiz in the published quiz format
 * @param {BuildOptions} options
 * @returns {Promise<BuildResult>}
 */
export async function buildPackage(input, options) {
  secure()
  const { libraries, files = {}, fetch: fetchImpl = pageFetch } = options ?? {}
  if (!libraries) throw new TypeError('Name the library pack: a pack openPack opened, the pack export of @missing-elements/h5p-libraries, or the address of a copy of its parts/ folder')
  const source = readSource(input)
  const pack = libraries instanceof Pack ? libraries : await openPack(libraries)
  try {
    const media = new MediaStore(pageMedia(files), { fetch: fetchImpl })
    const built = await composePackage(source, pack, media)
    const writer = new ZipWriter(new BlobWriter('application/zip'), { useWebWorkers: false })
    await writePackage(writer, built, pack)
    for (const item of media.files) {
      // Stored, its size and CRC in its local header: written into a stream, zip.js would put them in a descriptor after it.
      await writer.add(`content/${item.name}`, new BlobReader(item.from), { passThrough: true, compressionMethod: 0, uncompressedSize: item.from.size, crc32: await crcOf(item.from) })
    }
    return {
      blob: await writer.close(),
      manifest: built.manifest,
      content: built.content,
      libraries: [...built.selected.keys()],
      translations: built.translations,
      notes: built.notes,
      media: media.files.map((item) => item.name)
    }
  } finally {
    if (pack !== libraries) await pack.close()
  }
}
