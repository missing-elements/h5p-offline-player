import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PORTS, languageTag, packageId, startServer } from '../src/server.mjs'

const require = createRequire(import.meta.url)
const roots = {
  dist: dirname(require.resolve('@missing-elements/h5p-offline-player')),
  runtime: join(dirname(require.resolve('@missing-elements/h5p-runtime/package.json')), 'dist')
}
const packDir = dirname(require.resolve('@missing-elements/h5p-libraries/parts/index.json'))
const quiz = fileURLToPath(new URL('../../../apps/demo/demo/content/quiz.h5p', import.meta.url))

/** The settings the page was written with, read back out of it. */
function settingsOf(page: string) {
  const json = /<script type="application\/json" id="settings">(.*?)<\/script>/s.exec(page)?.[1]
  if (!json) throw new Error('no settings in the page')
  return JSON.parse(json)
}

describe('the preview server', () => {
  let server: Awaited<ReturnType<typeof startServer>>
  let folder: string

  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), 'h5p-preview-test-'))
    // Port 0: a test must not take 4646 from a VS Code running beside it.
    server = await startServer({ roots, packDir, port: 0 })
  })

  afterAll(async () => {
    server.close()
    await rm(folder, { recursive: true, force: true })
  })

  it('writes a page that plays the package as the preview says, with VS Code’s language', async () => {
    const id = server.add(quiz, 'quiz.h5p', 'file:///courses/quiz.h5p')
    const response = await fetch(`${server.url}/view/${id}?untrusted=1&newest=0&lang=de`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(settingsOf(await response.text())).toEqual({
      name: 'quiz.h5p',
      src: `/__package/${id}/quiz.h5p`,
      packBase: '/__pack/',
      untrusted: true,
      newest: false,
      lang: 'de'
    })
    // Trusted and with the newest libraries unless the address says otherwise.
    const plain = settingsOf(await (await fetch(`${server.url}/view/${id}`)).text())
    expect([plain.untrusted, plain.newest, plain.lang]).toEqual([false, true, null])
    server.remove(id)
  })

  it('writes a file name into the page as data, which no name can end', async () => {
    const name = '</script><script>alert(1)</script>.h5p'
    const file = join(folder, 'quiz.h5p')
    await copyFile(quiz, file)
    const id = server.add(file, name, 'file:///odd')
    const page = await (await fetch(`${server.url}/view/${id}`)).text()
    expect(page).not.toContain('</script><script>alert(1)')
    expect(settingsOf(page).name).toBe(name)
    server.remove(id)
  })

  it('takes a language tag and nothing else as one', async () => {
    const id = server.add(quiz, 'quiz.h5p', 'file:///courses/quiz.h5p')
    const page = await (await fetch(`${server.url}/view/${id}?lang=${encodeURIComponent('"><script>')}`)).text()
    expect(settingsOf(page).lang).toBeNull()
    server.remove(id)
    expect(['en', 'de-AT', 'zh-cn', 'pt-BR'].map(languageTag)).toEqual(['en', 'de-AT', 'zh-cn', 'pt-BR'])
    expect(['', 'e', 'english!', 'de_AT', null, undefined].map(languageTag)).toEqual([null, null, null, null, null, null])
  })

  it('serves the package by range, under its own name and id only', async () => {
    const id = server.add(quiz, 'quiz.h5p', 'file:///courses/quiz.h5p')
    const head = await fetch(`${server.url}/__package/${id}/quiz.h5p`, { headers: { Range: 'bytes=0-3' } })
    expect(head.status).toBe(206)
    expect(new Uint8Array(await head.arrayBuffer())).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))
    const whole = await fetch(`${server.url}/__package/${id}/quiz.h5p`)
    expect(Buffer.from(await whole.arrayBuffer()).equals(await readFile(quiz))).toBe(true)
    for (const path of [`/__package/${id}/other.h5p`, '/__package/0123456789abcdef/quiz.h5p', '/__package/not-an-id/quiz.h5p', '/view/0123456789abcdef', '/view/not-an-id']) {
      expect((await fetch(server.url + path)).status, path).toBe(404)
    }
    server.remove(id)
  })

  it('serves a package until its last preview has closed', async () => {
    const id = server.add(quiz, 'quiz.h5p', 'file:///courses/twice.h5p')
    expect(server.add(quiz, 'quiz.h5p', 'file:///courses/twice.h5p')).toBe(id)
    server.remove(id)
    expect((await fetch(`${server.url}/view/${id}`)).status).toBe(200)
    server.remove(id)
    expect((await fetch(`${server.url}/view/${id}`)).status).toBe(404)
    expect((await fetch(`${server.url}/__package/${id}/quiz.h5p`)).status).toBe(404)
  })

  it('plays every page untrusted in Restricted Mode, whatever its address says', async () => {
    let restricted = true
    const guarded = await startServer({ roots, packDir, port: 0, restricted: () => restricted })
    try {
      const id = guarded.add(quiz, 'quiz.h5p', 'file:///courses/quiz.h5p')
      const untrusted = async (query: string) => settingsOf(await (await fetch(`${guarded.url}/view/${id}${query}`)).text()).untrusted
      // A link in a package's content to its own page, without the flag, plays it untrusted too.
      expect([await untrusted(''), await untrusted('?untrusted=0'), await untrusted('?untrusted=1')]).toEqual([true, true, true])
      // Asked at each page: with the workspace trusted, the address says again.
      restricted = false
      expect([await untrusted(''), await untrusted('?untrusted=1')]).toEqual([false, true])
    } finally {
      guarded.close()
    }
  })

  it('serves the player, the runtime and the pack, and nothing beside them', async () => {
    const element = await fetch(`${server.url}/h5p-player.js`)
    expect([element.status, element.headers.get('content-type')]).toEqual([200, 'text/javascript; charset=utf-8'])
    expect((await fetch(`${server.url}/h5p-sw.js`)).status).toBe(200)
    expect((await fetch(`${server.url}/frame-assets/frame-boot.js`)).status).toBe(200)
    const index = await fetch(`${server.url}/__pack/index.json`)
    expect([index.status, index.headers.get('content-type')]).toEqual([200, 'application/json'])
    expect((await fetch(`${server.url}/package.json`)).status).toBe(404)
  })

  it('takes the first free port of its run, and any free one after it', async () => {
    // A run of ten, so that a second window has an address of its own from one session to the next.
    expect(PORTS).toEqual([4646, 4647, 4648, 4649, 4650, 4651, 4652, 4653, 4654, 4655])
    /** A server on a free port, standing in for another window's. */
    const holder = async () => {
      const server = createServer()
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      return { server, port: (server.address() as AddressInfo).port }
    }
    const stop = (server: Server) => new Promise((resolve) => server.close(resolve))
    const held = await holder()
    const freed = await holder()
    await stop(freed.server)
    const next = await startServer({ roots, packDir, port: [held.port, freed.port] })
    try {
      expect(next.url).toBe(`http://127.0.0.1:${freed.port}`)
    } finally {
      next.close()
    }
    const any = await startServer({ roots, packDir, port: [held.port] })
    try {
      expect(new URL(any.url).port).not.toBe(String(held.port))
    } finally {
      any.close()
      await stop(held.server)
    }
  })

  it('names a package by its URI, the same in every session', () => {
    expect(packageId('file:///courses/quiz.h5p')).toMatch(/^[0-9a-f]{16}$/)
    expect(packageId('file:///courses/quiz.h5p')).toBe(packageId('file:///courses/quiz.h5p'))
    expect(packageId('file:///courses/quiz.h5p')).not.toBe(packageId('file:///courses/other.h5p'))
  })
})
