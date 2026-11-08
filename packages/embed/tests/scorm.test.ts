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

  it('writes none of the options unless asked: SCORM 1.2, the content\'s own result, and nothing in the page', async () => {
    const out = join(dir, 'plain-options.zip')
    expect(await buildScorm({ h5p: quiz, out })).toMatchObject({ scormVersion: '1.2', passMark: null, completionScore: false })
    const zip = await entriesOf(out)
    const xml = await zip.text('imsmanifest.xml')
    expect(xml).toContain('<schemaversion>1.2</schemaversion>')
    expect(xml).not.toContain('masteryscore')
    expect(await zip.text('index.html')).not.toContain('h5p-scorm')
    expect(await zip.text('NOTICE.txt')).toMatch(/^This is a SCORM 1\.2 package/)
    await zip.close()
  })

  it('writes a pass mark as SCORM 1.2\'s mastery score, and SCORM 2004\'s manifest with the mark as its objective', async () => {
    const graded = join(dir, 'graded.zip')
    await buildScorm({ h5p: quiz, out: graded, passMark: 80, completionScore: true })
    const one = await entriesOf(graded)
    expect(await one.text('imsmanifest.xml')).toContain('<title>Do you know what just happened?</title>\n        <adlcp:masteryscore>80</adlcp:masteryscore>\n      </item>')
    const page = await one.text('index.html')
    expect(page).toContain('<meta name="h5p-scorm-pass-mark" content="80" />')
    expect(page).toContain('<meta name="h5p-scorm-completion-score" content="100" />')
    expect(page).not.toContain('h5p-scorm-version')
    await one.close()

    const out = join(dir, 'quiz-2004.zip')
    // A mark kept to the hundredth, as the score is, and to the ten-thousandth as a measure.
    expect(await buildScorm({ h5p: quiz, out, scormVersion: '2004', passMark: 66.666 })).toMatchObject({ scormVersion: '2004', passMark: 66.67, completionScore: false })
    const zip = await entriesOf(out)
    const xml = await zip.text('imsmanifest.xml')
    expect(xml).toContain('xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"')
    expect(xml).toContain('xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"')
    expect(xml).toContain('<schemaversion>2004 4th Edition</schemaversion>')
    expect(xml).toContain('<imsss:primaryObjective objectiveID="primary" satisfiedByMeasure="true">')
    expect(xml).toContain('<imsss:minNormalizedMeasure>0.6667</imsss:minNormalizedMeasure>')
    expect(xml).toContain('adlcp:scormType="sco"')
    const listed = [...xml.matchAll(/<file href="([^"]+)"\/>/g)].map((match) => match[1])
    expect(listed.sort()).toEqual([...zip.names].sort())
    expect(await zip.text('index.html')).toContain('<meta name="h5p-scorm-version" content="2004" />\n    <meta name="h5p-scorm-pass-mark" content="66.67" />')
    expect(await zip.text('NOTICE.txt')).toMatch(/^This is a SCORM 2004 4th Edition package/)
    await zip.close()
  })

  it('refuses an option it does not know, before writing anything', async () => {
    const out = join(dir, 'unknown-option.zip')
    await expect(buildScorm({ h5p: quiz, out, scormVersion: '1.3' as never })).rejects.toThrow(/The SCORM version is 1\.2 or 2004, not "1\.3"\./)
    for (const passMark of [101, -1, Number.NaN, '80' as never]) {
      await expect(buildScorm({ h5p: quiz, out, passMark })).rejects.toThrow(/The pass mark is a number from 0 to 100/)
    }
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

  it('writes SCORM 2004 with a pass mark and completion as 100 as the flags say, and refuses what is not one', async () => {
    const cwd = join(dir, 'cli-options')
    await mkdir(cwd)
    const { stdout } = await run(process.execPath, [bin, '--scorm', quiz, '--scorm-version', '2004', '--pass-mark', '66.666', '--completion-score'], { cwd })
    // The mark as the zip holds it, to the hundredth.
    expect(stdout).toContain('"Do you know what just happened?" as a SCORM 2004 4th Edition package (pass mark 66.67, completion counts as 100)')
    const zip = await entriesOf(join(cwd, 'quiz.scorm.zip'))
    expect(await zip.text('imsmanifest.xml')).toContain('<imsss:minNormalizedMeasure>0.6667</imsss:minNormalizedMeasure>')
    await zip.close()

    for (const [flags, said] of [
      [['--pass-mark', 'eighty'], 'The pass mark is a number from 0 to 100, not "eighty".'],
      [['--pass-mark', ''], 'The pass mark is a number from 0 to 100, not "".'],
      [['--pass-mark', '120'], 'The pass mark is a number from 0 to 100, not 120.'],
      [['--scorm-version', '1.3'], 'The SCORM version is 1.2 or 2004, not "1.3".']
    ] as const) {
      const failure = await run(process.execPath, [bin, '--scorm', quiz, 'refused.zip', ...flags], { cwd }).catch((error) => error)
      expect(failure.code, flags.join(' ')).toBe(1)
      expect(failure.stderr).toContain(said)
    }
    expect(existsSync(join(cwd, 'refused.zip'))).toBe(false)
    const site = await run(process.execPath, [bin, 'site', '--pass-mark', '80', '--completion-score'], { cwd }).catch((error) => error)
    expect(site.code).toBe(2)
    expect(site.stderr).toContain('--pass-mark, --completion-score only with --scorm')
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

/*
 * A SCORM 2004 LMS, as the same stand-in: `API_1484_11` in its window and nothing else, the values
 * kept between launches, and a launch after a suspended session a resumed one.
 */
const LMS_2004_PAGE = `<!doctype html>
<html><body>
<script>
  window.calls = []
  window.values = { 'cmi.completion_status': 'unknown', 'cmi.success_status': 'unknown', 'cmi.entry': 'ab-initio', 'cmi.suspend_data': '' }
  const record = (name, answer) => (...args) => {
    window.calls.push([name, ...args])
    return answer(...args)
  }
  window.API_1484_11 = {
    Initialize: record('Initialize', () => 'true'),
    Terminate: record('Terminate', () => 'true'),
    GetValue: record('GetValue', (element) => (element === 'cmi.interactions._count' ? String(interactionCount()) : window.values[element] ?? '')),
    SetValue: record('SetValue', (element, value) => {
      window.values[element] = value
      return 'true'
    }),
    Commit: record('Commit', () => 'true'),
    GetLastError: () => '0',
    GetErrorString: () => '',
    GetDiagnostic: () => ''
  }
  function interactionCount() {
    const indexes = Object.keys(window.values).map((key) => /^cmi\\.interactions\\.(\\d+)\\.id$/.exec(key)).filter(Boolean).map((match) => Number(match[1]))
    return indexes.length ? Math.max(...indexes) + 1 : 0
  }
  window.launch = (path) => {
    window.values['cmi.entry'] = window.values['cmi.exit'] === 'suspend' ? 'resume' : 'ab-initio'
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
    // And the quiz with the options, each in a folder of its own: 1.2 with a pass mark and
    // completion as 100, 2004 with completion as 100, and 2004 with a pass mark.
    const zips: Array<[string, string, Parameters<typeof buildScorm>[0] | null]> = [
      [quiz, root, null],
      [formulas, join(root, 'formulas'), null],
      [quiz, join(root, 'graded'), { h5p: quiz, out: '', passMark: 80, completionScore: true }],
      [quiz, join(root, 's2004'), { h5p: quiz, out: '', scormVersion: '2004', completionScore: true }],
      [quiz, join(root, 's2004-graded'), { h5p: quiz, out: '', scormVersion: '2004', passMark: 80 }]
    ]
    for (const [h5p, folder, options] of zips) {
      const out = join(dir, `${basename(folder)}.served.zip`)
      const built = await buildScorm({ ...options, h5p, out })
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
      if (path === '/lms.html' || path === '/lms2004.html') {
        response.writeHead(200, { 'Content-Type': MIME['.html'] }).end(path === '/lms.html' ? LMS_PAGE : LMS_2004_PAGE)
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

  async function lmsPage(lms = '/lms.html'): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${origin}${lms}`)
    return { context, page }
  }

  /** Six of the quiz's nine points, as the first test scores them, which the quiz's own mark of half passes. */
  async function sixOfNine(h5p: Frame) {
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
  }

  /** The element's `finished`, as it dispatches it, with this result. */
  const finish = (sco: Frame, result: Record<string, unknown>) =>
    sco.evaluate((result) => {
      const player = document.querySelector('h5p-player') as HTMLElement
      player.dispatchEvent(new CustomEvent('finished', { detail: { statement: { result } } }))
    }, result)

  /** Sets values in the LMS before the launch, as it holds them from the manifest or a session before. */
  const holding = (page: Page, held: Record<string, string>) =>
    page.evaluate((held) => Object.assign((window as unknown as { values: Record<string, string> }).values, held), held)

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
    // question's number and words as the id, since SCORM 1.2 has no description field.
    expect(Object.keys(kept).filter((key) => /^cmi\.interactions\.\d+\.id$/.test(key))).toHaveLength(4)
    expect(kept['cmi.interactions.0.id']).toMatch(/^Q1_[a-z0-9_]{1,40}$/)
    expect(kept['cmi.interactions.2.id']).toMatch(/^Q3_[a-z0-9_]{1,40}$/)
    expect(kept).toMatchObject({ 'cmi.interactions.0.type': 'choice', 'cmi.interactions.0.result': 'correct', 'cmi.interactions.1.type': 'true-false', 'cmi.interactions.1.result': 'correct', 'cmi.interactions.2.type': 'fill-in', 'cmi.interactions.2.result': 'correct' })
    // The typed-in answer with its response and the right one, as text a person reads: the blanks
    // listed, and H5P's `{case_matters=false}` gone. The right one is each blank's first answer; the
    // learner's "deflated" is the second the third blank takes. The choice and the true-false with
    // their result alone, since 1.2 writes those answers in a form of its own.
    expect(kept['cmi.interactions.2.student_response']).toBe('stored, Range, deflated, front')
    expect(kept['cmi.interactions.2.correct_responses.0.pattern']).toBe('stored, Range, compressed, front')
    for (const index of [0, 1]) {
      expect(kept[`cmi.interactions.${index}.student_response`]).toBeUndefined()
      expect(kept[`cmi.interactions.${index}.correct_responses.0.pattern`]).toBeUndefined()
    }
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
    expect((await decoded(first.sco, wrote[2])).questions).toEqual([['a', 'Q1_which_rivers_cross_germany']])
    // Another question with the same words takes its own number.
    await answer(first.sco, 'b', 'Which rivers cross Germany?')
    let kept = await values(page)
    expect(kept).toMatchObject({
      'cmi.interactions.0.id': 'Q1_which_rivers_cross_germany',
      'cmi.interactions.0.type': 'choice',
      'cmi.interactions.0.result': 'wrong',
      'cmi.interactions.0.weighting': '2',
      'cmi.interactions.0.latency': '00:00:12.50',
      'cmi.interactions.1.id': 'Q2_which_rivers_cross_germany'
    })
    expect(kept['cmi.interactions.0.time']).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    // 1.2 writes a choice in single characters, which H5P's `0[,]2` is not: the result alone.
    expect(kept['cmi.interactions.0.correct_responses.0.pattern']).toBeUndefined()
    expect(kept['cmi.interactions.0.student_response']).toBeUndefined()

    // Answered again: the same index, the new result, nothing added. What an earlier answer left
    // there, here a choice's response and right one in H5P's notation as a zip before 1.2's answers
    // were held to their types wrote them in an attempt it began, is emptied, not left beside it.
    await page.evaluate(() => Object.assign((window as unknown as { values: Record<string, string> }).values, { 'cmi.interactions.0.student_response': '0[,]1', 'cmi.interactions.0.correct_responses.0.pattern': '0[,]2' }))
    await answer(first.sco, 'a', 'Which <em>rivers</em> cross Germany?', {}, { response: '0[,]2', success: true, score: { raw: 2, max: 2 } })
    kept = await values(page)
    expect(kept).toMatchObject({ 'cmi.interactions.0.result': 'correct', 'cmi.interactions.0.student_response': '', 'cmi.interactions.0.correct_responses.0.pattern': '' })
    expect(kept['cmi.interactions.2.id']).toBeUndefined()
    // A question answered for the first time writes neither, empty or not.
    expect(kept['cmi.interactions.1.student_response']).toBeUndefined()
    expect(kept['cmi.interactions.1.correct_responses.0.pattern']).toBeUndefined()

    // An Essay's long answer, as `fill-in`, its response cut to what 1.2 keeps; a type 1.2 has not,
    // left out, with its response; a question with no words, named by its number alone; a result
    // that says nothing, neutral; one that says nothing but scores, as Fill in the Blanks does, by
    // its marks.
    await answer(first.sco, 'c', '', { interactionType: 'long-fill-in', correctResponsesPattern: [] }, { response: 'x'.repeat(300), success: undefined, score: undefined, duration: undefined })
    await answer(first.sco, 'd', 'Other', { interactionType: 'other' }, { success: undefined, score: { raw: 1, max: 2 } })
    kept = await values(page)
    expect(kept).toMatchObject({ 'cmi.interactions.2.id': 'Q3', 'cmi.interactions.2.type': 'fill-in', 'cmi.interactions.2.result': 'neutral', 'cmi.interactions.3.id': 'Q4_other', 'cmi.interactions.3.result': '1' })
    expect(kept['cmi.interactions.2.student_response']).toHaveLength(255)
    expect(kept['cmi.interactions.2.correct_responses.0.pattern']).toBeUndefined()
    expect(kept['cmi.interactions.2.latency']).toBeUndefined()
    expect(kept['cmi.interactions.3.type']).toBeUndefined()
    expect(kept['cmi.interactions.3.student_response']).toBeUndefined()

    // The questions go with the state, with no save of the content's, so the next session of the
    // attempt keeps their indexes and their ids.
    expect((await decoded(first.sco, (await values(page))['cmi.suspend_data'])).questions).toEqual([
      ['a', 'Q1_which_rivers_cross_germany'],
      ['b', 'Q2_which_rivers_cross_germany'],
      ['c', 'Q3'],
      ['d', 'Q4_other']
    ])
    await leave(page)
    const second = await launch(page)
    // The second of two questions with the same words, answered first this time, keeps its number.
    await answer(second.sco, 'b', 'Which rivers cross Germany?', {}, { success: true, score: { raw: 2, max: 2 } })
    await answer(second.sco, 'e', 'A new one')
    kept = await values(page)
    expect(kept).toMatchObject({ 'cmi.interactions.1.id': 'Q2_which_rivers_cross_germany', 'cmi.interactions.1.result': 'correct', 'cmi.interactions.4.id': 'Q5_a_new_one' })
    expect(kept['cmi.interactions.5.id']).toBeUndefined()

    // An attempt the LMS started over, which it does at a launch, its interactions gone: they start
    // again from the first index, and a question takes the number of its new one.
    await leave(page)
    await page.evaluate(() => {
      const lms = window as unknown as { values: Record<string, string> }
      for (const key of Object.keys(lms.values)) if (key.startsWith('cmi.interactions.')) delete lms.values[key]
    })
    const third = await launch(page)
    await answer(third.sco, 'e', 'A new one')
    kept = await values(page)
    expect(kept).toMatchObject({ 'cmi.interactions.0.id': 'Q1_a_new_one', 'cmi.interactions.0.result': 'wrong' })
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
    expect([0, 1, 2].map((index) => kept[`cmi.interactions.${index}.id`])).toEqual(['Q1_question_a', 'Q2_question_b', 'Q3_question_c'])

    // The next session of the attempt: the count it loaded, and new questions after it.
    await leave(page)
    const second = await launch(page)
    await answer(second.sco, 'b', 'Question b', {}, { success: true, score: { raw: 2, max: 2 } })
    for (const sub of ['d', 'e']) await answer(second.sco, sub, `Question ${sub}`)
    kept = await values(page)
    expect(kept).toMatchObject({ 'cmi.interactions.1.result': 'correct', 'cmi.interactions.3.id': 'Q4_question_d', 'cmi.interactions.4.id': 'Q5_question_e' })
    await context.close()
  })

  it('names an answer by its number and its first words, in letters, digits and _ alone', async () => {
    const { context, page } = await lmsPage()
    const { sco } = await launch(page)
    // Letters folded to ASCII and cut at a word; no Latin letters, the number alone; a long word cut
    // where its words end.
    await answer(sco, 'a', 'Wie heißt die Straße über den Fluß, die nach Łódź führt?')
    await answer(sco, 'b', 'Что такое вода?')
    await answer(sco, 'c', 'Supercalifragilisticexpialidocious-and-then-some-more-letters')
    // Markup out and character references read, as a question type writes its words; a dotless ı.
    await answer(sco, 'd', '<p>Don&rsquo;t&nbsp;stop &amp; go</p>')
    await answer(sco, 'e', 'Kızılırmak nehri')
    const kept = await values(page)
    expect([0, 1, 2, 3, 4].map((index) => kept[`cmi.interactions.${index}.id`])).toEqual([
      'Q1_wie_heisst_die_strasse_uber_den_fluss',
      'Q2',
      'Q3_supercalifragilisticexpialidocious_and',
      'Q4_don_t_stop_go',
      'Q5_kizilirmak_nehri'
    ])
    await context.close()
  })

  it('writes a SCORM 1.2 answer\'s response and the right one where they are the learner\'s own text or number, as text a person reads', async () => {
    const { context, page } = await lmsPage()
    const { sco } = await launch(page)
    await answer(sco, 'a', 'Name a river', { interactionType: 'fill-in', correctResponsesPattern: ['{case_matters=false}Rhine'] }, { response: 'Rhine', success: true })
    await answer(sco, 'b', 'How long is it, in km?', { interactionType: 'numeric', correctResponsesPattern: ['1233'] }, { response: '1230' })
    await answer(sco, 'c', 'It flows into the North Sea', { interactionType: 'true-false', correctResponsesPattern: ['true'] }, { response: 'false' })
    await answer(sco, 'd', 'Put them in order', { interactionType: 'sequencing', correctResponsesPattern: ['0[,]1[,]2'] }, { response: '1[,]0[,]2' })
    await answer(sco, 'e', 'Match them', { interactionType: 'matching', correctResponsesPattern: ['0[.]1[,]1[.]0'] }, { response: '0[.]0[,]1[.]1' })
    await answer(sco, 'f', 'Name two seas', { interactionType: 'fill-in', correctResponsesPattern: ['{case_matters=false}{lang=en}North Sea[,]Baltic'] }, { response: 'North Sea[,]Black Sea', success: false })
    await answer(sco, 'g', 'Roughly how long, in km?', { interactionType: 'numeric', correctResponsesPattern: ['1200[:]1300'] }, { response: 'about 1230', success: undefined, score: undefined })
    const kept = await values(page)
    // H5P's `{case_matters=false}` and `{lang=en}` taken off the right answer, and blanks parted by
    // `[,]` listed, in the answer given as in the right one.
    expect(kept).toMatchObject({
      'cmi.interactions.0.student_response': 'Rhine',
      'cmi.interactions.0.correct_responses.0.pattern': 'Rhine',
      'cmi.interactions.1.student_response': '1230',
      'cmi.interactions.1.correct_responses.0.pattern': '1233',
      'cmi.interactions.5.student_response': 'North Sea, Black Sea',
      'cmi.interactions.5.correct_responses.0.pattern': 'North Sea, Baltic',
      'cmi.interactions.6.type': 'numeric',
      'cmi.interactions.6.result': 'neutral'
    })
    // A numeric answer that is not a number, 1.2's `CMIDecimal`, is not written: neither 2004's
    // range nor words.
    expect(kept['cmi.interactions.6.student_response']).toBeUndefined()
    expect(kept['cmi.interactions.6.correct_responses.0.pattern']).toBeUndefined()
    // The fill-in answered again with nothing typed: its earlier response emptied, its right one
    // written again.
    await answer(sco, 'a', 'Name a river', { interactionType: 'fill-in', correctResponsesPattern: ['{case_matters=false}Rhine'] }, { response: '', success: false })
    expect(await values(page)).toMatchObject({ 'cmi.interactions.0.student_response': '', 'cmi.interactions.0.correct_responses.0.pattern': 'Rhine', 'cmi.interactions.0.result': 'wrong' })
    // Their type and their result, but not H5P's notation, which 1.2 does not take for them.
    for (const index of [2, 3, 4]) {
      expect(kept[`cmi.interactions.${index}.type`]).toBe(['true-false', 'sequencing', 'matching'][index - 2])
      expect(kept[`cmi.interactions.${index}.result`]).toBe('wrong')
      expect(kept[`cmi.interactions.${index}.student_response`]).toBeUndefined()
      expect(kept[`cmi.interactions.${index}.correct_responses.0.pattern`]).toBeUndefined()
    }
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

  it('holds the score to the pass mark in place of the content\'s pass, and takes the LMS\'s mark over the page\'s', async () => {
    // 66.67 passes the quiz's own mark of half, and not the zip's 80, which the LMS does not hold.
    const { context, page } = await lmsPage()
    const { h5p } = await launch(page, '/graded/index.html')
    await sixOfNine(h5p)
    await page.waitForFunction(() => (window as unknown as { values: Record<string, string> }).values['cmi.core.lesson_status'] === 'failed')
    expect(await values(page)).toMatchObject({ 'cmi.core.score.raw': '66.67', 'cmi.core.score.max': '100' })
    expect(await calls(page)).toContainEqual(['LMSGetValue', 'cmi.student_data.mastery_score'])
    await context.close()

    // An LMS that holds a mark of its own, 60: the same score passes, as the LMS would judge it.
    const second = await lmsPage()
    await holding(second.page, { 'cmi.student_data.mastery_score': '60' })
    const { sco } = await launch(second.page, '/graded/index.html')
    await finish(sco, { score: { raw: 6, max: 9, scaled: 0.6667 }, success: false })
    expect(await values(second.page)).toMatchObject({ 'cmi.core.lesson_status': 'passed', 'cmi.core.score.raw': '66.67' })
    await second.context.close()
  })

  it('counts content that finishes without a score as 100, which passes the mark, and gives no score where it is off', async () => {
    const { context, page } = await lmsPage()
    const { sco } = await launch(page, '/graded/index.html')
    await finish(sco, { completion: true })
    expect(await values(page)).toMatchObject({ 'cmi.core.lesson_status': 'passed', 'cmi.core.score.raw': '100', 'cmi.core.score.min': '0', 'cmi.core.score.max': '100' })
    // A score of 0 out of 0 is no score either.
    await finish(sco, { score: { raw: 0, max: 0 }, completion: true })
    expect((await values(page))['cmi.core.score.raw']).toBe('100')
    await context.close()
  })

  it('reports to a SCORM 2004 LMS: completion and success apart, the scaled score, each answer with its words, the time as ISO 8601', async () => {
    const { context, page } = await lmsPage('/lms2004.html')
    const { h5p } = await launch(page, '/s2004/index.html')
    await sixOfNine(h5p)
    await page.waitForFunction(() => (window as unknown as { values: Record<string, string> }).values['cmi.success_status'] === 'passed')
    const kept = await values(page)
    expect(kept).toMatchObject({ 'cmi.completion_status': 'completed', 'cmi.score.raw': '66.67', 'cmi.score.min': '0', 'cmi.score.max': '100', 'cmi.score.scaled': '0.6667' })
    expect(kept['cmi.session_time']).toMatch(/^PT(\d+H)?(\d+M)?\d+(\.\d{1,2})?S$/)
    // The answers: the part's id as a URN, the words as the description, 2004's names for the
    // response and the time, and `incorrect` where 1.2 says `wrong`.
    expect(Object.keys(kept).filter((key) => /^cmi\.interactions\.\d+\.id$/.test(key))).toHaveLength(4)
    expect(kept['cmi.interactions.0.id']).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(kept['cmi.interactions.0.description']).toMatch(/^Where was this quiz unpacked/)
    // The words as text: the drag question's `&rsquo;` read as the character it stands for.
    expect(kept['cmi.interactions.3.description']).toContain('runtime\u2019s requests')
    expect(kept).toMatchObject({ 'cmi.interactions.0.type': 'choice', 'cmi.interactions.0.result': 'correct', 'cmi.interactions.1.type': 'true-false', 'cmi.interactions.2.type': 'fill-in', 'cmi.interactions.3.result': 'incorrect' })
    expect(kept['cmi.interactions.0.learner_response']).toBe(kept['cmi.interactions.0.correct_responses.0.pattern'])
    expect(kept['cmi.interactions.0.student_response']).toBeUndefined()
    // 2004 takes H5P's notation, which is its own, as written: the fill-in's too.
    expect(kept['cmi.interactions.2.correct_responses.0.pattern']).toBe('{case_matters=false}stored[,]Range[,]compressed[,]front')
    expect(kept['cmi.interactions.2.learner_response']).toBe('stored[,]Range[,]deflated[,]front')
    expect(kept['cmi.interactions.0.latency']).toMatch(/^PT(\d+H)?(\d+M)?\d+(\.\d{1,2})?S$/)
    expect(kept['cmi.interactions.0.timestamp']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,2})?Z$/)
    expect(Object.keys(kept).some((key) => key.startsWith('cmi.core.'))).toBe(false)
    const made = await calls(page)
    expect(made[0]).toEqual(['Initialize', ''])
    expect(made).toContainEqual(['SetValue', 'cmi.completion_status', 'incomplete'])

    // Finished, the session is suspended all the same, and ends with the page; the next launch
    // resumes it, with the result kept and nothing written over it.
    await page.evaluate(() => (window as unknown as { leave: () => void }).leave())
    await page.waitForFunction(() => (window as unknown as { calls: string[][] }).calls.some((call) => call[0] === 'Terminate'))
    expect((await values(page))['cmi.exit']).toBe('suspend')
    expect((await calls(page)).filter((call) => call[0] === 'Terminate')).toHaveLength(1)
    const before = (await calls(page)).length
    await launch(page, '/s2004/index.html')
    expect(await values(page)).toMatchObject({ 'cmi.entry': 'resume', 'cmi.completion_status': 'completed', 'cmi.success_status': 'passed', 'cmi.score.raw': '66.67' })
    expect((await calls(page)).slice(before).filter((call) => call[0] === 'SetValue' && /status$/.test(call[1]))).toEqual([])
    await context.close()
  })

  it('resumes a suspended SCORM 2004 session, and keeps a state 1.2 would not', async () => {
    const { context, page } = await lmsPage('/lms2004.html')
    const first = await launch(page, '/s2004/index.html')
    await first.h5p.getByRole('button', { name: 'Start' }).click()
    await first.h5p.getByRole('radio', { name: 'In your browser, straight out of the zip' }).click()
    await first.h5p.getByRole('button', { name: /^Check/ }).click()
    await first.h5p.getByRole('button', { name: /^Next/ }).click()
    // The content's own state, which H5P saves three seconds after the answer, as in 1.2.
    await first.sco.waitForFunction(() => {
      const text = (parent as unknown as { values: Record<string, string> }).values['cmi.suspend_data']
      const json = text && (window as unknown as { LZString: { decompressFromBase64: (s: string) => string | null } }).LZString.decompressFromBase64(text)
      return Boolean(json && JSON.parse(json).entries.length > 0)
    }, null, { timeout: 30_000 })
    await page.evaluate(() => (window as unknown as { leave: () => void }).leave())
    await page.waitForFunction(() => (window as unknown as { calls: string[][] }).calls.some((call) => call[0] === 'Terminate'))
    expect((await values(page))['cmi.exit']).toBe('suspend')

    const second = await launch(page, '/s2004/index.html')
    expect((await values(page))['cmi.entry']).toBe('resume')
    await second.h5p.getByRole('radio', { name: 'True' }).waitFor({ state: 'visible', timeout: 10_000 })

    // Random text, compressed past what 1.2 keeps and short of 2004's 64,000: written, and nothing said.
    const random = randomBytes(6000).toString('base64')
    const kept = await save(second.sco, random)
    expect(kept.after.length).toBeGreaterThan(4096)
    expect(kept.said).toBe(false)
    expect((await decoded(second.sco, kept.after)).entries).toContainEqual(['state', 'large', random])
    await context.close()
  })

  it('holds a SCORM 2004 score to the LMS\'s passing score, and counts no score as 100 only where the zip says', async () => {
    const { context, page } = await lmsPage('/lms2004.html')
    // The LMS's passing score, from the manifest's objective: the content's pass is a fail below it.
    await holding(page, { 'cmi.scaled_passing_score': '0.8' })
    const { sco } = await launch(page, '/s2004-graded/index.html')
    await finish(sco, { score: { raw: 6, max: 9, scaled: 0.6667 }, success: true })
    expect(await values(page)).toMatchObject({ 'cmi.completion_status': 'completed', 'cmi.success_status': 'failed', 'cmi.score.scaled': '0.6667' })
    // This zip does not count no score as 100: no score, so no verdict from the mark.
    await finish(sco, { completion: true })
    expect(await values(page)).toMatchObject({ 'cmi.completion_status': 'completed', 'cmi.score.scaled': '0.6667' })
    await context.close()

    // The zip that does, with no pass mark: completed, 100, and success left as it was.
    const other = await lmsPage('/lms2004.html')
    const launched = await launch(other.page, '/s2004/index.html')
    await finish(launched.sco, { completion: true })
    expect(await values(other.page)).toMatchObject({ 'cmi.completion_status': 'completed', 'cmi.success_status': 'unknown', 'cmi.score.raw': '100', 'cmi.score.scaled': '1' })
    await other.context.close()
  })

  it('writes a SCORM 2004 answer\'s pattern and response after its type, and neither for an answer that names no type', async () => {
    const { context, page } = await lmsPage('/lms2004.html')
    const { sco } = await launch(page, '/s2004/index.html')
    await answer(sco, 'typed', 'Which rivers cross Germany?')
    // 2004 refuses either before the type that gives its form (408).
    const written = (await calls(page)).filter((call) => call[0] === 'SetValue' && call[1].startsWith('cmi.interactions.0.')).map((call) => call[1])
    const typedAt = written.indexOf('cmi.interactions.0.type')
    expect(typedAt).toBeGreaterThan(-1)
    expect(typedAt).toBeLessThan(written.indexOf('cmi.interactions.0.correct_responses.0.pattern'))
    expect(typedAt).toBeLessThan(written.indexOf('cmi.interactions.0.learner_response'))

    // An answer whose statement names no type is kept, without the two.
    await answer(sco, 'untyped', 'Which rivers cross France?', { interactionType: undefined })
    const kept = await values(page)
    expect(kept).toMatchObject({ 'cmi.interactions.1.id': 'urn:h5p:untyped', 'cmi.interactions.1.description': 'Which rivers cross France?', 'cmi.interactions.1.result': 'incorrect', 'cmi.interactions.1.weighting': '2' })
    expect(kept['cmi.interactions.1.type']).toBeUndefined()
    expect(kept['cmi.interactions.1.correct_responses.0.pattern']).toBeUndefined()
    expect(kept['cmi.interactions.1.learner_response']).toBeUndefined()
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
