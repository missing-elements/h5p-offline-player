import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { extname, join, normalize, resolve } from 'node:path'
import { BlobReader, BlobWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from '@zip.js/zip.js'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildSite } from '../lib/build.mjs'

/**
 * A written site deployed the way the README says: on a player origin of its own
 * (`127.0.0.1`), framed by a page on another site (`localhost`), with `resizer.js` from the player
 * origin on that page. Two sites, so the frame gets partitioned storage and a Service Worker of
 * its own, as on a real embed. The static server sends no headers but the type, like GitHub
 * Pages: the policy the page enforces is the `<meta>` one.
 */

const quiz = resolve(import.meta.dirname, '../../../apps/demo/demo/content/quiz.h5p')
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.h5p': 'application/zip'
}

type Host = { origin: string; close: () => Promise<void> }

/** A static host for `root`, CORS open so a package on it can be read from another origin. */
async function host(root: string, hostname: string, extra?: (path: string) => string | null): Promise<Host> {
  const server: Server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname)
    const page = extra?.(path)
    if (page != null) {
      response.writeHead(200, { 'Content-Type': MIME['.html'] }).end(page)
      return
    }
    const file = join(root, normalize(path.endsWith('/') ? `${path}index.html` : path).replace(/^(\.\.[/\\])+/, ''))
    try {
      const body = await readFile(file)
      response.writeHead(200, {
        'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
        'Content-Length': body.length,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      })
      response.end(body)
    } catch {
      response.writeHead(404).end()
    }
  })
  await new Promise<void>((done) => server.listen(0, hostname, done))
  const { port } = server.address() as AddressInfo
  return { origin: `http://${hostname}:${port}`, close: () => new Promise((done) => server.close(() => done())) }
}

let dir: string
let browser: Browser
let embedding: Host
let open: Host
let locked: Host
let lean: Host
let fallback: Host
let previewing: Host

/** The embedding site's page: the snippet the README gives, with a listener for the relay. */
const snippet = (player: string, query: string) => `<!doctype html>
<html><body>
<iframe id="embed" src="${player}/?${query}" allow="fullscreen" style="width: 100%; border: 0"></iframe>
<script src="${player}/resizer.js"></script>
<script>
  window.relayed = []
  addEventListener('message', (event) => {
    if (event.data && event.data.context === 'h5p-offline-player') window.relayed.push({ origin: event.origin, action: event.data.action, data: event.data })
  })
</script>
</body></html>`

/** What the embedding page heard from the frame, in order. */
type Heard = { origin: string; action: string; data: Record<string, unknown> }
const heard = (page: Page) => page.evaluate(() => (window as unknown as { relayed: unknown[] }).relayed) as Promise<Heard[]>
/** The first message with this action, once it has arrived. */
const firstHeard = async (page: Page, action: string) => {
  await page.waitForFunction((a) => (window as unknown as { relayed: Array<{ action: string }> }).relayed.some((m) => m.action === a), action, { timeout: 60_000 })
  return (await heard(page)).find((m) => m.action === action)!
}

/** The quiz as h5p.com exports it: `h5p.json` and `content/`, no library folders. */
async function strippedQuiz(path: string) {
  const reader = new ZipReader(new BlobReader(new Blob([await readFile(quiz)])))
  const writer = new ZipWriter(new BlobWriter('application/zip'))
  for (const entry of await reader.getEntries()) {
    if (entry.directory || !(entry.filename === 'h5p.json' || entry.filename.startsWith('content/'))) continue
    await writer.add(entry.filename, new Uint8ArrayReader(await entry.getData!(new Uint8ArrayWriter())))
  }
  await reader.close()
  await writeFile(path, new Uint8Array(await (await writer.close()).arrayBuffer()))
}

/** A page on the player's own origin that frames it, as a site's own preview would. */
const preview = (query: string) => `<!doctype html><html><body><iframe src="./?${query}" style="width: 100%; border: 0"></iframe></body></html>`

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'h5p-embed-site-'))
  // The embedding site also hosts a package, as a site's own CDN would.
  await cp(quiz, join(dir, 'quiz.h5p'))
  await strippedQuiz(join(dir, 'stripped.h5p'))
  const pages = new Map<string, string>()
  embedding = await host(dir, 'localhost', (path) => pages.get(path) ?? null)

  const leanDir = join(dir, 'lean')
  await buildSite({ out: leanDir, libraries: false, packages: [embedding.origin] })
  const openDir = join(dir, 'open')
  const lockedDir = join(dir, 'locked')
  await buildSite({ out: openDir })
  await cp(quiz, join(openDir, 'quiz.h5p'))
  await buildSite({ out: lockedDir, packages: [embedding.origin] })
  // The pack and nothing else: the hub is off the list, so the default is the local copy alone.
  const fallbackDir = join(dir, 'fallback')
  await buildSite({ out: fallbackDir, packages: [embedding.origin], defaultLibraries: 'pack' })
  // A site whose own preview frames the page, as Embed My's does: no click for the chosen package.
  const previewDir = join(dir, 'preview')
  await buildSite({ out: previewDir })
  await writeFile(join(previewDir, 'main.js'), "import { startEmbed } from './embed.js'\nstartEmbed({ askInOwnFrame: false })\n")
  const previews = (path: string) => (path === '/preview.html' ? preview(`src=${embedding.origin}/quiz.h5p`) : null)

  open = await host(openDir, '127.0.0.1', previews)
  fallback = await host(fallbackDir, '127.0.0.1')
  previewing = await host(previewDir, '127.0.0.1', previews)
  lean = await host(leanDir, '127.0.0.1')
  locked = await host(lockedDir, '127.0.0.1')

  pages.set('/open.html', snippet(open.origin, `src=${open.origin}/quiz.h5p&xapi=${embedding.origin}`))
  pages.set('/locked.html', snippet(locked.origin, `src=${embedding.origin}/quiz.h5p`))
  pages.set('/locked-elsewhere.html', snippet(locked.origin, `src=${open.origin}/quiz.h5p`))
  pages.set('/locked-hub.html', snippet(locked.origin, `src=${embedding.origin}/quiz.h5p&libraries=hub`))
  pages.set('/fallback.html', snippet(fallback.origin, `src=${embedding.origin}/stripped.h5p`))
  pages.set('/fallback-none.html', snippet(fallback.origin, `src=${embedding.origin}/stripped.h5p&libraries=none`))
  pages.set('/lean-pack.html', snippet(lean.origin, `src=${embedding.origin}/quiz.h5p&libraries=pack`))

  browser = await chromium.launch()
})

afterAll(async () => {
  await browser?.close()
  await Promise.all([embedding, open, locked, lean, fallback, previewing].map((h) => h?.close()))
  await rm(dir, { recursive: true, force: true })
})

/** The player frame of the embedding page, once it has navigated. */
const playerFrame = async (page: Page, origin: string) => {
  await page.waitForFunction((o) => document.querySelector('iframe')?.src.startsWith(o), origin)
  // Not the top frame: a preview on the player's own origin starts with the same origin.
  const frame = page.frames().find((f) => f !== page.mainFrame() && f.url().startsWith(origin))
  if (!frame) throw new Error('no player frame')
  return frame
}

/** Waits for the content to be up in the frame, then for the iframe to have taken its height. */
const playsSized = async (page: Page, origin: string) => {
  const frame = await playerFrame(page, origin)
  await frame.waitForFunction(() => (document.querySelector('h5p-player') as unknown as { state: string } | null)?.state === 'ready', null, { timeout: 60_000 })
  // `ready` comes before the content has reported its height; the quiz is taller than 300 px.
  await frame.waitForFunction(() => document.body.getBoundingClientRect().height > 300, null, { timeout: 15_000 })
  const content = await frame.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height))
  await page.waitForFunction((h) => parseInt(document.querySelector('iframe')!.style.height, 10) === h, content, { timeout: 15_000 })
}

describe('a written site, framed from another site', () => {
  it('plays, takes the content height through resizer.js, and relays xAPI to the named origin', async () => {
    const page = await browser.newPage()
    await page.goto(`${embedding.origin}/open.html`)
    await playsSized(page, open.origin)

    // The element's own event, as the content would raise it: the relay is the page's, not H5P's.
    const frame = await playerFrame(page, open.origin)
    await frame.evaluate(() =>
      document.querySelector('h5p-player')!.dispatchEvent(new CustomEvent('xapi', { detail: { verb: 'answered', statement: {} } }))
    )
    await page.waitForFunction(() => (window as unknown as { relayed: unknown[] }).relayed.length > 0)
    expect(await heard(page)).toContainEqual(expect.objectContaining({ origin: open.origin, action: 'xapi' }))
    await page.close()
  })

  it('plays a package from a host on its list, and reports what it learnt to any parent', async () => {
    const page = await browser.newPage()
    await page.goto(`${embedding.origin}/locked.html`)
    await playsSized(page, locked.origin)
    // No `xapi=` on this address: the report goes up regardless, the statements do not.
    const report = await firstHeard(page, 'report')
    expect(report.origin).toBe(locked.origin)
    expect(report.data).toMatchObject({
      source: { type: 'chunked', size: expect.any(Number) },
      metadata: { title: expect.any(String), mainLibrary: 'H5P.QuestionSet' },
      libraryBundle: null,
      elapsedMs: expect.any(Number)
    })
    expect((await heard(page)).map((m) => m.action)).not.toContain('xapi')
    await page.close()
  })

  it('refuses a package from a host off its list, and never asks for it', async () => {
    const page = await browser.newPage()
    const requested: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/quiz.h5p') requested.push(request.url())
    })
    await page.goto(`${embedding.origin}/locked-elsewhere.html`)
    const frame = await playerFrame(page, locked.origin)
    await frame.waitForSelector('#notice:not([hidden])')
    expect(await frame.textContent('#notice')).toBe(`This player does not play packages from ${open.origin}.`)
    expect(await frame.evaluate(() => document.querySelector('h5p-player')!.getAttribute('src'))).toBeNull()
    expect(requested).toEqual([])
    expect((await firstHeard(page, 'error')).data).toEqual({
      context: 'h5p-offline-player',
      action: 'error',
      code: 'refused',
      message: `This player does not play packages from ${open.origin}.`
    })
    await page.close()
  })

  it('refuses the hub when the list does not name it', async () => {
    const page = await browser.newPage()
    await page.goto(`${embedding.origin}/locked-hub.html`)
    const frame = await playerFrame(page, locked.origin)
    await frame.waitForSelector('#notice:not([hidden])')
    expect(await frame.textContent('#notice')).toBe('This player does not fetch libraries from the H5P hub.')
    await page.close()
  })

  it('refuses libraries=pack on a site without the pack only when the hub is not allowed either', async () => {
    // This site lists the embedding host alone, so there is no hub to fall back to. With the
    // default policy the same address would have used the hub.
    const page = await browser.newPage()
    await page.goto(`${embedding.origin}/lean-pack.html`)
    const frame = await playerFrame(page, lean.origin)
    await frame.waitForSelector('#notice:not([hidden])')
    expect(await frame.textContent('#notice')).toBe('This player was set up without the library pack, so libraries=pack is not available here.')
    await page.close()
  })

  it('plays an export without libraries from the default source, and says where they came from', async () => {
    const page = await browser.newPage()
    await page.goto(`${embedding.origin}/fallback.html`)
    await playsSized(page, fallback.origin)
    const report = await firstHeard(page, 'report')
    expect(report.data.libraryBundle).toMatchObject({ url: `${fallback.origin}/libraries.h5p`, fromCache: false })
    await page.close()
  })

  it('takes libraries=none over the default, and posts the load\'s error', async () => {
    const page = await browser.newPage()
    await page.goto(`${embedding.origin}/fallback-none.html`)
    const error = await firstHeard(page, 'error')
    expect(error.data).toMatchObject({ code: 'bad-archive', message: expect.stringContaining('contains no libraries') })
    await page.close()
  })

  it('asks in a frame of its own origin by default, and not when the page says it need not', async () => {
    const page = await browser.newPage()
    await page.goto(`${open.origin}/preview.html`)
    const asking = await playerFrame(page, open.origin)
    await asking.waitForSelector('#notice button')
    await page.goto(`${previewing.origin}/preview.html`)
    const trusting = await playerFrame(page, previewing.origin)
    await trusting.waitForFunction((src) => document.querySelector('h5p-player')!.getAttribute('src') === src, `${embedding.origin}/quiz.h5p`)
    expect(await trusting.evaluate(() => document.querySelector('#notice button'))).toBeNull()
    await page.close()
  })

  it('asks before playing a package from elsewhere when opened on its own', async () => {
    const page = await browser.newPage()
    await page.goto(`${open.origin}/?src=${embedding.origin}/quiz.h5p`)
    await page.waitForSelector('#notice button')
    expect(await page.textContent('#notice')).toContain(`This link opens a package from ${new URL(embedding.origin).host}.`)
    expect(await page.evaluate(() => document.querySelector('h5p-player')!.getAttribute('src'))).toBeNull()
    // The click starts the load. Whether it then plays is the policy's call: this site allows any
    // https host, and the test's package is on plain http.
    await page.click('#notice button')
    expect(await page.evaluate(() => document.querySelector('h5p-player')!.getAttribute('src'))).toBe(`${embedding.origin}/quiz.h5p`)
    await page.close()
  })
})
