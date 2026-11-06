import { openAsBlob } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { BlobReader, Uint8ArrayWriter, ZipReader, configure } from '@zip.js/zip.js'
import { formatBytes } from '@missing-elements/h5p-normalize'
import { splitPack, writePack, writePackModule } from '../../../packages/libraries/scripts/parts.mjs'
import { HUB, download as cachedDownload, hubBundle as cachedBundle } from './lib/hub.mjs'

/**
 * Builds the library pack, `@missing-elements/h5p-libraries`: `packages/libraries/libraries.h5p`,
 * the same split into one archive per library under `parts/` with its `index.json` and the
 * `index.js` a bundler reads (`writePack`, `splitPack` and `writePackModule` in that package's
 * `scripts/parts.mjs`), and the licence notice, `packages/libraries/libraries.txt`. Exports from
 * h5p.com and h5p.org carry no libraries, and the player fetches the parts such a package needs;
 * it also plays the pack's newer version of a library a package carries.
 *
 * Every content type below is fetched from the hub (cached under the OS temp directory, shared
 * with `build-demo-content.mjs`; `--refresh` fetches again), and so is every addon in `ADDONS`
 * from where H5P Group publishes it, and every library folder in the
 * bundles is kept at the newest minor of each major: H5P keeps a minor
 * compatible with the ones before it, and the player resolves a request for 1.26 to 1.27. A
 * package that needs a newer minor than the pack has is refused, naming the library. With them,
 * since pack 1.1.0, what an H5P site's upload check wants of those libraries (#146): the editor
 * libraries, and the older minor a library names exactly, at the exact versions. `splitPack`
 * marks those `installOnly` in the index; the player never serves one, and h5p-author carries
 * them into a package.
 *
 * The outputs are committed, like the demo content: a deploy should not depend on the hub.
 * Refresh them before a release. A library whose `library.json` declares no licence has to be
 * in `UNDECLARED` below, found by reading its repository, or the build stops — so a refresh that
 * brings in something new is a licence review, not a silent redistribution.
 */

configure({ useWebWorkers: false })

/**
 * Every content type the hub serves, as of 2026-10-13. One that is gone is reported and skipped.
 * Kept by hand: the hub's catalogue is read by a registered site, and the build does not register
 * one. AR Scavenger was missing until 2026-10-13, found by playing one example of every content
 * type h5p.org lists; that sweep is how to look for another.
 */
const CONTENT_TYPES = [
  'H5P.Accordion', 'H5P.AdventCalendar', 'H5P.Agamotto', 'H5P.ArithmeticQuiz', 'H5P.ARScavenger', 'H5P.Audio',
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
 * Addons: libraries a platform adds to content by its text (`addTo` in `library.json`), which the
 * hub does not serve and a site's administrator uploads by hand. The player adds one to content
 * that matches, as the platforms do when content is saved. MathDisplay is here because a full
 * export from a site that has it lists it as a dependency, and played `untrusted` such a package
 * is refused unless the pack has it too. Its formulas render with MathJax from its own folder.
 */
const ADDONS = ['https://h5p.org/sites/default/files/h5p-math-display-1-0-50.h5p']

/** What a library bundles besides its own code, for the notice; checked on 2026-10-13. */
const BUNDLED = {
  'H5P.MathDisplay': 'bundles MathJax 4.1, Speech Rule Engine and mhchem, all Apache-2.0'
}

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
  'H5PEditor.ARMarkerGenerator': 'MIT (LICENSE of github.com/otacke/h5p-editor-ar-marker-generator)',
  'H5PEditor.BranchingQuestion': 'MIT (README of github.com/h5p/h5p-editor-branching-question)',
  'H5PEditor.ColorSelector': 'MIT (README of github.com/h5p/h5p-editor-color-selector)',
  'H5PEditor.CoursePresentation': 'MIT (README of github.com/h5p/h5p-editor-course-presentation)',
  'H5PEditor.DateTime': 'MIT (LICENSE of github.com/otacke/h5p-editor-datetime)',
  'H5PEditor.DragQuestion': 'MIT (README of github.com/h5p/h5p-editor-drag-question)',
  'H5PEditor.Duration': 'MIT (README of github.com/h5p/h5p-editor-duration)',
  'H5PEditor.GameMap': 'MIT (LICENSE of github.com/otacke/h5p-editor-game-map)',
  'H5PEditor.ImageCoordinateSelector': 'MIT (README of github.com/h5p/h5p-editor-image-coordinate-selector)',
  'H5PEditor.ImageHotspotQuestion': 'MIT (README of github.com/h5p/h5p-editor-image-hotspot-question)',
  'H5PEditor.ImageMultipleHotspotQuestion': 'MIT (README of github.com/lukemuller/h5p-editor-image-multiple-hotspot-question)',
  'H5PEditor.ImportantDescription': 'MIT (LICENSE of github.com/otacke/h5p-editor-important-description)',
  'H5PEditor.InfoWall': 'MIT (LICENSE of github.com/otacke/h5p-editor-info-wall)',
  'H5PEditor.InfoWallPassiveList': 'MIT (LICENSE of github.com/otacke/h5p-editor-info-wall-passive-list)',
  'H5PEditor.InputRow': 'MIT (LICENSE of github.com/otacke/h5p-editor-input-row)',
  'H5PEditor.KewArCode': 'MIT (LICENSE of github.com/otacke/h5p-editor-kewar-code)',
  'H5PEditor.RadioGroup': 'MIT (README of github.com/h5p/h5p-editor-radio-group)',
  'H5PEditor.RadioSelector': 'MIT (README of github.com/h5p/h5p-editor-radio-selector)',
  'H5PEditor.Shape': 'MIT (README of github.com/h5p/h5p-editor-shape)',
  'H5PEditor.ThreeDModelLoader': 'MIT (LICENSE of github.com/otacke/h5p-editor-3d-model-loader)',
  'H5PEditor.Timecode': 'MIT (README of github.com/h5p/h5p-editor-timecode)',
  'H5PEditor.UrlField': 'MIT (README of github.com/h5p/h5p-editor-url-field)',
  'H5PEditor.Wizard': 'MIT (README of github.com/h5p/h5p-editor-wizard)',
  flowplayer: 'GPL-3.0 (header of scripts/flowplayer-3.2.12.min.js)'
}

const rootDir = resolve(import.meta.dirname, '..')
const outDir = resolve(rootDir, '..', '..', 'packages', 'libraries')
const refresh = process.argv.includes('--refresh')

// Declared before the loop below, which runs as the module loads.
const LOG = '[libraries]'

/** The hub bundle for a content type, cached; `null` when the hub no longer has it. */
const hubBundle = (machineName) => cachedBundle(machineName, { refresh, optional: true, log: LOG })

/**
 * A file, cached under `name`; with `optional`, `null` when its host says there is no such file.
 * @param {string} url @param {string} name @param {boolean} [optional]
 */
const download = (url, name, optional = false) => cachedDownload(url, name, { refresh, optional, log: LOG })

/** `<machineName>-<major>.<minor>` -> { folder, library, files: Map<name, Uint8Array> }: every version the bundles carry, at its newest patch. */
const seen = new Map()
const skipped = []

for (const machineName of CONTENT_TYPES) {
  const path = await hubBundle(machineName)
  if (!path) {
    skipped.push(machineName)
    continue
  }
  await keepLibraries(path)
}
for (const url of ADDONS) await keepLibraries(await download(url, url.slice(url.lastIndexOf('/') + 1)))

/** Keeps every library folder in a bundle, each version at the newest patch seen so far. */
async function keepLibraries(path) {
  const reader = new ZipReader(new BlobReader(await openAsBlob(path)))
  const entries = (await reader.getEntries({ filenameValidation: 'tolerant' })).filter((entry) => !entry.directory)

  const folders = new Map()
  for (const entry of entries) {
    const slash = entry.filename.indexOf('/')
    if (slash < 0) continue
    const folder = entry.filename.slice(0, slash)
    if (folder === 'content') continue
    if (!folders.has(folder)) folders.set(folder, [])
    folders.get(folder).push(entry)
  }

  for (const [folder, files] of folders) {
    const libraryEntry = files.find((entry) => entry.filename === `${folder}/library.json`)
    if (!libraryEntry) continue
    const library = JSON.parse(new TextDecoder().decode(await libraryEntry.getData(new Uint8ArrayWriter())))
    const current = seen.get(versionOf(library))
    if (current && !newer(library, current.library)) continue

    const contents = new Map()
    for (const entry of files) contents.set(entry.filename, await entry.getData(new Uint8ArrayWriter()))
    seen.set(versionOf(library), { folder, library, files: contents })
  }
  await reader.close()
}

// What the player serves: the newest minor of each major, the editor's libraries left out.
const played = new Map()
for (const version of seen.values()) {
  if (version.library.machineName.startsWith('H5PEditor.')) continue
  const key = `${version.library.machineName}-${version.library.majorVersion}`
  const current = played.get(key)
  if (!current || newer(version.library, current.library)) played.set(key, version)
}

// With them, what an H5P site's upload check wants (#146): every library a carried one names,
// preloaded, dynamic or editor, at the exact major.minor, and what those name in turn. A bundle
// carries its content type's whole closure, so each is in `seen`; one that is not stops the build.
const carried = new Map([...played.values()].map((version) => [versionOf(version.library), version]))
const queue = [...carried.values()]
while (queue.length > 0) {
  const { folder, library } = queue.shift()
  for (const dependency of [...(library.preloadedDependencies ?? []), ...(library.dynamicDependencies ?? []), ...(library.editorDependencies ?? [])]) {
    const wanted = versionOf(dependency)
    if (carried.has(wanted)) continue
    const found = seen.get(wanted)
    if (!found) {
      console.error(`${LOG} ${folder} needs ${wanted}, which no bundle carries`)
      process.exit(1)
    }
    carried.set(wanted, found)
    queue.push(found)
  }
}

const libraries = [...carried.values()].sort((a, b) => a.folder.localeCompare(b.folder))

const unknown = libraries.filter(({ library }) => !library.license && !UNDECLARED[library.machineName])
if (unknown.length > 0) {
  console.error(`[libraries] no licence known for ${unknown.map(({ folder }) => folder).join(', ')}:`)
  console.error('  read each repository and add it to UNDECLARED before shipping it')
  process.exit(1)
}

// Written with a fixed date, the same in any time zone (see `FIXED_DATE`), and with a library's
// entries kept from the committed pack while its files are the same, so the pack's bytes change
// only where a library does: the weekly refresh (.github/workflows/libraries.yml) opens a pull
// request only on a real difference, and commits only the parts of the libraries that changed.
const previous = await readFile(join(outDir, 'libraries.h5p')).then((bytes) => new Uint8Array(bytes), () => undefined)
const pack = await writePack(libraries, previous)
await writeFile(join(outDir, 'libraries.h5p'), pack)
const parts = await splitPack(pack, join(outDir, 'parts'))
await writePackModule(parts, outDir)

const lines = [
  'Library pack of H5P Offline Player by Missing Elements: the H5P hub runtime libraries the installable app carries,',
  'so that a package exported without its own libraries plays offline, and with them the editor',
  "libraries and older minors an H5P site's upload check wants of them, which h5p-author carries",
  'into a package and the player never serves (installOnly in parts/index.json). Each library is used here',
  'under the licence below; its source is the library folder itself, as shipped by the hub',
  `(${HUB}<content type>), or for an addon as H5P Group publishes it (${ADDONS.join(', ')}).`,
  'Built by apps/demo/scripts/build-libraries.mjs.',
  '',
  ...libraries.map(({ folder, library }) => {
    const licence = library.license ? `${library.license} (library.json)` : UNDECLARED[library.machineName]
    const bundled = BUNDLED[library.machineName] ? `; ${BUNDLED[library.machineName]}` : ''
    const authors = Array.isArray(library.author) ? library.author.join(', ') : library.author
    return `${folder}  ${library.majorVersion}.${library.minorVersion}.${library.patchVersion}  ${licence}${bundled}${authors ? `  — ${authors}` : ''}`
  }),
  ''
]
await writeFile(join(outDir, 'libraries.txt'), lines.join('\n'))

console.log(
  `[libraries] ${played.size} libraries the player serves and ${libraries.length - played.size} for H5P sites' upload check, from ${CONTENT_TYPES.length - skipped.length} content types -> packages/libraries/libraries.h5p ${formatBytes(pack.length)}, and ${parts.length} parts` +
    (skipped.length ? ` (not on the hub: ${skipped.join(', ')})` : '')
)

/** Whether `a` is a newer release than `b` of the same major. */
function newer(a, b) {
  return a.minorVersion !== b.minorVersion ? a.minorVersion > b.minorVersion : (a.patchVersion ?? 0) > (b.patchVersion ?? 0)
}

/** `<machineName>-<major>.<minor>`, of a `library.json` or a dependency it names. */
function versionOf(library) {
  return `${library.machineName}-${library.majorVersion}.${library.minorVersion}`
}
