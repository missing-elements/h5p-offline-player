import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, expect, it } from 'vitest'

/**
 * The installable app, `/app/`, as an app: home until a file is opened, the player until it is
 * closed, Back in the bar or the browser's own to close it, and the keyboard reaching all of it.
 * Through the dev server and a real browser. What only an installed window does — `display-mode`,
 * the title bar — Chromium cannot emulate, and is checked by hand.
 */

const rootDir = resolve(import.meta.dirname, '..')
const QUIZ = resolve(rootDir, 'demo', 'content', 'quiz.h5p')
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

interface Seen {
  screen: string | undefined
  player: string
  bar: string
  url: string
  startOver: boolean
  back: boolean
  loading: boolean
  message: string
}

const seen = (page: Page) =>
  page.evaluate((): Seen => {
    const shown = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector)!
      return !element.hidden && getComputedStyle(element).display !== 'none'
    }
    const message = document.querySelector<HTMLElement>('#message')!
    return {
      screen: document.body.dataset.screen,
      player: (document.querySelector('h5p-player') as HTMLElement & { state: string }).state,
      bar: document.querySelector('#title')!.textContent ?? '',
      url: location.pathname + location.search,
      startOver: shown('#start-over'),
      back: shown('#back'),
      loading: shown('#loading'),
      message: message.hidden ? '' : (message.textContent ?? '')
    }
  })

const playerIs = (page: Page, ...states: string[]) =>
  page.waitForFunction((states) => states.includes((document.querySelector('h5p-player') as HTMLElement & { state: string }).state), states, { timeout: 60_000 })

async function openApp(path = '/app/') {
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${origin}${path}`)
  await page.waitForFunction(() => document.querySelector<HTMLElement>('#offline')?.dataset.state !== 'preparing', null, { timeout: 30_000 })
  return { page, errors }
}

it('opens a file from the keyboard, shows it under its own title, and closes it with Back', async () => {
  const { page, errors } = await openApp()
  let state = await seen(page)
  expect(state).toMatchObject({ screen: 'home', startOver: false, back: false })

  // "Choose a file" is a button, so Tab reaches it and Enter opens the picker.
  let reached = false
  for (let i = 0; i < 12 && !reached; i++) {
    await page.keyboard.press('Tab')
    reached = await page.evaluate(() => document.activeElement?.id === 'open')
  }
  expect(reached).toBe(true)
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Enter')])
  const steps = await page.evaluate(() => history.length)
  await chooser.setFiles(QUIZ)
  await playerIs(page, 'ready')

  state = await seen(page)
  expect(state).toMatchObject({ screen: 'player', bar: 'Do you know what just happened?', startOver: true, back: true })
  expect(await page.title()).toMatch(/^Do you know what just happened\? — H5P Offline Player$/)
  // One step in the window's history, and the keyboard is not left on the hidden home screen.
  expect(await page.evaluate(() => history.length)).toBe(steps + 1)
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('back')

  await page.click('#back')
  await page.waitForFunction(() => document.body.dataset.screen === 'home')
  await playerIs(page, 'idle')
  expect(await seen(page)).toMatchObject({ screen: 'home', startOver: false, back: false, url: '/app/' })
  expect(errors).toEqual([])
  await page.close()
})

it('keeps a link in the address, and takes the browser’s Back and Forward as closing and reopening it', async () => {
  const { page, errors } = await openApp('/app/?src=/demo/content/quiz.h5p')
  await playerIs(page, 'ready')
  expect((await seen(page)).url).toContain('?src=')

  await page.goBack()
  await page.waitForFunction(() => document.body.dataset.screen === 'home')
  expect((await seen(page)).url).toBe('/app/')

  // Possible only because the player navigates its frame without adding history of its own.
  await page.goForward()
  await playerIs(page, 'ready')
  expect((await seen(page)).screen).toBe('player')

  // Start over opens it again in place, without another step.
  const steps = await page.evaluate(() => history.length)
  await page.click('#start-over')
  await playerIs(page, 'ready')
  expect(await page.evaluate(() => history.length)).toBe(steps)

  // A reload keeps the step it was at: the link opens into it again, with no step added.
  await page.reload()
  await playerIs(page, 'ready')
  expect(await page.evaluate(() => history.length)).toBe(steps)
  expect((await seen(page)).url).toContain('?src=')
  await page.goBack()
  await page.waitForFunction(() => document.body.dataset.screen === 'home')
  expect((await seen(page)).url).toBe('/app/')
  expect(errors).toEqual([])
  await page.close()
})

it('has a menu and an About dialog that Escape closes', async () => {
  const { page } = await openApp()
  const open = (selector: string) => page.evaluate((selector) => document.querySelector(selector)!.matches(':popover-open, [open]'), selector)

  await page.click('#menu-button')
  expect(await open('#menu')).toBe(true)
  await page.keyboard.press('Escape')
  expect(await open('#menu')).toBe(false)

  await page.click('#menu-button')
  await page.click('#menu-about')
  expect(await open('#about-dialog')).toBe(true)
  expect(await open('#menu')).toBe(false)
  await page.keyboard.press('Escape')
  expect(await open('#about-dialog')).toBe(false)
  await page.close()
})

it('plays a file dropped on it, and says what went wrong with a link that fails', async () => {
  const { page } = await openApp()
  await page.evaluate(async () => {
    const blob = await (await fetch('/demo/content/glossary.h5p')).blob()
    const transfer = new DataTransfer()
    transfer.items.add(new File([blob], 'glossary.h5p'))
    document.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
  })
  await playerIs(page, 'ready')
  expect(await seen(page)).toMatchObject({ screen: 'player', bar: 'Words this player uses' })

  await page.goto(`${origin}/app/?src=/demo/content/missing.h5p`)
  await playerIs(page, 'error')
  const state = await seen(page)
  expect(state.loading).toBe(false)
  expect(state.message).not.toBe('')
  await page.close()
})

it('gives the window’s title bar the page’s colour, in either theme', async () => {
  const { page } = await openApp()
  const color = () => page.evaluate(() => [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((meta) => meta.content))
  const light = await color()
  await page.click('.theme-toggle')
  await page.waitForFunction((light) => document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content !== light, light[0])
  const dark = await color()
  expect(new Set(dark).size).toBe(1)
  expect(dark[0]).toBe(await page.evaluate(() => getComputedStyle(document.body).backgroundColor))
  await page.close()
})

it('lets the keyboard reach the player page’s file input, which a label alone could not', async () => {
  const page = await browser.newPage()
  await page.goto(`${origin}/`)
  let reached = false
  for (let i = 0; i < 30 && !reached; i++) {
    await page.keyboard.press('Tab')
    reached = await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type === 'file')
  }
  expect(reached).toBe(true)
  expect(await page.evaluate(() => getComputedStyle(document.activeElement!.closest('label')!).outlineStyle)).not.toBe('none')
  await page.close()
})
