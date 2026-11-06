import { openAsBlob } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { BlobReader, BlobWriter, TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter, configure } from '@zip.js/zip.js'
import { formatBytes, normalizeArchive } from '@missing-elements/h5p-normalize'
// The rule h5p-author checks its packages by and `apps/skills` checks every example with, reached
// by path as build-libraries.mjs reaches the pack's scripts.
import { missingForInstall } from '../../../packages/author/lib/install.mjs'
import { download, hubBundle as cachedBundle } from './lib/hub.mjs'

/**
 * Builds the packages the hosted demo plays, from `demo/content/src/<name>/` into
 * `demo/content/<name>.h5p`. Each source is our own `content.json` plus a `manifest.json`
 * naming the content type; the libraries come from the H5P hub's bundle for that content type,
 * as `libraries="hub"` fetched them at runtime up to player 0.5, and the result is a self-contained
 * package run through the normalizer, so it is also an example of what the normalizer produces.
 * A manifest with `"stripped": true` is written the way h5p.com and h5p.org export: `h5p.json`
 * naming the main library alone, `content/`, and no library folders — the package the player
 * page plays `untrusted` against the site's pack.
 *
 * Every other package also carries what an H5P site's upload check wants of its libraries (#146):
 * H5P core refuses a package unless each library it carries has its preloaded, dynamic and editor
 * dependencies with it at the exact major.minor, so a Moodle with no library installed refused
 * the demo's quiz, video and glossary for their editor libraries. `h5p.json` lists only what
 * plays, as the platforms' exports write it, and the player never reads the rest; they follow the
 * libraries that play, and the normalizer keeps library folders in that order.
 *
 * The outputs are committed. This is a maintainer's tool with two network dependencies — the
 * hub, and whatever media a manifest points at — and a deploy should not have either. Hub
 * bundles are cached under the OS temp directory; `--refresh` fetches them again.
 *
 *   node scripts/build-demo-content.mjs            # every source
 *   node scripts/build-demo-content.mjs quiz       # one
 */

configure({ useWebWorkers: false })

const rootDir = resolve(import.meta.dirname, '..')
const sourceRoot = resolve(rootDir, 'demo', 'content', 'src')
const outDir = resolve(rootDir, 'demo', 'content')

const args = process.argv.slice(2)
const refresh = args.includes('--refresh')
const only = args.filter((arg) => !arg.startsWith('--'))

const names = (await readdir(sourceRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && (only.length === 0 || only.includes(entry.name)))
  .map((entry) => entry.name)
  .sort()

if (names.length === 0) {
  console.error(`[demo-content] nothing to build under ${relative(rootDir, sourceRoot)}`)
  process.exit(1)
}

// Declared before the loop below, which runs as the module loads.
const LOG = '[demo-content]'

/** The hub's bundle for a content type, from the cache when it is there. */
const hubBundle = (machineName) => cachedBundle(machineName, { refresh, log: LOG })

/** Media by URL, cached the same way, keyed on the file name. */
const fetched = async (url) => readFile(/** @type {string} */ (await download(url, basename(new URL(url).pathname), { refresh, log: LOG })))

const work = await mkdtemp(join(tmpdir(), 'h5p-demo-content-'))

try {
  for (const name of names) await buildPackage(name)
} finally {
  await rm(work, { recursive: true, force: true })
}

/** @param {string} name */
async function buildPackage(name) {
  const sourceDir = join(sourceRoot, name)
  const manifest = JSON.parse(await readFile(join(sourceDir, 'manifest.json'), 'utf8'))
  const content = JSON.parse(await readFile(join(sourceDir, 'content.json'), 'utf8'))

  const bundlePath = await hubBundle(manifest.mainLibrary)
  const bundle = new ZipReader(new BlobReader(await openAsBlob(bundlePath)))
  const entries = (await bundle.getEntries({ filenameValidation: 'tolerant' })).filter((entry) => !entry.directory)

  // Every library the content actually needs: the main library's dependency tree, plus the
  // tree of every sub-content library the params name. What else goes into the package is what
  // an H5P site's upload check wants of these, below; nothing else from the bundle does.
  const libraryJsons = new Map()
  for (const entry of entries) {
    const match = /^([^/]+)\/library\.json$/.exec(entry.filename)
    if (match) libraryJsons.set(match[1], JSON.parse(new TextDecoder().decode(await entry.getData(new Uint8ArrayWriter()))))
  }
  // A bundle can carry two minors of one library (the QuestionSet bundle has H5P.Question 1.4 and
  // 1.5); keep the newest, which every dependant naming an older minor of the same major accepts.
  // Taking whichever came last in the zip shipped 1.4 to libraries that require 1.5.
  const version = (library) => [library.majorVersion, library.minorVersion, library.patchVersion ?? 0]
  const newer = (a, b) => {
    const [x, y] = [version(a), version(b)]
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
    return false
  }
  const byMachineName = new Map()
  for (const library of libraryJsons.values()) {
    const current = byMachineName.get(library.machineName)
    if (!current || newer(library, current)) byMachineName.set(library.machineName, library)
  }
  const needed = new Map()
  const visit = (machineName) => {
    if (needed.has(machineName)) return
    const library = byMachineName.get(machineName)
    if (!library) throw new Error(`${name}: ${machineName} is not in the hub bundle for ${manifest.mainLibrary}`)
    needed.set(machineName, library)
    for (const dependency of [...(library.preloadedDependencies ?? []), ...(library.dynamicDependencies ?? [])]) visit(dependency.machineName)
  }
  visit(manifest.mainLibrary)
  for (const used of JSON.stringify(content).matchAll(/"library":\s*"([^" ]+) (\d+)\.(\d+)"/g)) visit(used[1])

  const folderOf = (library) => `${library.machineName}-${Number(library.majorVersion)}.${Number(library.minorVersion)}`
  const folders = new Set([...needed.values()].map(folderOf))

  // What an H5P site's upload check wants of them (#146): every dependency a carried library
  // names, preloaded, dynamic or editor, at its exact major.minor, and what those name in turn.
  // The bundle carries its content type's whole closure, so each is in it, an older minor of a
  // library included (the QuestionSet bundle's H5P.Question 1.4 beside the 1.5 that plays).
  /** @type {Set<string>} */
  const install = new Set()
  if (!manifest.stripped) {
    const queue = [...needed.values()]
    while (queue.length > 0) {
      const library = queue.shift()
      for (const dependency of [...(library.preloadedDependencies ?? []), ...(library.dynamicDependencies ?? []), ...(library.editorDependencies ?? [])]) {
        const folder = folderOf(dependency)
        if (folders.has(folder) || install.has(folder)) continue
        const found = libraryJsons.get(folder)
        if (!found) throw new Error(`${name}: ${folder} is not in the hub bundle for ${manifest.mainLibrary}, which ${folderOf(library)} needs to install on an H5P site`)
        install.add(folder)
        queue.push(found)
      }
    }
    // The same rule as h5p-author's check, over what is about to be written.
    const missing = missingForInstall([...needed.values(), ...[...install].map((folder) => libraryJsons.get(folder))])
    if (missing.length > 0) throw new Error(`${name}: an H5P site would refuse it for ${missing.map(({ library, needs }) => `${library} without ${needs}`).join(', ')}`)
  }

  const h5pJson = {
    title: manifest.title,
    language: 'en',
    defaultLanguage: 'en',
    mainLibrary: manifest.mainLibrary,
    embedTypes: ['div'],
    license: manifest.license ?? 'U',
    ...(manifest.licenseVersion ? { licenseVersion: manifest.licenseVersion } : {}),
    ...(manifest.authors ? { authors: manifest.authors } : {}),
    ...(manifest.source ? { source: manifest.source } : {}),
    preloadedDependencies: [...needed.values()]
      .filter((library) => !manifest.stripped || library.machineName === manifest.mainLibrary)
      .map((library) => ({
        machineName: library.machineName,
        majorVersion: String(library.majorVersion),
        minorVersion: String(library.minorVersion)
      }))
  }

  const writer = new ZipWriter(new BlobWriter('application/zip'))
  await writer.add('h5p.json', new TextReader(JSON.stringify(h5pJson)))
  await writer.add('content/content.json', new TextReader(JSON.stringify(content)))

  // Media beside the source, and media a manifest fetches by URL.
  for (const file of await listFiles(sourceDir)) {
    if (file === 'manifest.json' || file === 'content.json') continue
    await writer.add(`content/${file}`, new Uint8ArrayReader(new Uint8Array(await readFile(join(sourceDir, file)))))
  }
  for (const [path, url] of Object.entries(manifest.fetch ?? {})) {
    await writer.add(`content/${path}`, new Uint8ArrayReader(new Uint8Array(await fetched(url))))
  }

  // The libraries that play, then the ones an H5P site's upload check wants with them.
  let libraryBytes = 0
  let installBytes = 0
  for (const wanted of [folders, install]) {
    for (const entry of entries) {
      const folder = entry.filename.slice(0, entry.filename.indexOf('/'))
      if (manifest.stripped || !wanted.has(folder)) continue
      const bytes = await entry.getData(new Uint8ArrayWriter())
      if (wanted === folders) libraryBytes += bytes.length
      else installBytes += bytes.length
      await writer.add(entry.filename, new Uint8ArrayReader(bytes), { lastModDate: entry.lastModDate })
    }
  }
  await bundle.close()

  const assembled = join(work, `${name}.h5p`)
  await writeFile(assembled, new Uint8Array(await (await writer.close()).arrayBuffer()))

  await mkdir(outDir, { recursive: true })
  const output = join(outDir, `${name}.h5p`)
  const report = await normalizeArchive({ input: assembled, output })

  console.log(
    `[demo-content] ${name}.h5p ${formatBytes(report.bytesOut ?? 0)}: ${manifest.mainLibrary}, ` +
      (manifest.stripped
        ? 'content only, '
        : `${folders.size} libraries (${formatBytes(libraryBytes)} uncompressed)` +
          (install.size ? ` and ${install.size} more for an H5P site's upload check (${formatBytes(installBytes)}), ` : ', ')) +
      `${report.entries.filter((entry) => entry.target === 'store').length} media entries stored` +
      (report.entries.some((entry) => entry.action === 'faststart') ? ', mp4 index moved to front' : '')
  )
}

async function listFiles(dir, prefix = '') {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) found.push(...(await listFiles(join(dir, entry.name), name)))
    else found.push(name)
  }
  return found
}

