import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { chromium, type Browser } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, expect, it } from 'vitest'

/**
 * The embed example, `/demo/embed.html`, with `/resizer.js` doing the sizing: the frame says
 * hello, the script answers, and the iframe takes the content's height. Through the dev server
 * and a real browser, since the exchange is between two documents.
 */

const rootDir = resolve(import.meta.dirname, '..')
let vite: ViteDevServer
let browser: Browser
let origin: string

beforeAll(async () => {
  vite = await createServer({ configFile: resolve(rootDir, 'vite.config.ts'), root: rootDir, server: { host: 'localhost', port: 0 }, logLevel: 'error' })
  await vite.listen()
  origin = `http://localhost:${(vite.httpServer!.address() as AddressInfo).port}`
  browser = await chromium.launch()
})

afterAll(async () => {
  await browser?.close()
  await vite?.close()
})

it('sizes the framed player to its content through /resizer.js', async () => {
  const page = await browser.newPage()
  await page.goto(`${origin}/demo/embed.html`)
  // The script is served from the site root, as the snippet on the page says.
  expect(await page.evaluate(() => (window as unknown as { __h5pResizer?: boolean }).__h5pResizer)).toBe(true)
  const frame = page.locator('#embed')
  // Until the content is up the frame has only the stylesheet's height; the quiz is taller.
  await page.waitForFunction(() => {
    const el = document.querySelector<HTMLIFrameElement>('#embed')
    return el !== null && parseInt(el.style.height, 10) > 300
  }, null, { timeout: 60_000 })
  expect(await frame.getAttribute('data-loaded')).not.toBeNull()
  await page.close()
})

it('answers a frame that loaded before the script did', async () => {
  const page = await browser.newPage()
  await page.goto(`${origin}/demo/embed.html`)
  await page.waitForFunction(() => parseInt(document.querySelector<HTMLIFrameElement>('#embed')!.style.height, 10) > 300, null, { timeout: 60_000 })
  // A second copy of the script says `ready` to every frame; the frame says hello again and
  // reports its height again, so the height stays what the content needs.
  const before = await page.evaluate(() => document.querySelector<HTMLIFrameElement>('#embed')!.style.height)
  await page.evaluate(() => {
    document.querySelector<HTMLIFrameElement>('#embed')!.style.height = '50px'
    ;(window as unknown as { __h5pResizer?: boolean }).__h5pResizer = false
    const script = document.createElement('script')
    script.src = '/resizer.js?again'
    document.head.append(script)
  })
  await page.waitForFunction((h) => document.querySelector<HTMLIFrameElement>('#embed')!.style.height === h, before, { timeout: 15_000 })
  await page.close()
})
