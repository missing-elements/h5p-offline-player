import type { Browser, Page } from 'playwright'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { browserType } from './engine'
import { packageHost, playerIs, startSite } from './harness'

/**
 * The embed example, `/demo/embed.html`, with `/resizer.js` doing the sizing: the frame says
 * hello, the script answers, and the iframe takes the content's height. Through the dev server
 * and a real browser, since the exchange is between two documents.
 */

let vite: ViteDevServer
let browser: Browser
let origin: string
/** Another site, serving the quiz and a package that needs its own code. */
let elsewhere: Awaited<ReturnType<typeof packageHost>>

beforeAll(async () => {
  ;({ vite, origin } = await startSite())
  browser = await browserType.launch()
  elsewhere = await packageHost()
})

afterAll(async () => {
  await browser?.close()
  await vite?.close()
  await elsewhere?.close()
})

const playerState = (page: Page) =>
  page.evaluate(() => {
    const player = document.querySelector('h5p-player') as HTMLElement & { state: string; untrusted: boolean }
    return { state: player.state, untrusted: player.untrusted }
  })

it('plays a package from another site untrusted when opened on its own, with no question', async () => {
  const page = await browser.newPage()
  await page.goto(`${origin}/embed?src=${elsewhere.origin}/quiz.h5p`)
  await playerIs(page, 'ready')
  expect(await playerState(page)).toEqual({ state: 'ready', untrusted: true })
  expect(await page.evaluate(() => document.querySelector('#notice button'))).toBeNull()
  await page.close()
})

it('asks before playing a package from another site with its own code, and only when it needs it', async () => {
  const page = await browser.newPage()
  await page.goto(`${origin}/embed?src=${elsewhere.origin}/own-code-only.h5p`)
  await page.waitForSelector('#notice button')
  expect(await page.textContent('#notice')).toContain(`This package from ${new URL(elsewhere.origin).host} plays only with its own scripts.`)
  await page.click('#notice button')
  await playerIs(page, 'ready')
  expect(await playerState(page)).toEqual({ state: 'ready', untrusted: false })
  await page.close()
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
