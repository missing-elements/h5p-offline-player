import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, openAsBlob } from 'node:fs'
import { readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { crc32 } from 'node:zlib'
import { BlobReader, TextReader, TextWriter, ZipReader, ZipWriter, configure } from '@zip.js/zip.js'
import { EmbedError, PLAYER_FILES, installed } from './build.mjs'

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
 */

configure({ useWebWorkers: false })

const SCORM = fileURLToPath(new URL('../scorm', import.meta.url))
const SITE = fileURLToPath(new URL('../site', import.meta.url))

/** What the zip calls the package; the launch page plays it by this name. */
const PACKAGE = 'package.h5p'
/** Where the zip keeps the library pack's parts it carries, as the embed site does. */
const LIBRARIES = 'libraries'

/**
 * A dependency as `h5p.json` and every `library.json` list them, or nothing for an entry that is
 * not one.
 * @param {unknown} json
 * @returns {{ machineName: string, major: number, minor: number }[]}
 */
function dependenciesIn(json) {
  const list = /** @type {{ preloadedDependencies?: unknown }} */ (json ?? {}).preloadedDependencies
  if (!Array.isArray(list)) return []
  return list.flatMap((dependency) => {
    const major = Number(dependency?.majorVersion)
    const minor = Number(dependency?.minorVersion)
    return typeof dependency?.machineName === 'string' && Number.isInteger(major) && Number.isInteger(minor)
      ? [{ machineName: dependency.machineName, major, minor }]
      : []
  })
}

/**
 * The folder that serves a dependency, by the player's own rule: its versioned or bare name when
 * that folder has a `library.json`, else the lowest versioned folder of the same major with a
 * minor at least as high (`reachableFolder` in the player's `package-reader.ts`).
 * @internal
 * @param {{ machineName: string, major: number, minor: number }} dependency
 * @param {ReadonlySet<string>} names the archive's entry names
 * @returns {string | undefined}
 */
export function servingFolder({ machineName, major, minor }, names) {
  const own = [`${machineName}-${major}.${minor}`, machineName].find((folder) => names.has(`${folder}/library.json`))
  if (own) return own
  let best
  for (const name of names) {
    const match = /^(.+)-(\d+)\.(\d+)\/library\.json$/.exec(name)
    if (!match || match[1] !== machineName || Number(match[2]) !== major || Number(match[3]) < minor) continue
    if (!best || Number(match[3]) < best.minor) best = { folder: `${match[1]}-${match[2]}.${match[3]}`, minor: Number(match[3]) }
  }
  return best?.folder
}

/**
 * What the content asks for, and what those libraries need in turn, that no folder in `names`
 * serves: the player refuses such a package when it opens it, and the deep walk is the one it makes
 * before the runtime boots (`missingDependencies`). The sub-content the parameters name counts
 * too, which the player finds missing only when the runtime reaches it.
 * @param {{ machineName: string, major: number, minor: number }[]} roots
 * @param {ReadonlySet<string>} names
 * @param {(name: string) => Promise<unknown>} read a `library.json` among `names`, parsed
 * @returns {Promise<{ machineName: string, major: number, minor: number }[]>}
 */
async function missingLibraries(roots, names, read) {
  /** @type {Map<string, { machineName: string, major: number, minor: number }>} */
  const missing = new Map()
  const seen = new Set()
  let level = roots
  while (level.length > 0) {
    const next = []
    for (const dependency of level) {
      const key = `${dependency.machineName} ${dependency.major}.${dependency.minor}`
      if (seen.has(key)) continue
      seen.add(key)
      const folder = servingFolder(dependency, names)
      if (!folder) missing.set(key, dependency)
      else next.push(...dependenciesIn(await read(`${folder}/library.json`)))
    }
    level = next
  }
  return [...missing].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, dependency]) => dependency)
}

/*
 * The library pack's part of the work: which of its parts the package needs. These follow the
 * player's own functions, named on each, so that the element, planning from the zip's index,
 * asks for exactly the parts the zip carries; keep them in step.
 */

/**
 * The sub-content libraries the parameters name, by each object's `library` string, as
 * `"H5P.MultiChoice 1.16"`: what a full export's `h5p.json` lists and a stripped one's does not.
 * The player's `librariesNamedIn`.
 * @param {unknown} params
 * @returns {{ machineName: string, major: number, minor: number }[]}
 */
function librariesNamedIn(params) {
  /** @type {Map<string, { machineName: string, major: number, minor: number }>} */
  const found = new Map()
  /** @param {unknown} value @param {number} depth */
  const walk = (value, depth) => {
    if (depth > 64 || !value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1)
      return
    }
    const library = /** @type {{ library?: unknown }} */ (value).library
    if (typeof library === 'string') {
      const match = /^([A-Za-z0-9_.-]+) (\d+)\.(\d+)$/.exec(library)
      if (match && !found.has(match[1])) found.set(match[1], { machineName: match[1], major: Number(match[2]), minor: Number(match[3]) })
    }
    for (const child of Object.values(value)) walk(child, depth + 1)
  }
  walk(params, 0)
  return [...found.values()]
}

/**
 * An addon's patterns, under `addTo.content.types[].text.regex`, PHP's `/…/flags` made
 * JavaScript's; one JavaScript cannot read, or with a flag it has no counterpart for, is left out.
 * The player's `addonPatterns`.
 * @param {unknown} addTo
 * @returns {RegExp[]}
 */
function addonPatterns(addTo) {
  const types = /** @type {{ content?: { types?: unknown } } | null | undefined} */ (addTo)?.content?.types
  if (!Array.isArray(types)) return []
  const patterns = []
  for (const type of types) {
    const source = type?.text?.regex
    if (typeof source !== 'string' || source.length < 2) continue
    const delimiter = source[0]
    if (/[\p{L}\p{N}\\\s([{<]/u.test(delimiter)) continue
    const end = source.lastIndexOf(delimiter)
    const flags = source.slice(end + 1)
    if (end < 1 || /[^imsu]/.test(flags)) continue
    try {
      patterns.push(new RegExp(source.slice(1, end), flags))
    } catch {
      // PCRE that JavaScript does not read.
    }
  }
  return patterns
}

/**
 * Whether a string anywhere in the parameters matches one of the patterns. The player's
 * `textMatches`.
 * @param {unknown} params
 * @param {RegExp[]} patterns
 */
function textMatches(params, patterns) {
  /** @param {unknown} value @param {number} depth @returns {boolean} */
  const walk = (value, depth) => {
    if (typeof value === 'string') return patterns.some((pattern) => pattern.test(value))
    if (depth > 64 || !value || typeof value !== 'object') return false
    return Object.values(value).some((child) => walk(child, depth + 1))
  }
  return patterns.length > 0 && walk(params, 0)
}

/**
 * The library folders the package carries, each as its `library.json` says: the player's
 * `ownLibraries` once every `library.json` is at hand. One that does not parse, or a folder named
 * for another library, is left out.
 * @param {Iterable<string>} names
 * @param {(name: string) => Promise<unknown>} read
 */
async function ownLibraries(names, read) {
  /** @param {unknown} part */
  const version = (part) => (typeof part === 'number' && Number.isInteger(part) && part >= 0 ? part : typeof part === 'string' && /^\d+$/.test(part) ? Number(part) : null)
  const libraries = []
  for (const name of names) {
    const slash = name.indexOf('/')
    if (slash < 0 || name.slice(slash + 1) !== 'library.json') continue
    const folder = name.slice(0, slash)
    const library = /** @type {{ machineName?: unknown, majorVersion?: unknown, minorVersion?: unknown } | null} */ (await read(name).catch(() => null))
    const major = version(library?.majorVersion)
    const minor = version(library?.minorVersion)
    const machineName = library?.machineName
    if (typeof machineName !== 'string' || major === null || minor === null) continue
    const versioned = /^(.+)-(\d+)\.(\d+)$/.exec(folder)
    if (versioned ? versioned[1] !== machineName || Number(versioned[2]) !== major : folder !== machineName) continue
    libraries.push({ folder, machineName, major, minor, dependencies: dependenciesIn(library) })
  }
  return libraries
}

/**
 * The library pack's index, its `parts/index.json`, as the plan reads it. `entry` is the library's
 * own record, which the zip's index repeats.
 * @param {unknown} index
 */
function packLibraries(index) {
  const list = /** @type {{ libraries?: unknown } | null} */ (index)?.libraries
  return (Array.isArray(list) ? list : []).flatMap((entry) => {
    const { folder, machineName, majorVersion, minorVersion, sha256, addTo } = entry ?? {}
    return typeof folder === 'string' && typeof machineName === 'string' && Number.isInteger(majorVersion) && Number.isInteger(minorVersion) && typeof sha256 === 'string'
      ? [{ folder, machineName, major: Number(majorVersion), minor: Number(minorVersion), sha256, dependencies: dependenciesIn(entry), addTo, entry: /** @type {object} */ (entry) }]
      : []
  })
}

/**
 * The parts of the library pack the package needs, and the folders of its own they replace: the
 * player's `planPack` (`sw/pack-plan.ts`) as the launch page has the element run it, filling gaps
 * with nothing attached before (`refresh-libraries="off"`).
 * - What the content asks for, and the package carries at that major and at no lower minor, plays
 *   from the package. Anything else comes from the pack, which has one version of each major, and
 *   so does whatever a part needs; an older minor the package carries gives way to the part.
 * - Once anything comes from the pack, so do the addons whose pattern matches a string in the
 *   parameters: H5P.MathDisplay, for LaTeX.
 * @param {object} input
 * @param {Awaited<ReturnType<typeof ownLibraries>>} input.own
 * @param {{ machineName: string, major: number, minor: number }[]} input.roots what `h5p.json`
 *   declares and the parameters name as sub-content
 * @param {unknown} input.params
 * @param {ReturnType<typeof packLibraries>} input.pack
 */
function planParts({ own, roots, params, pack }) {
  const byLibrary = new Map(pack.map((library) => [`${library.machineName} ${library.major}`, library]))
  /** @type {Map<string, ReturnType<typeof packLibraries>[number]>} */
  const planned = new Map()
  /** @type {string[]} */
  const superseded = []
  let carried = own
  const queue = [...roots]
  const seen = new Set()

  /**
   * @param {{ machineName: string, major: number, minor: number }} version
   * @param {{ machineName: string, major: number, minor: number }} dependency
   */
  const satisfies = (version, dependency) =>
    version.machineName === dependency.machineName && version.major === dependency.major && version.minor >= dependency.minor
  /** @param {ReturnType<typeof packLibraries>[number]} library */
  const plan = (library) => {
    if (planned.has(library.folder)) return
    planned.set(library.folder, library)
    queue.push(...library.dependencies)
  }
  const follow = () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const dependency = next
      const key = `${dependency.machineName} ${dependency.major}.${dependency.minor}`
      if (seen.has(key)) continue
      seen.add(key)
      const ownVersion = carried.find((library) => satisfies(library, dependency))
      if (ownVersion) {
        queue.push(...ownVersion.dependencies)
        continue
      }
      if ([...planned.values()].some((library) => satisfies(library, dependency))) continue
      const candidate = byLibrary.get(`${dependency.machineName} ${dependency.major}`)
      if (!candidate || candidate.minor < dependency.minor) continue
      const older = carried.find((library) => library.machineName === dependency.machineName && library.major === dependency.major)
      if (older) {
        carried = carried.filter((library) => library !== older)
        superseded.push(older.folder)
      }
      plan(candidate)
    }
  }

  follow()
  if (planned.size > 0) {
    for (const addon of pack) {
      if (addon.addTo === undefined || carried.some((library) => library.machineName === addon.machineName)) continue
      if (textMatches(params, addonPatterns(addon.addTo))) plan(addon)
    }
    follow()
  }
  return { parts: [...planned.values()].sort((a, b) => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0)), superseded }
}

/** @param {string} text */
const escapeXml = (text) =>
  text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char] ?? char)

/** @param {string} text */
const escapeHtml = (text) => text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char)

/**
 * The page's language: `h5p.json`'s `defaultLanguage` when it is a language tag, else English.
 * @param {unknown} value
 */
function languageTag(value) {
  return typeof value === 'string' && /^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/i.test(value) ? value : 'en'
}

/**
 * The manifest, SCORM 1.2's: one organisation with one item, played by one SCO, the launch page.
 * Every file is listed, which Moodle does not need and some LMSs do.
 * @param {{ identifier: string, title: string, files: string[] }} manifest
 */
function manifestXml({ identifier, title, files }) {
  const name = escapeXml(title)
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${identifier}" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="organization">
    <organization identifier="organization">
      <title>${name}</title>
      <item identifier="item" identifierref="sco" isvisible="true">
        <title>${name}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="sco" type="webcontent" adlcp:scormtype="sco" href="index.html">
${files.map((file) => `      <file href="${escapeXml(file)}"/>`).join('\n')}
    </resource>
  </resources>
</manifest>
`
}

/** @param {{ version: string, source: string, pack: string | null }} zip `pack`, the library pack's version when the zip carries parts of it */
function notice({ version, source, pack }) {
  return `This is a SCORM 1.2 package written by @missing-elements/h5p-embed. It plays ${source} in an
LMS and reports its score, its result and the time spent, and keeps the learner's place.

  imsmanifest.xml   the package's manifest
  index.html, scorm.js, embed.css
                    the launch page and its bridge to the LMS: MIT
  h5p-player.js, h5p-sw.js, h5p-jobs.js
                    @missing-elements/h5p-offline-player ${version}: MIT. The Service Worker,
                    h5p-sw.js, also carries zip.js, BSD-3-Clause, its licence in its header.
  frame-assets/     @missing-elements/h5p-runtime, the H5P core runtime: GPL-3.0-only. Its
                    LICENSE.txt and NOTICE.txt say what it is and where its source is; keep them
                    with it.
  ${PACKAGE}       the H5P package, its content and libraries under their own licences, which its
                    h5p.json and each library's library.json name.
${
  pack
    ? `  ${LIBRARIES}/        @missing-elements/h5p-libraries ${pack}, the H5P hub's libraries: those the package
                    needs and does not carry, one archive per library and index.json, each under
                    its own licence, listed in libraries.txt.
`
    : ''
}
https://github.com/missing-elements/h5p-offline-player/tree/main/packages/embed
`
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
 * A file's CRC-32, read as a stream.
 * @param {string} file
 */
async function fileCrc32(file) {
  let crc = 0
  for await (const chunk of createReadStream(file)) crc = crc32(chunk, crc)
  return crc
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
  const pack = packLibraries(JSON.parse(await readFile(join(packDir, 'index.json'), 'utf8')))

  // What the package declares and carries, and what the pack adds, read before anything is written.
  /** @type {any} `h5p.json`, parsed */
  let manifest
  /** @type {ReturnType<typeof planParts>} */
  let plan
  let reader
  try {
    reader = new ZipReader(new BlobReader(await openAsBlob(source)))
    // One unsafe name does not refuse the package, as it does not in the player, which leaves that
    // entry out.
    const entries = await reader.getEntries({ filenameValidation: 'tolerant' })
    const byName = new Map(entries.filter((entry) => !entry.directory).map((entry) => [entry.filename, entry]))
    /** @param {string} name */
    const readJson = async (name) => {
      const entry = byName.get(name)
      if (!entry?.getData) throw new EmbedError(`${basename(h5p)} has no ${name}: it is not an H5P package.`)
      const text = await entry.getData(new TextWriter())
      try {
        return JSON.parse(text)
      } catch {
        throw new EmbedError(`${basename(h5p)}: ${name} is not JSON.`)
      }
    }
    manifest = await readJson('h5p.json')
    if (dependenciesIn(manifest).length === 0) {
      throw new EmbedError(`${basename(h5p)}: h5p.json names no libraries, so there is nothing to play.`)
    }
    const params = await readJson('content/content.json')
    const roots = [...dependenciesIn(manifest), ...librariesNamedIn(params)]
    plan = planParts({ own: await ownLibraries(byName.keys(), readJson), roots, params, pack })

    // Held to its libraries as the player holds it once the parts are attached: the folders they
    // replace withheld, and each part's `library.json` naming what its record in the index does.
    const parts = new Map(plan.parts.map((part) => [`${part.folder}/library.json`, part.entry]))
    const withheld = new Set(plan.superseded)
    const names = new Set([...byName.keys()].filter((name) => !withheld.has(name.split('/')[0])))
    for (const name of parts.keys()) names.add(name)
    const missing = await missingLibraries(roots, names, async (name) => parts.get(name) ?? readJson(name))
    if (missing.length > 0) {
      const packed = new Map(pack.map((library) => [`${library.machineName} ${library.major}`, library]))
      const listed = missing.map(({ machineName, major, minor }) => {
        const older = packed.get(`${machineName} ${major}`)
        return `${machineName} ${major}.${minor}${older ? ` (the pack has ${older.major}.${older.minor})` : ''}`
      })
      throw new EmbedError(
        `${basename(h5p)} needs libraries that neither it nor the library pack carries: ${listed.join(', ')}. ` +
          'Export the package with its libraries, as Lumi and the H5P plugins of Moodle, WordPress and Drupal do.'
      )
    }
  } catch (error) {
    if (error instanceof EmbedError) throw error
    throw new EmbedError(`${basename(h5p)} could not be read as a zip archive: ${error instanceof Error ? error.message : error}`)
  } finally {
    await reader?.close()
  }

  // Control characters, which XML refuses, read as spaces: a title pasted in can carry one.
  const named = typeof manifest.title === 'string' ? manifest.title.replace(/[\x00-\x1f\x7f]+/g, ' ').trim() : ''
  const title = named || basename(h5p, extname(h5p))
  // The learner's saved place is kept against the libraries too, as the player keeps it against
  // the revision: a zip written with others starts learners over, as a refreshed package does.
  const hashes = [await sha256(source), ...plan.parts.map((part) => part.sha256)]
  const build = (hashes.length === 1 ? hashes[0] : createHash('sha256').update(hashes.join('\n')).digest('hex')).slice(0, 16)
  const player = dirname(installed('@missing-elements/h5p-offline-player/dist/h5p-player.js', 'Run `pnpm build` in the workspace, or reinstall this package.'))
  const runtime = dirname(installed('@missing-elements/h5p-runtime/dist/h5p.css', 'Run `pnpm build` in the workspace, or reinstall this package.'))
  const version = (await readFile(join(player, 'VERSION'), 'utf8').catch(() => 'unknown')).trim()
  const packVersion = plan.parts.length > 0 ? String(JSON.parse(await readFile(join(dirname(packDir), 'package.json'), 'utf8')).version) : null

  const page = (await readFile(join(SCORM, 'index.html'), 'utf8'))
    .replace('%LANG%', languageTag(manifest.defaultLanguage))
    // A function, so that a title's `$&` or `$'` is written as it is rather than read as a pattern.
    .replace('%TITLE%', () => escapeHtml(title))
    .replace('%BUILD%', build)
    // The element plans from the zip's index what the writer planned, and plays the package's own
    // libraries as they are.
    .replace('%LIBRARIES%', packVersion ? ` libraries="pack" pack-base="./${LIBRARIES}/" refresh-libraries="off"` : '')
  /** @type {[string, { text: string } | { file: string }][]} zip path, and what it holds */
  const files = [
    ['index.html', { text: page }],
    ['scorm.js', { file: join(SCORM, 'scorm.js') }],
    ['embed.css', { file: join(SITE, 'embed.css') }],
    ...PLAYER_FILES.map((name) => /** @type {[string, { file: string }]} */ ([name, { file: join(player, name) }])),
    ...(await filesUnder(runtime)).map((name) => /** @type {[string, { file: string }]} */ ([`frame-assets/${name}`, { file: join(runtime, name) }])),
    [PACKAGE, { file: source }]
  ]
  if (packVersion) {
    files.push([`${LIBRARIES}/index.json`, { text: `${JSON.stringify({ libraries: plan.parts.map((part) => part.entry) }, null, 2)}\n` }])
    for (const part of plan.parts) files.push([`${LIBRARIES}/${part.folder}.h5p`, { file: join(packDir, `${part.folder}.h5p`) }])
    files.push(['libraries.txt', { file: join(dirname(packDir), 'libraries.txt') }])
  }
  files.push(['NOTICE.txt', { text: notice({ version, source: basename(h5p), pack: packVersion }) }])
  const xml = manifestXml({ identifier: `h5p-${build}`, title, files: ['imsmanifest.xml', ...files.map(([name]) => name)] })

  // Written beside the target and renamed into place, so a failure leaves no half-written zip.
  const partial = `${target}.${process.pid}.partial`
  try {
    const zip = new ZipWriter(Writable.toWeb(createWriteStream(partial)))
    await zip.add('imsmanifest.xml', new TextReader(xml))
    for (const [name, content] of files) {
      if ('text' in content) {
        await zip.add(name, new TextReader(content.text), { level: 6 })
        continue
      }
      const blob = await openAsBlob(content.file)
      // The package, the pack's parts and the fonts are compressed already, so they are stored.
      // Written into a stream, an entry gets a data descriptor, and Java's ZipInputStream, which
      // SCORM Cloud imports with, refuses a stored entry that has one. Passed through with its size
      // and CRC, it gets a complete local header instead, and is still streamed, not held.
      if (name.endsWith('.h5p') || name.endsWith('.woff2')) {
        await zip.add(name, new BlobReader(blob), { passThrough: true, compressionMethod: 0, uncompressedSize: blob.size, crc32: await fileCrc32(content.file) })
      } else {
        await zip.add(name, new BlobReader(blob), { level: 6 })
      }
    }
    await zip.close()
    await rename(partial, target)
  } catch (error) {
    await rm(partial, { force: true })
    throw error
  }

  return { out: target, title, version, libraries: plan.parts.map((part) => part.folder), build, size: (await stat(target)).size }
}
