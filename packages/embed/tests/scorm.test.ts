import { execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, normalize, resolve } from 'node:path'
import { promisify } from 'node:util'
import { crc32 } from 'node:zlib'
import { BlobReader, ZipReader } from '@zip.js/zip.js'
import { chromium, type Browser, type BrowserContext, type Frame, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EmbedError } from '../lib/build.mjs'
import { buildScorm } from '../lib/scorm.mjs'
import { changedQuiz, entriesOf, formulas, quiz } from './helpers/zip.js'

/**
 * The SCORM package `--scorm` writes: what is in the zip and what is refused, in Node; and in
 * Chromium, the launch page framed by a stand-in for an LMS's player page, which puts the SCORM
 * 1.2 API in its window and keeps the values, as Moodle's does, across launches. The same zip
 * built in a page is `scorm-browser.test.ts`'s and `scorm-page.test.ts`'s.
 */

const bin = resolve(import.meta.dirname, '../bin/h5p-embed.mjs')
let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'h5p-embed-scorm-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('the package', () => {
  it('carries the launch page, the player, the runtime and the package, every file in the manifest', async () => {
    const out = join(dir, 'quiz.zip')
    const built = await buildScorm({ h5p: quiz, out })
    const build = createHash('sha256').update(await readFile(quiz)).digest('hex').slice(0, 16)
    // It carries its libraries, so nothing of the pack comes with it.
    expect(built).toMatchObject({ out, title: 'Do you know what just happened?', libraries: [], build })

    const zip = await entriesOf(out)
    for (const name of ['imsmanifest.xml', 'index.html', 'scorm.js', 'lz-string.js', 'embed.css', 'h5p-player.js', 'h5p-sw.js', 'h5p-jobs.js', 'package.h5p', 'NOTICE.txt']) {
      expect(zip.names).toContain(name)
    }
    expect(zip.names.filter((name) => name.startsWith('libraries'))).toEqual([])
    for (const name of ['frame.bundle.js', 'frame-boot.js', 'h5p.css', 'l10n.js', 'LICENSE.txt', 'NOTICE.txt']) {
      expect(zip.names).toContain(`frame-assets/${name}`)
    }
    expect(Buffer.from(await zip.bytes('package.h5p')).equals(await readFile(quiz))).toBe(true)

    const manifest = await zip.text('imsmanifest.xml')
    expect(manifest).toContain('<schemaversion>1.2</schemaversion>')
    expect(manifest).toContain(`identifier="h5p-${build}"`)
    expect(manifest).toContain('<title>Do you know what just happened?</title>')
    expect(manifest).toContain('adlcp:scormtype="sco" href="index.html"')
    const listed = [...manifest.matchAll(/<file href="([^"]+)"\/>/g)].map((match) => match[1])
    expect(listed.sort()).toEqual([...zip.names].sort())

    const page = await zip.text('index.html')
    expect(page).toContain('<html lang="en">')
    expect(page).toContain('<title>Do you know what just happened?</title>')
    expect(page).toContain(`<meta name="h5p-package-build" content="${build}" />`)
    expect(page).toContain('<h5p-player></h5p-player>')
    expect(await zip.text('NOTICE.txt')).toContain('GPL-3.0-only')
    await zip.close()
  })

  it('writes each stored entry with its sizes and CRC in its local header, as Java\'s ZipInputStream needs', async () => {
    // A Java ZipInputStream reads the local headers and refuses a stored entry whose sizes follow
    // its data in a descriptor; SCORM Cloud refused every zip for it (#92).
    const out = join(dir, 'formulas-headers.zip')
    await buildScorm({ h5p: formulas, out })
    const bytes = await readFile(out)
    const reader = new ZipReader(new BlobReader(new Blob([bytes])))
    const stored = (await reader.getEntries()).filter((entry) => !entry.directory && entry.compressionMethod === 0)
    await reader.close()
    const names = stored.map((entry) => entry.filename)
    expect(names).toContain('package.h5p')
    expect(names).toContain('frame-assets/fonts/inter-400.woff2')
    expect(names.some((name) => name.startsWith('libraries/'))).toBe(true)
    for (const entry of stored) {
      const header = bytes.subarray(entry.offset, entry.offset + 30)
      expect(header.readUInt32LE(0), entry.filename).toBe(0x04034b50)
      expect(header.readUInt16LE(6) & 0x08, `${entry.filename} has a data descriptor`).toBe(0)
      const size = header.readUInt32LE(22)
      expect(size, entry.filename).toBe(entry.uncompressedSize)
      expect(header.readUInt32LE(18), entry.filename).toBe(size)
      // The data follows the name and the extra field. Its CRC is computed here and held to the
      // header's: the central directory's was written from the same number as the header's.
      const data = bytes.subarray(entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28)).subarray(0, size)
      expect(data.length, entry.filename).toBe(size)
      expect(crc32(data), entry.filename).toBe(header.readUInt32LE(14))
    }
  })

  it('writes the title as text in the manifest and the page, and the page in the content\'s language', async () => {
    const source = join(dir, 'titled.h5p')
    await changedQuiz(source, (manifest) => {
      // What a replacement string reads as a pattern, and a control character XML refuses.
      manifest.title = `Q&A:\u000b<b>"l'aigle"</b> for $$, $& and $'`
      manifest.defaultLanguage = 'fr'
    })
    await buildScorm({ h5p: source, out: join(dir, 'titled.zip') })
    const zip = await entriesOf(join(dir, 'titled.zip'))
    expect(await zip.text('imsmanifest.xml')).toContain(`<title>Q&amp;A: &lt;b&gt;&quot;l&apos;aigle&quot;&lt;/b&gt; for $$, $&amp; and $&apos;</title>`)
    const page = await zip.text('index.html')
    expect(page).toContain(`<title>Q&amp;A: &lt;b&gt;&quot;l'aigle&quot;&lt;/b&gt; for $$, $&amp; and $'</title>`)
    expect(page.match(/<h5p-player>/g)).toHaveLength(1)
    expect(page).toContain('<html lang="fr">')
    await zip.close()
  })

  it('carries the parts of the library pack that an export without its libraries needs, and only those', async () => {
    // h5p.json naming the main library alone, content/ and nothing else, as h5p.com and h5p.org export.
    const out = join(dir, 'formulas.zip')
    const built = await buildScorm({ h5p: formulas, out })
    expect(built.libraries).toContainEqual(expect.stringMatching(/^H5P\.QuestionSet-1\.\d+$/))
    // The sub-content its parameters name, and the addon its LaTeX asks for.
    expect(built.libraries).toContainEqual(expect.stringMatching(/^H5P\.MultiChoice-1\.\d+$/))
    expect(built.libraries).toContain('H5P.MathDisplay-1.0')
    expect(built.build).not.toBe(createHash('sha256').update(await readFile(formulas)).digest('hex').slice(0, 16))

    const zip = await entriesOf(out)
    const index = JSON.parse(await zip.text('libraries/index.json')) as { libraries: { folder: string; sha256: string }[] }
    expect(index.libraries.map((library) => library.folder)).toEqual(built.libraries)
    // Each part as the pack has it, which the element checks against the index before using it.
    for (const { folder, sha256 } of index.libraries) {
      expect(createHash('sha256').update(await zip.bytes(`libraries/${folder}.h5p`)).digest('hex')).toBe(sha256)
    }
    expect(zip.names.filter((name) => name.startsWith('libraries/'))).toHaveLength(built.libraries.length + 1)
    expect(zip.names).toContain('libraries.txt')
    const listed = [...(await zip.text('imsmanifest.xml')).matchAll(/<file href="([^"]+)"\/>/g)].map((match) => match[1])
    expect(listed.sort()).toEqual([...zip.names].sort())
    expect(await zip.text('index.html')).toContain('<h5p-player libraries="pack" pack-base="./libraries/" refresh-libraries="off"></h5p-player>')
    expect(await zip.text('NOTICE.txt')).toContain('listed in libraries.txt')
    await zip.close()
  })

  it('takes a library its own libraries need from the pack, and keeps every one it carries', async () => {
    // Left out of h5p.json as well, so only the walk through each library.json can find it.
    const source = join(dir, 'deep.h5p')
    await changedQuiz(
      source,
      (manifest) => {
        manifest.preloadedDependencies = manifest.preloadedDependencies.filter((dependency: { machineName: string }) => dependency.machineName !== 'H5P.TextUtilities')
      },
      (name) => name.startsWith('H5P.TextUtilities-')
    )
    const built = await buildScorm({ h5p: source, out: join(dir, 'deep.zip') })
    expect(built.libraries).toEqual([expect.stringMatching(/^H5P\.TextUtilities-1\.\d+$/)])
  })

  it('refuses a library neither it nor the pack carries, naming it, before writing anything', async () => {
    const source = join(dir, 'unknown.h5p')
    await changedQuiz(source, (manifest) => {
      manifest.preloadedDependencies.push({ machineName: 'H5P.Nowhere', majorVersion: 1, minorVersion: 0 })
      // Newer than the package's own and the pack's.
      manifest.preloadedDependencies.find((dependency: { machineName: string }) => dependency.machineName === 'H5P.QuestionSet').minorVersion = 99
    })
    const out = join(dir, 'unknown.zip')
    const refused = buildScorm({ h5p: source, out })
    await expect(refused).rejects.toThrow(/neither it nor the library pack carries: H5P\.Nowhere 1\.0, H5P\.QuestionSet 1\.99 \(the pack has 1\.\d+\)\./)
    expect(existsSync(out)).toBe(false)
  })

  it('refuses what is not a package, and a zip already there unless forced', async () => {
    const notZip = join(dir, 'not.h5p')
    await writeFile(notZip, 'not a zip')
    await expect(buildScorm({ h5p: notZip, out: join(dir, 'not.zip') })).rejects.toThrow(/could not be read as a zip archive/)
    await expect(buildScorm({ h5p: join(dir, 'missing.h5p'), out: join(dir, 'x.zip') })).rejects.toThrow(/No such file/)
    const noManifest = join(dir, 'empty.h5p')
    await changedQuiz(noManifest, () => {}, (name) => name === 'h5p.json')
    await expect(buildScorm({ h5p: noManifest, out: join(dir, 'empty.zip') })).rejects.toThrow(/has no h5p\.json/)

    const out = join(dir, 'twice.zip')
    await buildScorm({ h5p: quiz, out })
    await expect(buildScorm({ h5p: quiz, out })).rejects.toThrow(EmbedError)
    await expect(buildScorm({ h5p: quiz, out, force: true })).resolves.toMatchObject({ out })
    await mkdir(join(dir, 'folder.zip'))
    await expect(buildScorm({ h5p: quiz, out: join(dir, 'folder.zip'), force: true })).rejects.toThrow(/is a folder/)
    await expect(buildScorm({ h5p: quiz, out: quiz, force: true })).rejects.toThrow(/is the package itself/)
  })
})

describe('the command', () => {
  const run = promisify(execFile)

  it('names the zip after the package, here, and says what it wrote', async () => {
    const cwd = join(dir, 'cli')
    await mkdir(cwd)
    const { stdout } = await run(process.execPath, [bin, '--scorm', quiz], { cwd })
    expect(stdout).toContain('Wrote quiz.scorm.zip')
    expect(stdout).toContain('"Do you know what just happened?" as a SCORM 1.2 package')
    expect(existsSync(join(cwd, 'quiz.scorm.zip'))).toBe(true)
  })

  it('titles the zip as --title says, in the manifest and the page', async () => {
    const cwd = join(dir, 'cli-title')
    await mkdir(cwd)
    const { stdout } = await run(process.execPath, [bin, '--scorm', quiz, '--title', 'Week 3 & the <quiz>'], { cwd })
    expect(stdout).toContain('"Week 3 & the <quiz>" as a SCORM 1.2 package')
    const zip = await entriesOf(join(cwd, 'quiz.scorm.zip'))
    expect((await zip.text('imsmanifest.xml')).match(/<title>Week 3 &amp; the &lt;quiz&gt;<\/title>/g)).toHaveLength(2)
    expect(await zip.text('index.html')).toContain('<title>Week 3 &amp; the &lt;quiz&gt;</title>')
    await zip.close()
  })

  it('refuses --title without --scorm, which names nothing to title', async () => {
    const failure = await run(process.execPath, [bin, join(dir, 'titled-site'), '--title', 'A site'], { cwd: dir }).catch((error) => error)
    expect(failure.code).toBe(2)
    expect(failure.stderr).toContain('--title only with --scorm')
    expect(existsSync(join(dir, 'titled-site'))).toBe(false)
  })

  it('refuses the site\'s options beside --scorm', async () => {
    const failure = await run(process.execPath, [bin, '--scorm', quiz, '--packages', 'https://cdn.example.org'], { cwd: dir }).catch((error) => error)
    expect(failure.code).toBe(2)
    expect(failure.stderr).toContain('--packages not with --scorm')
  })

  it('refuses --scorm with no package, rather than write a site', async () => {
    const cwd = join(dir, 'cli-empty')
    await mkdir(cwd)
    const failure = await run(process.execPath, [bin, '--scorm=', 'site'], { cwd }).catch((error) => error)
    expect(failure.code).toBe(1)
    expect(failure.stderr).toContain('No package given')
    expect(existsSync(join(cwd, 'site'))).toBe(false)
  })
})

/*
 * In an LMS. The zip is unpacked onto a static host, as an LMS serves a SCORM package, and played
 * from `/lms.html`: a page that puts the API in its window and frames the launch page, as Moodle's
 * player page does, keeping every call and the values between launches.
 */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.h5p': 'application/zip'
}

const LMS_PAGE = `<!doctype html>
<html><body>
<script>
  window.calls = []
  window.values = { 'cmi.core.lesson_status': 'not attempted', 'cmi.core.entry': 'ab-initio', 'cmi.suspend_data': '' }
  const record = (name, answer) => (...args) => {
    window.calls.push([name, ...args])
    return answer(...args)
  }
  // Each commit and the finish, with the event the launch page was dispatching when it called,
  // which is what ILIAS decides by whether to send with a beacon, and the end it would have sent.
  window.sent = []
  const sent = (call) => () => {
    let during = null
    try {
      during = document.getElementById('sco')?.contentWindow?.event?.type ?? null
    } catch {}
    window.sent.push({ call, during, exit: window.values['cmi.core.exit'] ?? null, time: window.values['cmi.core.session_time'] ?? null })
    return 'true'
  }
  window.API = {
    LMSInitialize: record('LMSInitialize', () => 'true'),
    LMSFinish: record('LMSFinish', sent('LMSFinish')),
    // The interactions' count, which SCORM 1.2 lets the content read: one past the highest index
    // written, or, for an LMS whose count does not follow what is written, what it counted at launch.
    LMSGetValue: record('LMSGetValue', (element) => {
      if (element === 'cmi.interactions._count') return String(window.lagging ? window.launchCount : interactionCount())
      return window.values[element] ?? ''
    }),
    // An LMS that refuses the saved state, when a test says so.
    LMSSetValue: record('LMSSetValue', (element, value) => {
      if (window.refuse && element === 'cmi.suspend_data') return 'false'
      window.values[element] = value
      return 'true'
    }),
    LMSCommit: record('LMSCommit', sent('LMSCommit')),
    LMSGetLastError: () => '0',
    LMSGetErrorString: () => '',
    LMSGetDiagnostic: () => ''
  }
  function interactionCount() {
    const indexes = Object.keys(window.values).map((key) => /^cmi\\.interactions\\.(\\d+)\\.id$/.exec(key)).filter(Boolean).map((match) => Number(match[1]))
    return indexes.length ? Math.max(...indexes) + 1 : 0
  }
  // A launch after a suspended session resumes it, as the LMS says with cmi.core.entry.
  window.launch = (path) => {
    window.launchCount = interactionCount()
    window.values['cmi.core.entry'] = window.values['cmi.core.exit'] === 'suspend' ? 'resume' : window.calls.length ? '' : 'ab-initio'
    document.getElementById('sco')?.remove()
    const frame = document.createElement('iframe')
    frame.id = 'sco'
    frame.src = path
    frame.style.cssText = 'width: 100%; height: 700px; border: 0'
    document.body.append(frame)
  }
  window.leave = () => {
    document.getElementById('sco').src = 'about:blank'
  }
</script>
</body></html>`

describe('in an LMS', () => {
  let browser: Browser
  let server: Server
  let origin: string
  /** The libraries the zip of the export without its own carries from the pack. */
  let supplied: string[]
  /** Every path the host was asked for. */
  const served: string[] = []

  beforeAll(async () => {
    const root = join(dir, 'unpacked')
    // The quiz at the host's root, and the export without its libraries in a folder of its own,
    // as an LMS gives each package a path of its own.
    for (const [h5p, folder] of [[quiz, root], [formulas, join(root, 'formulas')]]) {
      const out = join(dir, `${basename(h5p, '.h5p')}.served.zip`)
      const built = await buildScorm({ h5p, out })
      if (h5p === formulas) supplied = built.libraries
      const zip = await entriesOf(out)
      for (const name of zip.names) {
        await mkdir(dirname(join(folder, name)), { recursive: true })
        await writeFile(join(folder, name), await zip.bytes(name))
      }
      await zip.close()
    }
    // The quiz's launch page without the compressor, as the page builder writes it for a page that
    // bundles the launch files and gives none (`scorm-browser.test.ts`).
    const launchPage = await readFile(join(root, 'index.html'), 'utf8')
    expect(launchPage).toContain('<script src="./lz-string.js"></script>')
    await writeFile(join(root, 'plain.html'), launchPage.replace(/\n[ \t]*<script src="\.\/lz-string\.js"><\/script>/, ''))

    server = createServer(async (request, response) => {
      const path = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname)
      served.push(path)
      if (path === '/lms.html') {
        response.writeHead(200, { 'Content-Type': MIME['.html'] }).end(LMS_PAGE)
        return
      }
      const file = join(root, normalize(path).replace(/^(\.\.[/\\])+/, ''))
      try {
        const body = await readFile(file)
        response.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': 'no-store' })
        response.end(body)
      } catch {
        response.writeHead(404).end()
      }
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    browser = await chromium.launch()
  })

  afterAll(async () => {
    await browser?.close()
    await new Promise((done) => server?.close(done))
  })

  /** A frame of the page, once there is one that passes `test`. */
  async function frame(page: Page, test: (frame: Frame) => boolean) {
    const end = Date.now() + 60_000
    for (;;) {
      const found = page.frames().find(test)
      if (found) return found
      if (Date.now() > end) throw new Error(`no such frame among ${page.frames().map((f) => f.url()).join(', ')}`)
      await page.waitForTimeout(100)
    }
  }

  /** Launches the package from the LMS page and waits for the content: the launch page, and the H5P frame in it. */
  async function launch(page: Page, path = '/index.html') {
    const before = new Set(page.frames())
    await page.evaluate((path) => (window as unknown as { launch: (path: string) => void }).launch(path), path)
    const sco = await frame(page, (f) => !before.has(f) && f.url().endsWith(path))
    await sco.waitForFunction(() => (document.querySelector('h5p-player') as { state?: string } | null)?.state === 'ready', null, { timeout: 60_000 })
    return { sco, h5p: await frame(page, (f) => f.parentFrame() === sco && f.url().includes('/h5p/')) }
  }

  const values = (page: Page) => page.evaluate(() => (window as unknown as { values: Record<string, string> }).values)
  const calls = (page: Page) => page.evaluate(() => (window as unknown as { calls: string[][] }).calls)

  async function lmsPage(): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${origin}/lms.html`)
    return { context, page }
  }

  it('reports the score out of 100, the result and the time, and ends the session with the page', async () => {
    const { context, page } = await lmsPage()
    const { h5p } = await launch(page)
    // Six of the nine points: the first three questions right, the fourth checked as it is.
    await h5p.getByRole('button', { name: 'Start' }).click()
    await h5p.getByRole('radio', { name: 'In your browser, straight out of the zip' }).click()
    await h5p.getByRole('button', { name: /^Check/ }).click()
    await h5p.getByRole('button', { name: /^Next/ }).click()
    await h5p.getByRole('radio', { name: 'True' }).click()
    await h5p.getByRole('button', { name: /^Check/ }).click()
    await h5p.getByRole('button', { name: /^Next/ }).click()
    const blanks = h5p.locator('input.h5p-text-input:visible')
    for (const [i, word] of ['stored', 'Range', 'deflated', 'front'].entries()) await blanks.nth(i).fill(word)
    await h5p.getByRole('button', { name: /^Check/ }).click()
    await h5p.getByRole('button', { name: /^Next/ }).click()
    await h5p.getByRole('button', { name: /^Check/ }).click()
    await h5p.getByRole('button', { name: /^Finish/ }).click()

    await page.waitForFunction(() => (window as unknown as { values: Record<string, string> }).values['cmi.core.lesson_status'] === 'passed')
    const kept = await values(page)
    expect(kept).toMatchObject({ 'cmi.core.score.min': '0', 'cmi.core.score.max': '100', 'cmi.core.score.raw': '66.67' })
    expect(kept['cmi.core.session_time']).toMatch(/^\d{2,4}:\d{2}:\d{2}\.\d{2}$/)
    // Each question's answer as an interaction, by index, as Moodle's report reads them: the
    // question's words as the id, since SCORM 1.2 has no description field.
    expect(Object.keys(kept).filter((key) => /^cmi\.interactions\.\d+\.id$/.test(key))).toHaveLength(4)
    expect(kept['cmi.interactions.0.id']).toMatch(/^[a-z0-9-]{3,80}$/)
    expect(kept).toMatchObject({ 'cmi.interactions.0.type': 'choice', 'cmi.interactions.0.result': 'correct', 'cmi.interactions.1.type': 'true-false', 'cmi.interactions.1.result': 'correct', 'cmi.interactions.2.type': 'fill-in', 'cmi.interactions.2.result': 'correct' })
    expect(kept['cmi.interactions.0.student_response']).toBe(kept['cmi.interactions.0.correct_responses.0.pattern'])
    expect(kept['cmi.interactions.0.weighting']).toMatch(/^\d+$/)
    expect(kept['cmi.interactions.0.latency']).toMatch(/^\d{2,4}:\d{2}:\d{2}\.\d{2}$/)
    expect(kept['cmi.interactions.0.time']).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    const made = await calls(page)
    expect(made[0]).toEqual(['LMSInitialize', ''])
    expect(made).toContainEqual(['LMSSetValue', 'cmi.core.lesson_status', 'incomplete'])
    const passedAt = made.findIndex((call) => call[0] === 'LMSSetValue' && call[2] === 'passed')
    expect(made.slice(passedAt).some((call) => call[0] === 'LMSCommit')).toBe(true)

    await page.evaluate(() => (window as unknown as { leave: () => void }).leave())
    await page.waitForFunction(() => (window as unknown as { calls: string[][] }).calls.some((call) => call[0] === 'LMSFinish'))
    expect((await values(page))['cmi.core.exit']).toBe('')
    await context.close()
  })

  it('reports a result below the pass mark as failed, with its score', async () => {
    const { context, page } = await lmsPage()
    const { h5p } = await launch(page)
    // None of the nine points, against a pass mark of half.
    await h5p.getByRole('button', { name: 'Start' }).click()
    await h5p.getByRole('radio', { name: 'On the server that hosts it' }).click()
    await h5p.getByRole('button', { name: /^Check/ }).click()
    await h5p.getByRole('button', { name: /^Next/ }).click()
    await h5p.getByRole('radio', { name: 'False' }).click()
    await h5p.getByRole('button', { name: /^Check/ }).click()
    await h5p.getByRole('button', { name: /^Next/ }).click()
    const blanks = h5p.locator('input.h5p-text-input:visible')
    for (let i = 0; i < 4; i++) await blanks.nth(i).fill('wrong')
    await h5p.getByRole('button', { name: /^Check/ }).click()
    await h5p.getByRole('button', { name: /^Next/ }).click()
    await h5p.getByRole('button', { name: /^Check/ }).click()
    await h5p.getByRole('button', { name: /^Finish/ }).click()

    await page.waitForFunction(() => (window as unknown as { values: Record<string, string> }).values['cmi.core.lesson_status'] === 'failed')
    expect(await values(page)).toMatchObject({ 'cmi.core.score.min': '0', 'cmi.core.score.max': '100', 'cmi.core.score.raw': '0' })
    await context.close()
  })

  /*
   * Two of the bridge's rules that no package here reaches headless: content that finishes with no
   * score, and a state past what SCORM 1.2 keeps. The element's events are dispatched as it
   * dispatches them, each within one call into the page, so no save of the content's own comes
   * between.
   */

  it('records a result without a score as completed, and no score', async () => {
    const { context, page } = await lmsPage()
    const { sco } = await launch(page)
    await sco.evaluate(() => {
      const player = document.querySelector('h5p-player') as HTMLElement
      player.dispatchEvent(new CustomEvent('finished', { detail: { statement: { result: { completion: true } } } }))
    })
    const kept = await values(page)
    expect(kept['cmi.core.lesson_status']).toBe('completed')
    expect(kept['cmi.core.score.raw']).toBeUndefined()
    await context.close()
  })

  /** What `suspend_data` holds before and after the element saves `data`, and whether the page says it could not. */
  const save = (sco: Frame, data: string) =>
    sco.evaluate((data) => {
      const lms = parent as unknown as { values: Record<string, string> }
      const before = lms.values['cmi.suspend_data']
      const player = document.querySelector('h5p-player') as HTMLElement
      player.dispatchEvent(new CustomEvent('userdata', { detail: { dataType: 'state', subContentId: 'large', data } }))
      const saying = document.getElementById('saving') as HTMLElement
      return { before, after: lms.values['cmi.suspend_data'], said: !saying.hidden, text: saying.textContent }
    }, data)

  /** `suspend_data` read back as the bridge reads it: compressed, by the page's own lz-string. */
  const decoded = (sco: Frame, text: string) =>
    sco.evaluate((text) => JSON.parse((window as unknown as { LZString: { decompressFromBase64: (s: string) => string } }).LZString.decompressFromBase64(text)), text)

  it('writes the state compressed, no larger than SCORM 1.2 keeps, and says once when it does not fit', async () => {
    const { context, page } = await lmsPage()
    const warnings: string[] = []
    page.on('console', (message) => { if (message.type() === 'warning') warnings.push(message.text()) })
    const { sco } = await launch(page)
    // Both notices sit in a live region that is on the page from the start, empty, so that what is
    // put into one is announced.
    expect(await sco.evaluate(() => ['saving', 'notice'].map((id) => {
      const region = document.getElementById(id)?.parentElement
      return `${region?.getAttribute('role')} ${region?.closest('[hidden]') === null} ${region?.textContent}`
    }))).toEqual(['status true ', 'alert true '])

    // A state that compresses: four times what SCORM 1.2 keeps, as JSON repeats itself, fits.
    const long = JSON.stringify(Array.from({ length: 400 }, (_, i) => ({ question: i, answers: [0, 2], checked: true })))
    expect(long.length).toBeGreaterThan(4096 * 4)
    const fits = await save(sco, long)
    expect(fits.after).not.toBe(fits.before)
    expect(fits.after).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect(fits.after.length).toBeLessThanOrEqual(4096)
    expect(fits.said).toBe(false)
    expect((await decoded(sco, fits.after)).entries).toContainEqual(['state', 'large', long])

    // One that does not: random text has nothing to compress. The last state that fitted stays,
    // and the page says so, once.
    const random = randomBytes(6000).toString('base64')
    const large = await save(sco, random)
    expect(large.after).toBe(fits.after)
    expect(large.said).toBe(true)
    expect(large.text).toMatch(/may not be saved/)
    expect(warnings.filter((text) => /SCORM 1\.2 keeps 4096/.test(text))).toHaveLength(1)
    const again = await save(sco, `${random}x`)
    expect(again.after).toBe(fits.after)
    expect(warnings.filter((text) => /SCORM 1\.2 keeps 4096/.test(text))).toHaveLength(2)
    expect(await sco.locator('#saving').count()).toBe(1)

    const written = (await calls(page)).filter((call) => call[0] === 'LMSSetValue' && call[1] === 'cmi.suspend_data')
    expect(Math.max(...written.map((call) => call[2].length))).toBeLessThanOrEqual(4096)
    await context.close()
  })

  it('says once when the LMS refuses the state, and keeps playing', async () => {
    const { context, page } = await lmsPage()
    const warnings: string[] = []
    page.on('console', (message) => { if (message.type() === 'warning') warnings.push(message.text()) })
    const { sco } = await launch(page)
    const kept = await save(sco, 'kept')
    expect(kept.said).toBe(false)
    await page.evaluate(() => { (window as unknown as { refuse: boolean }).refuse = true })
    const refused = await save(sco, 'refused')
    expect(refused.after).toBe(kept.after)
    expect(refused.said).toBe(true)
    expect(warnings.filter((text) => /the LMS refused/.test(text))).toHaveLength(1)
    expect(await sco.evaluate(() => (document.querySelector('h5p-player') as { state?: string }).state)).toBe('ready')
    await context.close()
  })

  /** A statement about the part `sub`, as the core writes one, dispatched as the element dispatches it. */
  const answer = (sco: Frame, sub: string, text: string, definition: Record<string, unknown> = {}, result: Record<string, unknown> = {}) =>
    sco.evaluate(({ verb, sub, text, definition, result }) => {
      const statement = {
        verb: { id: verb },
        object: { id: `http://lms.example/package.h5p?subContentId=${sub}`, definition: { description: { 'en-US': text }, interactionType: 'choice', correctResponsesPattern: ['0[,]2'], extensions: { 'http://h5p.org/x-api/h5p-subContentId': sub }, ...definition } },
        result: { response: '0[,]1', success: false, score: { raw: 0, max: 2 }, duration: 'PT12.5S', ...result }
      }
      ;(document.querySelector('h5p-player') as HTMLElement).dispatchEvent(new CustomEvent('xapi', { detail: { statement, verb } }))
    }, { verb: 'http://adlnet.gov/expapi/verbs/answered', sub, text, definition, result })

  /** Ends the session as the page going does, and waits for the LMS to hear this session's finish. */
  const leave = async (page: Page) => {
    const before = await page.evaluate(() => (window as unknown as { calls: string[][] }).calls.length)
    await page.evaluate(() => (window as unknown as { leave: () => void }).leave())
    await page.waitForFunction((before) => (window as unknown as { calls: string[][] }).calls.slice(before).some((call) => call[0] === 'LMSFinish'), before)
  }

  it('writes each answer as an interaction, one index per question, written over when answered again', async () => {
    const { context, page } = await lmsPage()
    const first = await launch(page)

    await answer(first.sco, 'a', 'Which <em>rivers</em> cross Germany?')
    // The question and its id go with the state as it is answered, and are committed: content that
    // keeps no state of its own sends nothing else that would keep them.
    const [wrote, committed] = (await calls(page)).slice(-2)
    expect([wrote[0], wrote[1], committed[0]]).toEqual(['LMSSetValue', 'cmi.suspend_data', 'LMSCommit'])
    expect((await decoded(first.sco, wrote[2])).questions).toEqual([['a', 'which-rivers-cross-germany']])
    // Another question with the same words takes another id.
    await answer(first.sco, 'b', 'Which rivers cross Germany?')
    let kept = await values(page)
    expect(kept).toMatchObject({
      'cmi.interactions.0.id': 'which-rivers-cross-germany',
      'cmi.interactions.0.type': 'choice',
      'cmi.interactions.0.correct_responses.0.pattern': '0[,]2',
      'cmi.interactions.0.student_response': '0[,]1',
      'cmi.interactions.0.result': 'wrong',
      'cmi.interactions.0.weighting': '2',
      'cmi.interactions.0.latency': '00:00:12.50',
      'cmi.interactions.1.id': 'which-rivers-cross-germany-2'
    })
    expect(kept['cmi.interactions.0.time']).toMatch(/^\d{2}:\d{2}:\d{2}$/)

    // Answered again: the same index, the new answer, nothing added.
    await answer(first.sco, 'a', 'Which <em>rivers</em> cross Germany?', {}, { response: '0[,]2', success: true, score: { raw: 2, max: 2 } })
    kept = await values(page)
    expect(kept).toMatchObject({ 'cmi.interactions.0.student_response': '0[,]2', 'cmi.interactions.0.result': 'correct' })
    expect(kept['cmi.interactions.2.id']).toBeUndefined()

    // An Essay's long answer, as `fill-in`, cut to what 1.2 keeps; a type 1.2 has not, left out;
    // a question with no words, named by its id; a result that says nothing, neutral; one that
    // says nothing but scores, as Fill in the Blanks does, by its marks.
    await answer(first.sco, 'c', '', { interactionType: 'long-fill-in', correctResponsesPattern: [] }, { response: 'x'.repeat(300), success: undefined, score: undefined, duration: undefined })
    await answer(first.sco, 'd', 'Other', { interactionType: 'other' }, { success: undefined, score: { raw: 1, max: 2 } })
    kept = await values(page)
    expect(kept).toMatchObject({ 'cmi.interactions.2.id': 'c', 'cmi.interactions.2.type': 'fill-in', 'cmi.interactions.2.result': 'neutral', 'cmi.interactions.3.id': 'other', 'cmi.interactions.3.result': '1' })
    expect(kept['cmi.interactions.2.student_response']).toHaveLength(255)
    expect(kept['cmi.interactions.2.correct_responses.0.pattern']).toBeUndefined()
    expect(kept['cmi.interactions.2.latency']).toBeUndefined()
    expect(kept['cmi.interactions.3.type']).toBeUndefined()

    // The questions go with the state, with no save of the content's, so the next session of the
    // attempt keeps their indexes and their ids.
    expect((await decoded(first.sco, (await values(page))['cmi.suspend_data'])).questions).toEqual([
      ['a', 'which-rivers-cross-germany'],
      ['b', 'which-rivers-cross-germany-2'],
      ['c', 'c'],
      ['d', 'other']
    ])
    await leave(page)
    const second = await launch(page)
    // The second of two questions with the same words, answered first this time, keeps its own id.
    await answer(second.sco, 'b', 'Which rivers cross Germany?', {}, { response: '2' })
    await answer(second.sco, 'e', 'A new one')
    kept = await values(page)
    expect(kept).toMatchObject({ 'cmi.interactions.1.id': 'which-rivers-cross-germany-2', 'cmi.interactions.1.student_response': '2', 'cmi.interactions.4.id': 'a-new-one' })
    expect(kept['cmi.interactions.5.id']).toBeUndefined()

    // An attempt the LMS started over, which it does at a launch, its interactions gone: they start
    // again from the first index.
    await leave(page)
    await page.evaluate(() => {
      const lms = window as unknown as { values: Record<string, string> }
      for (const key of Object.keys(lms.values)) if (key.startsWith('cmi.interactions.')) delete lms.values[key]
    })
    const third = await launch(page)
    await answer(third.sco, 'e', 'A new one', {}, { response: '1' })
    kept = await values(page)
    expect(kept).toMatchObject({ 'cmi.interactions.0.id': 'a-new-one', 'cmi.interactions.0.student_response': '1' })
    expect(kept['cmi.interactions.1.id']).toBeUndefined()
    await context.close()
  })

  it('keeps one index per question where the LMS counts only what it loaded at launch', async () => {
    // An LMS whose count does not follow what is written in the session (#130): the bridge reads it
    // once, at launch, and keeps its own record from there.
    const { context, page } = await lmsPage()
    await page.evaluate(() => { (window as unknown as { lagging: boolean }).lagging = true })
    const first = await launch(page)
    for (const sub of ['a', 'b', 'c']) await answer(first.sco, sub, `Question ${sub}`)
    let kept = await values(page)
    expect([0, 1, 2].map((index) => kept[`cmi.interactions.${index}.id`])).toEqual(['question-a', 'question-b', 'question-c'])

    // The next session of the attempt: the count it loaded, and new questions after it.
    await leave(page)
    const second = await launch(page)
    await answer(second.sco, 'b', 'Question b', {}, { response: '2' })
    for (const sub of ['d', 'e']) await answer(second.sco, sub, `Question ${sub}`)
    kept = await values(page)
    expect(kept).toMatchObject({ 'cmi.interactions.1.student_response': '2', 'cmi.interactions.3.id': 'question-d', 'cmi.interactions.4.id': 'question-e' })
    await context.close()
  })

  it('plays an export without its libraries from the parts in the zip, and only those', async () => {
    const { context, page } = await lmsPage()
    served.length = 0
    const { h5p } = await launch(page, '/formulas/index.html')
    // The element planned from the zip's index what the writer did, and asked for nothing else.
    const asked = new Set(served.filter((path) => path.startsWith('/formulas/libraries/') && path.endsWith('.h5p')).map((path) => basename(path, '.h5p')))
    expect([...asked].sort()).toEqual(supplied)
    // MathDisplay among them, so the LaTeX in the first question is typeset.
    await h5p.getByRole('button', { name: 'Start' }).click()
    await h5p.locator('mjx-container').first().waitFor({ state: 'attached', timeout: 30_000 })
    await context.close()
  })

  it('keeps the learner\'s place in suspend_data, and the next launch resumes there', async () => {
    const { context, page } = await lmsPage()
    const first = await launch(page)
    await first.h5p.getByRole('button', { name: 'Start' }).click()
    await first.h5p.getByRole('radio', { name: 'In your browser, straight out of the zip' }).click()
    await first.h5p.getByRole('button', { name: /^Check/ }).click()
    await first.h5p.getByRole('button', { name: /^Next/ }).click()
    // H5P saves three seconds after a `progressed` statement; the answer wrote the state before
    // that, with the question and none of the content's.
    await first.sco.waitForFunction(() => {
      const text = (parent as unknown as { values: Record<string, string> }).values['cmi.suspend_data']
      const json = text && (window as unknown as { LZString: { decompressFromBase64: (s: string) => string | null } }).LZString.decompressFromBase64(text)
      return Boolean(json && JSON.parse(json).entries.length > 0)
    }, null, { timeout: 30_000 })
    const kept = await decoded(first.sco, (await values(page))['cmi.suspend_data'])
    expect(kept.build).toMatch(/^[0-9a-f]{16}$/)
    expect(kept.entries.length).toBeGreaterThan(0)
    // The first question's answer, as an interaction.
    expect((await values(page))['cmi.interactions.0.result']).toBe('correct')

    await page.evaluate(() => (window as unknown as { leave: () => void }).leave())
    await page.waitForFunction(() => (window as unknown as { calls: string[][] }).calls.some((call) => call[0] === 'LMSFinish'))
    expect((await values(page))['cmi.core.exit']).toBe('suspend')

    const second = await launch(page)
    expect(await second.sco.evaluate(() => (document.querySelector('h5p-player') as { userData?: unknown[] }).userData?.length)).toBe(kept.entries.length)
    // The second question, where the first session left it.
    await second.h5p.getByRole('radio', { name: 'True' }).waitFor({ state: 'visible', timeout: 10_000 })
    await context.close()
  })

  it('commits the session\'s time and end while the page goes, and finishes the session once it has gone', async () => {
    type Sent = { call: string; during: string | null; exit: string | null; time: string | null }
    const sent = (page: Page) => page.evaluate(() => (window as unknown as { sent: Sent[] }).sent)
    const timespan = expect.stringMatching(/^\d{2,4}:\d{2}:\d{2}\.\d{2}$/)
    const { context, page } = await lmsPage()
    const { sco } = await launch(page)

    // A leave the learner thinks better of: the session is committed as suspended, and goes on.
    let before = (await sent(page)).length
    await sco.evaluate(() => dispatchEvent(new Event('beforeunload')))
    expect((await sent(page)).slice(before)).toEqual([{ call: 'LMSCommit', during: 'beforeunload', exit: 'suspend', time: timespan }])
    expect((await calls(page)).some((call) => call[0] === 'LMSFinish')).toBe(false)
    await sco.evaluate(() => {
      const player = document.querySelector('h5p-player') as HTMLElement
      player.dispatchEvent(new CustomEvent('finished', { detail: { statement: { result: { completion: true } } } }))
    })
    expect((await values(page))['cmi.core.lesson_status']).toBe('completed')

    // The leave for good: the end is committed during `beforeunload`, when ILIAS sends it with a
    // beacon, and the session finished on `pagehide`, last.
    before = (await sent(page)).length
    await page.evaluate(() => (window as unknown as { leave: () => void }).leave())
    await page.waitForFunction(() => (window as unknown as { calls: string[][] }).calls.some((call) => call[0] === 'LMSFinish'))
    const leaving = (await sent(page)).slice(before)
    const committed = leaving.findIndex((entry) => entry.during === 'beforeunload')
    expect(leaving[committed]).toEqual({ call: 'LMSCommit', during: 'beforeunload', exit: '', time: timespan })
    expect(leaving.at(-1)).toEqual({ call: 'LMSFinish', during: 'pagehide', exit: '', time: timespan })
    expect(committed).toBeLessThan(leaving.length - 1)
    expect(leaving.filter((entry) => entry.call === 'LMSFinish')).toHaveLength(1)
    await context.close()
  })

  it('starts over rather than hand the content state another package saved', async () => {
    const { context, page } = await lmsPage()
    await page.evaluate(() => {
      const lms = window as unknown as { values: Record<string, string> }
      lms.values['cmi.core.exit'] = 'suspend'
      lms.values['cmi.suspend_data'] = JSON.stringify({ build: '0000000000000000', entries: [['state', '0', '{"progress":1}']] })
    })
    const { sco, h5p } = await launch(page)
    expect(await sco.evaluate(() => (document.querySelector('h5p-player') as { userData?: unknown[] }).userData?.length)).toBe(0)
    await h5p.getByRole('button', { name: 'Start' }).waitFor({ state: 'visible', timeout: 10_000 })
    await context.close()
  })

  it('reads a state a zip from before wrote plain, so a learner keeps their place across the upgrade', async () => {
    const { context, page } = await lmsPage()
    const build = createHash('sha256').update(await readFile(quiz)).digest('hex').slice(0, 16)
    await page.evaluate((build) => {
      const lms = window as unknown as { values: Record<string, string> }
      lms.values['cmi.core.exit'] = 'suspend'
      lms.values['cmi.suspend_data'] = JSON.stringify({ build, entries: [['state', 'kept', '{"progress":1}']] })
    }, build)
    const { sco } = await launch(page)
    expect(await sco.evaluate(() => (document.querySelector('h5p-player') as { userData?: unknown[] }).userData)).toEqual([{ dataType: 'state', subContentId: 'kept', data: '{"progress":1}' }])
    await context.close()
  })

  it('writes the state plain where the launch page has no compressor', async () => {
    const { context, page } = await lmsPage()
    const { sco } = await launch(page, '/plain.html')
    expect(await sco.evaluate(() => 'LZString' in window)).toBe(false)
    const kept = await save(sco, 'kept')
    expect(kept.said).toBe(false)
    expect(JSON.parse(kept.after).entries).toContainEqual(['state', 'large', 'kept'])
    await context.close()
  })

  it('plays with no LMS around it, and reports nothing', async () => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${origin}/index.html`)
    await page.waitForFunction(() => (document.querySelector('h5p-player') as { state?: string } | null)?.state === 'ready', null, { timeout: 60_000 })
    expect(await page.locator('#notice').isHidden()).toBe(true)
    expect(await page.locator('h5p-player').getAttribute('resume')).toBeNull()
    await context.close()
  })
})
