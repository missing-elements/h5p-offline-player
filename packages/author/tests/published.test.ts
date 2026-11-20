import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { dependenciesServed, served } from '../../../scripts/published.mjs'

/*
 * The check, before a package is published, that npm serves what it depends on (#253): in CI it
 * waits for a version published moments before in the same run, which npm processes first.
 */

let dir: string
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'h5p-published-'))
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterAll(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await rm(dir, { recursive: true, force: true })
})

/** A fetch that answers with the statuses given, in turn, and with the last one after them. */
function answers(...statuses: Array<number | Error>) {
  const asked: string[] = []
  const fetch = async (url: string) => {
    asked.push(url)
    const next = statuses.length > 1 ? statuses.shift()! : statuses[0]
    if (next instanceof Error) throw next
    return { ok: next >= 200 && next < 300, status: next, json: async () => ({}) }
  }
  return { fetch, asked }
}

const version = async (folder: string) => JSON.parse(await readFile(resolve(import.meta.dirname, '../..', folder, 'package.json'), 'utf8')).version as string

describe('waiting for npm to serve a version', () => {
  it('asks again after a 404, a server error or a failed request, until it is served', async () => {
    const { fetch, asked } = answers(404, 503, new TypeError('fetch failed'), 200)
    const response = await served('https://registry.npmjs.org/x/1.0.0', 'x@1.0.0', { minutes: 1, poll: 1, fetch })
    expect(response.ok).toBe(true)
    expect(asked).toHaveLength(4)
  })

  it('asks once with no wait, as by hand and in a dry run, and takes any other refusal as the answer', async () => {
    const once = answers(404, 200)
    expect((await served('u', 'x', { minutes: 0, poll: 1, fetch: once.fetch })).status).toBe(404)
    expect(once.asked).toHaveLength(1)
    const refused = answers(403, 200)
    expect((await served('u', 'x', { minutes: 1, poll: 1, fetch: refused.fetch })).status).toBe(403)
    expect(refused.asked).toHaveLength(1)
  })

  it('cuts a request that gets no answer, and asks again within the wait', async () => {
    let calls = 0
    const stalling = (_url: string, init: { signal: AbortSignal }) => {
      calls++
      if (calls > 1) return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
      return new Promise<never>((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)))
    }
    expect((await served('u', 'x', { minutes: 0, poll: 1, timeout: 10, fetch: stalling })).status).toBe('no answer in time')
    calls = 0
    expect((await served('u', 'x', { minutes: 1, poll: 1, timeout: 10, fetch: stalling })).ok).toBe(true)
    expect(calls).toBe(2)
  })

  it('waits as long as H5P_PUBLISH_WAIT says, and no longer', async () => {
    vi.stubEnv('H5P_PUBLISH_WAIT', '1')
    const late = answers(404, 404, 200)
    expect((await served('u', 'x', { poll: 1, fetch: late.fetch })).ok).toBe(true)
    // The last answer once the wait has run out: the poll is longer than the minute left.
    const never = answers(404)
    expect((await served('u', 'x', { poll: 61_000, fetch: never.fetch })).status).toBe(404)
    expect(never.asked).toHaveLength(1)
    vi.unstubAllEnvs()
  })
})

describe('the dependencies a package names by workspace:', () => {
  it('are each asked for at the version the workspace has, and only those', async () => {
    const packages = join(dir, 'packages')
    const write = async (folder: string, manifest: object) => {
      await mkdir(join(packages, folder), { recursive: true })
      await writeFile(join(packages, folder, 'package.json'), JSON.stringify(manifest))
    }
    await write('a', {
      name: '@scope/a',
      version: '1.0.0',
      dependencies: { '@scope/b': 'workspace:^', zod: '^4.0.0' },
      peerDependencies: { '@scope/c': 'workspace:*' },
      devDependencies: { '@scope/d': 'workspace:*' }
    })
    await write('b', { name: '@scope/b', version: '2.3.4' })
    await write('c', { name: '@scope/c', version: '0.5.0' })
    await write('d', { name: '@scope/d', version: '9.9.9' })
    const { fetch, asked } = answers(200, 404)
    expect(await dependenciesServed(join(packages, 'a'), { minutes: 0, fetch })).toEqual([
      { name: '@scope/c', version: '0.5.0', status: 200, ok: true },
      { name: '@scope/b', version: '2.3.4', status: 404, ok: false }
    ])
    expect(asked).toEqual(['https://registry.npmjs.org/@scope%2fc/0.5.0', 'https://registry.npmjs.org/@scope%2fb/2.3.4'])
  })

  it('for the MCP server, are the author and the verifier at their versions here', async () => {
    const { fetch, asked } = answers(200)
    await dependenciesServed(resolve(import.meta.dirname, '../../mcp'), { minutes: 0, fetch })
    expect(asked).toEqual([
      `https://registry.npmjs.org/@missing-elements%2fh5p-author/${await version('author')}`,
      `https://registry.npmjs.org/@missing-elements%2fh5p-verify/${await version('verify')}`
    ])
  })
})
