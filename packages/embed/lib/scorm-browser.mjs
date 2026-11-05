import { BlobWriter, ZipWriter } from '@zip.js/zip.js'
import { packLibrariesIn } from '@missing-elements/h5p-offline-player/plan'
import { addScormEntries, buildStamp, mainLibraryOf, readPackage, runtimeFiles, scormEntries, scormOptions, scormTitle, sha256Hex } from './scorm-core.mjs'
import { EmbedError, PLAYER_FILES } from './shared.mjs'

/**
 * @missing-elements/h5p-embed/scorm/browser: the SCORM package built in a page, for the people
 * who need one and do not run `npx`. The same zip `buildScorm` writes, from the same code
 * (`scorm-core.mjs`), but the package is a `File` the page was given, the player, the runtime and
 * the library pack come from the site the page is on, and the zip comes back as a `Blob` for a
 * download link. Nothing is uploaded anywhere. It needs a secure context, https or localhost, for
 * `crypto.subtle`.
 *
 * In two steps, so that a page can show what a zip will hold before it is written:
 * `planScormInPage` reads the package and plans the parts of the pack it needs, and the plan's
 * `write` fetches the files and writes the zip. `buildScormInPage` is both at once.
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
 * @property {string} [title] the title the LMS lists the zip by, in place of `h5p.json`'s; an
 *   empty one leaves that
 * @property {'1.2' | '2004'} [scormVersion] SCORM 1.2, the default, or 2004 4th Edition
 * @property {number | null} [passMark] a pass mark from 0 to 100, which a score is held to in
 *   place of the content's own pass or fail; none by default
 * @property {boolean} [completionScore] count content that finishes without a score as 100; off
 *   by default
 * @property {string | URL} [base] the folder that holds the player's three files and
 *   `frame-assets/`, and, unless `assets` gives them, `scorm-launch.html`, `scorm.js`,
 *   `lz-string.js`, `embed.css` and `libraries.txt`: this page's own folder by default
 * @property {PackIndex | null} [pack] the library pack, as the `pack` export a bundler resolves;
 *   it wins over `packBase`
 * @property {string | URL | null} [packBase] the folder of a copy of the pack's `parts/`, which
 *   the written site has as `libraries/`. Without either, a package that does not carry its
 *   libraries is refused
 * @property {{ launch?: string, bridge?: string | Blob, lz?: string | Blob, css?: string | Blob, libraries?: string | Blob }} [assets]
 *   the launch page's template, its bridge, the compressor the bridge keeps the saved state with
 *   (`scorm/lz-string.js`), the stylesheet and the pack's licence list, for a page that bundles
 *   them rather than serving them beside the player. A page that gives the launch page and not the
 *   compressor gets the one at `base`, or a zip without it, whose bridge writes the saved state
 *   plain, as embed 1.4 did
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
 * @property {string} title the title the LMS lists it by: the one chosen, else the package's
 * @property {string} version the player's version, as given
 * @property {string[]} libraries the folders of the libraries the zip carries from the pack
 * @property {'1.2' | '2004'} scormVersion the SCORM version it was written for
 * @property {number | null} passMark the pass mark it holds a score to, as `buildScorm` returns it
 * @property {boolean} completionScore whether content that finishes without a score counts as 100
 * @property {string} build the build stamp, as `buildScorm` returns it
 * @property {number} size the zip's size in bytes
 */

/**
 * What `planScormInPage` read of a package: what its zip will hold, known before anything else is
 * fetched and anything is written.
 * @typedef {object} PlannedScorm
 * @property {string} name the package's file name
 * @property {number} size the package's size in bytes
 * @property {string} title the title the zip takes unless `write` is given another: the one given
 *   to the plan, else `h5p.json`'s, else the file's name
 * @property {{ machineName: string, majorVersion?: number, minorVersion?: number } | null} mainLibrary
 *   the package's main library, as `h5p.json` names it, with the version its dependencies give
 *   it; `null` when it names none
 * @property {string[]} libraries the folders of the libraries the zip will carry from the pack;
 *   none for a package that carries its own
 * @property {number} librariesSize their archives' size in bytes, as the pack's index gives it
 * @property {(options?: { title?: string, scormVersion?: '1.2' | '2004', passMark?: number | null, completionScore?: boolean, onProgress?: (progress: ScormProgress) => void }) => Promise<PageScorm>} write
 *   fetches the parts, the player and the runtime, and writes the zip, under the title and with
 *   the version and the grading options given, each defaulting to the plan's, as `onProgress`
 *   does. It can be called again, for another title or other options; the package is hashed for
 *   the build stamp on the first call only
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
 * Reads a package in a page and plans its SCORM zip: `h5p.json`, and the parts of the pack the
 * zip will carry, by the player's own plan. Refuses what `buildScorm` refuses before it writes,
 * with the same messages: a package that needs a library neither it nor the pack has, and a file
 * that is not a package.
 * @param {PageScormOptions} options
 * @returns {Promise<PlannedScorm>}
 */
export async function planScormInPage(options) {
  const { file, pack = null, packBase = null, onProgress = () => {}, fetch: fetchImpl = globalThis.fetch } = options ?? {}
  if (!(file instanceof Blob)) throw new TypeError('Give the package as a File or a Blob')
  // Checked before the package is read, so that a page hears of a wrong option at once.
  const planned = scormOptions(options)
  if (!globalThis.crypto?.subtle) {
    throw new EmbedError('A page builds SCORM packages in a secure context only, https or localhost: it needs crypto.subtle, which a page has nowhere else.')
  }
  const name = options.name ?? (/** @type {{ name?: unknown }} */ (file).name)
  if (typeof name !== 'string' || !name) throw new TypeError("Give the package's name: a Blob has none")
  const base = new URL(options.base ?? './', globalThis.location?.href)
  if (!base.href.endsWith('/')) base.pathname += '/'

  // The pack as the page can reach it, held to its shape by the player's own rule; a part's
  // record, what the zip's index repeats, is the entry without its address.
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
  /** @type {any} */
  let manifest
  /** @type {import('./scorm-core.mjs').PackPart[]} */
  let parts
  try {
    ;({ manifest, parts } = await readPackage(file, name, library))
  } catch (error) {
    // Without a pack, say so, rather than that the pack lacks what the package needs.
    if (error instanceof EmbedError && library.length === 0 && /neither it nor the library pack carries/.test(error.message)) {
      throw new EmbedError(`${name} does not carry all its libraries, and this page has no library pack to take them from. Export the package with its libraries, as Lumi and the H5P plugins of Moodle, WordPress and Drupal do.`)
    }
    throw error
  }
  const stem = name.replace(/\.[^.]+$/, '')
  // A title given to the plan is the plan's, and its writes' unless they give another.
  const plannedTitle = scormTitle(manifest, stem, options.title)
  /** @type {string | null} the build stamp, from the first write on */
  let stamp = null

  /** @type {PlannedScorm['write']} */
  const write = async ({ title: chosen = options.title, onProgress: report = onProgress, ...given } = {}) => {
    const title = scormTitle(manifest, stem, chosen)
    const scorm = scormOptions({ ...planned, ...Object.fromEntries(Object.entries(given).filter(([, value]) => value !== undefined)) })
    const { assets = {}, version = 'unknown', packVersion = null } = options
    /** @param {string} path */
    const at = (path) => new URL(path, base).href

    report({ step: 'libraries', libraries: parts.length })
    /** @param {string} url @param {string} what */
    const blob = async (url, what) => (await fetched(fetchImpl, url, what)).blob()
    // The compressor came in 1.5, after pages that bundle the launch files were written: such a
    // page that does not give it plays on without it, its state plain, rather than fail for a file
    // it never had to serve.
    const compressor = async () => {
      try {
        return await blob(at('lz-string.js'), "The launch page's compressor")
      } catch (error) {
        if (assets.launch !== undefined && error instanceof EmbedError) return null
        throw error
      }
    }
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
      lz: assets.lz !== undefined ? asBlob(assets.lz) : await compressor(),
      css: assets.css !== undefined ? asBlob(assets.css) : await blob(at('embed.css'), 'The stylesheet'),
      player: await blobs(PLAYER_FILES, at, "The player's file"),
      runtime: await blobs(runtimeFiles(runtimeManifest), (path) => at(`frame-assets/${path}`), "The runtime's file"),
      pkg: file,
      parts: partBlobs,
      librariesText: parts.length === 0 ? null : assets.libraries !== undefined ? asBlob(assets.libraries) : await blob(at('libraries.txt'), "The pack's licence list")
    }

    // The whole package in memory once, for its hash: `crypto.subtle` takes no stream. Once per
    // plan, too: the package and its parts are the same for every write.
    const build = (stamp ??= await buildStamp(await sha256Hex(await file.arrayBuffer()), parts))
    const { entries, xml } = scormEntries({ manifest, source: name, title, build, version, packVersion, parts, files, options: scorm })

    report({ step: 'writing' })
    const zip = new ZipWriter(new BlobWriter('application/zip'), { useWebWorkers: false })
    await addScormEntries(zip, { entries, xml })
    const out = await zip.close()
    return { blob: out, name: `${stem}.scorm.zip`, title, version, libraries: parts.map((part) => part.folder), ...scorm, build, size: out.size }
  }

  return {
    name,
    size: file.size,
    title: plannedTitle,
    mainLibrary: mainLibraryOf(manifest),
    libraries: parts.map((part) => part.folder),
    librariesSize: parts.reduce((sum, part) => sum + part.size, 0),
    write
  }
}

/**
 * Builds the SCORM 1.2 zip of a package in a page, and returns it as a `Blob`: `planScormInPage`
 * and the plan's `write` at once. Refuses what `buildScorm` refuses, with the same messages, and a
 * part of the pack whose bytes do not match the index, since they came over the network.
 * @param {PageScormOptions} options
 * @returns {Promise<PageScorm>}
 */
export async function buildScormInPage(options) {
  return (await planScormInPage(options)).write()
}
