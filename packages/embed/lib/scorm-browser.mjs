import { BlobWriter, ZipWriter } from '@zip.js/zip.js'
import { packLibrariesIn } from '@missing-elements/h5p-offline-player/plan'
import { addScormEntries, buildStamp, readPackage, runtimeFiles, scormEntries, scormTitle, sha256Hex } from './scorm-core.mjs'
import { EmbedError, PLAYER_FILES } from './shared.mjs'

/**
 * @missing-elements/h5p-embed/scorm/browser: the SCORM package built in a page, for the people
 * who need one and do not run `npx`. The same zip `buildScorm` writes, from the same code
 * (`scorm-core.mjs`), but the package is a `File` the page was given, the player, the runtime and
 * the library pack come from the site the page is on, and the zip comes back as a `Blob` for a
 * download link. Nothing is uploaded anywhere. It needs a secure context, https or localhost, for
 * `crypto.subtle`.
 */

/**
 * @typedef {import('@missing-elements/h5p-offline-player').LibraryPack} PackIndex
 *   the `pack` export of `@missing-elements/h5p-libraries` as a bundler emits it: the index, each
 *   library with its part's URL, as the element's `pack` property takes it
 * @typedef {{ step: 'reading' | 'libraries' | 'writing', libraries?: number }} ScormProgress
 *   where the build is: reading the package, fetching its `libraries` parts of the pack, writing
 *   the zip
 */

/**
 * @typedef {object} PageScormOptions
 * @property {Blob} file the package, as picked or dropped
 * @property {string} [name] its file name, for the zip's name, the title's fallback and the
 *   messages; a `File`'s own by default
 * @property {string | URL} [base] the folder that holds the player's three files and
 *   `frame-assets/`, and, unless `assets` gives them, `scorm-launch.html`, `scorm.js`, `embed.css`
 *   and `libraries.txt`: this page's own folder by default
 * @property {PackIndex | null} [pack] the library pack, as the `pack` export a bundler resolves;
 *   it wins over `packBase`
 * @property {string | URL | null} [packBase] the folder of a copy of the pack's `parts/`, which
 *   the written site has as `libraries/`. Without either, a package that does not carry its
 *   libraries is refused
 * @property {{ launch?: string, bridge?: string | Blob, css?: string | Blob, libraries?: string | Blob }} [assets]
 *   the launch page's template, its bridge, the stylesheet and the pack's licence list, for a page
 *   that bundles them rather than serving them beside the player
 * @property {string} [version] the player's version, for the notice; `unknown` if not given
 * @property {string | null} [packVersion] the pack's, the same way
 * @property {(progress: ScormProgress) => void} [onProgress]
 * @property {typeof fetch} [fetch]
 */

/**
 * What `buildScormInPage` built.
 * @typedef {object} PageScorm
 * @property {Blob} blob the zip
 * @property {string} name what to call it: the package's name with `.scorm.zip` in place of its extension
 * @property {string} title the package's title, as the LMS lists it
 * @property {string} version the player's version, as given
 * @property {string[]} libraries the folders of the libraries the zip carries from the pack
 * @property {string} build the build stamp, as `buildScorm` returns it
 * @property {number} size the zip's size in bytes
 */

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 * @param {string} what
 */
async function fetched(fetchImpl, url, what) {
  let response
  try {
    response = await fetchImpl(url)
  } catch (error) {
    throw new EmbedError(`${what} could not be fetched from ${url}: ${error instanceof Error ? error.message : error}`)
  }
  if (!response.ok) throw new EmbedError(`${what} is not at ${url}: it answered ${response.status}.`)
  return response
}

/**
 * A text or a `Blob` given, as a `Blob`.
 * @param {string | Blob} value
 */
const asBlob = (value) => (value instanceof Blob ? value : new Blob([value]))

/**
 * Builds the SCORM 1.2 zip of a package in a page, and returns it as a `Blob`. Refuses what
 * `buildScorm` refuses, with the same messages, and a part of the pack whose bytes do not match
 * the index, since they came over the network.
 * @param {PageScormOptions} options
 * @returns {Promise<PageScorm>}
 */
export async function buildScormInPage(options) {
  const { file, pack = null, packBase = null, assets = {}, version = 'unknown', packVersion = null, onProgress = () => {}, fetch: fetchImpl = globalThis.fetch } = options ?? {}
  if (!(file instanceof Blob)) throw new TypeError('Give the package as a File or a Blob')
  if (!globalThis.crypto?.subtle) {
    throw new EmbedError('A page builds SCORM packages in a secure context only, https or localhost: it needs crypto.subtle, which a page has nowhere else.')
  }
  const name = options.name ?? (/** @type {{ name?: unknown }} */ (file).name)
  if (typeof name !== 'string' || !name) throw new TypeError("Give the package's name: a Blob has none")
  const base = new URL(options.base ?? './', globalThis.location?.href)
  if (!base.href.endsWith('/')) base.pathname += '/'
  /** @param {string} path */
  const at = (path) => new URL(path, base).href

  // The pack as the page can reach it, held to its shape by the player's own rule; a part's
  // record, what the zip's index repeats, is the entry without its address.
  /** @type {import('./scorm-core.mjs').PackPart[]} */
  let parts = []
  /** @type {unknown[]} */
  let index = []
  if (pack) {
    index = (Array.isArray(pack.libraries) ? pack.libraries : []).map((entry) => ({ ...entry, url: new URL(entry.url, base).href }))
  } else if (packBase) {
    const packUrl = new URL(packBase, base)
    if (!packUrl.href.endsWith('/')) packUrl.pathname += '/'
    const listed = await (await fetched(fetchImpl, new URL('index.json', packUrl).href, "The library pack's index")).json()
    index = (Array.isArray(listed?.libraries) ? listed.libraries : []).map((/** @type {any} */ entry) => (
      entry && typeof entry === 'object' && typeof entry.folder === 'string' ? { ...entry, url: new URL(`${entry.folder}.h5p`, packUrl).href } : null
    ))
  }
  const library = packLibrariesIn(index).map((entry) => {
    const { url, ...record } = entry
    return { ...record, url, record }
  })

  onProgress({ step: 'reading' })
  let manifest
  try {
    ;({ manifest, parts } = await readPackage(file, name, library))
  } catch (error) {
    // Without a pack, say so, rather than that the pack lacks what the package needs.
    if (error instanceof EmbedError && library.length === 0 && /neither it nor the library pack carries/.test(error.message)) {
      throw new EmbedError(`${name} does not carry all its libraries, and this page has no library pack to take them from. Export the package with its libraries, as Lumi and the H5P plugins of Moodle, WordPress and Drupal do.`)
    }
    throw error
  }
  const title = scormTitle(manifest, name.replace(/\.[^.]+$/, ''))

  onProgress({ step: 'libraries', libraries: parts.length })
  /** @param {string} url @param {string} what */
  const blob = async (url, what) => (await fetched(fetchImpl, url, what)).blob()
  /** @param {string[]} names @param {(name: string) => string} url @param {string} what */
  const blobs = async (names, url, what) => new Map(await Promise.all(names.map(async (item) => /** @type {[string, Blob]} */ ([item, await blob(url(item), `${what} ${item}`)]))))
  const partBlobs = await blobs(parts.map((part) => part.folder), (folder) => /** @type {import('./scorm-core.mjs').PackPart} */ (parts.find((part) => part.folder === folder)).url, 'The library part')
  // Checked as the player checks a part before it uses one: these bytes came over the network.
  for (const part of parts) {
    const bytes = await /** @type {Blob} */ (partBlobs.get(part.folder)).arrayBuffer()
    if ((await sha256Hex(bytes)) !== part.sha256) {
      throw new EmbedError(`The library part ${part.folder} from ${part.url} does not match the pack's index, so the zip was not written.`)
    }
  }
  const runtimeManifest = await (await fetched(fetchImpl, at('frame-assets/MANIFEST.json'), "The runtime's manifest")).json()
  const files = {
    launch: assets.launch ?? (await (await fetched(fetchImpl, at('scorm-launch.html'), "The launch page's template")).text()),
    bridge: assets.bridge !== undefined ? asBlob(assets.bridge) : await blob(at('scorm.js'), 'The launch page\'s script'),
    css: assets.css !== undefined ? asBlob(assets.css) : await blob(at('embed.css'), 'The stylesheet'),
    player: await blobs(PLAYER_FILES, at, "The player's file"),
    runtime: await blobs(runtimeFiles(runtimeManifest), (path) => at(`frame-assets/${path}`), "The runtime's file"),
    pkg: file,
    parts: partBlobs,
    librariesText: parts.length === 0 ? null : assets.libraries !== undefined ? asBlob(assets.libraries) : await blob(at('libraries.txt'), "The pack's licence list")
  }

  // The whole package in memory once, for its hash: `crypto.subtle` takes no stream.
  const build = await buildStamp(await sha256Hex(await file.arrayBuffer()), parts)
  const { entries, xml } = scormEntries({ manifest, source: name, title, build, version, packVersion, parts, files })

  onProgress({ step: 'writing' })
  const zip = new ZipWriter(new BlobWriter('application/zip'), { useWebWorkers: false })
  await addScormEntries(zip, { entries, xml })
  const out = await zip.close()
  return { blob: out, name: `${name.replace(/\.[^.]+$/, '')}.scorm.zip`, title, version, libraries: parts.map((part) => part.folder), build, size: out.size }
}
