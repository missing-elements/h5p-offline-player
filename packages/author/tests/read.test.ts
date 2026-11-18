import { execFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { BlobReader, BlobWriter, TextReader, TextWriter, Uint8ArrayReader, ZipReader, ZipWriter, type FileEntry } from '@zip.js/zip.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildPackage, readPackage } from '../lib/author.mjs'
import { mp4, png } from './helpers/media'

// The skill's type files, whose examples a read is held to (#236).
const types = resolve(import.meta.dirname, '../../../skills/h5p-author/references/types')
const bin = resolve(import.meta.dirname, '../bin/h5p-author.mjs')
const exec = promisify(execFile)
const META = { title: 'Example', language: 'en', license: 'CC BY', authors: [{ name: 'Ann Author', role: 'Author' }] }
const files = (await readdir(types)).filter((name) => name.endsWith('.md')).sort()
let dir: string
let count = 0

beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'h5p-author-read-')) })
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

/** A new folder of the test's own. */
async function folder() {
  const path = join(dir, String(++count))
  await mkdir(path)
  return path
}

/** The source a type file gives as its example, the metadata every source carries added. */
async function exampleOf(file: string) {
  const block = /## Example\s+```json\n([\s\S]*?)\n```/.exec(await readFile(join(types, file), 'utf8'))
  if (!block) throw new Error(`${file} has no example`)
  return { ...META, ...JSON.parse(block[1]) }
}

/** Every file a source names, by its `path`. */
function paths(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => paths(item, found))
  else if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    if (typeof object.path === 'string') found.push(object.path)
    Object.values(object).forEach((item) => paths(item, found))
  }
  return found
}

/** A second of silence as MPEG-1 Layer III, 128 kbit/s at 44.1 kHz. */
function mp3() {
  const frame = Buffer.alloc(417)
  frame.set([0xff, 0xfb, 0x90, 0x64])
  return Buffer.concat(Array.from({ length: 38 }, () => frame))
}

/** A file for each name an example gives, by its type. */
function sample(name: string) {
  const extension = name.split('.').pop()
  if (extension === 'png') return png(480, 270)
  if (extension === 'mp4') return mp4(true, { seconds: 60, tracks: [['vide', 'avc1'], ['soun', 'mp4a']] })
  if (extension === 'mp3') return mp3()
  if (extension === 'vtt') return Buffer.from('WEBVTT\n\n00:00.000 --> 00:02.000\nA river.\n')
  throw new Error(`No sample for ${name}`)
}

/** Content but for each part's id, which a build gives anew. */
function withoutIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutIds)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'subContentId').map(([key, each]) => [key, withoutIds(each)]))
  return value
}

/** A package's `h5p.json` and content, as a build wrote them. */
async function opened(path: string) {
  const reader = new ZipReader(new BlobReader(new Blob([await readFile(path)])))
  try {
    const entries = new Map((await reader.getEntries()).map((entry) => [entry.filename, entry as FileEntry]))
    const json = async (name: string) => JSON.parse(await entries.get(name)!.getData(new TextWriter()))
    return { manifest: await json('h5p.json'), content: await json('content/content.json') }
  } finally {
    await reader.close()
  }
}

/**
 * A package as another tool exports it: its `h5p.json`, its content and its media, and no library,
 * as h5p.com exports one without them.
 */
async function exported(path: string, manifest: unknown, content: unknown, media: Record<string, Uint8Array> = {}) {
  const writer = new ZipWriter(new BlobWriter())
  await writer.add('h5p.json', new TextReader(JSON.stringify(manifest)))
  await writer.add('content/content.json', new TextReader(JSON.stringify(content)))
  for (const [name, bytes] of Object.entries(media)) await writer.add(`content/${name}`, new Uint8ArrayReader(bytes))
  await writeFile(path, new Uint8Array(await (await writer.close()).arrayBuffer()))
}

const exists = (path: string) => lstat(path).then(() => true, () => false)

describe.concurrent('every type file', () => {
  it.each(files)('%s: its example, built, read and built again, is the same content but for the ids', async (file) => {
    const source = await exampleOf(file)
    const at = await folder()
    for (const path of paths(source.params)) if (!/^https?:/.test(path)) await writeFile(join(at, path), sample(path))
    const first = await buildPackage(source, join(at, 'example.h5p'), { base: at })
    const read = await readPackage(join(at, 'example.h5p'), join(at, 'read'))
    expect(read.notes).toEqual([])
    expect(read.output).toBe(join(at, 'read', 'example.source.json'))
    expect(JSON.parse(await readFile(read.output, 'utf8'))).toEqual(read.source)
    const { type, title, language, license, authors } = read.source
    expect({ type, title, language, license, authors }).toEqual({ type: first.manifest.mainLibrary, ...META })
    for (const path of read.files) expect(await exists(join(at, 'read', path)), path).toBe(true)
    const again = await buildPackage(read.source, undefined, { base: join(at, 'read'), check: true })
    expect(withoutIds(again.content)).toEqual(withoutIds(first.content))
  }, 60_000)
})

describe('a package read back', () => {
  /**
   * A Question Set as H5P's editor saves one and another tool exports it, without its libraries:
   * no author, a language for the metadata apart from the content's, the comments and change log,
   * a part with a licence and authors of its own, a field its library does not have, an empty tip
   * nobody typed in, the copyright of a picture saved with every part empty, and a question
   * without a title, which the set names itself.
   */
  async function elsewhere(at: string) {
    const built = join(at, 'built.h5p')
    await writeFile(join(at, 'river.png'), png(320, 180))
    await buildPackage({
      ...META,
      type: 'H5P.QuestionSet',
      params: {
        questions: [
          { library: 'H5P.MultiChoice', params: { question: 'Which river is the longest in Europe?', media: { type: { library: 'H5P.Image', params: { file: { path: 'river.png' }, alt: 'A river' } } }, answers: [{ text: 'Volga', correct: true }, { text: 'Danube' }] } },
          { library: 'H5P.TrueFalse', params: { question: 'The Rhine flows into the North Sea.' } }
        ]
      }
    }, built, { base: at })
    const { manifest, content } = await opened(built)
    const { authors, ...rest } = manifest
    const saved = { ...rest, language: 'und', defaultLanguage: 'en', authorComments: 'Check the dates with Ann.', changes: [{ date: '01-11-26 10:00:00', author: 'Ann', log: 'First draft' }] }
    const [choice, statement] = content.questions
    choice.metadata = { ...choice.metadata, license: 'CC BY-SA', licenseVersion: '4.0', authors: [{ name: 'Bo Brown', role: 'Author' }], title: 'Untitled Multiple Choice' }
    choice.params.oldField = true
    choice.params.answers[1].tipsAndFeedback = { ...choice.params.answers[1].tipsAndFeedback, tip: '' }
    choice.params.media.type.params.file.copyright = { license: 'U', author: '', title: '', year: '', source: '', version: '' }
    delete statement.metadata.title
    const image = choice.params.media.type.params.file.path
    const bytes = new Uint8Array(png(320, 180))
    const output = join(at, 'elsewhere.h5p')
    await exported(output, saved, content, { [image]: bytes })
    return { output, image }
  }

  it('from another tool: its own fields and what a build fills in left out, and what a source cannot hold said', async () => {
    const at = await folder()
    const { output, image } = await elsewhere(at)
    const read = await readPackage(output, join(at, 'read'))
    expect(read.source).toMatchObject({ type: 'H5P.QuestionSet', title: 'Example', language: 'en', license: 'CC BY', authors: [{ name: 'Unknown', role: 'Author' }] })
    expect(read.source.params).toEqual({
      questions: [
        {
          library: 'H5P.MultiChoice',
          params: { question: 'Which river is the longest in Europe?', media: { type: { library: 'H5P.Image', params: { file: { path: image }, alt: 'A river' } } }, answers: [{ text: 'Volga', correct: true }, { text: 'Danube' }] },
          metadata: { title: 'Untitled Multiple Choice' }
        },
        { library: 'H5P.TrueFalse', params: { question: 'The Rhine flows into the North Sea.' } }
      ]
    })
    expect(read.notes.map(({ path }) => path)).toEqual(['language', 'params.questions[0].params.oldField', 'authors', 'authorComments', 'changes', 'params.questions[0].metadata'])
    expect(read.notes.find(({ path }) => path === 'params.questions[0].metadata')?.message).toMatch(/licence, authors or more of their own.*a build gives every part the source's/)
    expect(read.files).toEqual([image])
    expect(await exists(join(at, 'read', image))).toBe(true)
    const again = await buildPackage(read.source, undefined, { base: join(at, 'read'), check: true })
    expect(again.notes).toEqual([])
  })

  it('refuses content made for another version of a library than the pack has, naming both', async () => {
    const at = await folder()
    const { output } = await elsewhere(at)
    const { manifest, content } = await opened(output)
    const main = manifest.preloadedDependencies.find((each: { machineName: string }) => each.machineName === 'H5P.QuestionSet')
    const minor = Number(main.minorVersion)
    main.minorVersion = String(minor - 1)
    const older = join(at, 'older.h5p')
    await exported(older, manifest, content)
    await expect(readPackage(older, join(at, 'read'))).rejects.toThrow(`H5P.QuestionSet ${main.majorVersion}.${minor - 1}, where the pack has ${main.majorVersion}.${minor}`)
    expect(await exists(join(at, 'read'))).toBe(false)
  })

  it('never writes over a file, and writes nothing where a name is taken', async () => {
    const at = await folder()
    const { output, image } = await elsewhere(at)
    await mkdir(join(at, 'read'))
    await writeFile(join(at, 'read', 'elsewhere.source.json'), 'mine')
    await expect(readPackage(output, join(at, 'read'))).rejects.toThrow(/exists, and a read never writes over a file/)
    expect(await readFile(join(at, 'read', 'elsewhere.source.json'), 'utf8')).toBe('mine')
    expect(await exists(join(at, 'read', image))).toBe(false)
  })

  it('writes only inside its folder, and only where it may', async () => {
    const at = await folder()
    const { output } = await elsewhere(at)
    const { manifest, content } = await opened(output)
    content.questions[0].params.media.type.params.file.path = '../../outside.png'
    const hostile = join(at, 'hostile.h5p')
    await exported(hostile, manifest, content)
    const read = await readPackage(hostile, join(at, 'read'))
    expect(read.notes).toContainEqual({ path: 'params', message: 'names the file "../../outside.png", which is no path a read writes a file at: not written' })
    expect(read.files).toEqual([])
    expect(await exists(join(at, 'outside.png'))).toBe(false)
    // An archive whose entry leads out of its folders is not read at all.
    const leading = join(at, 'leading.h5p')
    await exported(leading, manifest, content, { '../../outside.png': new Uint8Array(png(8, 8)) })
    await expect(readPackage(leading, join(at, 'read-1'))).rejects.toThrow('has an entry named "content/../../outside.png", which leads out of its folders: an archive like that is not read')
    expect(await exists(join(at, 'outside.png'))).toBe(false)
    const elsewhereFolder = await folder()
    await expect(readPackage(output, join(at, 'read-2'), { within: [elsewhereFolder] })).rejects.toThrow(/is outside the folders this read may use/)
    await expect(readPackage(output, join(elsewhereFolder, '..', 'read-3'), { within: [at] })).rejects.toThrow(/is outside the folders this read may write in/)
  })

  it('is a command: h5p-author read writes the source and its media, and says how to build it again', async () => {
    const at = await folder()
    const { image } = await elsewhere(at)
    // As the command sees its folder, a temporary folder's link followed.
    const real = await realpath(at)
    const { stdout, stderr } = await exec(process.execPath, [bin, 'read', 'elsewhere.h5p', 'read'], { cwd: at })
    expect(stdout).toContain(`Read ${join(real, 'elsewhere.h5p')}: H5P.QuestionSet. Wrote its source to ${join(real, 'read', 'elsewhere.source.json')}, and 1 media file beside it.`)
    expect(stdout).toContain(`h5p-author build ${join('read', 'elsewhere.source.json')} <output.h5p>`)
    expect(stderr).toContain('Note: authorComments is the author\'s comments, which a source has no field for: left out')
    expect(await exists(join(at, 'read', image))).toBe(true)
  })
})
