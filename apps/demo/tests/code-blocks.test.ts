import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Browser, Page } from 'playwright'
import { type ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { highlightCodeBlocks } from '../scripts/lib/code-blocks.mjs'
import { browserType, engine } from './engine'
import { startSite } from './harness'

/**
 * The demo pages' code blocks: highlighted by `scripts/lib/code-blocks.mjs` when a page is
 * served or built, and made to work by `demo/code-blocks.js`.
 */

const rootDir = resolve(import.meta.dirname, '..')
const PAGES = ['demo/setup.html', 'demo/embed.html', 'demo/index.html', 'demo/normalize.html', 'demo/cmi5.html']

const decode = (text: string) =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')

/** What each block says, as the page wrote it. */
const written = (html: string) => [...html.matchAll(/<pre class="code"[^>]*>([\s\S]*?)<\/pre>/g)].map((match) => decode(match[1]))

/** What each highlighted block says: the text a visitor copies, the text between its tags. */
const shown = (html: string) =>
  [...html.matchAll(/<pre class="code-body"[^>]*>([\s\S]*?)<\/pre>/g)].map((match) =>
    decode([...`>${match[1]}<`.matchAll(/>([^<]*)(?=<)/g)].map((text) => text[1]).join(''))
  )

describe('highlighting', () => {
  it('turns a block into a labelled figure, coloured by classes, with no style attribute', async () => {
    const html = await highlightCodeBlocks(
      '<p>Before</p><pre class="code" data-lang="html">&lt;h5p-player src="a.h5p?x=1&amp;y=2" untrusted&gt;&lt;/h5p-player&gt;</pre><p>After</p>'
    )
    expect(html.startsWith('<p>Before</p><figure class="code-block"><div class="code-head"><span class="code-label">HTML</span>')).toBe(true)
    expect(html.endsWith('</figure><p>After</p>')).toBe(true)
    expect(html).toContain('<span class="tk-tag">h5p-player</span>')
    expect(html).toContain('<span class="tk-attr"> untrusted</span>')
    expect(html).toContain('<button type="button" class="code-copy">Copy</button>')
    // The site's CSP is `style-src 'self'`: a style attribute would be refused, and the colour lost.
    expect(html).not.toContain('style=')
    expect(shown(html)).toEqual(['<h5p-player src="a.h5p?x=1&y=2" untrusted></h5p-player>'])
  })

  it.each(PAGES)('keeps every snippet of %s as it is written, and colours it with classes alone', async (page) => {
    const source = readFileSync(resolve(rootDir, page), 'utf8')
    const html = await highlightCodeBlocks(source)
    expect(written(source).length).toBeGreaterThan(0)
    expect(shown(html)).toEqual(written(source))
    expect(html).not.toContain('<pre class="code"')
    for (const figure of html.match(/<figure class="code-block"[\s\S]*?<\/figure>/g) ?? []) expect(figure).not.toContain('style=')
  })

  it('shows a group of blocks as tabs, the first selected and each naming its panel', async () => {
    const group = (name: string) =>
      `<div class="code-tabs">\n` +
      `<pre class="code" data-lang="sh" data-tab="npm">npm i ${name}</pre>\n` +
      `<pre class="code" data-lang="sh" data-tab="pnpm">pnpm add ${name}</pre>\n` +
      `</div>`
    const html = await highlightCodeBlocks(`${group('a')}<p>Between</p>${group('b')}`)
    const figures = html.match(/<figure class="code-block" data-tabs>[\s\S]*?<\/figure>/g) ?? []
    expect(figures).toHaveLength(2)
    expect(html).not.toContain('code-tabs')
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1])
    expect(new Set(ids).size).toBe(ids.length)
    for (const figure of figures) {
      const tabs = [...figure.matchAll(/<button type="button" role="tab" id="([^"]+)" aria-controls="([^"]+)" aria-selected="(true|false)" tabindex="(0|-1)" data-tab="([^"]+)">/g)]
      expect(tabs.map((tab) => [tab[3], tab[4], tab[5]])).toEqual([
        ['true', '0', 'npm'],
        ['false', '-1', 'pnpm']
      ])
      for (const [, tabId, panelId] of tabs) expect(figure).toContain(`id="${panelId}" aria-labelledby="${tabId}"`)
      expect(figure.match(/<pre [^>]*\bhidden\b/g)).toHaveLength(1)
      expect(figure).toContain('<span class="code-label">Terminal</span>')
    }
    expect(shown(html)).toEqual(['npm i a', 'pnpm add a', 'npm i b', 'pnpm add b'])
  })

  it('names a block by its title, keeping a file name as it is written', async () => {
    const html = await highlightCodeBlocks('<pre class="code" data-lang="xml" data-title="cmi5.xml">&lt;au id="x"/&gt;</pre>')
    expect(html).toContain('<span class="code-label code-file">cmi5.xml</span>')
  })

  it('shows a block of another language as plain text', async () => {
    const html = await highlightCodeBlocks('<pre class="code" data-lang="cobol">MOVE A TO B</pre><pre class="code">x = 1</pre>')
    expect(html).not.toContain('class="tk-')
    expect(html).not.toContain('code-label')
    expect(shown(html)).toEqual(['MOVE A TO B', 'x = 1'])
  })

  it('leaves a page without code blocks, and an event log, as they are', async () => {
    const page = '<pre class="log" id="log"></pre><p>No code here.</p>'
    expect(await highlightCodeBlocks(page)).toBe(page)
  })
})

describe('on the page', () => {
  let vite: ViteDevServer
  let browser: Browser
  let origin: string

  beforeAll(async () => {
    ;({ vite, origin } = await startSite())
    browser = await browserType.launch()
  })

  afterAll(async () => {
    await browser?.close()
    await vite?.close()
  })

  const visible = (page: Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.code-block[data-tabs] .code-body')].filter((panel) => !panel.hidden).map((panel) => panel.dataset.tab)
    )

  it('switches tabs by click and by arrow keys, and remembers the choice', async () => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${origin}/demo/setup.html`)
    expect(await visible(page)).toEqual(['npm'])

    await page.click('[role="tab"][data-tab="pnpm"]')
    expect(await visible(page)).toEqual(['pnpm'])
    expect(await page.getAttribute('[role="tab"][data-tab="pnpm"]', 'aria-selected')).toBe('true')
    expect(await page.getAttribute('[role="tab"][data-tab="npm"]', 'tabindex')).toBe('-1')

    await page.keyboard.press('ArrowRight')
    expect(await visible(page)).toEqual(['yarn'])
    expect(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.tab)).toBe('yarn')
    await page.keyboard.press('ArrowRight')
    expect(await visible(page)).toEqual(['npm'])
    await page.keyboard.press('End')
    expect(await visible(page)).toEqual(['yarn'])

    await page.reload()
    expect(await visible(page)).toEqual(['yarn'])
    await context.close()
  })

  // Reading the clipboard back takes a permission only Chromium grants a test.
  it.skipIf(engine !== 'chromium')('copies the code a block shows', async () => {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
    const page = await context.newPage()
    await page.goto(`${origin}/demo/setup.html`)
    await page.click('[role="tab"][data-tab="pnpm"]')

    const install = page.locator('.code-block').nth(0)
    await install.locator('.code-copy').click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('pnpm add @missing-elements/h5p-offline-player @missing-elements/h5p-runtime')
    expect(await install.locator('.code-copy').textContent()).toBe('Copied')
    expect(await install.locator('.code-status').textContent()).toBe('Copied')

    await page.locator('.code-block').nth(1).locator('.code-copy').click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "import '@missing-elements/h5p-offline-player'\nimport { runtime } from '@missing-elements/h5p-runtime'\n\ndocument.querySelector('h5p-player').runtime = runtime"
    )
    await context.close()
  })
})
