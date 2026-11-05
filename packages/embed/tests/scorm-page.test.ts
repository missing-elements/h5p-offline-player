import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { chromium, type Browser, type Download, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildSite } from '../lib/build.mjs'
import { buildScorm } from '../lib/scorm.mjs'
import { host, type Host } from './helpers/host.js'
import { changedQuiz, entriesOf, formulas, quiz } from './helpers/zip.js'

/**
 * The SCORM page of a written site, driven in Chromium as a teacher uses it: files chosen or
 * dropped, each read into a row of the review, a title changed, the zips built and downloaded one
 * by one and all in one, and a refusal shown beside the files that build. What a zip holds is
 * `scorm-browser.test.ts`'s to check against the command's; here it is the page's own script,
 * bundled as the site carries it, and the downloads that reach the disk. A page with only the
 * elements a page had up to embed 1.5 still builds a file the moment it is chosen.
 */

/** A host's page as the README described one up to embed 1.5: the input, the line, the link and the notice. */
const LEGACY = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>A page of a host's own</title>
    <script type="module" src="./scorm-main.js"></script>
  </head>
  <body>
    <input type="file" id="file" accept=".h5p" />
    <p class="status"><span id="status"></span> <a id="download" hidden>Download</a></p>
    <p id="notice" role="alert" hidden></p>
  </body>
</html>
`

let dir: string
let site: Host
let browser: Browser
/** A package that needs a library neither it nor the pack has. */
let unknown: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'h5p-embed-scorm-page-'))
  await buildSite({ out: join(dir, 'site') })
  // The packages again, for a page to fetch and drop on itself.
  await mkdir(join(dir, 'site', 'packages'))
  await copyFile(quiz, join(dir, 'site', 'packages', 'quiz.h5p'))
  await copyFile(formulas, join(dir, 'site', 'packages', 'formulas.h5p'))
  unknown = join(dir, 'unknown.h5p')
  await changedQuiz(unknown, (manifest) => {
    manifest.preloadedDependencies.push({ machineName: 'H5P.Nowhere', majorVersion: 1, minorVersion: 0 })
  })
  site = await host(join(dir, 'site'), '127.0.0.1', (path) => (path === '/legacy.html' ? LEGACY : null))
  browser = await chromium.launch()
})

afterAll(async () => {
  await browser?.close()
  await site?.close()
  await rm(dir, { recursive: true, force: true })
})

/** The row of the file by that name. */
const rowOf = (page: Page, name: string) => page.locator('#files > li', { has: page.locator('.scorm-row-name', { hasText: name }) })

/** Waits until every file chosen has been read: no row says `Reading…` any more. */
const read = (page: Page, count: number) =>
  page.waitForFunction((rows) => document.querySelectorAll('#files > li').length === rows && !document.querySelector('#files > li[data-state="reading"]'), count, { timeout: 60_000 })

/** What a link hands over, saved. */
async function saved(page: Page, link: ReturnType<Page['locator']>, name: string): Promise<{ download: Download; path: string }> {
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()])
  const path = join(dir, name)
  await download.saveAs(path)
  return { download, path }
}

describe('the SCORM page', () => {
  it("reads a chosen file into a row, and on Build hands over the command's zip, which plays", async () => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${site.origin}/scorm.html`)
    // Only the first step until a file is chosen.
    expect(await page.locator('[data-step="review"]').isHidden()).toBe(true)
    expect(await page.locator('[data-step="download"]').isHidden()).toBe(true)

    await page.setInputFiles('#file', quiz)
    await read(page, 1)
    const row = rowOf(page, 'quiz.h5p')
    expect(await row.getAttribute('data-state')).toBe('planned')
    expect(await row.locator('.scorm-row-size').textContent()).toBe('1.5 MB')
    expect(await row.locator('.scorm-row-facts').textContent()).toMatch(/^H5P\.QuestionSet 1\.\d+ · carries its libraries$/)
    expect(await row.locator('.scorm-row-title input').inputValue()).toBe('Do you know what just happened?')
    // Nothing is written before Build.
    expect(await page.locator('#download').isHidden()).toBe(true)
    expect(await page.locator('#build').textContent()).toBe('Build the SCORM package')

    await page.locator('#build').click()
    await page.locator('#download').waitFor({ state: 'visible', timeout: 60_000 })
    expect(await page.locator('#status').textContent()).toMatch(/^“Do you know what just happened\?” as a SCORM 1\.2 package\. Build [0-9a-f]{16}\.$/)
    expect(await page.locator('#download').textContent()).toMatch(/^Download quiz\.scorm\.zip \(\d+\.\d MB\)$/)
    expect(await page.locator('#notice').isHidden()).toBe(true)
    expect(await row.getAttribute('data-state')).toBe('built')
    // One zip, one link: the strip's, where focus has gone, and none in the row.
    expect(await row.locator('.scorm-row-download').isHidden()).toBe(true)
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('download')
    expect(await page.locator('#build').isDisabled()).toBe(true)

    const { download, path } = await saved(page, page.locator('#download'), 'quiz.page.zip')
    expect(download.suggestedFilename()).toBe('quiz.scorm.zip')

    // The same entries as the command's, with the same bytes; deflated by another zlib, so not
    // necessarily the same size.
    const command = await buildScorm({ h5p: quiz, out: join(dir, 'quiz.cli.zip') })
    const downloaded = await entriesOf(path)
    const written = await entriesOf(command.out)
    expect(downloaded.names).toEqual(written.names)
    for (const name of downloaded.names) {
      expect(Buffer.from(await downloaded.bytes(name)).equals(await written.bytes(name)), name).toBe(true)
    }
    await written.close()

    // Unpacked onto the site, as an LMS unpacks it, the launch page plays the package.
    const played = join(dir, 'site', 'played')
    for (const name of downloaded.names) {
      await mkdir(dirname(join(played, name)), { recursive: true })
      await writeFile(join(played, name), await downloaded.bytes(name))
    }
    await downloaded.close()
    await page.goto(`${site.origin}/played/index.html`)
    await page.waitForFunction(() => (document.querySelector('h5p-player') as { state?: string } | null)?.state === 'ready', null, { timeout: 60_000 })
    await context.close()
  })

  it('builds several files one after another, each with its link and all in one, beside a refusal, under the titles given', async () => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${site.origin}/scorm.html`)
    await page.setInputFiles('#file', [quiz, formulas, unknown])
    await read(page, 3)
    expect(await page.locator('#files > li .scorm-row-name').allTextContents()).toEqual(['quiz.h5p', 'formulas.h5p', 'unknown.h5p'])

    // An export without its libraries: what the pack adds, and how much.
    const exported = rowOf(page, 'formulas.h5p')
    expect(await exported.locator('.scorm-row-size').textContent()).toBe('2 kB')
    expect(await exported.locator('.scorm-row-facts').textContent()).toMatch(/^H5P\.QuestionSet 1\.\d+ · \d+ libraries from the pack, \d+\.\d MB$/)
    // The refusal, in its words, in its row, before anything is built; nothing to title.
    const refused = rowOf(page, 'unknown.h5p')
    expect(await refused.getAttribute('data-state')).toBe('refused')
    expect(await refused.locator('.scorm-row-facts').textContent()).toMatch(/^unknown\.h5p needs libraries that neither it nor the library pack carries: H5P\.Nowhere 1\.0\./)
    expect(await refused.locator('.scorm-row-title').count()).toBe(0)
    expect(await page.locator('#build').textContent()).toBe('Build 2 SCORM packages')

    // Typed in, key by key, a title rewrites no live region: one written again may be read out again.
    await page.evaluate(() => {
      const watched = [...document.querySelectorAll('.scorm-row-facts'), document.querySelector('#status')]
      const changes = { count: 0 }
      ;(window as unknown as { changes: typeof changes }).changes = changes
      const observer = new MutationObserver((records) => (changes.count += records.length))
      for (const element of watched) observer.observe(element as Node, { childList: true, characterData: true, subtree: true })
    })
    await exported.locator('.scorm-row-title input').fill('Formulas')
    await exported.locator('.scorm-row-title input').pressSequentially(', retitled')
    expect(await page.evaluate(() => (window as unknown as { changes: { count: number } }).changes.count)).toBe(0)
    await page.locator('#build').click()
    await page.locator('#download').waitFor({ state: 'visible', timeout: 120_000 })
    expect(await page.locator('#download').textContent()).toMatch(/^Download all 2 as one zip \(\d+\.\d MB\)$/)
    expect(await page.locator('#status').textContent()).toBe('2 SCORM 1.2 packages, each with its link above.')
    expect(await page.locator('#notice').isHidden()).toBe(true)
    const quizRow = rowOf(page, 'quiz.h5p')
    expect(await quizRow.locator('.scorm-row-download').textContent()).toMatch(/^Download quiz\.scorm\.zip \(\d+\.\d MB\)$/)
    expect(await exported.locator('.scorm-row-download').textContent()).toMatch(/^Download formulas\.scorm\.zip \(\d+\.\d MB\)$/)

    // The title given is the one the LMS lists: the manifest's organisation and item, and the page.
    const own = await saved(page, exported.locator('.scorm-row-download'), 'formulas.row.zip')
    expect(own.download.suggestedFilename()).toBe('formulas.scorm.zip')
    const formulasZip = await entriesOf(own.path)
    expect((await formulasZip.text('imsmanifest.xml')).match(/<title>Formulas, retitled<\/title>/g)).toHaveLength(2)
    expect(await formulasZip.text('index.html')).toContain('<title>Formulas, retitled</title>')
    await formulasZip.close()

    // All in one: the two zips as they are, stored, under their own names.
    const all = await saved(page, page.locator('#download'), 'all.zip')
    expect(all.download.suggestedFilename()).toBe('scorm-packages.zip')
    const together = await entriesOf(all.path)
    expect(together.names).toEqual(['quiz.scorm.zip', 'formulas.scorm.zip'])
    for (const name of together.names) expect(together.entry(name).compressionMethod, name).toBe(0)
    expect(Buffer.from(await together.bytes('formulas.scorm.zip')).equals(await readFile(own.path))).toBe(true)
    await together.close()

    // Taken out, the refused row leaves the focus on the row before it.
    await refused.locator('.scorm-row-remove').click()
    expect(await page.locator('#files > li').count()).toBe(2)
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Remove formulas.h5p')

    // A title changed after the build takes that zip back, and the zip of all with it, until it is built again.
    await quizRow.locator('.scorm-row-title input').fill('The quiz, retitled')
    expect(await quizRow.getAttribute('data-state')).toBe('planned')
    expect(await quizRow.locator('.scorm-row-download').isHidden()).toBe(true)
    expect(await page.locator('#download').isHidden()).toBe(true)
    expect(await page.locator('#status').textContent()).toBe('One SCORM 1.2 package, with its link above; 1 more to build.')
    expect(await page.locator('#build').textContent()).toBe('Build 1 SCORM package')
    await page.locator('#build').click()
    await page.locator('#download').waitFor({ state: 'visible', timeout: 60_000 })
    expect(await page.locator('#download').textContent()).toMatch(/^Download all 2 as one zip /)
    const again = await saved(page, quizRow.locator('.scorm-row-download'), 'quiz.retitled.zip')
    const quizZip = await entriesOf(again.path)
    expect(await quizZip.text('imsmanifest.xml')).toContain('<title>The quiz, retitled</title>')
    await quizZip.close()
    await context.close()
  })

  it('takes files dropped on the page, and the same file only once', async () => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${site.origin}/scorm.html`)
    await page.evaluate(async () => {
      const transfer = new DataTransfer()
      for (const name of ['quiz.h5p', 'formulas.h5p', 'quiz.h5p']) {
        transfer.items.add(new File([await (await fetch(`/packages/${name}`)).blob()], name, { lastModified: 1 }))
      }
      document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
    })
    await read(page, 2)
    expect(await page.locator('#files > li .scorm-row-name').allTextContents()).toEqual(['quiz.h5p', 'formulas.h5p'])
    expect(await page.locator('#build').textContent()).toBe('Build 2 SCORM packages')
    await context.close()
  })

  it("builds at once on a page with only the elements of embed 1.5's, and shows a refusal in #notice", async () => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${site.origin}/legacy.html`)
    await page.setInputFiles('#file', unknown)
    await page.locator('#notice').waitFor({ state: 'visible', timeout: 60_000 })
    expect(await page.locator('#notice').textContent()).toMatch(/^unknown\.h5p needs libraries that neither it nor the library pack carries: H5P\.Nowhere 1\.0\./)
    expect(await page.locator('#download').isHidden()).toBe(true)
    expect(await page.locator('#status').textContent()).toBe('')

    // An export without its libraries, next: the parts come from the site's own copy of the pack.
    await page.setInputFiles('#file', formulas)
    await page.locator('#download').waitFor({ state: 'visible', timeout: 60_000 })
    expect(await page.locator('#notice').isHidden()).toBe(true)
    expect(await page.locator('#status').textContent()).toMatch(/ as a SCORM 1\.2 package, with \d+ libraries from the pack\. Build [0-9a-f]{16}\.$/)
    expect(await page.locator('#download').textContent()).toMatch(/^Download formulas\.scorm\.zip /)
    await context.close()
  })
})
