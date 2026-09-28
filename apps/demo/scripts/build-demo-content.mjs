import { createWriteStream, openAsBlob } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { BlobReader, BlobWriter, TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter, configure } from '@zip.js/zip.js'
import { formatBytes } from './lib/format.mjs'
import { normalizeArchive } from './lib/normalize.mjs'

/**
 * Builds the packages the hosted demo plays, from `demo/content/src/<name>/` into
 * `demo/content/<name>.h5p`. Each source is our own `content.json` plus a `manifest.json`
 * naming the content type; the libraries come from the H5P hub's bundle for that content type,
 * exactly as `libraries="hub"` fetches them at runtime, and the result is a self-contained
 * package run through the normalizer, so it is also an example of what the normalizer produces.
 *
 * The outputs are committed. This is a maintainer's tool with two network dependencies — the
 * hub, and whatever media a manifest points at — and a deploy should not have either. Hub
 * bundles are cached under the OS temp directory; `--refresh` fetches them again.
 *
 *   node scripts/build-demo-content.mjs            # every source
 *   node scripts/build-demo-content.mjs quiz       # one
 */

configure({ useWebWorkers: false })

const HUB = 'https://api.h5p.org/v1/content-types/'

const rootDir = resolve(import.meta.dirname, '..')
const sourceRoot = resolve(rootDir, 'demo', 'content', 'src')
const outDir = resolve(rootDir, 'demo', 'content')
const cacheDir = join(tmpdir(), 'h5p-hub-cache')

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

await mkdir(cacheDir, { recursive: true })
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
  // tree of every sub-content library the params name. Nothing else from the bundle — in
  // particular none of its editor libraries — goes into the package.
  const libraryJsons = new Map()
  for (const entry of entries) {
    const match = /^([^/]+)\/library\.json$/.exec(entry.filename)
    if (match) libraryJsons.set(match[1], JSON.parse(new TextDecoder().decode(await entry.getData(new Uint8ArrayWriter()))))
  }
  const byMachineName = new Map([...libraryJsons.values()].map((library) => [library.machineName, library]))
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

  const folderOf = (library) => `${library.machineName}-${library.majorVersion}.${library.minorVersion}`
  const folders = new Set([...needed.values()].map(folderOf))

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
    preloadedDependencies: [...needed.values()].map((library) => ({
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

  let libraryBytes = 0
  for (const entry of entries) {
    const folder = entry.filename.slice(0, entry.filename.indexOf('/'))
    if (!folders.has(folder)) continue
    const bytes = await entry.getData(new Uint8ArrayWriter())
    libraryBytes += bytes.length
    await writer.add(entry.filename, new Uint8ArrayReader(bytes), { lastModDate: entry.lastModDate })
  }
  await bundle.close()

  const assembled = join(work, `${name}.h5p`)
  await writeFile(assembled, new Uint8Array(await (await writer.close()).arrayBuffer()))

  await mkdir(outDir, { recursive: true })
  const output = join(outDir, `${name}.h5p`)
  const report = await normalizeArchive({ input: assembled, output })

  console.log(
    `[demo-content] ${name}.h5p ${formatBytes(report.bytesOut ?? 0)}: ${manifest.mainLibrary}, ` +
      `${folders.size} libraries (${formatBytes(libraryBytes)} uncompressed), ` +
      `${report.entries.filter((entry) => entry.target === 'store').length} media entries stored` +
      (report.entries.some((entry) => entry.action === 'faststart') ? ', mp4 index moved to front' : '')
  )
}

/** The hub's bundle for a content type, from the cache when it is there. */
async function hubBundle(machineName) {
  const path = join(cacheDir, `${machineName}.h5p`)
  if (!refresh && (await exists(path))) return path
  const url = `${HUB}${encodeURIComponent(machineName)}`
  console.log(`[demo-content] fetching ${url}`)
  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`${url} returned ${response.status}`)
  await pipeline(Readable.fromWeb(/** @type {any} */ (response.body)), createWriteStream(path))
  return path
}

/** Media by URL, cached the same way, keyed on the file name. */
async function fetched(url) {
  const path = join(cacheDir, basename(new URL(url).pathname))
  if (refresh || !(await exists(path))) {
    console.log(`[demo-content] fetching ${url}`)
    const response = await fetch(url)
    if (!response.ok || !response.body) throw new Error(`${url} returned ${response.status}`)
    await pipeline(Readable.fromWeb(/** @type {any} */ (response.body)), createWriteStream(path))
  }
  return readFile(path)
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

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
