import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, normalize, resolve } from 'node:path'
import { promisify } from 'node:util'
import { BlobReader, BlobWriter, TextWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from '@zip.js/zip.js'
import { chromium, type Browser, type BrowserContext, type Frame, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EmbedError } from '../lib/build.mjs'
import { buildScorm, servingFolder } from '../lib/scorm.mjs'

/**
 * The SCORM package `--scorm` writes: what is in the zip and what is refused, in Node; and in
 * Chromium, the launch page framed by a stand-in for an LMS's player page, which puts the SCORM
 * 1.2 API in its window and keeps the values, as Moodle's does, across launches.
 */

const quiz = resolve(import.meta.dirname, '../../../apps/demo/demo/content/quiz.h5p')
const formulas = resolve(import.meta.dirname, '../../../apps/demo/demo/content/formulas.h5p')
const bin = resolve(import.meta.dirname, '../bin/h5p-embed.mjs')
let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'h5p-embed-scorm-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** A zip's entries, by name, with a way to read each as text. */
async function entriesOf(path: string) {
  const reader = new ZipReader(new BlobReader(new Blob([await readFile(path)])))
  const entries = await reader.getEntries()
  const file = (name: string) => {
    const entry = entries.find((candidate) => candidate.filename === name)
    if (!entry || entry.directory) throw new Error(`${name} is not in ${path}`)
    return entry
  }
  const text = async (name: string) => file(name).getData!(new TextWriter())
  const bytes = async (name: string) => file(name).getData!(new Uint8ArrayWriter())
  return { names: entries.filter((entry) => !entry.directory).map((entry) => entry.filename), text, bytes, close: () => reader.close() }
}

/** The quiz, changed: its `h5p.json` edited, and the entries `drop` names left out. */
async function changedQuiz(path: string, edit: (manifest: Record<string, any>) => void, drop: (name: string) => boolean = () => false) {
  const reader = new ZipReader(new BlobReader(new Blob([await readFile(quiz)])))
  const writer = new ZipWriter(new BlobWriter('application/zip'))
  for (const entry of await reader.getEntries()) {
    if (entry.directory || drop(entry.filename)) continue
    let bytes = await entry.getData!(new Uint8ArrayWriter())
    if (entry.filename === 'h5p.json') {
      const manifest = JSON.parse(new TextDecoder().decode(bytes))
      edit(manifest)
      bytes = new TextEncoder().encode(JSON.stringify(manifest))
    }
    await writer.add(entry.filename, new Uint8ArrayReader(bytes))
  }
  await reader.close()
  await writeFile(path, new Uint8Array(await (await writer.close()).arrayBuffer()))
}

describe('the package', () => {
  it('carries the launch page, the player, the runtime and the package, every file in the manifest', async () => {
    const out = join(dir, 'quiz.zip')
    const built = await buildScorm({ h5p: quiz, out })
    const build = createHash('sha256').update(await readFile(quiz)).digest('hex').slice(0, 16)
    // It carries its libraries, so nothing of the pack comes with it.
    expect(built).toMatchObject({ out, title: 'Do you know what just happened?', libraries: [], build })

    const zip = await entriesOf(out)
    for (const name of ['imsmanifest.xml', 'index.html', 'scorm.js', 'embed.css', 'h5p-player.js', 'h5p-sw.js', 'h5p-jobs.js', 'package.h5p', 'NOTICE.txt']) {
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
    // Java's ZipInputStream, which SCORM Cloud imports with, reads the local headers and refuses
    // a stored entry whose sizes follow its data in a descriptor (#92).
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
      expect(header.readUInt32LE(14), entry.filename).toBe(entry.crc32)
      expect(header.readUInt32LE(18), entry.filename).toBe(entry.compressedSize)
      expect(header.readUInt32LE(22), entry.filename).toBe(entry.uncompressedSize)
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

  it('takes a newer minor of the same major, and only that, as the player serves libraries', () => {
    const names = new Set(['H5P.Text-1.3/library.json', 'H5P.Text-1.5/library.json', 'H5P.Text-2.0/library.json', 'Bare/library.json'])
    expect(servingFolder({ machineName: 'H5P.Text', major: 1, minor: 1 }, names)).toBe('H5P.Text-1.3')
    expect(servingFolder({ machineName: 'H5P.Text', major: 1, minor: 4 }, names)).toBe('H5P.Text-1.5')
    expect(servingFolder({ machineName: 'H5P.Text', major: 1, minor: 6 }, names)).toBeUndefined()
    expect(servingFolder({ machineName: 'Bare', major: 3, minor: 0 }, names)).toBe('Bare')
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
  window.API = {
    LMSInitialize: record('LMSInitialize', () => 'true'),
    LMSFinish: record('LMSFinish', () => 'true'),
    LMSGetValue: record('LMSGetValue', (element) => window.values[element] ?? ''),
    LMSSetValue: record('LMSSetValue', (element, value) => {
      window.values[element] = value
      return 'true'
    }),
    LMSCommit: record('LMSCommit', () => 'true'),
    LMSGetLastError: () => '0',
    LMSGetErrorString: () => '',
    LMSGetDiagnostic: () => ''
  }
  // A launch after a suspended session resumes it, as the LMS says with cmi.core.entry.
  window.launch = (path) => {
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

  it('writes no state larger than SCORM 1.2 keeps, and keeps the last that fitted', async () => {
    const { context, page } = await lmsPage()
    const { sco } = await launch(page)
    /** What `suspend_data` holds before and after the element saves `data`. */
    const save = (data: string) =>
      sco.evaluate((data) => {
        const lms = parent as unknown as { values: Record<string, string> }
        const before = lms.values['cmi.suspend_data']
        const player = document.querySelector('h5p-player') as HTMLElement
        player.dispatchEvent(new CustomEvent('userdata', { detail: { dataType: 'state', subContentId: 'large', data } }))
        return { before, after: lms.values['cmi.suspend_data'] }
      }, data)

    const large = await save('x'.repeat(5000))
    expect(large.after).toBe(large.before)
    const small = await save('small')
    expect(JSON.parse(small.after).entries).toContainEqual(['state', 'large', 'small'])
    const written = (await calls(page)).filter((call) => call[0] === 'LMSSetValue' && call[1] === 'cmi.suspend_data')
    expect(Math.max(...written.map((call) => call[2].length))).toBeLessThanOrEqual(4096)
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
    // H5P saves three seconds after a `progressed` statement.
    await page.waitForFunction(() => (window as unknown as { values: Record<string, string> }).values['cmi.suspend_data'] !== '', null, { timeout: 30_000 })
    const kept = JSON.parse((await values(page))['cmi.suspend_data'])
    expect(kept.build).toMatch(/^[0-9a-f]{16}$/)
    expect(kept.entries.length).toBeGreaterThan(0)

    await page.evaluate(() => (window as unknown as { leave: () => void }).leave())
    await page.waitForFunction(() => (window as unknown as { calls: string[][] }).calls.some((call) => call[0] === 'LMSFinish'))
    expect((await values(page))['cmi.core.exit']).toBe('suspend')

    const second = await launch(page)
    expect(await second.sco.evaluate(() => (document.querySelector('h5p-player') as { userData?: unknown[] }).userData?.length)).toBe(kept.entries.length)
    // The second question, where the first session left it.
    await second.h5p.getByRole('radio', { name: 'True' }).waitFor({ state: 'visible', timeout: 10_000 })
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
