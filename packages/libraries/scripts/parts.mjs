import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BlobWriter, TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter, configure } from '@zip.js/zip.js'

/**
 * Splits the library pack into one archive per library folder, `parts/<folder>.h5p`, and writes
 * `parts/index.json`, which says what each part is: the library's full version, the dependencies
 * its `library.json` declares, its addon patterns, and the part's size and SHA-256. `<h5p-player>`
 * reads the index to fetch only the parts a package needs, and to play the pack's newer version
 * of a library a package carries; a part is checked against its hash once downloaded.
 *
 * Also writes `index.js` and `index.d.ts`, the `pack` export a bundler resolves: the index with a
 * static `new URL` for every part, the one shape Vite, Rollup and webpack 5 emit as an asset; and
 * `install.js`, the same with the libraries carried for an H5P site's upload check only
 * (`installOnly` below), which the player never serves.
 *
 * Each part copies its entries from the pack as they are, compressed bytes and dates included,
 * so the parts change exactly when the pack does, and the pack keeps a library's entries from the
 * pack before it when its files are the same (`writePack`), so the weekly refresh commits only the
 * libraries that changed. `pnpm parts` splits the committed `libraries.h5p`;
 * `apps/demo/scripts/build-libraries.mjs` writes a new one with `writePack` and splits it.
 */

configure({ useWebWorkers: false })

const packageDir = resolve(import.meta.dirname, '..')

/**
 * The `h5p.json` the pack and every part carry. The player refuses an archive without one, and an
 * archive registered to supply libraries is never held to what it declares.
 */
const PART_MANIFEST =JSON.stringify({ title: 'H5P Offline Player library pack', language: 'und', mainLibrary: '', preloadedDependencies: [], embedTypes: ['div'] })

/**
 * The date every entry of the pack and its parts is written with, so the bytes change only when a
 * library does. A zip records a wall-clock time with no zone, and zip.js takes it from the Date's
 * local fields, so this is built from local fields too: the same bytes in any time zone. It was
 * `Date.UTC(2000, 0, 1)` until #51, which wrote 02:00 at UTC+2, where the pack up to 1.0.0 was
 * built, and 00:00 on CI, whose first weekly run rewrote all 106 archives with no library changed
 * (#48). 02:00 is kept so the bytes stay those pack 1.0.0 shipped.
 */
export const FIXED_DATE = new Date(2000, 0, 1, 2)

/**
 * The smallest a part is written. A bundler inlines a small asset named by `new URL` as a `data:`
 * URL — Vite under 4 kB, webpack's asset modules under 8 kB — and a page's `connect-src` refuses
 * to fetch one, so a smaller part is padded up to this with the archive's comment, which nothing
 * reads. A dozen libraries are that small; the padding is about 50 kB in all.
 */
const MIN_PART_SIZE = 8 * 1024 + 1

/**
 * Writes the pack: its `h5p.json`, then each library's files, in the order given. A library whose
 * files are those its folder holds in `previous`, the pack this one replaces, keeps that pack's
 * entries as they are, their order and compressed bytes included, so its part comes out as before.
 * The build takes each library from the first hub bundle that carries its newest version, with
 * its files in that bundle's order, and the hub lists them in an order of its own: the refresh of
 * 2026-11-02 rewrote 30 parts whose libraries had not changed, because the new bundle of Branching
 * Scenario, the first to carry them, listed their files differently (#116).
 * @param {{ folder: string, files: Map<string, Uint8Array> }[]} libraries each folder's files, by their names in the pack
 * @param {Uint8Array} [previous] the pack this one replaces
 */
export async function writePack(libraries, previous) {
  const reader = previous ? new ZipReader(new Uint8ArrayReader(previous)) : null
  const before = new Map()
  for (const entry of reader ? await reader.getEntries() : []) {
    const slash = entry.filename.indexOf('/')
    if (entry.directory || slash < 0) continue
    const folder = entry.filename.slice(0, slash)
    if (!before.has(folder)) before.set(folder, [])
    before.get(folder).push(entry)
  }

  const writer = new ZipWriter(new BlobWriter('application/zip'), { lastModDate: FIXED_DATE, extendedTimestamp: false })
  await writer.add('h5p.json', new TextReader(PART_MANIFEST))
  for (const { folder, files } of libraries) {
    const kept = before.get(folder)
    if (kept && (await holds(kept, files))) {
      for (const entry of kept) {
        const raw = await entry.getData(new Uint8ArrayWriter(), { passThrough: true })
        await writer.add(entry.filename, new Uint8ArrayReader(raw), { passThrough: true, entry })
      }
    } else {
      for (const [name, bytes] of files) await writer.add(name, new Uint8ArrayReader(bytes))
    }
  }
  await reader?.close()
  return new Uint8Array(await (await writer.close()).arrayBuffer())
}

/** Whether a folder's entries in a pack hold exactly these files, by name and bytes. */
async function holds(entries, files) {
  if (entries.length !== files.size) return false
  for (const entry of entries) {
    const bytes = files.get(entry.filename)
    if (!bytes || bytes.length !== entry.uncompressedSize) return false
    if (Buffer.compare(await entry.getData(new Uint8ArrayWriter()), bytes) !== 0) return false
  }
  return true
}

/**
 * Writes `<outDir>/<folder>.h5p` for every library folder in the pack and `<outDir>/index.json`,
 * replacing whatever `outDir` held. Returns the index's entries.
 * @param {Uint8Array} pack the pack's bytes
 * @param {string} outDir
 */
export async function splitPack(pack, outDir) {
  const reader = new ZipReader(new Uint8ArrayReader(pack))
  const folders = new Map()
  for (const entry of await reader.getEntries()) {
    if (entry.directory) continue
    const slash = entry.filename.indexOf('/')
    if (slash < 0) continue
    const folder = entry.filename.slice(0, slash)
    if (!folders.has(folder)) folders.set(folder, [])
    folders.get(folder).push(entry)
  }

  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  // Every folder's `library.json` first: whether a library is carried for an H5P site's upload
  // check only is decided against the pack as a whole (`installOnly`).
  const read = []
  for (const [folder, entries] of [...folders].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!/^[A-Za-z0-9._-]+-\d+\.\d+$/.test(folder)) throw new Error(`${folder} is not a versioned library folder`)
    const libraryEntry = entries.find((entry) => entry.filename === `${folder}/library.json`)
    if (!libraryEntry) throw new Error(`${folder} has no library.json`)
    const library = JSON.parse(new TextDecoder().decode(await libraryEntry.getData(new Uint8ArrayWriter())))
    if (folder !== `${library.machineName}-${library.majorVersion}.${library.minorVersion}`) {
      throw new Error(`${folder}/library.json names ${library.machineName} ${library.majorVersion}.${library.minorVersion}`)
    }
    read.push({ folder, entries, library })
  }
  const newestMinor = new Map()
  for (const { library } of read) {
    const key = `${library.machineName}-${library.majorVersion}`
    newestMinor.set(key, Math.max(newestMinor.get(key) ?? -1, Number(library.minorVersion)))
  }

  const index = []
  for (const { folder, entries, library } of read) {
    const write = async (comment) => {
      const writer = new ZipWriter(new BlobWriter('application/zip'), { lastModDate: FIXED_DATE, extendedTimestamp: false })
      await writer.add('h5p.json', new TextReader(PART_MANIFEST))
      for (const entry of entries) {
        const raw = await entry.getData(new Uint8ArrayWriter(), { passThrough: true })
        await writer.add(entry.filename, new Uint8ArrayReader(raw), { passThrough: true, entry })
      }
      return new Uint8Array(await (await writer.close(comment)).arrayBuffer())
    }
    let bytes = await write()
    if (bytes.length < MIN_PART_SIZE) bytes = await write(padding(MIN_PART_SIZE - bytes.length))
    await writeFile(join(outDir, `${folder}.h5p`), bytes)

    const preloaded = dependenciesOf(library.preloadedDependencies)
    const dynamic = dependenciesOf(library.dynamicDependencies)
    const editor = dependenciesOf(library.editorDependencies)
    index.push({
      folder,
      machineName: library.machineName,
      majorVersion: Number(library.majorVersion),
      minorVersion: Number(library.minorVersion),
      patchVersion: Number(library.patchVersion ?? 0),
      ...(preloaded.length ? { preloadedDependencies: preloaded } : {}),
      ...(dynamic.length ? { dynamicDependencies: dynamic } : {}),
      ...(editor.length ? { editorDependencies: editor } : {}),
      ...(library.addTo ? { addTo: library.addTo } : {}),
      ...(installOnly(library, newestMinor.get(`${library.machineName}-${library.majorVersion}`)) ? { installOnly: true } : {}),
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex')
    })
  }
  await reader.close()

  await checkParts(outDir, index)
  // One library a line, so a refresh's diff reads as the libraries it changed.
  await writeFile(join(outDir, 'index.json'), `{"libraries": [\n${index.map((entry) => `  ${JSON.stringify(entry)}`).join(',\n')}\n]}\n`)
  return index
}

/**
 * Whether a library of the pack is carried for an H5P site's upload check only, and never served
 * by the player: an editor library, or an older minor of a major the pack has a newer minor of,
 * which the player plays in its place. H5P core's validator, which Moodle, WordPress and Drupal
 * run on an upload, wants every library a package carries to have its dependencies with it at the
 * exact major.minor, editor dependencies included (#146), so h5p-author carries these too; the
 * `pack` export of `index.js` leaves them out, and `install.js` has them.
 * @param {{ machineName: string, minorVersion: number | string }} library its `library.json`
 * @param {number} newestMinor the pack's newest minor of the library's major
 */
export function installOnly(library, newestMinor) {
  return library.machineName.startsWith('H5PEditor.') || Number(library.minorVersion) < newestMinor
}

/** A `library.json` dependency list, each entry's version as numbers. */
function dependenciesOf(list) {
  return (Array.isArray(list) ? list : []).map(({ machineName, majorVersion, minorVersion }) => ({
    machineName,
    majorVersion: Number(majorVersion),
    minorVersion: Number(minorVersion)
  }))
}

/** An archive comment of `length` bytes, ASCII, saying what it is for. */
function padding(length) {
  const text = 'Padding, so that a bundler does not inline this part as a data: URL. '
  return new TextEncoder().encode(text.repeat(Math.ceil(length / text.length)).slice(0, length))
}

/** Reads every part back, each entry's bytes checked against its CRC-32, so a bad copy stops the build. */
async function checkParts(outDir, index) {
  for (const { folder } of index) {
    const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(await readFile(join(outDir, `${folder}.h5p`)))))
    for (const entry of await reader.getEntries()) {
      if (!entry.directory) await entry.getData(new Uint8ArrayWriter(), { checkSignature: true })
    }
    await reader.close()
  }
}

/**
 * Writes the modules a bundler resolves into `dir`, the index as data with each part named by a
 * static `new URL` relative to the module: `index.js`, the `pack` export, the libraries the player
 * serves; and `install.js`, the same with the libraries carried for an H5P site's upload check
 * only (`installOnly`), for a page that writes packages. A bundler emits every part a module
 * names, so a page that only plays imports the first. With their `.d.ts` files.
 * @param {Array<object>} index
 * @param {string} dir the package directory
 * @param {string} name the package's name, for the pre-bundling fix below
 */
export async function writePackModule(index, dir = packageDir, name = '@missing-elements/h5p-libraries') {
  const url = (folder) => `unbundled(new URL(${JSON.stringify(`./parts/${folder}.h5p`)}, import.meta.url).href)`
  const list = (entries) => entries.map((entry) => `    { ...${JSON.stringify(entry)}, url: ${url(entry.folder)} }`).join(',\n')
  const header = `// Written by scripts/parts.mjs. Do not edit; run \`pnpm parts\` in packages/libraries.

// Vite's dev server pre-bundles dependencies into \`node_modules/.vite/deps/\`, which rewrites
// these URLs to files that were never put there. The package's own copy is still served at its
// real path, so a URL that landed in the pre-bundle directory is pointed back at it. A Vite
// build, Rollup and webpack never produce such a URL.
const VITE_DEPS = '/node_modules/.vite/deps/'
const PACKAGE_DIR = ${JSON.stringify(`/node_modules/${name}/`)}

function unbundled(href) {
  const url = new URL(href)
  const at = url.pathname.indexOf(VITE_DEPS)
  if (at < 0) return href
  url.pathname = url.pathname.slice(0, at) + PACKAGE_DIR + url.pathname.slice(at + VITE_DEPS.length)
  url.search = ''
  return url.href
}
`
  const played = index.filter((entry) => !entry.installOnly)
  const carried = index.filter((entry) => entry.installOnly)
  const module = `${header}
/**
 * The library pack, for \`<h5p-player>\`'s \`pack\` property: what \`parts/index.json\` says of each
 * library the player serves, and where its part is. Each URL is a static \`new URL\`, so a bundler
 * emits the part and rewrites the address; a learner's browser fetches only the parts a package
 * needs. The libraries carried for an H5P site's upload check only are in \`install.js\`.
 */
export const pack = {
  libraries: [
${list(played)}
  ]
}
`
  const install = `${header}
import { pack as played } from './index.js'

/**
 * The whole pack, for a page that writes packages with \`@missing-elements/h5p-author/browser\`:
 * the libraries the player serves, then the ones an H5P site's upload check wants with them
 * (\`installOnly\`): the editor libraries, and an older minor of a library that another names
 * exactly. A bundler emits every part named here, about ${Math.round(carried.reduce((sum, { size }) => sum + size, 0) / 1e5) / 10} MB more than \`index.js\`'s,
 * so a page that only plays imports that one.
 */
export const pack = {
  libraries: [
    ...played.libraries,
${list(carried)}
  ]
}
`
  const types = `// Written by scripts/parts.mjs. Do not edit; run \`pnpm parts\` in packages/libraries.

export interface PackDependency {
  machineName: string
  majorVersion: number
  minorVersion: number
}

/** One library of the pack, as \`parts/index.json\` describes it, and where its part is. */
export interface PackLibrary {
  /** \`<machineName>-<major>.<minor>\`, the folder the part holds. */
  folder: string
  machineName: string
  majorVersion: number
  minorVersion: number
  patchVersion: number
  /** The dependencies its \`library.json\` declares. */
  preloadedDependencies?: PackDependency[]
  dynamicDependencies?: PackDependency[]
  editorDependencies?: PackDependency[]
  /** For an addon, the content it is added to, as its \`library.json\` says. */
  addTo?: unknown
  /**
   * Carried for an H5P site's upload check only, which wants every library a package carries to
   * have its dependencies with it at the exact major.minor, editor dependencies included: an
   * editor library, or an older minor the player plays the newer one for. Never served by the
   * player; \`install.js\` has these, \`index.js\` does not.
   */
  installOnly?: true
  /** The part's size in bytes. */
  size: number
  /** The part's SHA-256, in hex. */
  sha256: string
  url: string
}

/** For \`<h5p-player>\`'s \`pack\` property. */
export declare const pack: { libraries: PackLibrary[] }
`
  const installTypes = `// Written by scripts/parts.mjs. Do not edit; run \`pnpm parts\` in packages/libraries.

import type { PackLibrary } from './index.js'

/** The whole pack, \`installOnly\` libraries included, for a page that writes packages. */
export declare const pack: { libraries: PackLibrary[] }
`
  await writeFile(join(dir, 'index.js'), module)
  await writeFile(join(dir, 'index.d.ts'), types)
  await writeFile(join(dir, 'install.js'), install)
  await writeFile(join(dir, 'install.d.ts'), installTypes)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = await splitPack(new Uint8Array(await readFile(join(packageDir, 'libraries.h5p'))), join(packageDir, 'parts'))
  await writePackModule(index)
  const total = index.reduce((sum, { size }) => sum + size, 0)
  console.log(`[parts] ${index.length} parts, ${(total / 1e6).toFixed(2)} MB -> packages/libraries/parts/`)
}
