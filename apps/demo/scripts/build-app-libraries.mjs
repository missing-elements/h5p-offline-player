import { createWriteStream, openAsBlob } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { BlobReader, BlobWriter, TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter, configure } from '@zip.js/zip.js'
import { formatBytes } from '@missing-elements/h5p-normalize'

/**
 * Builds the installable app's library pack, `app/libraries.h5p`, and its licence notice,
 * `app/libraries.txt`. Exports from h5p.com and h5p.org carry no libraries, and an offline app
 * that has to fetch them from the hub first is not offline, so the app carries the hub's runtime
 * libraries for every content type and attaches them to any package missing its own.
 *
 * Every content type below is fetched from the hub (cached under the OS temp directory, shared
 * with `build-demo-content.mjs`; `--refresh` fetches again), and every library folder in the
 * bundles is kept except the editor's, at the newest minor of each major: H5P keeps a minor
 * compatible with the ones before it, and the player resolves a request for 1.26 to 1.27. A
 * package that needs a newer minor than the pack has plays from the hub instead, online.
 *
 * The outputs are committed, like the demo content: a deploy should not depend on the hub.
 * Refresh them before a release. A library whose `library.json` declares no licence has to be
 * in `UNDECLARED` below, found by reading its repository, or the build stops — so a refresh that
 * brings in something new is a licence review, not a silent redistribution.
 */

configure({ useWebWorkers: false })

// The hub moved to this host in 2026; see the same constant in build-demo-content.mjs for why
// the element itself has not followed yet.
const HUB = 'https://hub-api.h5p.org/v1/content-types/'

/** Every content type the hub serves, as of 2026-09-29. One that is gone is reported and skipped. */
const CONTENT_TYPES = [
  'H5P.Accordion', 'H5P.AdventCalendar', 'H5P.Agamotto', 'H5P.ArithmeticQuiz', 'H5P.Audio',
  'H5P.AudioRecorder', 'H5P.Blanks', 'H5P.BranchingScenario', 'H5P.Chart', 'H5P.Collage',
  'H5P.Column', 'H5P.Cornell', 'H5P.CoursePresentation', 'H5P.Crossword', 'H5P.Dialogcards',
  'H5P.Dictation', 'H5P.DocumentationTool', 'H5P.DragQuestion', 'H5P.DragText', 'H5P.Essay',
  'H5P.FindTheWords', 'H5P.Flashcards', 'H5P.GameMap', 'H5P.GuessTheAnswer', 'H5P.IFrameEmbed',
  'H5P.ImageHotspotQuestion', 'H5P.ImageHotspots', 'H5P.ImageJuxtaposition',
  'H5P.ImageMultipleHotspotQuestion', 'H5P.ImagePair', 'H5P.ImageSequencing', 'H5P.ImageSlider',
  'H5P.InfoWall', 'H5P.InteractiveBook', 'H5P.InteractiveVideo', 'H5P.KewArCode',
  'H5P.MarkTheWords', 'H5P.MemoryGame', 'H5P.MultiChoice', 'H5P.MultiMediaChoice',
  'H5P.PersonalityQuiz', 'H5P.Questionnaire', 'H5P.QuestionSet', 'H5P.SingleChoiceSet',
  'H5P.SortParagraphs', 'H5P.SpeakTheWords', 'H5P.SpeakTheWordsSet', 'H5P.StructureStrip',
  'H5P.Summary', 'H5P.ThreeImage', 'H5P.Timeline', 'H5P.TrueFalse'
]

/**
 * Licences for the libraries whose `library.json` names none, checked on 2026-09-29. The H5P
 * ones state MIT in their repository's README (github.com/h5p/<repo>), which has no LICENSE file;
 * flowplayer's script carries the GPL-3.0 notice in its own header.
 */
const UNDECLARED = {
  'H5P.AdvancedText': 'MIT (README of github.com/h5p/h5p-advanced-text)',
  'H5P.Audio': 'MIT (README of github.com/h5p/h5p-audio)',
  'H5P.ContinuousText': 'MIT (README of github.com/h5p/h5p-continuous-text)',
  'H5P.DragNBar': 'MIT (README of github.com/h5p/h5p-drag-n-bar)',
  'H5P.DragNDrop': 'MIT (README of github.com/h5p/h5p-drag-n-drop)',
  'H5P.DragNResize': 'MIT (README of github.com/h5p/h5p-drag-n-resize)',
  'H5P.ExportableTextArea': 'MIT (README of github.com/h5p/h5p-exportable-text-area)',
  'H5P.FontIcons': 'MIT (README of github.com/h5p/h5p-font-icons)',
  'H5P.Image': 'MIT (README of github.com/h5p/h5p-image)',
  'H5P.ImageMultipleHotspotQuestion': 'MIT (README of github.com/h5p/h5p-image-multiple-hotspot-question)',
  'H5P.JoubelUI': 'MIT (README of github.com/h5p/h5p-joubel-ui)',
  'H5P.Link': 'MIT (README of github.com/h5p/h5p-link)',
  'H5P.Nil': 'MIT (README of github.com/h5p/h5p-nil)',
  'H5P.Table': 'MIT (README of github.com/h5p/h5p-table)',
  'H5P.Text': 'MIT (README of github.com/h5p/h5p-text)',
  flowplayer: 'GPL-3.0 (header of scripts/flowplayer-3.2.12.min.js)'
}

const rootDir = resolve(import.meta.dirname, '..')
const outDir = resolve(rootDir, 'app')
const cacheDir = join(tmpdir(), 'h5p-hub-cache')
const refresh = process.argv.includes('--refresh')

await mkdir(cacheDir, { recursive: true })

/** folder -> { library, files: Map<name, Uint8Array> }, keeping the newest minor per major. */
const kept = new Map()
const skipped = []

for (const machineName of CONTENT_TYPES) {
  const path = await hubBundle(machineName)
  if (!path) {
    skipped.push(machineName)
    continue
  }
  const reader = new ZipReader(new BlobReader(await openAsBlob(path)))
  const entries = (await reader.getEntries({ filenameValidation: 'tolerant' })).filter((entry) => !entry.directory)

  const folders = new Map()
  for (const entry of entries) {
    const slash = entry.filename.indexOf('/')
    if (slash < 0) continue
    const folder = entry.filename.slice(0, slash)
    if (folder === 'content' || folder.startsWith('H5PEditor.')) continue
    if (!folders.has(folder)) folders.set(folder, [])
    folders.get(folder).push(entry)
  }

  for (const [folder, files] of folders) {
    const libraryEntry = files.find((entry) => entry.filename === `${folder}/library.json`)
    if (!libraryEntry) continue
    const library = JSON.parse(new TextDecoder().decode(await libraryEntry.getData(new Uint8ArrayWriter())))
    const key = `${library.machineName}-${library.majorVersion}`
    const current = kept.get(key)
    if (current && !newer(library, current.library)) continue

    const contents = new Map()
    for (const entry of files) contents.set(entry.filename, await entry.getData(new Uint8ArrayWriter()))
    kept.set(key, { folder, library, files: contents })
  }
  await reader.close()
}

const libraries = [...kept.values()].sort((a, b) => a.folder.localeCompare(b.folder))

const unknown = libraries.filter(({ library }) => !library.license && !UNDECLARED[library.machineName])
if (unknown.length > 0) {
  console.error(`[app-libraries] no licence known for ${unknown.map(({ folder }) => folder).join(', ')}:`)
  console.error('  read each repository and add it to UNDECLARED before shipping it')
  process.exit(1)
}

// A bundle registered to supply libraries is never held to its own manifest, but the player
// refuses any archive without an h5p.json.
const writer = new ZipWriter(new BlobWriter('application/zip'))
await writer.add(
  'h5p.json',
  new TextReader(
    JSON.stringify({ title: 'H5P Offline Player library pack', language: 'und', mainLibrary: '', preloadedDependencies: [], embedTypes: ['div'] })
  )
)
for (const { files } of libraries) {
  for (const [name, bytes] of files) await writer.add(name, new Uint8ArrayReader(bytes))
}
const pack = new Uint8Array(await (await writer.close()).arrayBuffer())
await writeFile(join(outDir, 'libraries.h5p'), pack)

const lines = [
  'H5P Offline Player library pack: the H5P hub runtime libraries the installable app carries,',
  'so that a package exported without its own libraries plays offline. Each library is used here',
  'under the licence below; its source is the library folder itself, as shipped by the hub',
  `(${HUB}<content type>). Built by apps/demo/scripts/build-app-libraries.mjs.`,
  '',
  ...libraries.map(({ folder, library }) => {
    const licence = library.license ? `${library.license} (library.json)` : UNDECLARED[library.machineName]
    const authors = Array.isArray(library.author) ? library.author.join(', ') : library.author
    return `${folder}  ${library.majorVersion}.${library.minorVersion}.${library.patchVersion}  ${licence}${authors ? `  — ${authors}` : ''}`
  }),
  ''
]
await writeFile(join(outDir, 'libraries.txt'), lines.join('\n'))

console.log(
  `[app-libraries] ${libraries.length} libraries from ${CONTENT_TYPES.length - skipped.length} content types -> app/libraries.h5p ${formatBytes(pack.length)}` +
    (skipped.length ? ` (not on the hub: ${skipped.join(', ')})` : '')
)

/** Whether `a` is a newer release than `b` of the same major. */
function newer(a, b) {
  return a.minorVersion !== b.minorVersion ? a.minorVersion > b.minorVersion : (a.patchVersion ?? 0) > (b.patchVersion ?? 0)
}

/** The hub bundle for a content type, cached; `null` when the hub no longer has it. */
async function hubBundle(machineName) {
  const path = join(cacheDir, `${machineName}.h5p`)
  if (!refresh && (await stat(path).then(() => true, () => false))) return path
  const url = `${HUB}${encodeURIComponent(machineName)}`
  console.log(`[app-libraries] fetching ${url}`)
  const response = await fetch(url)
  // Not a content type. The old host said 404; S3 behind the new one says 403 for a missing key.
  if (response.status === 404 || response.status === 403) return null
  if (!response.ok || !response.body) throw new Error(`${url} returned ${response.status}`)
  await pipeline(Readable.fromWeb(/** @type {any} */ (response.body)), createWriteStream(path))
  return path
}
