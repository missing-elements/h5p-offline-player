import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, openAsBlob } from 'node:fs'
import { readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { Writable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ZipWriter } from '@zip.js/zip.js'
import { installed } from './build.mjs'
import { addScormEntries, buildStamp, readPackage, scormEntries, scormTitle } from './scorm-core.mjs'
import { EmbedError, PLAYER_FILES } from './shared.mjs'

/**
 * Writes a SCORM 1.2 package that plays one `.h5p` in an LMS and reports its result there: the
 * launch page and its bridge to the LMS's API, the player, the H5P runtime and the package, in
 * one zip a teacher uploads as a SCORM activity. The LMS serves the files from its own origin,
 * under a path of the package's own, so the player's Service Worker registers there, scoped to
 * that path, and nothing is fetched from anywhere else.
 *
 * The package plays trusted, as every SCORM package runs its own code on the LMS's origin, with the
 * libraries it carries. What it does not carry, as an export from h5p.com or h5p.org carries none,
 * comes from the library pack, written into the zip: only the parts it needs. One that needs a
 * library neither has is refused here rather than in front of a learner. Checked against Moodle 4.5
 * on 2026-10-28: the worker registered under `pluginfile.php`, the package was read by ranges, and
 * the score reached the gradebook.
 *
 * What the zip is and how it is written is `scorm-core.mjs`'s, shared with the page's builder;
 * this is the Node side: the files from the installed packages, and the zip to a path.
 */

const SCORM = fileURLToPath(new URL('../scorm', import.meta.url))
const SITE = fileURLToPath(new URL('../site', import.meta.url))

/**
 * The library pack's index, its `parts/index.json`, as the plan takes it: each library's record,
 * which the zip's index repeats as `record`, with the part's file as `url`. A record the index got
 * wrong is left out.
 * @param {unknown} index
 * @param {string} packDir the folder holding the index and the parts
 * @returns {import('./scorm-core.mjs').PackPart[]}
 */
function packLibraries(index, packDir) {
  const list = /** @type {{ libraries?: unknown } | null} */ (index)?.libraries
  return (Array.isArray(list) ? list : []).flatMap((record) => {
    const { folder, machineName, majorVersion, minorVersion, patchVersion, size, sha256 } = record ?? {}
    if (typeof folder !== 'string' || typeof machineName !== 'string' || ![majorVersion, minorVersion, patchVersion, size].every(Number.isInteger) || typeof sha256 !== 'string') return []
    const library = /** @type {import('@missing-elements/h5p-offline-player/plan').PackLibrary} */ (record)
    return [{ ...library, url: pathToFileURL(join(packDir, `${folder}.h5p`)).href, record: library }]
  })
}

/**
 * A file's SHA-256, read as a stream.
 * @param {string} file
 */
function sha256(file) {
  return new Promise((done, fail) => {
    const hash = createHash('sha256')
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', fail)
      .on('end', () => done(hash.digest('hex')))
  })
}

/**
 * Every file under a folder, as zip paths relative to it, sorted.
 * @param {string} dir
 */
async function filesUnder(dir) {
  const files = []
  for (const name of await readdir(dir, { recursive: true })) {
    if ((await stat(join(dir, name))).isFile()) files.push(name.split(sep).join('/'))
  }
  return files.sort()
}

/**
 * What `buildScorm` wrote, for a summary.
 * @typedef {object} BuiltScorm
 * @property {string} out the zip, as an absolute path
 * @property {string} title the package's title, as the LMS lists it: `h5p.json`'s, or the file's name
 * @property {string} version the player's version, as its `dist/VERSION` says
 * @property {string[]} libraries the folders of the libraries the zip carries from the library
 *   pack, for a package that does not carry them itself; none for one that does
 * @property {string} build the first 16 hex digits of the package's SHA-256, or, with libraries
 *   from the pack, of one over its and theirs: a learner's saved place is kept against it, and
 *   handed back only to the same package playing with the same libraries
 * @property {number} size the zip's size in bytes
 */

/**
 * Writes a SCORM 1.2 zip that plays `h5p` in an LMS, with the parts of the library pack it needs
 * and does not carry. Refuses a package that needs a library neither it nor the pack has, and a
 * file already at `out` unless `force`.
 *
 * @param {object} options
 * @param {string} options.h5p the package to wrap
 * @param {string} options.out the zip to write
 * @param {boolean} [options.force] replace a file already at `out`
 * @returns {Promise<BuiltScorm>}
 */
export async function buildScorm({ h5p, out, force = false }) {
  if (!h5p) throw new EmbedError('No package given.')
  if (!out) throw new EmbedError('No output file given.')
  const source = resolve(h5p)
  const target = resolve(out)
  if (source === target) throw new EmbedError(`${out} is the package itself. Name another file to write.`)
  const sourceInfo = await stat(source).catch(() => null)
  if (!sourceInfo?.isFile()) throw new EmbedError(`No such file: ${h5p}`)
  const targetInfo = await stat(target).catch(() => null)
  if (targetInfo?.isDirectory()) throw new EmbedError(`${out} is a folder. Name the zip to write.`)
  if (targetInfo && !force) throw new EmbedError(`${out} exists. Pass --force to replace it.`)

  const packDir = dirname(installed('@missing-elements/h5p-libraries/parts/index.json', 'Reinstall this package.'))
  const pack = packLibraries(JSON.parse(await readFile(join(packDir, 'index.json'), 'utf8')), packDir)

  // What the package declares and carries, and what the pack adds, read before anything is written.
  const { manifest, parts } = await readPackage(await openAsBlob(source), basename(h5p), pack)
  const title = scormTitle(manifest, basename(h5p, extname(h5p)))
  // The learner's saved place is kept against the libraries too, as the player keeps it against
  // the revision: a zip written with others starts learners over, as a refreshed package does.
  const build = await buildStamp(await sha256(source), parts)
  const player = dirname(installed('@missing-elements/h5p-offline-player/dist/h5p-player.js', 'Run `pnpm build` in the workspace, or reinstall this package.'))
  const runtime = dirname(installed('@missing-elements/h5p-runtime/dist/h5p.css', 'Run `pnpm build` in the workspace, or reinstall this package.'))
  const version = (await readFile(join(player, 'VERSION'), 'utf8').catch(() => 'unknown')).trim()
  const packVersion = parts.length > 0 ? String(JSON.parse(await readFile(join(dirname(packDir), 'package.json'), 'utf8')).version) : null

  /** @param {string[]} names @param {(name: string) => string} at */
  const blobs = async (names, at) => new Map(await Promise.all(names.map(async (name) => /** @type {[string, Blob]} */ ([name, await openAsBlob(at(name))]))))
  const { entries, xml } = scormEntries({
    manifest,
    source: basename(h5p),
    title,
    build,
    version,
    packVersion,
    parts,
    files: {
      launch: await readFile(join(SCORM, 'index.html'), 'utf8'),
      bridge: await openAsBlob(join(SCORM, 'scorm.js')),
      lz: await openAsBlob(join(SCORM, 'lz-string.js')),
      css: await openAsBlob(join(SITE, 'embed.css')),
      player: await blobs(PLAYER_FILES, (name) => join(player, name)),
      runtime: await blobs(await filesUnder(runtime), (name) => join(runtime, name)),
      pkg: await openAsBlob(source),
      parts: await blobs(parts.map((part) => part.folder), (folder) => join(packDir, `${folder}.h5p`)),
      librariesText: parts.length > 0 ? await openAsBlob(join(dirname(packDir), 'libraries.txt')) : null
    }
  })

  // Written beside the target and renamed into place, so a failure leaves no half-written zip.
  const partial = `${target}.${process.pid}.partial`
  try {
    const zip = new ZipWriter(Writable.toWeb(createWriteStream(partial)), { useWebWorkers: false })
    await addScormEntries(zip, { entries, xml })
    await zip.close()
    await rename(partial, target)
  } catch (error) {
    await rm(partial, { force: true })
    throw error
  }

  return { out: target, title, version, libraries: parts.map((part) => part.folder), build, size: (await stat(target)).size }
}
