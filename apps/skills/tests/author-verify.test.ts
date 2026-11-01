import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { BlobReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js'
import { buildPackage, schemaOf } from '@missing-elements/h5p-author'
import { verifyPackage } from '@missing-elements/h5p-verify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const project = resolve(import.meta.dirname, '..')
// The pack this project installed, named to the check as `--libraries` names a copy of its parts.
const parts = resolve(project, 'node_modules/@missing-elements/h5p-libraries/parts')
const skill = resolve(project, '../../skills/h5p-author')
const types = join(skill, 'references/types')
const example = JSON.parse(await readFile(join(skill, 'assets/quiz.json'), 'utf8'))
const scenarios = JSON.parse(await readFile(join(skill, 'assets/phishing-scenarios.json'), 'utf8'))
const META = { title: 'Example', language: 'en', license: 'CC BY', authors: [{ name: 'Ann Author', role: 'Author' }] }
const files = (await readdir(types)).filter((name) => name.endsWith('.md')).sort()
let dir: string
let clip: Uint8Array

/** The source a type file gives as its example, the metadata every source carries added. */
async function exampleOf(file: string) {
  const text = await readFile(join(types, file), 'utf8')
  const block = /## Example\s+```json\n([\s\S]*?)\n```/.exec(text)
  if (!block) throw new Error(`${file} has no example`)
  return { ...META, ...JSON.parse(block[1]) }
}

/** Every file an example names, by its `path`. */
function paths(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => paths(item, found))
  else if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    if (typeof object.path === 'string') found.push(object.path)
    Object.values(object).forEach((item) => paths(item, found))
  }
  return found
}

/** A PNG of one colour. */
function png(width: number, height: number) {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(data.length)
    head.write(type, 4)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])))
    return Buffer.concat([head, data, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  const row = Buffer.alloc(1 + width * 3, 0x90)
  row[0] = 0
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))), chunk('IEND', Buffer.alloc(0))])
}

/** A second of silence as MPEG-1 Layer III, 128 kbit/s at 44.1 kHz. */
function mp3() {
  const frame = Buffer.alloc(417)
  frame.set([0xff, 0xfb, 0x90, 0x64])
  return Buffer.concat(Array.from({ length: 38 }, () => frame))
}

/** A sample file for each name an example gives, by its type: what the user would supply. */
function sample(name: string) {
  const extension = name.split('.').pop()
  if (extension === 'png') return png(480, 270)
  if (extension === 'mp4') return clip
  if (extension === 'mp3') return mp3()
  if (extension === 'vtt') return Buffer.from('WEBVTT\n\n00:00.000 --> 00:02.000\nA river.\n')
  throw new Error(`No sample for ${name}`)
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'h5p-author-verify-'))
  // The demo's clip, which the player's own tests play: an H.264 mp4 of ten seconds.
  const reader = new ZipReader(new BlobReader(new Blob([await readFile(resolve(project, '../demo/demo/content/video.h5p'))])))
  try {
    const entry = (await reader.getEntries()).find((each) => each.filename.endsWith('.mp4'))!
    clip = await (entry as import('@zip.js/zip.js').FileEntry).getData(new Uint8ArrayWriter())
  } finally {
    await reader.close()
  }
})
afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }) })

/** Step 4 of the skill: the check, through the verifier's published API, trusted and untrusted. */
async function playsBothWays(file: string) {
  for (const untrusted of [false, true]) {
    const report = await verifyPackage({ file, untrusted, libraries: untrusted ? parts : undefined, settle: 500 })
    expect(report.verdict, JSON.stringify(report)).toBe('pass')
    expect(report.warnings, `${file}, untrusted: ${untrusted}`).toEqual([])
    expect(report.errors).toEqual([])
    expect(report.state).toBe('ready')
    expect(report.untrusted).toBe(untrusted)
    expect(report.revision).toMatch(/^sha256:[0-9a-f]{64}(; libraries sha256:[0-9a-f]{64})?$/)
  }
}

describe.concurrent('every type file', () => {
  it.each(files)('%s: its example builds, and plays trusted and untrusted without warnings', async (file) => {
    const source = await exampleOf(file)
    const folder = join(dir, file.slice(0, -'.md'.length))
    await mkdir(folder, { recursive: true })
    for (const path of paths(source.params)) if (!/^https?:/.test(path)) await writeFile(join(folder, path), sample(path))
    const output = join(folder, 'example.h5p')
    const result = await buildPackage(source, output, { base: folder })
    expect(result.notes).toEqual([])
    await playsBothWays(output)
  }, 180_000)

  it.each(files)('%s: its fields are the pack\'s, as `h5p-author schema --markdown` writes them', async (file) => {
    const text = await readFile(join(types, file), 'utf8')
    // Out of date after the pack changed: run `pnpm --filter @missing-elements/h5p-author sync:skill`.
    expect(text).toContain(await schemaOf(file.slice(0, -'.md'.length), { markdown: true }))
  })
})

describe.concurrent('the quiz format', () => {
  const quizzes: [string, unknown][] = [
    ['multiple choice', { ...example, kind: 'multiple-choice', questions: [example.questions[0]] }],
    ['question set', example],
    ['eight scenarios', scenarios],
    // Interface texts from the libraries' Ukrainian, one of them with an apostrophe the content check escapes.
    ['Ukrainian', { ...example, language: 'uk' }],
    // Titles and an author's name with quotes and markup, which the content check escapes.
    ['punctuation', {
      ...example,
      authors: [{ name: "Anne O'Brien <ed>", role: 'Author' }],
      questions: example.questions.map((question: { title: string }) => ({ ...question, title: `${question.title}'s "draft" <b> & co` }))
    }]
  ]
  it.each(quizzes)('%s plays trusted and untrusted without warnings', async (name, source) => {
    const output = join(dir, `${name.replaceAll(' ', '-')}.h5p`)
    await buildPackage(source, output)
    await playsBothWays(output)
  }, 180_000)
})
