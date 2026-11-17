import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildPackage, loadLibraries, openPack, outlineOf, publicFetch, SourceError } from '../lib/author.mjs'
import { guardedFetch, inside, isPrivateAddress } from '../lib/node.mjs'
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
  await writeFile(join(allowed, '..notes.png'), png(8, 8))
  await writeFile(join(outside, 'out.png'), png(8, 8))
  await symlink(join(outside, 'out.png'), join(allowed, 'link.png'))
})
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

/** A source's outline, from a build that writes nothing. */
async function outline(source: Record<string, unknown>) {
  return (await buildPackage({ ...META, ...source }, join(allowed, 'never.h5p'), { check: true })).outline
}

describe('within', () => {
  it('builds with a file and an output inside the folders, a name that starts with two dots among them', async () => {
    expect((await buildPackage(withImage('in.png'), join(allowed, 'a.h5p'), { base: allowed, within: [allowed] })).media).toHaveLength(1)
    expect((await buildPackage(withImage('..notes.png'), join(allowed, 'a2.h5p'), { base: allowed, within: [allowed] })).media).toHaveLength(1)
  })

  it('refuses a file outside them, by .. and by a link, and an output outside', async () => {
    await expect(buildPackage(withImage('../outside/out.png'), join(allowed, 'b.h5p'), { base: allowed, within: [allowed] })).rejects.toThrow(SourceError)
    await expect(buildPackage(withImage('link.png'), join(allowed, 'c.h5p'), { base: allowed, within: [allowed] })).rejects.toThrow(/outside the folders/)
    await expect(buildPackage(question, join(outside, 'd.h5p'), { within: [allowed] })).rejects.toThrow(/outside the folders this build may write in/)
    expect(await readdir(outside)).toEqual(['out.png'])
  })

  it('judges a path that does not exist yet by its nearest folder, and a folder is not its sibling of the same prefix', async () => {
    expect(await inside(join(allowed, 'new', 'x.h5p'), [allowed])).toBe(true)
    expect(await inside(join(allowed, '..notes.png'), [allowed])).toBe(true)
    expect(await inside(join(allowed, '..', 'outside', 'out.png'), [allowed])).toBe(false)
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
  let requests = 0
  beforeAll(async () => {
    server = createServer((request, response) => {
      requests += 1
      response.writeHead(200).end('local')
    })
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    port = (server.address() as AddressInfo).port
  })
  afterAll(() => { server.close() })

  it('refuses a local address however it is written, a URL writing ::ffff:127.0.0.1 as ::ffff:7f00:1, and asks nothing of it', async () => {
    for (const host of ['127.0.0.1', 'localhost', '[::1]', '[::ffff:127.0.0.1]', '[::ffff:7f00:1]', '[::127.0.0.1]', '2130706433', '0x7f.1']) {
      await expect(publicFetch(`http://${host}:${port}/`), host).rejects.toThrow(/local network/)
    }
    await expect(publicFetch('file:///etc/passwd')).rejects.toThrow(/not fetched/)
    await expect(publicFetch('https://example.com/', { method: 'POST' })).rejects.toThrow(/GET or HEAD/)
    expect(requests).toBe(0)
  })

  it('knows the local ranges, in IPv4 and IPv6, and an IPv4 address written as IPv6', () => {
    for (const address of ['10.0.0.1', '172.16.5.5', '172.31.0.1', '192.168.1.1', '169.254.169.254', '127.0.0.1', '100.64.0.1', '0.0.0.0', '192.0.0.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
      '::', '::1', '0:0:0:0:0:0:0:1', '::7f00:1', 'fd00::1', 'fe80::1', 'fec0::1', 'ff02::1', '::ffff:10.0.0.1', '::ffff:a00:1', '::ffff:7f00:1', 'not an address']) {
      expect(isPrivateAddress(address), address).toBe(true)
    }
    for (const address of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700::1111', '::ffff:808:808', '::ffff:8.8.8.8', '64:ff9b::808:808']) expect(isPrivateAddress(address), address).toBe(false)
  })

  /** A web of hosts: `public.test` and `cdn.test` resolve to public addresses, `inside.test` to a local one. */
  const web = (answer: (url: URL) => Response) => {
    const asked: string[] = []
    const fetch = guardedFetch({
      lookup: async (host) => [{ address: host === 'inside.test' ? '10.1.2.3' : '93.184.216.34' }],
      fetch: async (input) => {
        const url = new URL(String(input))
        asked.push(url.href)
        return answer(url)
      }
    })
    return { fetch, asked }
  }
  const redirect = (location: string) => new Response(null, { status: 302, headers: { location } })

  it('refuses a redirect to a local address, by name and by number, without asking it', async () => {
    for (const location of ['http://inside.test/secret', 'http://[::ffff:127.0.0.1]/secret', 'http://169.254.169.254/latest']) {
      const { fetch, asked } = web((url) => (url.pathname === '/hop' ? redirect(location) : new Response('reached')))
      await expect(fetch('https://public.test/hop'), location).rejects.toThrow(/local network/)
      expect(asked).toEqual(['https://public.test/hop'])
    }
  })

  it('follows a redirect between public hosts, keeps the request\'s headers, and names the address it ended at', async () => {
    let header: string | null = null
    const { fetch, asked } = web((url) => (url.hostname === 'public.test' ? redirect('https://cdn.test/clip.mp4') : new Response('video')))
    const answered = await fetch(new Request('https://public.test/clip', { headers: { 'x-test': 'kept' } }))
    expect(await answered.text()).toBe('video')
    expect(answered.url).toBe('https://cdn.test/clip.mp4')
    expect(asked).toEqual(['https://public.test/clip', 'https://cdn.test/clip.mp4'])
    const seen = guardedFetch({ lookup: async () => [{ address: '93.184.216.34' }], fetch: async (_, init) => { header = new Headers(init?.headers).get('x-test'); return new Response('') } })
    await seen(new Request('https://public.test/', { headers: { 'x-test': 'kept' } }))
    expect(header).toBe('kept')
  })

  it('answers a redirect as asked: manual returns it, error refuses it, and more than ten are refused', async () => {
    const { fetch } = web(() => redirect('https://cdn.test/next'))
    expect((await fetch('https://public.test/', { redirect: 'manual' })).status).toBe(302)
    await expect(fetch('https://public.test/', { redirect: 'error' })).rejects.toThrow(/redirects were refused/)
    await expect(fetch('https://public.test/')).rejects.toThrow(/more than 10 redirects/)
  })
})

describe('outline', () => {
  it('writes the question, its answers with the right one marked, numbers included, and the feedback by its label', async () => {
    expect(await outline({
      type: 'H5P.MultiChoice',
      params: { question: 'When did Apollo 11 land?', answers: [{ text: '1969', correct: true, tipsAndFeedback: { chosenFeedback: 'Yes, in July.' } }, { text: '1972', correct: false }] }
    })).toBe('When did Apollo 11 land?\n  ✓ 1969\n  Message displayed if answer is selected: Yes, in July.\n  1972')
  })

  it('names the right answer where a select holds it, or where a type takes the first item as the right one', async () => {
    expect(await outline({ type: 'H5P.TrueFalse', params: { question: 'The Rhine flows into the North Sea.', correct: 'true' } }))
      .toBe('The Rhine flows into the North Sea.\nCorrect answer: True')
    expect(await outline({ type: 'H5P.SingleChoiceSet', params: { choices: [{ question: 'Which sea does the Danube reach?', answers: ['Black Sea', 'North Sea'] }] } }))
      .toBe('  Which sea does the Danube reach?\n    ✓ Black Sea\n    North Sea')
    expect(await outline({ type: 'H5P.Summary', params: { summaries: [{ summary: ['Rivers flow downhill.', 'Rivers flow uphill.'] }] } }))
      .toBe('    ✓ Rivers flow downhill.\n    Rivers flow uphill.')
  })

  it('leaves out interface texts and settings, in any language, and writes sub-content with its title and the score ranges', async () => {
    const quiz = {
      type: 'H5P.QuestionSet',
      params: {
        questions: [{ library: 'H5P.TrueFalse', params: { question: 'Water is wet.', correct: 'true' }, metadata: { title: 'Water' } }],
        endGame: { overallFeedback: [{ from: 0, to: 49, feedback: 'Try again.' }, { from: 50, to: 100, feedback: 'Passed.' }] }
      }
    }
    const expected = '  Title: Water\n  Water is wet.\n  Correct answer: True\n  0–49%: Try again.\n  50–100%: Passed.'
    expect(await outline(quiz)).toBe(expected)
    expect(await outline({ ...quiz, language: 'de' })).toBe(expected)
  })

  it('is outlineOf over a content and the libraries loaded for it, and counts what a limit cuts off', async () => {
    const { content, outline: built } = await buildPackage(question, join(allowed, 'never.h5p'), { check: true })
    const pack = await openPack()
    try {
      const libraries = await loadLibraries(pack, { type: 'H5P.MultiChoice', language: 'en', params: question.params })
      expect(outlineOf(content, libraries)).toBe(built)
      expect(outlineOf(content, libraries, { limit: 1 })).toBe('Capital of France?\n… 2 more lines')
    } finally {
      await pack.close()
    }
  })
})
