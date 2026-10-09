import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EmbedError, buildSite, contentSecurityPolicy, parseOrigin, parseOrigins } from '../lib/build.mjs'

/** What the command writes, and what it refuses, without a browser. */

const bin = resolve(import.meta.dirname, '../bin/h5p-embed.mjs')
let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'h5p-embed-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('origins', () => {
  it('takes an https origin, or http on a loopback address', () => {
    expect(parseOrigin('https://cdn.example.org')).toBe('https://cdn.example.org')
    expect(parseOrigin('https://cdn.example.org:8443')).toBe('https://cdn.example.org:8443')
    expect(parseOrigin('http://localhost:5173')).toBe('http://localhost:5173')
    expect(parseOrigin('http://127.0.0.1:4000')).toBe('http://127.0.0.1:4000')
  })

  it('refuses rather than trims what is not exactly an origin', () => {
    expect(() => parseOrigin('https://cdn.example.org/')).toThrow(EmbedError)
    expect(() => parseOrigin('https://cdn.example.org/packages')).toThrow(/no path or trailing slash/)
    expect(() => parseOrigin('http://cdn.example.org')).toThrow(/Not an https origin/)
    expect(() => parseOrigin('cdn.example.org')).toThrow(EmbedError)
  })

  it('reads a list given once, separated, or several times', () => {
    expect(parseOrigins(null)).toBeNull()
    expect(parseOrigins(['https://a.example,https://b.example', 'https://c.example https://a.example'])).toEqual([
      'https://a.example',
      'https://b.example',
      'https://c.example'
    ])
  })
})

describe('the policy', () => {
  it('lets packages come from any https host unless told otherwise', () => {
    expect(contentSecurityPolicy()).toContain("connect-src 'self' https:;")
    expect(contentSecurityPolicy({ packages: ['https://cdn.example.org'] })).toContain("connect-src 'self' https://cdn.example.org;")
  })

  it('puts frame-ancestors in the header and never in the page, where it would be ignored', () => {
    const ancestors = ['https://school.example']
    expect(contentSecurityPolicy({ ancestors })).toMatch(/; frame-ancestors https:\/\/school\.example$/)
    expect(contentSecurityPolicy({ ancestors, meta: true })).not.toContain('frame-ancestors')
  })
})

describe('the site', () => {
  it('writes everything the page needs, beside each other, with the policy in all three places', async () => {
    const out = join(dir, 'locked')
    const site = await buildSite({ out, packages: 'https://cdn.example.org', ancestors: ['https://school.example'] })

    for (const name of ['index.html', 'main.js', 'embed.js', 'embed.css', 'resizer.js', 'config.js', 'h5p-player.js', 'h5p-sw.js', 'h5p-jobs.js', 'libraries.h5p', 'libraries.txt', 'NOTICE.txt', '_headers', 'vercel.json']) {
      expect(existsSync(join(out, name)), name).toBe(true)
    }
    for (const name of ['frame-boot.js', 'frame.bundle.js', 'main.bundle.js', 'h5p.css', 'LICENSE.txt', 'NOTICE.txt']) {
      expect(existsSync(join(out, 'frame-assets', name)), name).toBe(true)
    }

    const html = await readFile(join(out, 'index.html'), 'utf8')
    expect(html).toContain(`content="${contentSecurityPolicy({ packages: ['https://cdn.example.org'], meta: true })}"`)
    expect(html).not.toContain('%CSP%')
    expect(await readFile(join(out, '_headers'), 'utf8')).toContain(`Content-Security-Policy: ${site.csp}`)
    const vercel = JSON.parse(await readFile(join(out, 'vercel.json'), 'utf8'))
    expect(vercel.headers[0]).toEqual({ source: '/(.*)', headers: expect.arrayContaining([{ key: 'Content-Security-Policy', value: site.csp }]) })
    expect(vercel.headers).toContainEqual({ source: '/h5p-sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] })
    expect(await readFile(join(out, 'config.js'), 'utf8')).toContain('{"libraries":true,"packages":["https://cdn.example.org"]}')
  })

  it('leaves the library pack out when asked, and says so to the page', async () => {
    const out = join(dir, 'lean')
    await buildSite({ out, libraries: false })
    expect(existsSync(join(out, 'libraries.h5p'))).toBe(false)
    expect(await readFile(join(out, 'config.js'), 'utf8')).toContain('{"libraries":false,"packages":null}')
    expect(await readFile(join(out, 'NOTICE.txt'), 'utf8')).not.toContain('libraries.h5p')
  })

  it('says so, rather than crashing, when the folder is a file', async () => {
    const file = join(dir, 'a-file.txt')
    await writeFile(file, 'not a folder')
    await expect(buildSite({ out: file })).rejects.toThrow(EmbedError)
    await expect(buildSite({ out: file, force: true })).rejects.toThrow(/is a file, not a folder/)
  })

  it('refuses a folder with files in it, and with --force replaces only its own', async () => {
    const out = join(dir, 'occupied')
    await mkdir(out, { recursive: true })
    await writeFile(join(out, 'keep.txt'), 'mine')
    await expect(buildSite({ out })).rejects.toThrow(/not empty/)
    await buildSite({ out, force: true })
    expect(await readFile(join(out, 'keep.txt'), 'utf8')).toBe('mine')
    expect(existsSync(join(out, 'index.html'))).toBe(true)
  })
})

describe('the command', () => {
  const run = promisify(execFile)

  it('writes the site and says where it may be framed from', async () => {
    const out = join(dir, 'cli')
    const { stdout } = await run(process.execPath, [bin, out, '--ancestors', 'https://school.example'])
    expect(stdout).toContain('the embed page, the player')
    expect(stdout).toContain('Framed by: https://school.example.')
    expect(existsSync(join(out, 'index.html'))).toBe(true)
  })

  it('exits 1 with the reason on a bad origin', async () => {
    const failure = await run(process.execPath, [bin, join(dir, 'bad'), '--packages', 'https://cdn.example.org/']).catch((error) => error)
    expect(failure.code).toBe(1)
    expect(failure.stderr).toContain('h5p-embed: Not an origin: https://cdn.example.org/')
  })
})
