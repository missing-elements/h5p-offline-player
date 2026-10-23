import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { type Browser, type BrowserContext, type Page } from 'playwright'
import { browserType, engine } from './engine'
import { OWN_CODE_ONLY, QUIZ, packageHost, playerIs, startSite } from './harness'
import { type ViteDevServer } from 'vite'
import { afterAll, beforeAll, expect, it } from 'vitest'

/**
 * The installable app, `/app/`, as an app: home until a file is opened, the player until it is
 * closed, Back in the bar or the browser's own to close it, and the keyboard reaching all of it.
 * Through the dev server and a real browser. What only an installed window does — `display-mode`,
 * the title bar — Chromium cannot emulate, and is checked by hand.
 */

let vite: ViteDevServer
let browser: Browser
let origin: string
/** Another site, serving the quiz and a package that needs its own code. */
let elsewhere: Awaited<ReturnType<typeof packageHost>>

beforeAll(async () => {
  ;({ vite, origin } = await startSite())
  browser = await browserType.launch()
  elsewhere = await packageHost({ '/quiz.h5p': QUIZ, '/own-code-only.h5p': OWN_CODE_ONLY })
})

afterAll(async () => {
  await browser?.close()
  await vite?.close()
  await elsewhere?.close()
})

const VIEWPORT = { width: 1000, height: 760 }

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

/** The player's next `ready` event: the load after this one, where `playerIs` would see this one's state. */
const nextReady = (page: Page) =>
  page.evaluate(() => new Promise<void>((done) => document.querySelector('h5p-player')!.addEventListener('ready', () => done(), { once: true })))

/**
 * The app in a fresh browser profile. Chromium's own picker, `showOpenFilePicker`, is taken away
 * unless a test brings its own: Playwright cannot answer it, and without it the app takes the path
 * Safari and Firefox take, the page's file input. `onDisk` opens it in a profile on disk, as a
 * browser window is (closed with `closePage`), and `installed` answers `display-mode` as an
 * installed window would; see `profileOnDisk`.
 */
async function openApp(path = '/app/', { keepPicker = false, onDisk = false, installed = false } = {}) {
  const page = onDisk ? await profileOnDisk({ installed }) : await browser.newPage({ viewport: VIEWPORT })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  if (!keepPicker) {
    // An own property of the window, as every operation of the global object is in Web IDL.
    await page.addInitScript(() => {
      delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker
    })
  }
  await page.goto(`${origin}${path}`)
  await workerChecked(page)
  return { page, errors }
}

const profiles = new Map<Page, { context: BrowserContext; dir: string }>()

/**
 * A page in a browser profile on disk, as a browser window is: WebKit, as Safari in a private
 * window, refuses a `File` in IndexedDB in the private profile Playwright gives a page, so the app
 * keeps no copy there. Closed with `closePage`. With `installed`, the app is as installed as far
 * as its script can tell: `display-mode` answered as matching, which Chromium will not emulate —
 * on disk because storing a file handle in the private profile takes Chromium down, the reason the
 * app keeps handles only when installed, which a private profile never is.
 */
async function profileOnDisk({ installed = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'h5p-app-profile-'))
  const context = await browserType.launchPersistentContext(dir, { viewport: VIEWPORT })
  if (installed) {
    await context.addInitScript(() => {
      const match = window.matchMedia.bind(window)
      window.matchMedia = (query) => match(query.includes('display-mode') ? 'all' : query)
    })
  }
  const page = context.pages()[0] ?? (await context.newPage())
  profiles.set(page, { context, dir })
  return page
}

async function closePage(page: Page) {
  const profile = profiles.get(page)
  if (!profile) return page.close()
  profiles.delete(page)
  await profile.context.close()
  await rm(profile.dir, { recursive: true, force: true })
}


/**
 * Chrome's picker, standing in: it answers with a real handle, to a copy of the quiz in the
 * origin's own file system, which the app treats as any other handle.
 */
const standInPicker = (page: Page) =>
  page.evaluate(() => {
    ;(window as unknown as { showOpenFilePicker: () => Promise<FileSystemFileHandle[]> }).showOpenFilePicker = async () => {
      const root = await navigator.storage.getDirectory()
      const handle = await root.getFileHandle('quiz.h5p', { create: true })
      const writable = await handle.createWritable()
      await writable.write(await (await fetch('/demo/content/quiz.h5p')).blob())
      await writable.close()
      return [handle]
    }
  })

/**
 * The key that moves focus on: WebKit, as Safari does by default, passes over buttons and links on
 * Tab alone, and reaches them on Option-Tab.
 */
const NEXT = engine === 'webkit' ? 'Alt+Tab' : 'Tab'

/** Handles to files on disk are Chromium's: its picker, a drop, the file manager. */
const noHandles = engine !== 'chromium'

/** Resolves once the page has found out whether its worker controls it, which is when it opens files. */
const workerChecked = (page: Page) =>
  page.waitForFunction(() => document.querySelector<HTMLElement>('#offline')?.dataset.state !== 'preparing', null, { timeout: 30_000 })

const goneHome = (page: Page) => page.waitForFunction(() => document.body?.dataset.screen === 'home')
const recentShown = (page: Page) => page.waitForFunction(() => !document.querySelector<HTMLElement>('#recent')!.hidden)
const recentGone = (page: Page) => page.waitForFunction(() => document.querySelector<HTMLElement>('#recent')!.hidden)
/** Resolves once the app has marked the current step as `depth` steps above home. */
const atDepth = (page: Page, depth: number) => page.waitForFunction((depth) => history.state?.depth === depth, depth)

/** The list of recent files as it reads, once it has drawn what it holds. */
const recent = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('#recent:not([hidden]) .recent-list li')].map((item) => ({
      title: item.querySelector('.recent-title')!.textContent,
      meta: item.querySelector('.recent-meta')!.textContent
    }))
  )

/** How many copies of files the app keeps, read from its own database. */
const copiesKept = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open('h5p-app')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const count = db.transaction('copies').objectStore('copies').count()
          count.onsuccess = () => {
            db.close()
            resolve(count.result)
          }
          count.onerror = () => reject(count.error)
        }
      })
  )

it('opens a file from the keyboard, shows it under its own title, and closes it with Back', async () => {
  const { page, errors } = await openApp()
  let state = await seen(page)
  expect(state).toMatchObject({ screen: 'home', startOver: false, back: false })

  // Listening from before the first key, not from beside Enter. Playwright switches Chromium's
  // picker interception on when the first listener is added, and Enter opens the picker on
  // keydown, the very next event the page gets: in Chromium on Linux the picker then went unseen
  // in seven runs of ten, on CI too (2026-10-12).
  const choosing = page.waitForEvent('filechooser')

  // "Choose a file" is a button, so Tab reaches it and Enter opens the picker.
  let reached = false
  for (let i = 0; i < 12 && !reached; i++) {
    await page.keyboard.press(NEXT)
    reached = await page.evaluate(() => document.activeElement?.id === 'open')
  }
  expect(reached).toBe(true)
  await page.keyboard.press('Enter')
  const chooser = await choosing
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
  await goneHome(page)
  await playerIs(page, 'idle')
  expect(await seen(page)).toMatchObject({ screen: 'home', startOver: false, back: false, url: '/app/' })
  expect(errors).toEqual([])
  await page.close()
})

it('keeps a link in the address, and takes the browser’s Back and Forward as closing and reopening it', async () => {
  const { page, errors } = await openApp('/app/?src=/demo/content/quiz.h5p')
  await playerIs(page, 'ready')
  expect((await seen(page)).url).toContain('?src=')

  // From script, as the bar's Back goes: Firefox's own Back passes over a step a page wrote before
  // anyone interacted with it, which home is when a link opens the app, and leaves the app.
  await page.evaluate(() => history.back())
  await goneHome(page)
  expect((await seen(page)).url).toBe('/app/')

  // Possible only because the player navigates its frame without adding history of its own.
  await page.evaluate(() => history.forward())
  await playerIs(page, 'ready')
  expect((await seen(page)).screen).toBe('player')

  // Start over opens it again in place, without another step. The player still says `ready` while
  // the app clears the saved state, before it opens the file again, so the wait is for the next
  // `ready`: going on before it, the reopen's first request started under the reload below, which
  // WebKit refuses and logs as a page error ("due to access control checks", CI 2026-10-15).
  const steps = await page.evaluate(() => history.length)
  await Promise.all([nextReady(page), page.click('#start-over')])
  expect(await page.evaluate(() => history.length)).toBe(steps)

  // A reload keeps the step it was at: the link opens into it again, with no step added.
  await page.reload()
  await playerIs(page, 'ready')
  expect(await page.evaluate(() => history.length)).toBe(steps)
  expect((await seen(page)).url).toContain('?src=')
  await page.goBack()
  await goneHome(page)
  expect((await seen(page)).url).toBe('/app/')
  expect(errors).toEqual([])
  await page.close()
})

/**
 * What Interactive Book does as it turns a page: it writes the chapter into the address of the page
 * around its frame, which adds a step to that page's history. The app once took any step it had
 * not made for Back, and closed the book at its first page.
 */
const turnPage = (page: Page, chapter: string) =>
  page
    .frames()
    .find((frame) => frame.url().includes('/frame/'))!
    .evaluate((chapter) => {
      top!.location.hash = `h5pbookid=1&chapter=${chapter}`
    }, chapter)

it('keeps a file open while its content writes to the address, and closes it with one Back', async () => {
  const { page, errors } = await openApp()
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#open')])
  const steps = await page.evaluate(() => history.length)
  await chooser.setFiles(QUIZ)
  await playerIs(page, 'ready')

  await turnPage(page, 'one')
  await turnPage(page, 'two')
  await atDepth(page, 3)
  expect(await seen(page)).toMatchObject({ screen: 'player', player: 'ready' })
  expect(await page.evaluate(() => history.length)).toBe(steps + 3)

  // The browser's Back turns back what the content wrote first; the file stays open.
  await page.goBack()
  expect(await page.evaluate(() => location.hash)).toContain('chapter=one')
  expect(await seen(page)).toMatchObject({ screen: 'player', player: 'ready' })

  // Back in the bar goes home past the content's steps, in one press.
  await page.click('#back')
  await goneHome(page)
  await playerIs(page, 'idle')
  expect(await seen(page)).toMatchObject({ url: '/app/', back: false })
  expect(await page.evaluate(() => location.hash)).toBe('')
  expect(errors).toEqual([])
  await page.close()
})

it('reopens a link where its content had got to after a reload, and still goes home in one', async () => {
  const { page, errors } = await openApp('/app/?src=/demo/content/quiz.h5p')
  await playerIs(page, 'ready')
  await turnPage(page, 'one')
  await atDepth(page, 2)
  const steps = await page.evaluate(() => history.length)

  await page.reload()
  await playerIs(page, 'ready')
  expect(await seen(page)).toMatchObject({ screen: 'player' })
  expect(await page.evaluate(() => history.length)).toBe(steps)

  // Home was written by the page before the reload, so going there loads the page again.
  await page.click('#back')
  await page.waitForURL(`${origin}/app/`)
  await goneHome(page)
  expect(await seen(page)).toMatchObject({ screen: 'home', url: '/app/' })
  expect(errors).toEqual([])
  await page.close()
})

it('lists a file it played, keeps a copy where there is no handle, and opens it from the list after a reload', async () => {
  const { page, errors } = await openApp('/app/', { onDisk: true })
  expect(await recent(page)).toEqual([])
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#open')])
  await chooser.setFiles(QUIZ)
  await playerIs(page, 'ready')
  const pkgId = await page.evaluate(() => (document.querySelector('h5p-player') as HTMLElement & { pkgId: string }).pkgId)
  await page.click('#back')
  await goneHome(page)
  await recentShown(page)
  expect(await recent(page)).toEqual([{ title: 'Do you know what just happened?', meta: expect.stringMatching(/^quiz\.h5p · Today · [\d.]+ (kB|MB) on this device$/) }])
  expect(await copiesKept(page)).toBe(1)

  // A new visit: the file opens from the copy, as the same file to the player, so its saved place
  // comes back with it, and no picker opens.
  await page.reload()
  await workerChecked(page)
  await recentShown(page)
  let picked = false
  page.on('filechooser', () => (picked = true))
  await page.click('.recent-open')
  await playerIs(page, 'ready')
  expect(await seen(page)).toMatchObject({ screen: 'player', bar: 'Do you know what just happened?' })
  expect(await page.evaluate(() => (document.querySelector('h5p-player') as HTMLElement & { pkgId: string }).pkgId)).toBe(pkgId)
  expect(picked).toBe(false)

  // Taken off the list, it takes its copy with it, and the keyboard goes back to the picker.
  await page.click('#back')
  await goneHome(page)
  await page.click('.recent-remove')
  await recentGone(page)
  expect(await copiesKept(page)).toBe(0)
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('open')
  expect(errors).toEqual([])
  await closePage(page)
})

// Chromium's private profile keeps a reference to a file rather than a copy of its bytes, which is
// what lets deleting the file take the copy away; Firefox keeps the bytes, and WebKit keeps nothing.
it.skipIf(engine !== 'chromium')('asks for a file again when its copy cannot be read, and lists it afresh once chosen', async () => {
  // The private profile Playwright gives a page keeps a reference to a file rather than a copy of
  // its bytes, as a private window may: deleting the file is what takes the copy away.
  const dir = await mkdtemp(join(tmpdir(), 'h5p-app-moved-'))
  const moved = join(dir, 'quiz.h5p')
  await copyFile(QUIZ, moved)
  const { page, errors } = await openApp()
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#open')])
  await chooser.setFiles(moved)
  await playerIs(page, 'ready')
  await page.click('#back')
  await goneHome(page)
  await recentShown(page)
  await rm(dir, { recursive: true, force: true })

  // Not "Could not read the archive index": the picker, and the entry gone until it is chosen.
  const [again] = await Promise.all([page.waitForEvent('filechooser'), page.click('.recent-open')])
  await recentGone(page)
  expect(await seen(page)).toMatchObject({ screen: 'home', player: 'idle', message: 'quiz.h5p could not be opened from the list. Choose it again.' })
  expect(await copiesKept(page)).toBe(0)
  await again.setFiles(QUIZ)
  await playerIs(page, 'ready')
  await page.click('#back')
  await goneHome(page)
  await recentShown(page)
  expect((await recent(page)).length).toBe(1)
  expect(await copiesKept(page)).toBe(1)
  expect(errors).toEqual([])
  await page.close()
})

it.skipIf(noHandles)('keeps a handle when installed, keeps no copy, and reads the file from it again', async () => {
  const { page, errors } = await openApp('/app/', { onDisk: true, installed: true })
  try {
    await standInPicker(page)
    await page.click('#open')
    await playerIs(page, 'ready')
    await page.click('#back')
    await goneHome(page)
    await recentShown(page)
    expect(await recent(page)).toEqual([{ title: 'Do you know what just happened?', meta: 'quiz.h5p · Today' }])
    expect(await copiesKept(page)).toBe(0)

    await page.reload()
    await workerChecked(page)
    await recentShown(page)
    await page.click('.recent-open')
    await playerIs(page, 'ready')
    expect((await seen(page)).bar).toBe('Do you know what just happened?')
    expect(errors).toEqual([])
  } finally {
    await closePage(page)
  }
})

it.skipIf(noHandles)('keeps a copy in a tab even where the browser gives a handle, which a private profile cannot store', async () => {
  const { page, errors } = await openApp('/app/', { keepPicker: true })
  await standInPicker(page)
  await page.click('#open')
  await playerIs(page, 'ready')
  await page.click('#back')
  await goneHome(page)
  await recentShown(page)
  expect(await recent(page)).toEqual([{ title: 'Do you know what just happened?', meta: expect.stringMatching(/^quiz\.h5p · Today · [\d.]+ MB on this device$/) }])
  expect(await copiesKept(page)).toBe(1)
  expect(errors).toEqual([])
  await page.close()
})

const untrusted = (page: Page) => page.evaluate(() => (document.querySelector('h5p-player') as HTMLElement & { untrusted: boolean }).untrusted)

it('plays a link from another site untrusted, with the libraries it carries and no question', async () => {
  const { page, errors } = await openApp(`/app/?src=${elsewhere.origin}/quiz.h5p`)
  await playerIs(page, 'ready')
  expect(await untrusted(page)).toBe(true)
  // The quiz carries its own libraries, and played with the pack's instead: the parts the app
  // carries, from its own origin.
  const bundle = await page.evaluate(() => (document.querySelector('h5p-player') as HTMLElement & { libraryBundle: { origin: string } | null }).libraryBundle)
  expect(bundle?.origin).toBe(new URL(page.url()).origin)
  expect(await page.isVisible('#confirm-src')).toBe(false)
  expect(errors).toEqual([])
  await page.close()
})

it('asks before playing a link from another site with its own code, and only when it needs it', async () => {
  const { page, errors } = await openApp(`/app/?src=${elsewhere.origin}/own-code-only.h5p`)
  await page.waitForSelector('#confirm-src:not([hidden])')
  expect(await page.textContent('#confirm-src .host')).toBe(new URL(elsewhere.origin).host)
  expect((await seen(page)).message).toBe('')

  await page.click('#confirm-open')
  await playerIs(page, 'ready')
  expect(await untrusted(page)).toBe(false)
  expect(await page.isVisible('#confirm-src')).toBe(false)
  expect(errors).toEqual([])
  await page.close()
})

it('lists a link by its host, and opens it from the list', async () => {
  const { page, errors } = await openApp('/app/?src=/demo/content/glossary.h5p')
  await playerIs(page, 'ready')
  await page.click('#back')
  await goneHome(page)
  await recentShown(page)
  expect(await recent(page)).toEqual([{ title: 'Words this player uses', meta: `${new URL(origin).host} · Today` }])

  await page.click('.recent-open')
  await playerIs(page, 'ready')
  expect((await seen(page)).url).toContain('?src=')
  expect(errors).toEqual([])
  await page.close()
})

it('keeps the bar’s icons on its first row at every width, with Install off the bar', async () => {
  const { page } = await openApp()
  // Chrome's offer to install, as the page receives it.
  await page.evaluate(() => {
    const offer = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: async () => ({ outcome: 'dismissed' }) })
    dispatchEvent(offer)
  })
  expect(await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#install, #menu-install')].map((button) => button.hidden))).toEqual([false, false])
  expect(await page.evaluate(() => document.querySelector('.topbar #install, .topbar .install'))).toBeNull()

  for (const width of [1440, 1100, 1024, 1000, 900, 768, 600, 390, 360]) {
    await page.setViewportSize({ width, height: 800 })
    const middles = await page.evaluate(() =>
      ['#brand', '#menu-button'].map((selector) => {
        const box = document.querySelector(selector)!.getBoundingClientRect()
        return Math.round(box.top + box.height / 2)
      })
    )
    expect(Math.abs(middles[0] - middles[1]), `at ${width}px`).toBeLessThan(6)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no sideways scroll at ${width}px`).toBe(true)
  }
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

it('refuses a link that is not http or https, and plays nothing', async () => {
  const { page, errors } = await openApp(`/app/?src=${encodeURIComponent('javascript:alert(1)')}`)
  await page.waitForFunction(() => !document.querySelector<HTMLElement>('#message')!.hidden)
  expect(await seen(page)).toMatchObject({ screen: 'home', message: 'That is not an http or https address: javascript:alert(1)' })
  expect(await page.evaluate(() => document.querySelector('h5p-player')!.hasAttribute('src'))).toBe(false)
  expect(errors).toEqual([])
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
