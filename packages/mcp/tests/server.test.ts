import { access, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * The server as an app runs it: the command the package ships, started over standard input and
 * output, given one folder, asked through the SDK's own client. The build's rules are the author
 * package's and tested there; these hold the server to calling them, to its folders, and to its
 * answers. Each test builds what it needs, under a title of its own.
 */

const COMMAND = resolve(import.meta.dirname, '../bin/h5p-mcp.mjs')
const SOURCE = {
  type: 'H5P.TrueFalse',
  title: 'Boiling point',
  language: 'en',
  license: 'U',
  authors: [{ name: 'Unknown', role: 'Author' }],
  params: { question: '<p>Water boils at 100 °C at sea level.</p>', correct: 'true' }
}

type Content = { type: string, text?: string, data?: string, mimeType?: string }
type Answer = { content: Content[], isError?: boolean }

let folder: string
/** A folder the server may not use. */
let elsewhere: string
let client: Client

const call = async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as Answer
const textOf = (answer: Answer) => answer.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
/** The path a build's answer names, if it built. */
const builtOf = (answer: Answer) => /^Built (.+?\.h5p) \(/m.exec(textOf(answer))?.[1]
const build = async (title: string, args: Record<string, unknown> = {}) => builtOf(await call('h5p_build', { source: { ...SOURCE, title }, verify: false, ...args }))

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'h5p-mcp-'))
  elsewhere = await mkdtemp(join(tmpdir(), 'h5p-mcp-elsewhere-'))
  client = new Client({ name: 'h5p-mcp-test', version: '0' })
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [COMMAND, '--allow', folder, '--no-open'], stderr: 'pipe' }))
})

afterAll(async () => {
  await client?.close()
  await rm(folder, { recursive: true, force: true })
  await rm(elsewhere, { recursive: true, force: true })
})

describe('the server', () => {
  it('offers four tools and the flow, in few words', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual(['h5p_build', 'h5p_preview', 'h5p_read', 'h5p_types'])
    expect(client.getInstructions()).toMatch(/h5p_types[\s\S]*h5p_build[\s\S]*h5p_preview[\s\S]*h5p_read/)
    // A source's own fields as the author package declares them, before one is written (#230),
    // with nothing required or forbidden, so no app refuses a source the build would read (#174).
    const source = tools.find((tool) => tool.name === 'h5p_build')?.inputSchema.properties?.source as Record<string, any>
    expect(source.properties).toMatchObject({ license: { enum: expect.arrayContaining(['U', 'CC BY']) }, authors: { items: { required: ['name', 'role'] } } })
    expect(source).not.toHaveProperty('required')
    expect(source.additionalProperties).not.toBe(false)
    // What an app sends the model with every message: under about 1,500 tokens at four characters each.
    expect(JSON.stringify(tools).length + (client.getInstructions()?.length ?? 0)).toBeLessThan(6_000)
  })
})

describe('h5p_types', () => {
  it('lists the pack\'s content types, marking those with a type file, and how to write good content', async () => {
    const answer = await call('h5p_types')
    const text = textOf(answer)
    expect(answer.isError).toBeFalsy()
    expect(text).toContain('* H5P.QuestionSet: ')
    expect(text).toContain('- H5P.AdvancedBlanks: ')
    expect(text).toContain('# The brief, and good content')
  })

  it('answers a type named loosely with its file, and where the person\'s files are', async () => {
    const text = textOf(await call('h5p_types', { type: 'true false' }))
    expect(text).toContain('(H5P.TrueFalse)')
    expect(text).toContain('"correct"')
    expect(text).toContain(`This server reads files and writes packages only in ${folder}.`)
  })

  it('answers a type with no file with its fields', async () => {
    const answer = await call('h5p_types', { type: 'H5P.AdvancedBlanks' })
    expect(answer.isError).toBeFalsy()
    expect(textOf(answer)).toContain('H5P.AdvancedBlanks')
  })

  it('refuses a type the pack has not', async () => {
    const answer = await call('h5p_types', { type: 'no such type' })
    expect(answer.isError).toBe(true)
    expect(textOf(answer)).toContain('h5p_types with no type lists them')
  })
})

describe('h5p_build', () => {
  it('writes the package and its source in its folder, checks it, and says what it holds', async () => {
    const answer = await call('h5p_build', { source: SOURCE })
    const text = textOf(answer)
    expect(answer.isError).toBeFalsy()
    expect(text).toContain(`Built ${join(folder, 'boiling-point.h5p')}`)
    expect(text).toContain('Water boils at 100 °C at sea level.')
    expect(text).toMatch(/^pass {2}boiling-point\.h5p/m)
    expect(text).not.toMatch(/screenshot:/)
    expect(answer.content.some((part) => part.type === 'image' && part.mimeType === 'image/png')).toBe(true)
    expect(JSON.parse(await readFile(join(folder, 'boiling-point.source.json'), 'utf8'))).toEqual(SOURCE)
  })

  it('takes the next number rather than write over a file', async () => {
    expect(await build('Again')).toBe(join(folder, 'again.h5p'))
    expect(await build('Again')).toBe(join(folder, 'again-2.h5p'))
    await writeFile(join(folder, 'mine.h5p'), 'the person\'s own file')
    expect(await build('Boiling point', { output: 'mine.h5p' })).toBe(join(folder, 'mine-2.h5p'))
    expect(await readFile(join(folder, 'mine.h5p'), 'utf8')).toBe('the person\'s own file')
  })

  // A link to a file takes privileges Windows does not give by default.
  it.skipIf(process.platform === 'win32')('takes the next number rather than write through a link', async () => {
    // A link holds its name, even one that leads nowhere: written through, it would make a file
    // outside the folder.
    const outside = join(elsewhere, 'source.json')
    await symlink(outside, join(folder, 'linked.source.json'))
    expect(await build('Linked')).toBe(join(folder, 'linked-2.h5p'))
    await expect(access(outside)).rejects.toThrow()
  })

  it('gives builds made at once names of their own', async () => {
    const both = await Promise.all([build('Twice'), build('Twice')])
    expect(both.sort()).toEqual([join(folder, 'twice-2.h5p'), join(folder, 'twice.h5p')])
  })

  it('refuses a source with problems, each by its path, and writes nothing', async () => {
    const before = await readdir(folder)
    const answer = await call('h5p_build', { source: { ...SOURCE, title: 'Broken', params: { ...SOURCE.params, correct: 'maybe' } }, verify: false })
    expect(answer.isError).toBe(true)
    expect(textOf(answer)).toMatch(/params\.correct/)
    // A source unlike the shape the app is shown reaches the build, which says all it finds at once (#230).
    const loose = textOf(await call('h5p_build', { source: { ...SOURCE, title: 'Loose', authors: ['Unknown'], params: { ...SOURCE.params, correct: 'maybe' } }, verify: false }))
    expect(loose).toContain('authors[0]: expected an author: write { "name": "Unknown", "role": "Author" }')
    expect(loose).toMatch(/params\.correct/)
    expect(await readdir(folder)).toEqual(before)
  })

  it('writes nowhere but its folders', async () => {
    const answer = await call('h5p_build', { source: SOURCE, output: join(elsewhere, 'boiling-point.h5p'), verify: false })
    expect(answer.isError).toBe(true)
    // A model cannot know the folders, so the refusal names them and the way out.
    expect(textOf(answer)).toContain(`outside the folders this server may write in: ${folder}. Give a file name alone, or leave output out.`)
  })
})

describe('h5p_read', () => {
  /** A picture of one pixel, which a build reads the size of. */
  const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

  it('reads a package back into its source in a new folder beside it, its files named where they were written, to build again', async () => {
    await writeFile(join(folder, 'pixel.png'), PIXEL)
    const picture = { library: 'H5P.Image', params: { file: { path: 'pixel.png' }, alt: 'A pixel' } }
    const source = { ...SOURCE, type: 'H5P.Column', title: 'One pixel', params: { content: [{ content: picture }] } }
    const built = builtOf(await call('h5p_build', { source, verify: false }))
    expect(built).toBe(join(folder, 'one-pixel.h5p'))
    const answer = await call('h5p_read', { package: 'one-pixel.h5p' })
    const text = textOf(answer)
    expect(answer.isError).toBeFalsy()
    const beside = join(folder, 'one-pixel')
    expect(text).toContain(`Read ${built}: H5P.Column. Its source is in ${join(beside, 'one-pixel.source.json')}, with its 1 media file beside it.`)
    const read = JSON.parse(text.split('\n').at(-1)!)
    expect(read).toMatchObject({ type: 'H5P.Column', title: 'One pixel', params: { content: [{ content: { library: 'H5P.Image', params: { alt: 'A pixel' } } }] } })
    // Where it was written, read by a build wherever its package goes.
    const path = read.params.content[0].content.params.file.path
    expect(path.startsWith(`${beside}/`)).toBe(true)
    await access(path)
    const again = builtOf(await call('h5p_build', { source: { ...read, title: 'One pixel, again' }, verify: false }))
    expect(again).toBe(join(folder, 'one-pixel-again.h5p'))
    // Read again, it takes a folder of its own: nothing is written over.
    expect(textOf(await call('h5p_read', { package: 'one-pixel.h5p' }))).toContain(`Its source is in ${join(folder, 'one-pixel-2', 'one-pixel.source.json')}`)
  })

  it('refuses a package outside its folders, and says why one is refused', async () => {
    await writeFile(join(elsewhere, 'outside.h5p'), 'not a package')
    const outside = await call('h5p_read', { package: join(elsewhere, 'outside.h5p') })
    expect(outside.isError).toBe(true)
    expect(textOf(outside)).toContain('is not in a folder this server may use.')
    await writeFile(join(folder, 'broken.h5p'), 'not a package')
    const broken = await call('h5p_read', { package: 'broken.h5p' })
    expect(broken.isError).toBe(true)
    expect(textOf(broken)).toContain('is not a zip, as a .h5p is')
  })
})

describe('h5p_preview', () => {
  it('serves a package in its folders, and answers with the address', async () => {
    const file = await build('Preview')
    expect(file).toBeTruthy()
    const answer = await call('h5p_preview', { package: basename(file!) })
    expect(answer.isError).toBeFalsy()
    const address = /http:\/\/127\.0\.0\.1:\d+\//.exec(textOf(answer))?.[0]
    expect(address).toBeTruthy()
    expect((await fetch(address!)).status).toBe(200)
  })

  it('refuses a file outside its folders', async () => {
    const answer = await call('h5p_preview', { package: join(elsewhere, 'boiling-point.h5p') })
    expect(answer.isError).toBe(true)
    expect(textOf(answer)).toContain('not in a folder this server may use')
  })
})
