import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BlobReader, BlobWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from '@zip.js/zip.js'
import type { H5PPlayerElement } from '@missing-elements/h5p-offline-player'
import type { Browser } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { byteRange, previewPackage } from '../lib/preview.mjs'
import { launch } from '../lib/verify.mjs'

/**
 * `--preview` end to end: its server answers for the package as a static host with `Range` does,
 * a real browser plays the package from it by range, and it ends once its last tab has gone.
 */

const content = resolve(import.meta.dirname, '../../../apps/demo/demo/content')
const quiz = join(content, 'quiz.h5p')
const video = join(content, 'video.h5p')
const bin = resolve(import.meta.dirname, '../bin/h5p-verify.mjs')
/** A stored video that nothing plays, large enough that reading it whole would show. */
const UNWATCHED = 'content/videos/unwatched.mp4'
const UNWATCHED_SIZE = 32 * 1024 * 1024
let dir: string
let browser: Browser

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'h5p-preview-'))
  browser = await launch(undefined)
})
afterAll(async () => {
  await browser?.close()
  await rm(dir, { recursive: true, force: true })
})

/** The demo's video package with the unwatched video beside its own; stored entries stay stored. */
async function withUnwatchedVideo(): Promise<string> {
  const reader = new ZipReader(new BlobReader(new Blob([await readFile(video)])))
  const writer = new ZipWriter(new BlobWriter('application/zip'))
  for (const entry of await reader.getEntries()) {
    if (entry.directory) continue
    const bytes = await entry.getData!(new Uint8ArrayWriter())
    await writer.add(entry.filename, new Uint8ArrayReader(bytes), { level: entry.compressionMethod === 0 ? 0 : 6 })
  }
  await reader.close()
  await writer.add(UNWATCHED, new Uint8ArrayReader(new Uint8Array(UNWATCHED_SIZE)), { level: 0 })
  const path = join(dir, 'unwatched.h5p')
  await writeFile(path, new Uint8Array(await (await writer.close()).arrayBuffer()))
  return path
}

/** The command's exit code and what it wrote to stderr. */
function run(...args: string[]): Promise<{ code: number | null, stderr: string }> {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [bin, ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.setEncoding('utf8').on('data', (text: string) => (stderr += text))
    child.once('exit', (code) => resolveRun({ code, stderr }))
  })
}

describe('byteRange', () => {
  it('reads one range as a static host does', () => {
    expect(byteRange('bytes=0-0', 100)).toEqual({ start: 0, end: 0 })
    expect(byteRange('bytes=10-', 100)).toEqual({ start: 10, end: 99 })
    expect(byteRange('bytes=90-200', 100)).toEqual({ start: 90, end: 99 })
    expect(byteRange('bytes=-22', 100)).toEqual({ start: 78, end: 99 })
    expect(byteRange('bytes=-200', 100)).toEqual({ start: 0, end: 99 })
    // Starting past the end, an open one included, or asking for no bytes at all: a 416.
    expect(byteRange('bytes=100-', 100)).toBe(false)
    expect(byteRange('bytes=5000-', 100)).toBe(false)
    expect(byteRange('bytes=-0', 100)).toBe(false)
    expect(byteRange('bytes=0-0', 0)).toBe(false)
    // None, one that does not parse, a last byte before the first, several: the whole file.
    expect(byteRange(null, 100)).toBeNull()
    expect(byteRange('bytes=-', 100)).toBeNull()
    expect(byteRange('items=0-1', 100)).toBeNull()
    expect(byteRange('bytes=5-3', 100)).toBeNull()
    expect(byteRange('bytes=0-1,5-6', 100)).toBeNull()
  })
})

describe('h5p-verify --preview', () => {
  it('answers for the package as a static host with Range does', async () => {
    const bytes = await readFile(quiz)
    const preview = await previewPackage({ file: quiz, port: 0 })
    try {
      const archive = `${preview.url}/__package/quiz.h5p`
      expect(await (await fetch(`${preview.url}/`)).text()).toContain('"src":"/__package/quiz.h5p"')
      // What the element's probe asks first.
      const first = await fetch(archive, { headers: { Range: 'bytes=0-0' } })
      expect(first.status).toBe(206)
      expect(first.headers.get('content-range')).toBe(`bytes 0-0/${bytes.length}`)
      expect(first.headers.get('etag')).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/)
      expect(Buffer.from(await first.arrayBuffer())).toEqual(bytes.subarray(0, 1))
      const tail = await fetch(archive, { headers: { Range: 'bytes=-22' } })
      expect(Buffer.from(await tail.arrayBuffer())).toEqual(bytes.subarray(bytes.length - 22))
      const whole = await fetch(archive)
      expect(whole.status).toBe(200)
      expect(Buffer.from(await whole.arrayBuffer())).toEqual(bytes)
      const past = await fetch(archive, { headers: { Range: `bytes=${bytes.length}-` } })
      expect(past.status).toBe(416)
      expect(past.headers.get('content-range')).toBe(`bytes */${bytes.length}`)
      expect((await fetch(`${preview.url}/__package/other.h5p`)).status).toBe(404)
    } finally {
      preview.close()
    }
    expect(await preview.closed).toBe('stopped')
  })

  it('plays the package in a browser by range, reads no video nobody asked for, and ends with its tab', async () => {
    const file = await withUnwatchedVideo()
    const answers: { range: string | null, bytes: number }[] = []
    const preview = await previewPackage({ file, port: 0, closeGrace: 200, onArchiveRequest: (answer) => answers.push(answer) })
    const page = await browser.newPage()
    await page.goto(`${preview.url}/`)
    await page.waitForFunction(() => document.querySelector<H5PPlayerElement>('h5p-player')?.state === 'ready', null, { timeout: 60_000 })
    // Read as a site that honours Range is: in pieces, not downloaded whole first.
    expect(await page.evaluate(() => document.querySelector<H5PPlayerElement>('h5p-player')?.source?.type)).toBe('range-http')
    const frame = page.frames().find((candidate) => candidate.url().includes('/h5p/frame/'))
    expect(frame).toBeDefined()
    expect(await frame!.evaluate(() => document.querySelector('#h5p-root')?.querySelectorAll('*').length ?? 0)).toBeGreaterThan(0)
    // A range of the large video, asked for as a media element asks: answered, and read alone.
    const asked = await frame!.evaluate(async (path) => {
      const config = JSON.parse(document.getElementById('h5p-boot-config')?.textContent ?? 'null')
      const response = await fetch(`${config.h5pJsonPath}/${path}`, { headers: { Range: 'bytes=1000000-1000999' } })
      return { status: response.status, length: (await response.arrayBuffer()).byteLength }
    }, UNWATCHED)
    expect(asked).toEqual({ status: 206, length: 1000 })
    expect(answers.length).toBeGreaterThan(0)
    expect(answers.filter((answer) => answer.range === null)).toEqual([])
    expect(answers.reduce((sum, answer) => sum + answer.bytes, 0)).toBeLessThan(UNWATCHED_SIZE / 4)

    await page.close()
    expect(await preview.closed).toBe('closed')
  }, 90_000)

  it('ends by itself when no tab opens it in time', async () => {
    const preview = await previewPackage({ file: quiz, port: 0, openWait: 100 })
    expect(await preview.closed).toBe('unopened')
  })

  it('prints its address with --no-open, and ends with exit code 0 on Ctrl+C', async () => {
    const child = spawn(process.execPath, [bin, quiz, '--preview', '--no-open'], { stdio: ['ignore', 'pipe', 'inherit'] })
    try {
      let output = ''
      child.stdout.setEncoding('utf8').on('data', (text: string) => (output += text))
      // The last line it writes before it waits; the lines above it can arrive in chunks of their own.
      await new Promise<void>((resolveStarted, reject) => {
        child.stdout.on('data', () => output.includes('Ctrl+C') && resolveStarted())
        child.once('exit', () => reject(new Error(`ended before it started: ${output}`)))
      })
      expect(output).toContain('Open that address in a browser.')
      const address = /at (http:\/\/127\.0\.0\.1:\d+\/)$/m.exec(output)?.[1]
      expect(address).toBeDefined()
      expect((await fetch(address!)).status).toBe(200)
      child.kill('SIGINT')
      // `close` rather than `exit`: its last line is read by then.
      const [code] = await once(child, 'close')
      expect(code).toBe(0)
      expect(output).toContain('The preview ended.')
    } finally {
      if (child.exitCode === null) child.kill()
    }
  }, 30_000)

  it("refuses the check's own options, and --no-open without --preview", async () => {
    expect(await run(quiz, '--preview', '--json', '--out', dir)).toEqual({ code: 2, stderr: '--preview does not take --out, --json\n' })
    expect(await run(quiz, '--no-open')).toEqual({ code: 2, stderr: '--no-open goes with --preview\n' })
    expect((await run(join(dir, 'missing.h5p'), '--preview', '--no-open')).code).toBe(2)
  })
})
