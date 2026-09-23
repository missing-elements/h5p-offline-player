import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { resolve, relative, sep } from 'node:path'
import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js'

/**
 * Builds the `.h5p` archives the browser tests play. They are generated rather than committed
 * because two of them need entries no ordinary zip tool will write — a path traversal, and media
 * large enough to take the slice and chunk paths — and because a 20 MB fixture does not belong
 * in git.
 */

const rootDir = resolve(import.meta.dirname, '..')
const sourceDir = resolve(rootDir, 'tests', 'fixtures', 'src', 'basic')
const extraLibDir = resolve(rootDir, 'tests', 'fixtures', 'src', 'extra')
const outDir = resolve(rootDir, 'public', 'fixtures')

/** Comfortably past the 16 MB inline threshold, so these take the large-entry paths. */
const LARGE_ENTRY_SIZE = 20 * 1024 * 1024

async function collectFiles(dir, prefix = '') {
  const found = []
  for (const name of await readdir(dir)) {
    const path = resolve(dir, name)
    const entryName = prefix ? `${prefix}/${name}` : name
    if ((await stat(path)).isDirectory()) {
      found.push(...(await collectFiles(path, entryName)))
    } else {
      found.push({ entryName, path })
    }
  }
  return found
}

async function writeArchive(name, build) {
  const writer = new ZipWriter(new BlobWriter('application/zip'))
  await build(writer)
  const blob = await writer.close()
  const bytes = new Uint8Array(await blob.arrayBuffer())
  await writeFile(resolve(outDir, name), bytes)
  return bytes.length
}

const baseFiles = await collectFiles(sourceDir)

const addBaseFiles = async (writer, { skip = [] } = {}) => {
  for (const { entryName, path } of baseFiles) {
    if (skip.includes(entryName)) continue
    const contents = await readFile(path)
    await writer.add(entryName, new Uint8ArrayReader(new Uint8Array(contents)))
  }
}

/** Highly compressible filler: 20 MB that deflates to a few kilobytes, so the archive stays small. */
const compressibleBytes = () => new Uint8Array(LARGE_ENTRY_SIZE)

/** Incompressible filler: stored either way, and the stored path is what it is here to exercise. */
const randomBytes = () => {
  const bytes = new Uint8Array(LARGE_ENTRY_SIZE)
  // `crypto.getRandomValues` caps at 64 kB per call.
  for (let offset = 0; offset < bytes.length; offset += 65536) {
    crypto.getRandomValues(bytes.subarray(offset, Math.min(offset + 65536, bytes.length)))
  }
  return bytes
}

/**
 * Only the archives this script owns are cleared. `public/fixtures/` is where a real `.h5p` gets
 * dropped to try it against the demo, and wiping the directory would delete it on the next
 * `npm run dev`.
 */
const GENERATED = [
  'basic.h5p',
  'large-deflated.h5p',
  'large-stored.h5p',
  'traversal.h5p',
  'not-h5p.h5p',
  'content-only.h5p',
  'needs-libraries.h5p',
  'libraries.h5p',
  'unversioned.h5p',
  'corrupt.h5p'
]

await mkdir(outDir, { recursive: true })
for (const name of GENERATED) {
  await rm(resolve(outDir, name), { force: true })
}

const built = []

// 1. The ordinary case: every entry small and deflated.
built.push([
  'basic.h5p',
  await writeArchive('basic.h5p', async (writer) => {
    await addBaseFiles(writer)
  })
])

// 2. A large deflated entry: the Jobs worker inflates it into chunks and the virtual server
//    serves the prefix that exists as a shorter 206.
built.push([
  'large-deflated.h5p',
  await writeArchive('large-deflated.h5p', async (writer) => {
    await addBaseFiles(writer, { skip: ['content/content.json'] })
    await writer.add(
      'content/content.json',
      new TextReader(
        JSON.stringify({ message: 'Large deflated media', media: { path: 'media/big.bin' } })
      )
    )
    await writer.add('content/media/big.bin', new Uint8ArrayReader(compressibleBytes()))
    // Large, deflated, and referenced by nothing: the prefetch case. The runtime never asks for
    // it, so an extraction of it can only have been started ahead of demand.
    await writer.add('content/media/unused.bin', new Uint8ArrayReader(compressibleBytes()))
  })
])

// 3. A large stored entry: sliced straight out of the archive, never extracted or stored.
built.push([
  'large-stored.h5p',
  await writeArchive('large-stored.h5p', async (writer) => {
    await addBaseFiles(writer, { skip: ['content/content.json'] })
    await writer.add(
      'content/content.json',
      new TextReader(
        JSON.stringify({ message: 'Large stored media', media: { path: 'media/big.bin' } })
      )
    )
    await writer.add('content/media/big.bin', new Uint8ArrayReader(randomBytes()), { level: 0 })
  })
])

// 4. Hostile names. A zip tool will not write these, which is exactly why they are here.
built.push([
  'traversal.h5p',
  await writeArchive('traversal.h5p', async (writer) => {
    await addBaseFiles(writer)
    await writer.add('../escaped.js', new TextReader('window.escaped = true'))
    await writer.add('content\\windows.json', new TextReader('{"windows":true}'))
    await writer.add('nested/../../escaped-too.js', new TextReader('window.escapedToo = true'))
  })
])

// 5. Content with no libraries — what h5p.com and h5p.org hand you when the site they came from
//    already has them. The runtime asks for `<MainLibrary>/library.json` and gets nothing.
built.push([
  'content-only.h5p',
  await writeArchive('content-only.h5p', async (writer) => {
    await writer.add(
      'h5p.json',
      new TextReader(
        JSON.stringify({
          title: 'Content without its libraries',
          language: 'en',
          mainLibrary: 'H5P.InteractiveVideo',
          embedTypes: ['iframe'],
          license: 'U',
          // Versions as strings, the way an h5p.org export writes them.
          preloadedDependencies: [
            { machineName: 'H5P.InteractiveVideo', majorVersion: '1', minorVersion: '27' }
          ]
        })
      )
    )
    await writer.add('content/content.json', new TextReader(JSON.stringify({ interactiveVideo: {} })))
  })
])

// 6. The same shape, but for a content type we can supply locally: an export stripped of its
//    libraries, plus a bundle that carries them. Together they have to play.
const OFFLINE_TEST_DEPENDENCY = {
  machineName: 'H5P.OfflineTest',
  majorVersion: '1',
  minorVersion: '0'
}

built.push([
  'needs-libraries.h5p',
  await writeArchive('needs-libraries.h5p', async (writer) => {
    await writer.add(
      'h5p.json',
      new TextReader(
        JSON.stringify({
          title: 'Stripped export',
          language: 'en',
          mainLibrary: 'H5P.OfflineTest',
          embedTypes: ['div'],
          license: 'U',
          // Only the main library, the way a content-only export writes it.
          preloadedDependencies: [OFFLINE_TEST_DEPENDENCY]
        })
      )
    )
    await writer.add(
      'content/content.json',
      new TextReader(JSON.stringify({ message: 'Libraries came from somewhere else.' }))
    )
  })
])

const extraLibFiles = await collectFiles(extraLibDir)

built.push([
  'libraries.h5p',
  await writeArchive('libraries.h5p', async (writer) => {
    for (const { entryName, path } of baseFiles) {
      // Libraries only: no h5p.json of the content's, no content folder.
      if (!entryName.startsWith('H5P.OfflineTest-1.0/')) continue
      await writer.add(entryName, new Uint8ArrayReader(new Uint8Array(await readFile(path))))
    }
    for (const { entryName, path } of extraLibFiles) {
      await writer.add(entryName, new Uint8ArrayReader(new Uint8Array(await readFile(path))))
    }
    await writer.add(
      'h5p.json',
      new TextReader(
        JSON.stringify({
          title: 'Library bundle',
          language: 'und',
          mainLibrary: 'H5P.OfflineTest',
          embedTypes: ['div'],
          license: 'U',
          // H5P.OfflineExtra appears only here. The merged manifest is what makes it load.
          preloadedDependencies: [
            OFFLINE_TEST_DEPENDENCY,
            { machineName: 'H5P.OfflineExtra', majorVersion: '1', minorVersion: '0' }
          ]
        })
      )
    )
  })
])

// 7. Library folders with no version suffix, the way older packages are built. h5p-standalone
//    probes the versioned name first, takes the 404 and falls back to the bare one.
built.push([
  'unversioned.h5p',
  await writeArchive('unversioned.h5p', async (writer) => {
    for (const { entryName, path } of baseFiles) {
      const bare = entryName.replace(/^H5P\.OfflineTest-1\.0\//, 'H5P.OfflineTest/')
      await writer.add(bare, new Uint8ArrayReader(new Uint8Array(await readFile(path))))
    }
  })
])

// 8. A zip that is not an H5P package at all.
built.push([
  'not-h5p.h5p',
  await writeArchive('not-h5p.h5p', async (writer) => {
    await writer.add('readme.txt', new TextReader('This archive has no h5p.json.'))
  })
])

// 9. Not a zip at all: the index read has to fail cleanly rather than hang.
const garbage = new TextEncoder().encode('this is not a zip archive, not even close\n')
await writeFile(resolve(outDir, 'corrupt.h5p'), garbage)
built.push(['corrupt.h5p', garbage.length])

for (const [name, size] of built) {
  console.log(`[fixtures] ${name.padEnd(20)} ${(size / 1024).toFixed(1)} kB`)
}
