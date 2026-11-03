import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildSite } from '../lib/build.mjs'
import { buildScorm } from '../lib/scorm.mjs'
import { host, type Host } from './helpers/host.js'
import { changedQuiz, entriesOf, formulas, quiz } from './helpers/zip.js'

/**
 * The SCORM page of a written site, driven in Chromium as a teacher uses it: a file chosen, the
 * zip offered and downloaded, and a refusal shown. What the zip holds is `scorm-browser.test.ts`'s
 * to check against the command's; here it is the page's own script, bundled as the site carries
 * it, and the download that reaches the disk.
 */

let dir: string
let site: Host
let browser: Browser

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'h5p-embed-scorm-page-'))
  await buildSite({ out: join(dir, 'site') })
  site = await host(join(dir, 'site'), '127.0.0.1')
  browser = await chromium.launch()
})

afterAll(async () => {
  await browser?.close()
  await site?.close()
  await rm(dir, { recursive: true, force: true })
})

describe('the SCORM page', () => {
  it("builds the command's zip from a chosen file and hands it over as a download, which plays", async () => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${site.origin}/scorm.html`)
    await page.setInputFiles('#file', quiz)
    await page.locator('#download').waitFor({ state: 'visible', timeout: 60_000 })
    expect(await page.locator('#status').textContent()).toMatch(/^“Do you know what just happened\?” as a SCORM 1\.2 package\. Build [0-9a-f]{16}\.$/)
    expect(await page.locator('#download').textContent()).toMatch(/^Download quiz\.scorm\.zip \(\d+\.\d MB\)$/)
    expect(await page.locator('#notice').isHidden()).toBe(true)

    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download').click()])
    expect(download.suggestedFilename()).toBe('quiz.scorm.zip')
    const saved = join(dir, 'quiz.page.zip')
    await download.saveAs(saved)

    // The same entries as the command's, with the same bytes; deflated by another zlib, so not
    // necessarily the same size.
    const command = await buildScorm({ h5p: quiz, out: join(dir, 'quiz.cli.zip') })
    const downloaded = await entriesOf(saved)
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

  it('shows a refusal in its words, and builds the next file as if nothing had happened', async () => {
    const unknown = join(dir, 'unknown.h5p')
    await changedQuiz(unknown, (manifest) => {
      manifest.preloadedDependencies.push({ machineName: 'H5P.Nowhere', majorVersion: 1, minorVersion: 0 })
    })
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${site.origin}/scorm.html`)
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
