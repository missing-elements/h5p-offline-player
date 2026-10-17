import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BlobReader, BlobWriter, type Entry, TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from '@zip.js/zip.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { contentChanges, summarize, verifyPackage } from '../lib/verify.mjs'

/**
 * The real thing end to end: a browser, the player's Service Worker, the demo's committed
 * content. Each case launches a browser, so the timeouts are generous.
 */

const content = resolve(import.meta.dirname, '../../../apps/demo/demo/content')
const quiz = join(content, 'quiz.h5p')
/** The workspace's library pack, served by the verifier itself, so the untrusted cases need no network. */
const pack = resolve(import.meta.dirname, '../../libraries/libraries.h5p')
let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'h5p-verify-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

/**
 * The quiz written again as `name` under `dir`, each file entry through `each`, which writes what
 * it keeps, as it is or changed; `then` adds what else the archive should carry.
 */
async function rewrittenQuiz(
  name: string,
  each: (entry: Entry, bytes: Uint8Array, writer: ZipWriter<Blob>) => Promise<void>,
  then: (writer: ZipWriter<Blob>) => Promise<void> = async () => {}
): Promise<string> {
  const reader = new ZipReader(new BlobReader(new Blob([await readFile(quiz)])))
  const writer = new ZipWriter(new BlobWriter('application/zip'))
  for (const entry of await reader.getEntries()) {
    if (entry.directory) continue
    await each(entry, await entry.getData!(new Uint8ArrayWriter()), writer)
  }
  await reader.close()
  await then(writer)
  const path = join(dir, name)
  await writeFile(path, new Uint8Array(await (await writer.close()).arrayBuffer()))
  return path
}

/** The quiz as h5p.com would export it: `h5p.json` and `content/`, no library folders. */
const strippedQuiz = () =>
  rewrittenQuiz('stripped.h5p', async (entry, bytes, writer) => {
    if (entry.filename === 'h5p.json' || entry.filename.startsWith('content/')) await writer.add(entry.filename, new Uint8ArrayReader(bytes))
  })

/** The quiz plus a dependency whose script throws as it loads: the content still comes up. */
const quizWithBrokenLibrary = () =>
  rewrittenQuiz(
    'broken-library.h5p',
    async (entry, bytes, writer) => {
      if (entry.filename !== 'h5p.json') return void (await writer.add(entry.filename, new Uint8ArrayReader(bytes)))
      const info = JSON.parse(new TextDecoder().decode(bytes))
      info.preloadedDependencies.push({ machineName: 'H5P.Broken', majorVersion: 1, minorVersion: 0 })
      await writer.add('h5p.json', new TextReader(JSON.stringify(info)))
    },
    async (writer) => {
  await writer.add(
    'H5P.Broken-1.0/library.json',
    new TextReader(JSON.stringify({ machineName: 'H5P.Broken', majorVersion: 1, minorVersion: 0, patchVersion: 0, runnable: 0, preloadedJs: [{ path: 'broken.js' }] }))
  )
  await writer.add('H5P.Broken-1.0/broken.js', new TextReader("throw new ReferenceError('H5PEditor is not defined')\n"))
    }
  )

/** The quiz with its `content.json` changed by `change`. */
const quizWithContent = (name: string, change: (params: Record<string, any>) => void) =>
  rewrittenQuiz(name, async (entry, bytes, writer) => {
    if (entry.filename !== 'content/content.json') return void (await writer.add(entry.filename, new Uint8ArrayReader(bytes)))
    const params = JSON.parse(new TextDecoder().decode(bytes))
    change(params)
    await writer.add('content/content.json', new TextReader(JSON.stringify(params)))
  })

/**
 * The quiz built against a Question Set newer than any pack: its own folder renamed to 1.99 and
 * named so, which played untrusted cannot come from anywhere.
 */
const quizNeedingNewerLibrary = () =>
  rewrittenQuiz('newer.h5p', async (entry, bytes, writer) => {
    const folder = /^H5P\.QuestionSet-1\.\d+\//.exec(entry.filename)
    if (entry.filename === 'h5p.json' || (folder && entry.filename.endsWith('/library.json'))) {
      const json = JSON.parse(new TextDecoder().decode(bytes))
      if (entry.filename === 'h5p.json') {
        for (const dependency of json.preloadedDependencies) if (dependency.machineName === 'H5P.QuestionSet') dependency.minorVersion = 99
      } else json.minorVersion = 99
      bytes = new TextEncoder().encode(JSON.stringify(json))
    }
    await writer.add(folder ? entry.filename.replace(folder[0], 'H5P.QuestionSet-1.99/') : entry.filename, new Uint8ArrayReader(bytes))
  })

describe('contentChanges', () => {
  it('names the markup a text lost, counting attributes only on the tags that stayed', () => {
    const changes = contentChanges(
      { text: '<p style="position:fixed;color:#fff">Hi</p><form action="x"><input name="a"><input name="b"></form>' },
      { text: '<p style="color:#fff;">Hi</p>' }
    )
    expect(changes).toEqual([{ path: 'text', change: 'markup removed: <form>, <input> ×2; style removed: position' }])
  })

  it('reads a text of tags that never close in linear time', { timeout: 1000 }, () => {
    const changes = contentChanges({ text: `<p>Hi</p>${'<a'.repeat(100_000)}` }, { text: '<p>Hi</p>' })
    expect(changes).toEqual([{ path: 'text', change: 'markup removed: <a> ×100000' }])
  })

  it('reports removed fields, shortened lists and changed values, and leaves removed empty values out', () => {
    const changes = contentChanges(
      { a: { b: 'x', empty: [], gone: 1 }, list: [1, 2, 3], n: 5, plain: 'Tom & Jerry', html: '<p>a & b</p>' },
      { a: { b: 'x' }, list: [1], n: 3, plain: 'Tom &amp; Jerry', html: '<p>a &amp; b</p>' }
    )
    expect(changes).toEqual([
      { path: 'a.gone', change: 'removed' },
      { path: 'list', change: '2 of 3 items removed' },
      { path: 'n', change: '5 became 3' },
      { path: 'plain', change: '"Tom & Jerry" became "Tom &amp; Jerry"' },
      { path: 'html', change: 'text rewritten' }
    ])
  })
})

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

  it('played untrusted, reports what the content check removed and the notes it wrote, and still passes', async () => {
    const file = await quizWithContent('hostile.h5p', (params) => {
      params.questions[0].params.question = '<p>Sign in first</p><form action="https://sign-in.example/"><input type="password" name="p"></form>'
      params.progressType = 'bogus'
    })
    const report = await verifyPackage({ file, untrusted: true, libraries: pack, out: join(dir, 'hostile') })

    expect(report.verdict).toBe('pass')
    expect(report.untrusted).toBe(true)
    expect(report.contentCheck?.notes).toContain('progressType: invalid option replaced by the first')
    expect(report.contentCheck?.changes).toEqual(
      expect.arrayContaining([
        { path: 'progressType', change: '"bogus" became "textual"' },
        { path: 'questions[0].params.question', change: 'markup removed: <form>, <input>' }
      ])
    )
    expect(report.warnings).toContain('content check: questions[0].params.question: markup removed: <form>, <input>')
  }, 120_000)

  it('played untrusted, passes the quiz unchanged', async () => {
    const report = await verifyPackage({ file: quiz, untrusted: true, libraries: pack })

    expect(report.verdict).toBe('pass')
    expect(report.untrusted).toBe(true)
    expect(report.contentCheck).toEqual({ notes: [], changes: [] })
    expect(report.warnings).toEqual([])
  }, 120_000)

  it('played untrusted, refuses a package that needs its own copy of a library, and says what to do', async () => {
    const report = await verifyPackage({ file: await quizNeedingNewerLibrary(), untrusted: true, libraries: pack })

    expect(report.verdict).toBe('fail')
    expect(report.errors[0]?.missingLibraries?.carried).toBe(true)
    expect(report.errors[0]?.missingLibraries?.folders).toContain('H5P.QuestionSet-1.99')
    expect(summarize(report)).toContain('played untrusted its libraries come only from')
    // Trusted, the same package plays with its own copy.
    expect((await verifyPackage({ file: await quizNeedingNewerLibrary() })).verdict).toBe('pass')
  }, 240_000)

  it('refuses a library bundle on disk that does not exist, before starting a browser', async () => {
    await expect(verifyPackage({ file: quiz, libraries: join(dir, 'no-such-pack.h5p') })).rejects.toThrow(/No such library bundle/)
  })

  it('refuses a file that does not exist', async () => {
    await expect(verifyPackage({ file: join(dir, 'missing.h5p') })).rejects.toThrow(/No such file/)
  })
})
