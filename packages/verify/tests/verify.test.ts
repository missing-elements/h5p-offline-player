import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BlobReader, BlobWriter, TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from '@zip.js/zip.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { summarize, verifyPackage } from '../lib/verify.mjs'

/**
 * The real thing end to end: a browser, the player's Service Worker, the demo's committed
 * content. Each case launches a browser, so the timeouts are generous.
 */

const content = resolve(import.meta.dirname, '../../../apps/demo/demo/content')
const quiz = join(content, 'quiz.h5p')
let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'h5p-verify-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** The quiz as h5p.com would export it: `h5p.json` and `content/`, no library folders. */
async function strippedQuiz(): Promise<string> {
  const reader = new ZipReader(new BlobReader(new Blob([await readFile(quiz)])))
  const writer = new ZipWriter(new BlobWriter('application/zip'))
  for (const entry of await reader.getEntries()) {
    if (entry.directory || !(entry.filename === 'h5p.json' || entry.filename.startsWith('content/'))) continue
    await writer.add(entry.filename, new Uint8ArrayReader(await entry.getData!(new Uint8ArrayWriter())))
  }
  await reader.close()
  const path = join(dir, 'stripped.h5p')
  await writeFile(path, new Uint8Array(await (await writer.close()).arrayBuffer()))
  return path
}

/** The quiz plus a dependency whose script throws as it loads: the content still comes up. */
async function quizWithBrokenLibrary(): Promise<string> {
  const reader = new ZipReader(new BlobReader(new Blob([await readFile(quiz)])))
  const writer = new ZipWriter(new BlobWriter('application/zip'))
  for (const entry of await reader.getEntries()) {
    if (entry.directory) continue
    const bytes = await entry.getData!(new Uint8ArrayWriter())
    if (entry.filename !== 'h5p.json') {
      await writer.add(entry.filename, new Uint8ArrayReader(bytes))
      continue
    }
    const info = JSON.parse(new TextDecoder().decode(bytes))
    info.preloadedDependencies.push({ machineName: 'H5P.Broken', majorVersion: 1, minorVersion: 0 })
    await writer.add('h5p.json', new TextReader(JSON.stringify(info)))
  }
  await reader.close()
  await writer.add(
    'H5P.Broken-1.0/library.json',
    new TextReader(JSON.stringify({ machineName: 'H5P.Broken', majorVersion: 1, minorVersion: 0, patchVersion: 0, runnable: 0, preloadedJs: [{ path: 'broken.js' }] }))
  )
  await writer.add('H5P.Broken-1.0/broken.js', new TextReader("throw new ReferenceError('H5PEditor is not defined')\n"))
  const path = join(dir, 'broken-library.h5p')
  await writeFile(path, new Uint8Array(await (await writer.close()).arrayBuffer()))
  return path
}

describe('h5p-verify', () => {
  it('fails a package whose library throws while booting, even though the content comes up', async () => {
    const report = await verifyPackage({ file: await quizWithBrokenLibrary(), out: join(dir, 'broken') })

    expect(report.state).toBe('ready')
    expect(report.rendered?.elements).toBeGreaterThan(0)
    expect(report.verdict).toBe('fail')
    expect(report.reasons).toEqual(['1 uncaught error while booting: Uncaught ReferenceError: H5PEditor is not defined'])
    expect(report.screenshot).not.toBeNull()
  }, 120_000)

  it('passes a complete package, with its revision and a screenshot', async () => {
    const out = join(dir, 'quiz')
    const report = await verifyPackage({ file: quiz, out })

    expect(report.verdict).toBe('pass')
    expect(report.reasons).toEqual([])
    expect(report.state).toBe('ready')
    expect(report.readyMs).toBeGreaterThan(0)
    expect(report.revision).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(report.rendered?.elements).toBeGreaterThan(0)
    expect(report.rendered?.height).toBeGreaterThan(0)
    expect(report.errors).toEqual([])
    expect(report.csp).toEqual([])
    expect(report.failedRequests).toEqual([])
    expect(existsSync(join(out, 'report.json'))).toBe(true)
    expect(report.screenshot).toBe(join(out, 'screenshot.png'))
    expect(existsSync(report.screenshot!)).toBe(true)
    expect(summarize(report)).toMatch(/^pass {2}quiz\.h5p {2}ready in \d+\.\d\d s {2}revision sha256:/)
  }, 120_000)

  it('fails a package without its libraries, naming them', async () => {
    const report = await verifyPackage({ file: await strippedQuiz(), out: join(dir, 'stripped') })

    expect(report.verdict).toBe('fail')
    expect(report.state).toBe('error')
    expect(report.errors[0]?.code).toBe('bad-archive')
    // Any minor: the demo's quiz moves with the hub's catalogue whenever its content is rebuilt.
    expect(report.errors[0]?.missingLibraries?.folders).toContainEqual(expect.stringMatching(/^H5P\.QuestionSet-1\.\d+$/))
    expect(report.reasons[0]).toMatch(/^bad-archive: /)
    expect(report.screenshot).toBeNull()
    expect(summarize(report)).toContain('--libraries pack')
  }, 120_000)

  it('fails a file that is not an archive', async () => {
    const path = join(dir, 'not-a-zip.h5p')
    await writeFile(path, 'this is not a zip file')
    const report = await verifyPackage({ file: path })

    expect(report.verdict).toBe('fail')
    expect(report.errors[0]?.code).toBe('bad-archive')
  }, 120_000)

  it('refuses a file that does not exist', async () => {
    await expect(verifyPackage({ file: join(dir, 'missing.h5p') })).rejects.toThrow(/No such file/)
  })
})
