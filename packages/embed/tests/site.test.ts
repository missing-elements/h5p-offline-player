import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { extname, join, normalize, resolve } from 'node:path'
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

/** The embedding site's page: the snippet the README gives, with a listener for the relay. */
const snippet = (player: string, query: string) => `<!doctype html>
<html><body>
<iframe id="embed" src="${player}/?${query}" allow="fullscreen" style="width: 100%; border: 0"></iframe>
<script src="${player}/resizer.js"></script>
<script>
  window.relayed = []
  addEventListener('message', (event) => {
    if (event.data && event.data.context === 'h5p-offline-player') window.relayed.push({ origin: event.origin, action: event.data.action })
  })
</script>
</body></html>`

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'h5p-embed-site-'))
  // The embedding site also hosts a package, as a site's own CDN would.
  await cp(quiz, join(dir, 'quiz.h5p'))
  const pages = new Map<string, string>()
  embedding = await host(dir, 'localhost', (path) => pages.get(path) ?? null)

  const leanDir = join(dir, 'lean')
  await buildSite({ out: leanDir, libraries: false, packages: [embedding.origin] })
  const openDir = join(dir, 'open')
  const lockedDir = join(dir, 'locked')
  await buildSite({ out: openDir })
  await cp(quiz, join(openDir, 'quiz.h5p'))
  await buildSite({ out: lockedDir, packages: [embedding.origin] })
  open = await host(openDir, '127.0.0.1')
  lean = await host(leanDir, '127.0.0.1')
  locked = await host(lockedDir, '127.0.0.1')

  pages.set('/open.html', snippet(open.origin, `src=${open.origin}/quiz.h5p&xapi=${embedding.origin}`))
  pages.set('/locked.html', snippet(locked.origin, `src=${embedding.origin}/quiz.h5p`))
  pages.set('/locked-elsewhere.html', snippet(locked.origin, `src=${open.origin}/quiz.h5p`))
  pages.set('/locked-hub.html', snippet(locked.origin, `src=${embedding.origin}/quiz.h5p&libraries=hub`))
  pages.set('/lean-pack.html', snippet(lean.origin, `src=${embedding.origin}/quiz.h5p&libraries=pack`))

  browser = await chromium.launch()
})

afterAll(async () => {
  await browser?.close()
  await Promise.all([embedding, open, locked, lean].map((h) => h?.close()))
  await rm(dir, { recursive: true, force: true })
})

/** The player frame of the embedding page, once it has navigated. */
const playerFrame = async (page: Page, origin: string) => {
  await page.waitForFunction((o) => document.querySelector('iframe')?.src.startsWith(o), origin)
  const frame = page.frames().find((f) => f.url().startsWith(origin))
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
    expect(await page.evaluate(() => (window as unknown as { relayed: unknown[] }).relayed)).toContainEqual({ origin: open.origin, action: 'xapi' })
    await page.close()
  })

  it('plays a package from a host on its list', async () => {
    const page = await browser.newPage()
    await page.goto(`${embedding.origin}/locked.html`)
    await playsSized(page, locked.origin)
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
