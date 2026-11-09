import { execFile } from 'node:child_process'
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { BlobReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildPackage, bundleLibraries, contentTypes, missingForInstall, openPack, writeBundle, writeBundles } from '../lib/author.mjs'

/*
 * A content type's bundle (#166): the parts a build of the type reads, for a build where the pack
 * cannot be installed and a file can be fetched. Everything the type can hold is in it, with what
 * an H5P site's upload check wants, and no addon; a build from it is the build from the pack, or
 * stops at the part it lacks, by name.
 */

const parts = resolve(import.meta.dirname, '../../libraries/parts')
const bin = resolve(import.meta.dirname, '../bin/h5p-author.mjs')
const exec = promisify(execFile)
const META = { title: 'Rivers', language: 'en', license: 'CC BY', authors: [{ name: 'Ann Author', role: 'Author' }] }
const QUIZ = {
  ...META,
  type: 'H5P.QuestionSet',
  params: {
    questions: [
      { library: 'H5P.MultiChoice', params: { question: 'Which river is the longest in Europe?', answers: [{ text: 'Volga', correct: true }, { text: 'Danube', correct: false }] } },
      { library: 'H5P.TrueFalse', params: { question: 'The Rhine flows into the North Sea.', correct: 'true' } }
    ]
  }
}

type Field = { name: string, type: string, options?: string[], field?: Field, fields?: Field[] }

let dir: string
let pack: Awaited<ReturnType<typeof openPack>>
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'h5p-author-bundle-'))
  pack = await openPack()
})
afterAll(async () => {
  await pack?.close()
  await rm(dir, { recursive: true, force: true })
})

/** A zip's files by name, in its order. */
async function unzipped(path: string) {
  const reader = new ZipReader(new BlobReader(new Blob([await readFile(path)])), { checkSignature: true })
  try {
    const files = new Map<string, Uint8Array>()
    for (const entry of await reader.getEntries()) if (!entry.directory) files.set(entry.filename, await entry.getData(new Uint8ArrayWriter()))
    return files
  } finally {
    await reader.close()
  }
}

/** A zip unzipped into a folder of its own, as a chat's sandbox unzips a bundle. */
async function unzip(path: string, name: string) {
  const folder = join(dir, name)
  for (const [file, bytes] of await unzipped(path)) {
    await mkdir(dirname(join(folder, file)), { recursive: true })
    await writeFile(join(folder, file), bytes)
  }
  return folder
}

/** Content with the ids a build draws anew each time masked. */
const masked = (content: unknown) => JSON.parse(JSON.stringify(content, (key, value) => (key === 'subContentId' ? '*' : value)))

/** The `library.json` of each part, as the upload check reads them. */
const librariesOf = (entries: Array<{ folder: string }>) => Promise.all(entries.map(async (entry) => (await pack.open(pack.libraries.find((each) => each.folder === entry.folder)!)).library))

describe('bundleLibraries', () => {
  it('holds every question a Question Set offers, with what an H5P site\'s upload check wants, and no addon', async () => {
    const bundle = await bundleLibraries(pack, 'H5P.QuestionSet')
    const set = pack.newest('H5P.QuestionSet')!
    expect(bundle[0]).toEqual(set)
    const names = new Set(bundle.map((entry) => entry.machineName))
    const questions = ((await pack.open(set)).semantics as Field[]).find((field) => field.name === 'questions')!.field!
    const offered = questions.options!.map((option) => option.split(' ')[0]).filter((name) => pack.newest(name))
    expect(offered.length).toBeGreaterThan(5)
    for (const name of offered) expect(names).toContain(name)
    expect(names).toContain('H5PEditor.QuestionSetTextualEditor')
    // Every dependency a part names, preloaded, dynamic or editor, is there at its exact version.
    expect(missingForInstall(await librariesOf(bundle))).toEqual([])
    expect(bundle.filter((entry) => entry.addTo !== undefined)).toEqual([])
    const size = (entries: Array<{ size: number }>) => entries.reduce((sum, entry) => sum + entry.size, 0)
    expect(size(bundle)).toBeLessThan(size(pack.libraries) / 4)
  })

  it('makes every content type\'s complete for the upload check, without an addon', async () => {
    const types = await contentTypes(pack)
    expect(types.length).toBeGreaterThan(40)
    for (const type of types) {
      expect(type.library.runnable, type.folder).toBeTruthy()
      expect(type.index.installOnly, type.folder).toBeUndefined()
      const bundle = await bundleLibraries(pack, type.library.machineName)
      expect(missingForInstall(await librariesOf(bundle)), type.folder).toEqual([])
      expect(bundle.some((entry) => entry.addTo !== undefined), type.folder).toBe(false)
    }
  })

  it('refuses a library that is not a content type, and one the pack does not have', async () => {
    await expect(bundleLibraries(pack, 'H5P.Question')).rejects.toThrow(/^H5P\.Question is not a content type on its own but a library content types use/)
    await expect(bundleLibraries(pack, 'H5P.Nothing')).rejects.toThrow(/^The library pack has no content type H5P\.Nothing\. Its content types: .*H5P\.QuestionSet/)
  })
})

describe('writeBundle', () => {
  it('writes the pack\'s whole index, the parts and the licences, the same bytes each time', async () => {
    const output = join(dir, 'H5P.QuestionSet.zip')
    const result = await writeBundle('H5P.QuestionSet', output)
    expect(result).toMatchObject({ output, type: expect.stringMatching(/^H5P\.QuestionSet \d+\.\d+$/), size: (await stat(output)).size })
    const files = await unzipped(output)
    expect([...files.keys()]).toEqual(['parts/index.json', ...result.parts.map((folder) => `parts/${folder}.h5p`), 'libraries.txt'])
    expect(Buffer.from(files.get('parts/index.json')!).equals(await readFile(join(parts, 'index.json')))).toBe(true)
    expect(Buffer.from(files.get('libraries.txt')!).equals(await readFile(join(parts, '../libraries.txt')))).toBe(true)
    for (const folder of result.parts) expect(Buffer.from(files.get(`parts/${folder}.h5p`)!).equals(await readFile(join(parts, `${folder}.h5p`))), folder).toBe(true)

    const again = await writeBundle('H5P.QuestionSet', join(dir, 'again.zip'))
    expect((await readFile(again.output)).equals(await readFile(output))).toBe(true)
    await expect(writeBundle('H5P.QuestionSet', output)).rejects.toMatchObject({ code: 'EEXIST', message: `${output} exists, and h5p-author never writes over a file: name a new one` })
  })

  it('builds what the pack builds', async () => {
    const folder = await unzip((await writeBundle('H5P.QuestionSet', join(dir, 'quiz.zip'))).output, 'quiz')
    const whole = await buildPackage(QUIZ, join(dir, 'whole.h5p'))
    const bundled = await buildPackage(QUIZ, join(dir, 'bundled.h5p'), { libraries: join(folder, 'parts') })
    expect(bundled.libraries).toEqual(whole.libraries)
    expect(bundled.install).toEqual(whole.install)
    expect(bundled.manifest).toEqual(whole.manifest)
    expect(masked(bundled.content)).toEqual(masked(whole.content))
  })

  it('stops at an addon the text calls for, naming its part, and builds with it once it is there', async () => {
    const folder = join(await unzip((await writeBundle('H5P.Blanks', join(dir, 'H5P.Blanks.zip'))).output, 'blanks'), 'parts')
    const addon = pack.newest('H5P.MathDisplay')!
    const squares = { ...META, type: 'H5P.Blanks', params: { questions: ['The square of 3, $$3^2$$, is *9*.'] } }
    const output = join(dir, 'squares.h5p')
    await expect(buildPackage(squares, output, { libraries: folder })).rejects.toThrow(
      `The parts folder ${folder} has no ${addon.folder}.h5p, which this build needs: add it from the library pack's parts/`
    )
    expect(await readdir(dir)).not.toContain('squares.h5p')
    await copyFile(join(parts, `${addon.folder}.h5p`), join(folder, `${addon.folder}.h5p`))
    const built = await buildPackage(squares, output, { libraries: folder })
    expect(built.libraries).toContain(addon.folder)
    expect(built.notes.map(({ message }) => message)).toContainEqual(expect.stringContaining(`${addon.machineName} ${addon.majorVersion}.${addon.minorVersion}`))
  })

  it('writes every content type\'s or none: one that fails takes those before it away again', async () => {
    // A copy of the pack without a part that only a later content type's bundle reads: an older
    // minor kept for the upload check, which listing the content types never opens.
    const types = (await contentTypes(pack)).map((type) => type.library.machineName)
    const bundles: string[][] = []
    for (const type of types) bundles.push((await bundleLibraries(pack, type)).map((entry) => entry.folder))
    const firstNeeding = (folder: string) => bundles.findIndex((folders) => folders.includes(folder))
    const missing = pack.libraries.filter((entry) => entry.installOnly).map((entry) => entry.folder).find((folder) => firstNeeding(folder) > 0)
    expect(missing).toBeDefined()
    const copy = join(dir, 'gappy')
    await cp(parts, join(copy, 'parts'), { recursive: true })
    await copyFile(join(parts, '../libraries.txt'), join(copy, 'libraries.txt'))
    await rm(join(copy, 'parts', `${missing}.h5p`))

    const out = join(dir, 'gappy-bundles')
    await expect(writeBundles(out, { libraries: join(copy, 'parts') })).rejects.toThrow(`has no ${missing}.h5p`)
    expect(await readdir(out)).toEqual([])
    // Run again with the part back, it writes them all.
    await copyFile(join(parts, `${missing}.h5p`), join(copy, 'parts', `${missing}.h5p`))
    expect(await writeBundles(out, { libraries: join(copy, 'parts') })).toHaveLength(types.length)
  })

  it('refuses a pack without its licence list beside its parts', async () => {
    const bare = join(dir, 'bare', 'parts')
    await mkdir(bare, { recursive: true })
    await copyFile(join(parts, 'index.json'), join(bare, 'index.json'))
    await expect(writeBundle('H5P.TrueFalse', join(dir, 'bare.zip'), { libraries: bare })).rejects.toThrow(
      `${join(dir, 'bare', 'libraries.txt')} cannot be read: a bundle carries the licences its libraries are used under`
    )
    expect(await readdir(dir)).not.toContain('bare.zip')
  })
})

describe('the bundle command', () => {
  it('writes one content type\'s bundle, or with --all every content type\'s, by its name', async () => {
    const { stdout } = await exec(process.execPath, [bin, 'bundle', 'H5P.TrueFalse', join(dir, 'tf.zip')])
    expect(stdout).toMatch(/^Bundled H5P\.TrueFalse \d+\.\d+ in \S+tf\.zip: \d+ parts from the library pack \d+\.\d+\.\d+, [\d.]+ (kB|MB)\. Unzip it beside a source and build with --libraries parts\.\n$/)

    const all = join(dir, 'all')
    const { stdout: listed } = await exec(process.execPath, [bin, 'bundle', '--all', all])
    const types = (await contentTypes(pack)).map((type) => type.library.machineName)
    expect((await readdir(all)).sort()).toEqual(types.map((type) => `${type}.zip`).sort())
    expect(listed).toContain(`Bundled ${types.length} content types in ${all} from the library pack `)
    // Not one written over: nothing is written.
    await rm(join(all, 'H5P.Blanks.zip'))
    await expect(exec(process.execPath, [bin, 'bundle', '--all', all])).rejects.toMatchObject({ code: 1, stderr: expect.stringMatching(/\.zip exists, and h5p-author never writes over a file/) })
    expect(await readdir(all)).not.toContain('H5P.Blanks.zip')

    await expect(exec(process.execPath, [bin, 'bundle', 'H5P.TrueFalse'])).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('bundle takes a content type and an output') })
    await expect(exec(process.execPath, [bin, 'bundle', '--markdown', 'H5P.TrueFalse', 'x.zip'])).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('bundle does not take --markdown') })
  })
})
