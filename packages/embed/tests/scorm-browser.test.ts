import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildSite } from '../lib/build.mjs'
import { buildScormInPage, type ScormProgress } from '../lib/scorm-browser.mjs'
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
})
