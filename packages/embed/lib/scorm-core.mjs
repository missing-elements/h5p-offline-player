import { BlobReader, TextReader, TextWriter, ZipReader } from '@zip.js/zip.js'
import { crc32 } from '@missing-elements/h5p-normalize/crc32'
import { dependenciesIn, indexLibraryFolders, librariesNamedIn, ownLibraries, planPack, reachableFolder, walkDependencies } from '@missing-elements/h5p-offline-player/plan'
import { EmbedError, PLAYER_FILES } from './shared.mjs'

/**
 * What the SCORM package is, wherever it is written. The command's `buildScorm` in Node and the
 * page's `buildScormInPage` in a browser read the package and plan its parts here, lay out the
 * same entries and write them the same way, and differ only in where the bytes come from and
 * where the zip goes: so a zip built in a browser is the zip the command writes, which is what
 * the LMSs were checked with. No Node import, so the page's bundle carries this as it is.
 */

/** What the zip calls the package; the launch page plays it by this name. */
export const PACKAGE = 'package.h5p'
/** Where the zip keeps the library pack's parts it carries, as the embed site does. */
export const LIBRARIES = 'libraries'

/**
 * The runtime's `dist/` as a page has to name it, since a folder on a server cannot be listed:
 * every file but the fonts, which `MANIFEST.json` names. Node lists the folder instead, and the
 * test of the page's build holds the two to each other, so a file the runtime adds shows up there.
 */
export const RUNTIME_FILES = ['frame.bundle.js', 'frame-boot.js', 'h5p.css', 'l10n.js', 'LICENSE.txt', 'NOTICE.txt', 'MANIFEST.json', 'fonts/Inter-LICENSE.txt', 'fonts/OpenSans-OFL.txt']

/**
 * The runtime's files, from its manifest: `RUNTIME_FILES` and the fonts it names.
 * @param {unknown} manifest the runtime's `MANIFEST.json`, parsed
 */
export function runtimeFiles(manifest) {
  const fonts = /** @type {{ fonts?: unknown } | null} */ (manifest)?.fonts
  const named = (Array.isArray(fonts) ? fonts : []).flatMap((font) => (typeof font?.file === 'string' ? [`fonts/${font.file}`] : []))
  return [...RUNTIME_FILES, ...named]
}

/**
 * A part of the library pack as the writer takes it: its record in the index, which the zip's
 * index repeats as `record`, and where its archive is.
 * @typedef {import('@missing-elements/h5p-offline-player/plan').PackLibrary & { url: string, record: import('@missing-elements/h5p-offline-player/plan').PackLibrary }} PackPart
 */

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
 * What a zip is written as: the SCORM version, 1.2 unless 2004 4th Edition is asked for; a pass
 * mark out of 100, or `null` for the content's own result; and whether content that finishes
 * without a score counts as 100. Each is off unless asked for, and a zip written with none is
 * the one written before any existed.
 * @typedef {{ scormVersion: '1.2' | '2004', passMark: number | null, completionScore: boolean }} ScormOptions
 */

/**
 * The options as given, checked: an unknown version or a pass mark outside 0 to 100 is refused,
 * and the pass mark is kept to the hundredth, as the score is.
 * @param {{ scormVersion?: unknown, passMark?: unknown, completionScore?: unknown }} [given]
 * @returns {ScormOptions}
 */
export function scormOptions({ scormVersion, passMark, completionScore } = {}) {
  const version = scormVersion ?? '1.2'
  if (version !== '1.2' && version !== '2004') throw new EmbedError(`The SCORM version is 1.2 or 2004, not ${typeof version === 'string' ? JSON.stringify(version) : String(version)}.`)
  const mark = passMark ?? null
  if (mark !== null && (typeof mark !== 'number' || !Number.isFinite(mark) || mark < 0 || mark > 100)) {
    throw new EmbedError(`The pass mark is a number from 0 to 100, not ${typeof mark === 'string' ? JSON.stringify(mark) : String(mark)}.`)
  }
  return { scormVersion: version, passMark: mark === null ? null : Math.round(mark * 100) / 100, completionScore: completionScore === true }
}

/**
 * The manifest: one organisation with one item, played by one SCO, the launch page. Every file is
 * listed, which Moodle does not need and some LMSs do. SCORM 1.2's, the pass mark as the item's
 * mastery score; or SCORM 2004 4th Edition's, the pass mark as its primary objective's least
 * measure, satisfied by the score, from which the LMS sets `cmi.scaled_passing_score`.
 * @param {{ identifier: string, title: string, files: string[], options: ScormOptions }} manifest
 */
function manifestXml({ identifier, title, files, options: { scormVersion, passMark } }) {
  const name = escapeXml(title)
  const listed = files.map((file) => `      <file href="${escapeXml(file)}"/>`).join('\n')
  if (scormVersion === '2004') {
    const objective =
      passMark === null
        ? ''
        : `
        <imsss:sequencing>
          <imsss:objectives>
            <imsss:primaryObjective objectiveID="primary" satisfiedByMeasure="true">
              <imsss:minNormalizedMeasure>${Math.round(passMark * 100) / 10000}</imsss:minNormalizedMeasure>
            </imsss:primaryObjective>
          </imsss:objectives>
        </imsss:sequencing>`
    return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${identifier}" version="1"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
  </metadata>
  <organizations default="organization">
    <organization identifier="organization">
      <title>${name}</title>
      <item identifier="item" identifierref="sco" isvisible="true">
        <title>${name}</title>${objective}
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="sco" type="webcontent" adlcp:scormType="sco" href="index.html">
${listed}
    </resource>
  </resources>
</manifest>
`
  }
  const mastery = passMark === null ? '' : `\n        <adlcp:masteryscore>${passMark}</adlcp:masteryscore>`
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
        <title>${name}</title>${mastery}
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="sco" type="webcontent" adlcp:scormtype="sco" href="index.html">
${listed}
    </resource>
  </resources>
</manifest>
`
}

/**
 * What the launch page's bridge is told of the options, as `<meta>` elements after the build's:
 * nothing for a zip written with none, so that its page is the one written before any existed.
 * @param {ScormOptions} options
 */
function optionsMeta({ scormVersion, passMark, completionScore }) {
  /** @type {Array<[string, string]>} */
  const told = []
  if (scormVersion === '2004') told.push(['h5p-scorm-version', '2004'])
  if (passMark !== null) told.push(['h5p-scorm-pass-mark', String(passMark)])
  if (completionScore) told.push(['h5p-scorm-completion-score', '100'])
  return told.map(([name, content]) => `\n    <meta name="${name}" content="${content}" />`).join('')
}

/** What the notice and the page call the version. @param {ScormOptions['scormVersion']} version */
export const scormName = (version) => (version === '2004' ? 'SCORM 2004 4th Edition' : 'SCORM 1.2')

/** @param {{ version: string, source: string, pack: string | null, lz: boolean, scorm: string }} zip `pack`, the library pack's version when the zip carries parts of it; `lz`, whether it carries the compressor; `scorm`, the version's name */
function notice({ version, source, pack, lz, scorm }) {
  return `This is a ${scorm} package written by @missing-elements/h5p-embed. It plays ${source} in an
LMS and reports its score, its result, each question's answer and the time spent, and keeps the
learner's place.

  imsmanifest.xml   the package's manifest
  index.html, scorm.js, embed.css
                    the launch page and its bridge to the LMS: MIT
${
  lz
    ? `  lz-string.js      lz-string 1.5.0, which the bridge compresses the learner's saved state
                    with: MIT, its licence in its header.
`
    : ''
}  h5p-player.js, h5p-sw.js, h5p-jobs.js
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
 * SHA-256 as lower-case hex, by the browser's and Node's `crypto.subtle`.
 * @param {BufferSource} data
 */
export async function sha256Hex(data) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * The build stamp a learner's saved place is kept against: the package's SHA-256, or, with parts
 * of the pack, one over its and theirs, so a zip written with other libraries starts learners
 * over, as a refreshed package does in the player; its first 16 hex digits.
 * @param {string} packageSha256 the package's, as hex
 * @param {PackPart[]} parts
 */
export async function buildStamp(packageSha256, parts) {
  const hashes = [packageSha256, ...parts.map((part) => part.sha256)]
  const stamp = hashes.length === 1 ? hashes[0] : await sha256Hex(new TextEncoder().encode(hashes.join('\n')))
  return stamp.slice(0, 16)
}

/**
 * The package's title, as the LMS lists it: the one chosen for the zip, by `--title` or on the
 * page, else `h5p.json`'s, else the file's name; with the control characters XML refuses read as
 * spaces, since a title pasted in can carry one. A chosen title that is empty, or only spaces,
 * leaves the default.
 * @param {unknown} manifest `h5p.json`, parsed
 * @param {string} fallback the file's name without its extension
 * @param {unknown} [chosen] the title chosen for the zip
 */
export function scormTitle(manifest, fallback, chosen) {
  /** @param {unknown} value */
  const text = (value) => (typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]+/g, ' ').trim() : '')
  return text(chosen) || text(/** @type {{ title?: unknown } | null} */ (manifest)?.title) || fallback
}

/**
 * The package's main library, as `h5p.json` names it, with the version its
 * `preloadedDependencies` give it; `null` when it names none, and no version when the
 * dependencies do not list it.
 * @param {unknown} manifest `h5p.json`, parsed
 * @returns {{ machineName: string, majorVersion?: number, minorVersion?: number } | null}
 */
export function mainLibraryOf(manifest) {
  const machineName = /** @type {{ mainLibrary?: unknown } | null} */ (manifest)?.mainLibrary
  if (typeof machineName !== 'string' || !machineName) return null
  const listed = dependenciesIn(manifest).find((dependency) => dependency.machineName === machineName)
  const majorVersion = Number(listed?.majorVersion)
  const minorVersion = Number(listed?.minorVersion)
  return listed && Number.isInteger(majorVersion) && Number.isInteger(minorVersion) ? { machineName, majorVersion, minorVersion } : { machineName }
}

/**
 * What the package declares and carries, and what the pack adds, read before anything is
 * written: `h5p.json`, and the parts of the pack the zip carries, by the player's own plan.
 * Refuses a package that needs a library neither it nor the pack has.
 *
 * @param {Blob} blob the package
 * @param {string} name what to call it in a message
 * @param {PackPart[]} pack the library pack, as the writer takes it
 * @param {{ useWebWorkers?: boolean }} [options] zip.js's, for the reader
 * @returns {Promise<{ manifest: any, parts: PackPart[] }>} `manifest`, `h5p.json` parsed; `parts`, sorted by folder
 */
export async function readPackage(blob, name, pack, { useWebWorkers = false } = {}) {
  let reader
  try {
    reader = new ZipReader(new BlobReader(blob), { useWebWorkers })
    // One unsafe name does not refuse the package, as it does not in the player, which leaves that
    // entry out.
    const entries = await reader.getEntries({ filenameValidation: 'tolerant' })
    const byName = new Map(entries.filter((entry) => !entry.directory).map((entry) => [entry.filename, entry]))
    /** @param {string} entryName */
    const readJson = async (entryName) => {
      const entry = byName.get(entryName)
      if (!entry?.getData) throw new EmbedError(`${name} has no ${entryName}: it is not an H5P package.`)
      const text = await entry.getData(new TextWriter())
      try {
        return JSON.parse(text)
      } catch {
        throw new EmbedError(`${name}: ${entryName} is not JSON.`)
      }
    }
    const manifest = await readJson('h5p.json')
    if (dependenciesIn(manifest).length === 0) {
      throw new EmbedError(`${name}: h5p.json names no libraries, so there is nothing to play.`)
    }
    const params = await readJson('content/content.json')
    /** @param {{ machineName: string, majorVersion: string | number, minorVersion: string | number }} dependency */
    const numbered = ({ machineName, majorVersion, minorVersion }) => ({ machineName, majorVersion: Number(majorVersion), minorVersion: Number(minorVersion) })
    const roots = [...dependenciesIn(manifest), ...librariesNamedIn(params)].map(numbered)
    const folders = [...byName.keys()].flatMap((entryName) => {
      const match = /^([^/]+)\/library\.json$/.exec(entryName)
      return match ? [match[1]] : []
    })
    // The player's own plan, as the launch page has the element run it: gaps filled from the pack,
    // nothing provided before, no refresh (`refresh-libraries="off"`).
    const plan = planPack({ own: await ownLibraries(folders, (folder) => readJson(`${folder}/library.json`)), provided: [], roots, params, pack, refresh: false, fill: true })
    const byFolder = new Map(pack.map((library) => [library.folder, library]))
    const parts = (plan?.parts ?? []).map((part) => /** @type {PackPart} */ (byFolder.get(part.folder))).sort((a, b) => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0))

    // Held to its libraries as the player holds it once the parts are attached: the folders they
    // replace withheld, and each part's `library.json` naming what its record in the index does.
    const records = new Map(parts.map((part) => [`${part.folder}/library.json`, part.record]))
    const withheld = new Set(plan?.superseded ?? [])
    const names = new Set([...byName.keys()].filter((entryName) => !withheld.has(entryName.split('/')[0])))
    for (const entryName of records.keys()) names.add(entryName)
    const available = indexLibraryFolders(names)
    const { missing } = await walkDependencies(
      roots,
      (dependency) => reachableFolder(dependency, names, available),
      async (folder) => records.get(`${folder}/library.json`) ?? readJson(`${folder}/library.json`)
    )
    if (missing.length > 0) {
      const packed = new Map(pack.map((library) => [`${library.machineName} ${library.majorVersion}`, library]))
      const listed = missing
        .map(({ machineName, majorVersion, minorVersion }) => {
          const older = packed.get(`${machineName} ${Number(majorVersion)}`)
          return `${machineName} ${majorVersion}.${minorVersion}${older ? ` (the pack has ${older.majorVersion}.${older.minorVersion})` : ''}`
        })
        .sort()
      throw new EmbedError(
        `${name} needs libraries that neither it nor the library pack carries: ${listed.join(', ')}. ` +
          'Export the package with its libraries, as Lumi and the H5P plugins of Moodle, WordPress and Drupal do.'
      )
    }
    return { manifest, parts }
  } catch (error) {
    if (error instanceof EmbedError) throw error
    throw new EmbedError(`${name} could not be read as a zip archive: ${error instanceof Error ? error.message : error}`)
  } finally {
    await reader?.close()
  }
}

/**
 * An entry of the zip: a text the writer makes, or bytes it was given.
 * @typedef {{ name: string, text: string } | { name: string, blob: Blob }} ScormEntry
 */

/**
 * What the zip is made of, gathered by whoever has the files: the launch page's template and
 * the bridge and stylesheet beside it; the player's files by name; the runtime's by path under
 * `frame-assets/`; the package; the parts of the pack by folder; and the pack's licence list,
 * when parts are carried.
 * @typedef {object} ScormFiles
 * @property {string} launch the launch page's template, `scorm/index.html`
 * @property {Blob} bridge `scorm/scorm.js`
 * @property {Blob | null} lz `scorm/lz-string.js`, which the bridge compresses the saved state
 *   with; without it the launch page names none, and the state is written plain, as embed 1.4
 *   wrote it
 * @property {Blob} css `embed.css`
 * @property {Map<string, Blob>} player the player's files, by name
 * @property {Map<string, Blob>} runtime the runtime's files, by path under `frame-assets/`
 * @property {Blob} pkg the package
 * @property {Map<string, Blob>} parts the parts of the pack the zip carries, by folder
 * @property {Blob | null} librariesText the pack's `libraries.txt`; `null` when no part is carried
 */

/**
 * Everything the zip holds, in the order it is written, with the manifest that lists it: the
 * launch page filled in with the content's language, the title and the build, and naming the
 * zip's own copy of the pack when it carries one.
 *
 * @param {object} input
 * @param {any} input.manifest `h5p.json`, parsed
 * @param {string} input.source the package's file name, for the notice
 * @param {string} input.title
 * @param {string} input.build the build stamp
 * @param {string} input.version the player's version, as its `dist/VERSION` says
 * @param {string | null} input.packVersion the library pack's version; read when the zip carries parts of it
 * @param {PackPart[]} input.parts the parts carried, sorted by folder
 * @param {ScormFiles} input.files
 * @param {ScormOptions} [input.options] the version and the grading options, checked by
 *   `scormOptions`; none by default
 * @returns {{ entries: ScormEntry[], xml: string }}
 */
export function scormEntries({ manifest, source, title, build, version, packVersion, parts, files, options = scormOptions() }) {
  const pack = parts.length > 0 ? packVersion ?? 'unknown' : null
  const told = optionsMeta(options)
  // A template from before the options, as a page that bundles the launch files may give, has no
  // place for them, and its bridge would play a 2004 zip as 1.2: refused, rather than written so.
  if (told && !files.launch.includes('%SCORM%')) {
    throw new EmbedError("The launch page's template is older than the SCORM options and cannot carry them; give the one this version of h5p-embed ships, scorm/index.html.")
  }
  const page = files.launch
    .replace('%LANG%', languageTag(manifest.defaultLanguage))
    // A function, so that a title's `$&` or `$'` is written as it is rather than read as a pattern.
    .replace('%TITLE%', () => escapeHtml(title))
    .replace('%BUILD%', build)
    .replace('%SCORM%', () => told)
    // The element plans from the zip's index what the writer planned, and plays the package's own
    // libraries as they are.
    .replace('%LIBRARIES%', pack ? ` libraries="pack" pack-base="./${LIBRARIES}/" refresh-libraries="off"` : '')
    // Without the compressor, which a page that bundles the launch files may not give, the page
    // names none, rather than a script the zip lacks.
    .replace(/\n[ \t]*<script src="\.\/lz-string\.js"><\/script>/, (line) => (files.lz ? line : ''))
  /** @param {Map<string, Blob>} map @param {string} name @param {string} what */
  const given = (map, name, what) => {
    const blob = map.get(name)
    if (!blob) throw new EmbedError(`${what} ${name} was not given.`)
    return blob
  }
  /** @type {ScormEntry[]} */
  const entries = [
    { name: 'index.html', text: page },
    { name: 'scorm.js', blob: files.bridge },
    ...(files.lz ? [{ name: 'lz-string.js', blob: files.lz }] : []),
    { name: 'embed.css', blob: files.css },
    ...PLAYER_FILES.map((name) => ({ name, blob: given(files.player, name, "The player's file") })),
    ...[...files.runtime.keys()].sort().map((name) => ({ name: `frame-assets/${name}`, blob: given(files.runtime, name, "The runtime's file") })),
    { name: PACKAGE, blob: files.pkg }
  ]
  if (pack) {
    entries.push({ name: `${LIBRARIES}/index.json`, text: `${JSON.stringify({ libraries: parts.map((part) => part.record) }, null, 2)}\n` })
    for (const part of parts) entries.push({ name: `${LIBRARIES}/${part.folder}.h5p`, blob: given(files.parts, part.folder, 'The library part') })
    if (!files.librariesText) throw new EmbedError("The pack's libraries.txt was not given.")
    entries.push({ name: 'libraries.txt', blob: files.librariesText })
  }
  entries.push({ name: 'NOTICE.txt', text: notice({ version, source, pack, lz: files.lz !== null, scorm: scormName(options.scormVersion) }) })
  const xml = manifestXml({ identifier: `h5p-${build}`, title, files: ['imsmanifest.xml', ...entries.map((entry) => entry.name)], options })
  return { entries, xml }
}

/**
 * Adds a file that is compressed already as a stored entry. Written into a stream, an entry gets a
 * data descriptor, and a Java ZipInputStream refuses a stored entry that has one: SCORM Cloud
 * refused exactly those (#92). Passed through with its size and CRC, it gets a complete local
 * header instead, and is still streamed, not held.
 * @param {import('@zip.js/zip.js').ZipWriter<unknown>} zip
 * @param {string} name
 * @param {Blob} blob
 */
export async function addStored(zip, name, blob) {
  await zip.add(name, new BlobReader(blob), { passThrough: true, compressionMethod: 0, uncompressedSize: blob.size, crc32: await crcOf(blob) })
}

/**
 * Writes the manifest and the entries into a zip.js writer, which the caller opens on a file or a
 * `Blob` and closes.
 * @param {import('@zip.js/zip.js').ZipWriter<unknown>} zip
 * @param {{ entries: ScormEntry[], xml: string }} content
 */
export async function addScormEntries(zip, { entries, xml }) {
  await zip.add('imsmanifest.xml', new TextReader(xml))
  for (const entry of entries) {
    if ('text' in entry) {
      await zip.add(entry.name, new TextReader(entry.text), { level: 6 })
      continue
    }
    const { name, blob } = entry
    // The package, the pack's parts and the fonts are compressed already, so they are stored.
    if (name.endsWith('.h5p') || name.endsWith('.woff2')) await addStored(zip, name, blob)
    else await zip.add(name, new BlobReader(blob), { level: 6 })
  }
}
