import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildSite } from '../lib/build.mjs'
import { buildScormInPage, planScormInPage, type ScormProgress } from '../lib/scorm-browser.mjs'
import { buildScorm } from '../lib/scorm.mjs'
import { EmbedError } from '../lib/shared.mjs'
import { host, type Host } from './helpers/host.js'
import { changedQuiz, entriesOf, formulas, quiz } from './helpers/zip.js'

/**
 * The SCORM package built in a page, run here in Node, which has what the builder needs of a
 * browser — `fetch`, `File`, `Blob`, `crypto.subtle` — against a written site served as a static
 * host serves one. Held to the command's zip entry for entry: the two are written by one code,
 * and this is what keeps them one. `scorm-page.test.ts` drives the page itself, in Chromium.
 */

const require = createRequire(import.meta.url)
/** The versions the command's notice names, read as the command reads them. */
const version = (await readFile(require.resolve('@missing-elements/h5p-offline-player/dist/VERSION'), 'utf8')).trim()
const packVersion: string = require('@missing-elements/h5p-libraries/package.json').version

let dir: string
/** The written site, with the pack; one without it; and one serving a part with the wrong bytes. */
let site: Host
let lean: Host
let tampered: Host

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'h5p-embed-page-scorm-'))
  await buildSite({ out: join(dir, 'site') })
  await buildSite({ out: join(dir, 'lean'), libraries: false })
  await cp(join(dir, 'site'), join(dir, 'tampered'), { recursive: true })
  // A part served with other bytes than the index says, as a host that cut one short would.
  await writeFile(join(dir, 'tampered', 'libraries', 'H5P.Transition-1.0.h5p'), 'not the part')
  site = await host(join(dir, 'site'), '127.0.0.1')
  lean = await host(join(dir, 'lean'), '127.0.0.1')
  tampered = await host(join(dir, 'tampered'), '127.0.0.1')
})

afterAll(async () => {
  await Promise.all([site, lean, tampered].map((h) => h?.close()))
  await rm(dir, { recursive: true, force: true })
})

/** The file as a page is given it. */
const picked = async (path: string, name: string) => new File([await readFile(path)], name)
/** Where a page on `where` finds the player's files and the pack. */
const onSite = (where: Host) => ({ base: `${where.origin}/`, packBase: `${where.origin}/libraries/`, version, packVersion })

/** Two zips held to each other: the same entries in the same order, each stored or deflated alike, with the same bytes. */
async function expectSameZip(a: string, b: string) {
  const left = await entriesOf(a)
  const right = await entriesOf(b)
  expect(left.names).toEqual(right.names)
  for (const name of left.names) {
    expect(left.entry(name).compressionMethod, name).toBe(right.entry(name).compressionMethod)
    expect(Buffer.from(await left.bytes(name)).equals(await right.bytes(name)), name).toBe(true)
  }
  await left.close()
  await right.close()
}

/** The page's zip, written out for the comparison. */
async function builtInPage(path: string, name: string, where: Host, onProgress?: (progress: ScormProgress) => void) {
  const built = await buildScormInPage({ file: await picked(path, name), ...onSite(where), onProgress })
  const out = join(dir, `${name}.page.zip`)
  await writeFile(out, new Uint8Array(await built.blob.arrayBuffer()))
  return { built, out }
}

describe('built in a page', () => {
  it("writes the command's zip, entry for entry, from a picked file that carries its libraries", async () => {
    const { built, out } = await builtInPage(quiz, 'quiz.h5p', site)
    const command = await buildScorm({ h5p: quiz, out: join(dir, 'quiz.cli.zip') })
    expect(built).toMatchObject({ name: 'quiz.scorm.zip', title: command.title, build: command.build, libraries: [], version, size: command.size })
    expect(built.blob.type).toBe('application/zip')
    await expectSameZip(out, command.out)
  })

  it("writes the command's zip for an export without its libraries, with the parts from the site's pack", async () => {
    const steps: ScormProgress[] = []
    const { built, out } = await builtInPage(formulas, 'formulas.h5p', site, (progress) => steps.push(progress))
    const command = await buildScorm({ h5p: formulas, out: join(dir, 'formulas.cli.zip') })
    expect(built.libraries).toEqual(command.libraries)
    expect(built.libraries.length).toBeGreaterThan(1)
    expect(built).toMatchObject({ name: 'formulas.scorm.zip', title: command.title, build: command.build })
    await expectSameZip(out, command.out)
    expect(steps).toEqual([{ step: 'reading' }, { step: 'libraries', libraries: command.libraries.length }, { step: 'writing' }])
  })

  it('says what a zip will hold before it is written, and writes it under any title as often as asked', async () => {
    const steps: ScormProgress[] = []
    const plan = await planScormInPage({ file: await picked(formulas, 'formulas.h5p'), ...onSite(site), onProgress: (progress) => steps.push(progress) })
    const command = await buildScorm({ h5p: formulas, out: join(dir, 'formulas.plan.zip') })
    const index = JSON.parse(await readFile(join(dir, 'site', 'libraries', 'index.json'), 'utf8')) as { libraries: Array<{ folder: string; size: number }> }
    const sizes = new Map(index.libraries.map((entry) => [entry.folder, entry.size]))
    expect(plan).toMatchObject({ name: 'formulas.h5p', size: (await readFile(formulas)).length, title: command.title, libraries: command.libraries })
    expect(plan.mainLibrary).toEqual({ machineName: 'H5P.QuestionSet', majorVersion: 1, minorVersion: expect.any(Number) })
    expect(plan.librariesSize).toBe(command.libraries.reduce((sum, folder) => sum + (sizes.get(folder) ?? Number.NaN), 0))
    // Read, and nothing fetched or written yet.
    expect(steps).toEqual([{ step: 'reading' }])

    const carries = await planScormInPage({ file: await picked(quiz, 'quiz.h5p'), ...onSite(site) })
    expect(carries).toMatchObject({ libraries: [], librariesSize: 0, mainLibrary: { machineName: 'H5P.QuestionSet' } })

    // Written twice, under two titles: the same zip but for the title, kept against the same build.
    const first = await plan.write()
    const second = await plan.write({ title: '  A title\nof its own  ' })
    expect(first).toMatchObject({ title: command.title, build: command.build, libraries: command.libraries })
    expect(second).toMatchObject({ title: 'A title of its own', build: command.build })
    expect(steps).toEqual([{ step: 'reading' }, ...Array(2).fill([{ step: 'libraries', libraries: command.libraries.length }, { step: 'writing' }]).flat()])
    const firstOut = join(dir, 'formulas.first.zip')
    const secondOut = join(dir, 'formulas.second.zip')
    await writeFile(firstOut, new Uint8Array(await first.blob.arrayBuffer()))
    await writeFile(secondOut, new Uint8Array(await second.blob.arrayBuffer()))
    const a = await entriesOf(firstOut)
    const b = await entriesOf(secondOut)
    expect(b.names).toEqual(a.names)
    for (const name of a.names) {
      const same = Buffer.from(await a.bytes(name)).equals(Buffer.from(await b.bytes(name)))
      expect(same, name).toBe(name !== 'imsmanifest.xml' && name !== 'index.html')
    }
    expect((await b.text('imsmanifest.xml')).match(/<title>A title of its own<\/title>/g)).toHaveLength(2)
    expect(await b.text('index.html')).toContain('<title>A title of its own</title>')
    await a.close()
    await b.close()
  })

  it("writes the command's zip under the command's title, and keeps the package's for a title of spaces", async () => {
    const titled = await buildScormInPage({ file: await picked(quiz, 'quiz.h5p'), ...onSite(site), title: 'Week 3: the quiz' })
    const out = join(dir, 'quiz.titled.page.zip')
    await writeFile(out, new Uint8Array(await titled.blob.arrayBuffer()))
    const command = await buildScorm({ h5p: quiz, out: join(dir, 'quiz.titled.cli.zip'), title: 'Week 3: the quiz' })
    expect(titled).toMatchObject({ title: 'Week 3: the quiz', build: command.build })
    expect(command.title).toBe('Week 3: the quiz')
    await expectSameZip(out, command.out)
    await expect(buildScormInPage({ file: await picked(quiz, 'quiz.h5p'), ...onSite(site), title: ' \t ' })).resolves.toMatchObject({ title: 'Do you know what just happened?' })
  })

  it('takes a title given to the plan for its writes, and hashes the package once however often it is written', async () => {
    const size = (await readFile(quiz)).length
    const digest = vi.spyOn(crypto.subtle, 'digest')
    try {
      const plan = await planScormInPage({ file: await picked(quiz, 'quiz.h5p'), ...onSite(site), title: 'Week 3: the quiz' })
      expect(plan.title).toBe('Week 3: the quiz')
      const first = await plan.write()
      const second = await plan.write({ title: 'Week 4' })
      expect(first.title).toBe('Week 3: the quiz')
      expect(second).toMatchObject({ title: 'Week 4', build: first.build })
      // The whole package, hashed for the build stamp: on the first write only.
      expect(digest.mock.calls.filter(([, data]) => data.byteLength === size)).toHaveLength(1)
    } finally {
      digest.mockRestore()
    }
  })

  it("writes the command's zip with the command's options, and refuses them with a launch page from before them", async () => {
    const options = { scormVersion: '2004' as const, passMark: 80, completionScore: true }
    const built = await buildScormInPage({ file: await picked(formulas, 'formulas.h5p'), ...onSite(site), ...options })
    const out = join(dir, 'formulas.2004.page.zip')
    await writeFile(out, new Uint8Array(await built.blob.arrayBuffer()))
    const command = await buildScorm({ h5p: formulas, out: join(dir, 'formulas.2004.cli.zip'), ...options })
    expect(built).toMatchObject({ scormVersion: '2004', passMark: 80, completionScore: true, build: command.build })
    await expectSameZip(out, command.out)

    // A plan written under other options, as the page's options step changes them.
    const plan = await planScormInPage({ file: await picked(quiz, 'quiz.h5p'), ...onSite(site) })
    expect((await plan.write()).scormVersion).toBe('1.2')
    expect((await plan.write({ scormVersion: '2004' })).scormVersion).toBe('2004')
    await expect(plan.write({ passMark: 120 })).rejects.toThrow(/The pass mark is a number from 0 to 100, not 120\./)
    await expect(planScormInPage({ file: await picked(quiz, 'quiz.h5p'), ...onSite(site), scormVersion: '3' as never })).rejects.toThrow(/The SCORM version is 1\.2 or 2004/)

    // A page that bundles the launch page as embed 1.5 shipped it has no place for the options.
    const launch = (await readFile(join(import.meta.dirname, '../scorm/index.html'), 'utf8')).replace('%SCORM%', '')
    const older = { ...onSite(site), assets: { launch } }
    await expect(buildScormInPage({ file: await picked(quiz, 'quiz.h5p'), ...older, scormVersion: '2004' })).rejects.toThrow(/The launch page's template is older than the SCORM options/)
    await expect(buildScormInPage({ file: await picked(quiz, 'quiz.h5p'), ...older })).resolves.toMatchObject({ scormVersion: '1.2' })
  })

  it("takes the pack as its package exports it, with the same result", async () => {
    const index = JSON.parse(await readFile(join(dir, 'site', 'libraries', 'index.json'), 'utf8')) as { libraries: Array<{ folder: string }> }
    const pack = { libraries: index.libraries.map((entry) => ({ ...entry, url: `${site.origin}/libraries/${entry.folder}.h5p` })) }
    const { packBase: _unused, ...rest } = onSite(site)
    const built = await buildScormInPage({ file: await picked(formulas, 'formulas.h5p'), ...rest, pack: pack as never })
    const command = await buildScorm({ h5p: formulas, out: join(dir, 'formulas.pack.zip') })
    expect(built).toMatchObject({ build: command.build, libraries: command.libraries })
  })

  it('refuses what the command refuses, in its words, and a part whose bytes are not the index\'s', async () => {
    const unknown = join(dir, 'unknown.h5p')
    await changedQuiz(unknown, (manifest) => {
      manifest.preloadedDependencies.push({ machineName: 'H5P.Nowhere', majorVersion: 1, minorVersion: 0 })
    })
    await expect(buildScormInPage({ file: await picked(unknown, 'unknown.h5p'), ...onSite(site) })).rejects.toThrow(/unknown\.h5p needs libraries that neither it nor the library pack carries: H5P\.Nowhere 1\.0\./)
    await expect(buildScormInPage({ file: new File(['not a zip'], 'not.h5p'), ...onSite(site) })).rejects.toThrow(/not\.h5p could not be read as a zip archive/)
    await expect(buildScormInPage({ file: new Blob(['x']), ...onSite(site) })).rejects.toThrow(TypeError)

    // The quiz needs no part, so the tampered one is never fetched; the export without its libraries does.
    await expect(builtInPage(quiz, 'quiz.h5p', tampered)).resolves.toBeTruthy()
    const refused = buildScormInPage({ file: await picked(formulas, 'formulas.h5p'), ...onSite(tampered) })
    await expect(refused).rejects.toThrow(/H5P\.Transition-1\.0 from .* does not match the pack's index, so the zip was not written/)
    await expect(refused).rejects.toBeInstanceOf(EmbedError)
  })

  it('says that the site has no pack, rather than that the pack lacks something, and names a file the site lacks', async () => {
    const { packBase: _unused, ...withoutPack } = onSite(lean)
    await expect(buildScormInPage({ file: await picked(formulas, 'formulas.h5p'), ...withoutPack })).rejects.toThrow(
      /formulas\.h5p does not carry all its libraries, and this page has no library pack to take them from\./
    )
    // One that carries its libraries builds there as anywhere.
    await expect(buildScormInPage({ file: await picked(quiz, 'quiz.h5p'), ...withoutPack })).resolves.toMatchObject({ libraries: [] })
    await expect(buildScormInPage({ file: await picked(quiz, 'quiz.h5p'), ...onSite(site), base: `${site.origin}/nowhere/` })).rejects.toThrow(/is not at .*\/nowhere\/.*: it answered 404\./)
  })

  it('writes a zip without the compressor for a page that bundles the launch files and has none, and refuses a site without it', async () => {
    // A page bundled before 1.5 gives the launch page, the bridge and the stylesheet, and serves
    // only the player's files: no `lz-string.js` where it serves them.
    const withoutCompressor: typeof fetch = (input, init) =>
      String(input).endsWith('/lz-string.js') ? Promise.resolve(new Response('', { status: 404 })) : fetch(input, init)
    const assets = {
      launch: await readFile(join(import.meta.dirname, '../scorm/index.html'), 'utf8'),
      bridge: await readFile(join(import.meta.dirname, '../scorm/scorm.js'), 'utf8'),
      css: await readFile(join(import.meta.dirname, '../site/embed.css'), 'utf8')
    }
    const built = await buildScormInPage({ file: await picked(quiz, 'quiz.h5p'), ...onSite(site), assets, fetch: withoutCompressor })
    const out = join(dir, 'quiz.plain.zip')
    await writeFile(out, new Uint8Array(await built.blob.arrayBuffer()))
    const zip = await entriesOf(out)
    expect(zip.names).not.toContain('lz-string.js')
    const page = await zip.text('index.html')
    expect(page).not.toContain('lz-string')
    expect(page).toContain('<script type="module" src="./scorm.js"></script>')
    const listed = [...(await zip.text('imsmanifest.xml')).matchAll(/<file href="([^"]+)"\/>/g)].map((match) => match[1])
    expect(listed.sort()).toEqual([...zip.names].sort())
    expect(await zip.text('NOTICE.txt')).not.toContain('lz-string')
    await zip.close()

    // Given it, the zip carries it, as from the site.
    const given = await buildScormInPage({ file: await picked(quiz, 'quiz.h5p'), ...onSite(site), assets: { ...assets, lz: 'var LZString = {}' }, fetch: withoutCompressor })
    await writeFile(out, new Uint8Array(await given.blob.arrayBuffer()))
    const withIt = await entriesOf(out)
    expect(await withIt.text('lz-string.js')).toBe('var LZString = {}')
    expect(await withIt.text('index.html')).toContain('<script src="./lz-string.js"></script>')
    await withIt.close()

    // A page that takes the launch files from the site takes the compressor from it too, and a
    // site without it is refused, naming it.
    await expect(buildScormInPage({ file: await picked(quiz, 'quiz.h5p'), ...onSite(site), fetch: withoutCompressor })).rejects.toThrow(
      /The launch page's compressor is not at .*\/lz-string\.js: it answered 404\./
    )
  })
})
