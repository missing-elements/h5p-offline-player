import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildPackage, outlineOf, publicFetch, SourceError } from '../lib/author.mjs'
import { inside, isPrivateAddress } from '../lib/node.mjs'
import { png } from './helpers/media'

const exec = promisify(execFile)
const bin = resolve(import.meta.dirname, '../bin/h5p-author.mjs')
const META = { title: 'Rivers', language: 'en', license: 'CC BY', authors: [{ name: 'Ann Author', role: 'Author' }] }
const withImage = (path: string) => ({ ...META, type: 'H5P.Column', params: { content: [{ content: { library: 'H5P.Image', params: { file: { path }, alt: 'A river' } } }] } })
const question = { ...META, type: 'H5P.MultiChoice', params: { question: 'Capital of France?', answers: [{ text: 'Paris', correct: true }, { text: 'Lyon', correct: false }] } }
let dir: string
let allowed: string
let outside: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'h5p-author-confine-'))
  allowed = join(dir, 'allowed')
  outside = join(dir, 'outside')
  await mkdir(allowed)
  await mkdir(outside)
  await writeFile(join(allowed, 'in.png'), png(8, 8))
  await writeFile(join(outside, 'out.png'), png(8, 8))
  await symlink(join(outside, 'out.png'), join(allowed, 'link.png'))
})
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('within', () => {
  it('builds with a file and an output inside the folders', async () => {
    const result = await buildPackage(withImage('in.png'), join(allowed, 'a.h5p'), { base: allowed, within: [allowed] })
    expect(result.media).toHaveLength(1)
  })

  it('refuses a file outside them, by .. and by a link, and an output outside', async () => {
    await expect(buildPackage(withImage('../outside/out.png'), join(allowed, 'b.h5p'), { base: allowed, within: [allowed] })).rejects.toThrow(SourceError)
    await expect(buildPackage(withImage('link.png'), join(allowed, 'c.h5p'), { base: allowed, within: [allowed] })).rejects.toThrow(/outside the folders/)
    await expect(buildPackage(question, join(outside, 'd.h5p'), { within: [allowed] })).rejects.toThrow(/outside the folders this build may write in/)
    expect(await readdir(outside)).toEqual(['out.png'])
  })

  it('judges a path that does not exist yet by its nearest folder, and a folder is not its sibling of the same prefix', async () => {
    expect(await inside(join(allowed, 'new', 'x.h5p'), [allowed])).toBe(true)
    expect(await inside(`${allowed}-other/x.h5p`, [allowed])).toBe(false)
  })
})

describe('check', () => {
  it('writes nothing, and reports the problems of a wrong source as a build does', async () => {
    const result = await buildPackage(question, join(allowed, 'never.h5p'), { check: true })
    expect(result.output).toBe('')
    expect(result.manifest.mainLibrary).toBe('H5P.MultiChoice')
    expect(await readdir(allowed)).not.toContain('never.h5p')
    await expect(buildPackage({ ...question, title: undefined }, join(allowed, 'never.h5p'), { check: true })).rejects.toThrow(SourceError)
  })

  it('is build --check on the command line, with one argument and no file written', async () => {
    const source = join(allowed, 'q.json')
    await writeFile(source, JSON.stringify(question))
    const { stdout } = await exec('node', [bin, 'build', '--check', source])
    expect(stdout).toMatch(/Checked, nothing written: H5P.MultiChoice/)
    expect(await readdir(allowed)).not.toContain('check.h5p')
    await expect(exec('node', [bin, 'build', '--check', source, 'x.h5p'])).rejects.toThrow(/build --check takes a source/)
  })
})

describe('publicFetch', () => {
  let server: Server
  let port: number
  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === '/hop') response.writeHead(302, { location: 'http://169.254.169.254/latest' }).end()
      else response.writeHead(200).end('ok')
    })
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    port = (server.address() as AddressInfo).port
  })
  afterAll(() => { server.close() })

  it('refuses a local address, however it is written, and a scheme that is not http(s)', async () => {
    await expect(publicFetch(`http://127.0.0.1:${port}/`)).rejects.toThrow(/local network/)
    await expect(publicFetch(`http://localhost:${port}/`)).rejects.toThrow(/local network/)
    await expect(publicFetch(`http://[::1]:${port}/`)).rejects.toThrow(/local network/)
    await expect(publicFetch('file:///etc/passwd')).rejects.toThrow(/not fetched/)
  })

  it('knows the private ranges', () => {
    for (const address of ['10.0.0.1', '172.16.5.5', '172.31.0.1', '192.168.1.1', '169.254.169.254', '127.0.0.1', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) expect(isPrivateAddress(address), address).toBe(true)
    for (const address of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700::1111', '::ffff:8.8.8.8']) expect(isPrivateAddress(address), address).toBe(false)
  })
})

describe('outlineOf', () => {
  it('writes the words a learner reads, marks the right answer and leaves interface texts out', async () => {
    const { content } = await buildPackage(question, join(allowed, 'o.h5p'), { check: true })
    expect(outlineOf(content)).toBe('Capital of France?\n  ✓ Paris\n  Lyon')
  })

  it('strips markup, and counts what the limit cuts off', () => {
    const content = { questions: ['<p>One &amp; two</p>', '<p>Three</p>', 'Four'] }
    expect(outlineOf(content)).toBe('  One & two\n  Three\n  Four')
    expect(outlineOf(content, { limit: 1 })).toBe('  One & two\n… 2 more lines')
  })
})
