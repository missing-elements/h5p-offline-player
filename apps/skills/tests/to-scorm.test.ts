import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { promisify } from 'node:util'
import { BlobReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js'
import { buildPackage } from '@missing-elements/h5p-author'
import { chromium, type Browser, type Frame, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/*
 * The h5p-to-scorm skill as an agent follows it: its commands run as it writes them, on packages
 * h5p-author builds, and the zips they write played by a learner under a stand-in for an LMS's
 * player page, which puts the SCORM API in its window, frames the launch page and keeps what it is
 * sent between launches, as Moodle's does. What the skill tells the user is held to what that LMS
 * kept. The zip's behaviour in full, call by call, is the embed package's tests'; these hold the
 * skill to it, with real content where those dispatch the element's events by hand.
 */

const run = promisify(execFile)
const project = resolve(import.meta.dirname, '..')
const skill = await readFile(resolve(project, '../../skills/h5p-to-scorm/SKILL.md'), 'utf8')
const readme = await readFile(resolve(project, '../../packages/embed/README.md'), 'utf8')
const types = resolve(project, '../../skills/h5p-author/references/types')
const fixtures = resolve(project, '../../packages/author/tests/fixtures')
// The commands, as installed here, which `npx` runs for the skill's user.
const embed = resolve(project, 'node_modules/@missing-elements/h5p-embed/bin/h5p-embed.mjs')
const verify = resolve(project, 'node_modules/@missing-elements/h5p-verify/bin/h5p-verify.mjs')
// The pack this project installed, named to the check as `--libraries` names a copy of its parts,
// so the check needs no network.
const parts = resolve(project, 'node_modules/@missing-elements/h5p-libraries/parts')
const META = { language: 'en', license: 'CC BY', authors: [{ name: 'Ann Author', role: 'Author' }] }

/** The commands the skill gives, as it writes them: its indented lines that run one of ours. */
const commands = [...skill.matchAll(/^ {4}npx @missing-elements\/(h5p-embed|h5p-verify)@latest (.+)$/gm)].map(([, tool, rest]) => ({ tool, args: rest.trim().split(/\s+/) }))

/** The skill's command that writes a zip with these options and no others. */
function embedCommand(...options: string[]) {
  const named = (args: string[]) => args.filter((arg) => arg.startsWith('--') && arg !== '--scorm').sort()
  const found = commands.find(({ tool, args }) => tool === 'h5p-embed' && JSON.stringify(named(args)) === JSON.stringify([...options].sort()))
  if (!found) throw new Error(`the skill gives no command with ${options.join(' ') || 'no options'}`)
  return found.args
}

/** A command run in a folder of its own holding the package as the skill names it, `course.h5p`. */
async function runIn(name: string, h5p: string, bin: string, args: string[]) {
  const cwd = join(dir, name)
  await mkdir(cwd)
  await copyFile(h5p, join(cwd, 'course.h5p'))
  const { stdout } = await run(process.execPath, [bin, ...args], { cwd })
  return { cwd, stdout }
}

/** A zip's entries, unpacked where an LMS would serve them, and its manifest. */
async function unpack(zip: string, folder: string) {
  const reader = new ZipReader(new BlobReader(new Blob([await readFile(zip)])))
  for (const entry of await reader.getEntries()) {
    if (entry.directory) continue
    await mkdir(dirname(join(root, folder, entry.filename)), { recursive: true })
    await writeFile(join(root, folder, entry.filename), await entry.getData(new Uint8ArrayWriter()))
  }
  await reader.close()
  return readFile(join(root, folder, 'imsmanifest.xml'), 'utf8')
}

/** The source a type file of h5p-author gives as its example, the metadata a source carries added. */
async function example(type: string, title: string) {
  const text = await readFile(join(types, `${type}.md`), 'utf8')
  const block = /## Example\s+```json\n([\s\S]*?)\n```/.exec(text)
  if (!block) throw new Error(`${type} has no example`)
  return { ...META, title, ...JSON.parse(block[1]) }
}

// The stand-in LMS: one page per version, its API in its window, the values it is sent kept
// between launches, and a launch after a suspended session a resumed one. `cmi.interactions._count`
// is one past the highest index written, as Moodle answers it.
const LMS = {
  '1.2': `
  window.values = { 'cmi.core.lesson_status': 'not attempted', 'cmi.core.entry': 'ab-initio', 'cmi.suspend_data': '' }
  window.finished = 0
  const count = () => String(Math.max(-1, ...Object.keys(values).map((key) => Number(/^cmi\\.interactions\\.(\\d+)\\.id$/.exec(key)?.[1] ?? -1))) + 1)
  window.API = {
    LMSInitialize: () => 'true',
    LMSFinish: () => { window.finished++; return 'true' },
    LMSGetValue: (element) => (element === 'cmi.interactions._count' ? count() : values[element] ?? ''),
    LMSSetValue: (element, value) => { values[element] = String(value); return 'true' },
    LMSCommit: () => 'true',
    LMSGetLastError: () => '0', LMSGetErrorString: () => '', LMSGetDiagnostic: () => ''
  }
  let launched = false
  window.launch = (path) => {
    values['cmi.core.entry'] = values['cmi.core.exit'] === 'suspend' ? 'resume' : launched ? '' : 'ab-initio'
    launched = true
    document.getElementById('sco')?.remove()
    const frame = document.createElement('iframe')
    frame.id = 'sco'
    frame.src = path
    frame.style.cssText = 'width: 100%; height: 700px; border: 0'
    document.body.append(frame)
  }`,
  '2004': `
  window.values = { 'cmi.completion_status': 'unknown', 'cmi.success_status': 'unknown', 'cmi.entry': 'ab-initio', 'cmi.suspend_data': '' }
  window.finished = 0
  const count = () => String(Math.max(-1, ...Object.keys(values).map((key) => Number(/^cmi\\.interactions\\.(\\d+)\\.id$/.exec(key)?.[1] ?? -1))) + 1)
  window.API_1484_11 = {
    Initialize: () => 'true',
    Terminate: () => { window.finished++; return 'true' },
    GetValue: (element) => (element === 'cmi.interactions._count' ? count() : values[element] ?? ''),
    SetValue: (element, value) => { values[element] = String(value); return 'true' },
    Commit: () => 'true',
    GetLastError: () => '0', GetErrorString: () => '', GetDiagnostic: () => ''
  }
  let launched = false
  window.launch = (path) => {
    values['cmi.entry'] = values['cmi.exit'] === 'suspend' ? 'resume' : launched ? '' : 'ab-initio'
    launched = true
    document.getElementById('sco')?.remove()
    const frame = document.createElement('iframe')
    frame.id = 'sco'
    frame.src = path
    frame.style.cssText = 'width: 100%; height: 700px; border: 0'
    document.body.append(frame)
  }`
}
type Version = keyof typeof LMS
type LmsWindow = Window & { values: Record<string, string>; finished: number; launch: (path: string) => void }
type Results = Window & { results: Array<{ success?: boolean; score?: { raw?: number; max?: number } } | null> }

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.h5p': 'application/zip' }
let dir: string
let root: string
let server: Server
let origin: string
let browser: Browser
const built: Record<string, string> = {}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'h5p-to-scorm-'))
  root = join(dir, 'lms')
  // The quiz example, with a pass percentage of its own that the learner's two of three points
  // pass, so that a pass mark above it is seen to decide instead.
  const quiz = JSON.parse(await readFile(join(fixtures, 'quiz.json'), 'utf8'))
  const sources: Record<string, object> = {
    quiz: { ...quiz, passPercentage: 50 },
    questionnaire: await example('H5P.Questionnaire', 'Rivers survey'),
    scenario: await example('H5P.BranchingScenario', 'Crossing the river'),
    presentation: {
      ...META,
      title: 'Rivers, three slides',
      type: 'H5P.CoursePresentation',
      params: { presentation: { slides: ['Sources', 'Courses', 'Mouths'].map((words) => ({ elements: [{ action: { library: 'H5P.AdvancedText', params: { text: `<p>${words}</p>` } } }] })) } }
    }
  }
  for (const [name, source] of Object.entries(sources)) {
    built[name] = join(dir, `${name}.h5p`)
    await buildPackage(source, built[name])
  }
  server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname)
    const version = /^\/lms-(1\.2|2004)\.html$/.exec(path)?.[1] as Version | undefined
    if (version) {
      response.writeHead(200, { 'Content-Type': MIME['.html'] }).end(`<!doctype html><body><script>${LMS[version]}</script></body>`)
      return
    }
    try {
      const body = await readFile(join(root, normalize(path).replace(/^(\.\.[/\\])+/, '')))
      response.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': 'no-store' }).end(body)
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
  await new Promise((done) => (server ? server.close(done) : done(undefined)))
  if (dir) await rm(dir, { recursive: true, force: true })
})

/** A frame of the page, once one passes `test`. */
async function frameWhere(page: Page, test: (frame: Frame) => boolean) {
  for (const end = Date.now() + 60_000; Date.now() < end; await page.waitForTimeout(100)) {
    const found = page.frames().find(test)
    if (found) return found
  }
  throw new Error(`no such frame among ${page.frames().map((frame) => frame.url()).join(', ')}`)
}

/** The LMS's page for a version, with what it holds already, as from the manifest. */
async function lms(version: Version, held: Record<string, string> = {}) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${origin}/lms-${version}.html`)
  await page.evaluate((held) => Object.assign((window as unknown as LmsWindow).values, held), held)
  return { context, page }
}

/**
 * Launches a zip from the LMS's page and waits for its content: the launch page, with the results
 * the element raises recorded, and the H5P frame in it.
 */
async function launch(page: Page, folder: string) {
  const path = `/${folder}/index.html`
  const before = new Set(page.frames())
  await page.evaluate((path) => (window as unknown as LmsWindow).launch(path), path)
  const sco = await frameWhere(page, (frame) => !before.has(frame) && frame.url().endsWith(path))
  await sco.waitForFunction(() => (document.querySelector('h5p-player') as { state?: string } | null)?.state === 'ready', null, { timeout: 60_000 })
  await sco.evaluate(() => {
    const results: Results['results'] = ((window as unknown as Results).results = [])
    document.querySelector('h5p-player')?.addEventListener('finished', (event) => results.push((event as CustomEvent).detail?.statement?.result ?? null))
  })
  return { sco, h5p: await frameWhere(page, (frame) => frame.parentFrame() === sco && frame.url().includes('/h5p/')) }
}

/** The learner leaves: the LMS takes the launch page down, which ends the session. */
async function leave(page: Page) {
  const finished = await page.evaluate(() => (window as unknown as LmsWindow).finished)
  await page.evaluate(() => ((document.getElementById('sco') as HTMLIFrameElement).src = 'about:blank'))
  await page.waitForFunction((before) => (window as unknown as LmsWindow).finished > before, finished)
}

const kept = (page: Page) => page.evaluate(() => ({ ...(window as unknown as LmsWindow).values }))
/** Waits for the LMS to hold a value; if it never does, fails with all it holds. */
async function holds(page: Page, element: string, value: string) {
  try {
    await page.waitForFunction(([element, value]) => (window as unknown as LmsWindow).values[element] === value, [element, value], { timeout: 30_000 })
  } catch (error) {
    throw new Error(`the LMS never held ${element} = ${value}; it holds ${JSON.stringify(await kept(page), null, 1)}`, { cause: error })
  }
}

/**
 * Clicks the visible button that begins with these words, once it is there, as a learner would:
 * by its accessible name, which H5P often makes longer than its text ("Check the answers. …"), in
 * any case, since some content types write their buttons in capitals. A button that does not come
 * fails with what the frame offered instead.
 */
async function press(h5p: Frame, words: string) {
  const button = h5p.getByRole('button', { name: new RegExp(`^${words}`, 'i') }).locator('visible=true').last()
  try {
    await button.waitFor({ timeout: 30_000 })
  } catch (error) {
    throw new Error(`no button "${words}" in the content:\n${await h5p.locator('body').ariaSnapshot().catch(() => '(none)')}`, { cause: error })
  }
  await button.click()
}

/**
 * Presses a button until the words it leads to show: a branching scenario and a presentation slide
 * each step in, and take no click until it has, so a learner presses again.
 */
async function pressFor(h5p: Frame, words: string, shown: string) {
  const next = h5p.getByText(shown).locator('visible=true').first()
  for (let tries = 0; tries < 5 && !(await next.isVisible()); tries++) {
    await press(h5p, words)
    await next.waitFor({ timeout: 3000 }).catch(() => undefined)
  }
  await next.waitFor({ timeout: 1000 })
}

describe('the h5p-to-scorm skill', () => {
  it('checks a quiz and writes it as its commands say; in SCORM 1.2 the pass mark decides, and a learner who leaves continues', async () => {
    // The check, as written, but for the pack named by its copy here.
    const check = commands.find(({ tool }) => tool === 'h5p-verify')
    expect(check?.args).toContain('pack')
    const checked = await runIn('check', built.quiz, verify, check!.args.map((arg) => (arg === 'pack' ? parts : arg)))
    expect(checked.stdout).toMatch(/^pass {2}course\.h5p {2}ready in /)

    // The plain command: SCORM 1.2 in course.scorm.zip, graded by the content's own result.
    const plain = await runIn('plain', built.quiz, embed, embedCommand())
    expect(plain.stdout).toMatch(/^Wrote course\.scorm\.zip \([\d.]+ MB\): "Practice: recognizing phishing" as a SCORM 1\.2 package,\n/)
    const plainManifest = await unpack(join(plain.cwd, 'course.scorm.zip'), 'plain')
    expect(plainManifest).toContain('<schemaversion>1.2</schemaversion>')
    expect(plainManifest).not.toContain('masteryscore')

    // The pass mark's command: the zip it names, the mark in the manifest, where an LMS reads it.
    const args = embedCommand('--pass-mark')
    const mark = args[args.indexOf('--pass-mark') + 1]
    const zip = args[args.indexOf('course.h5p') + 1]
    expect(zip).toMatch(/\.zip$/)
    const graded = await runIn('graded', built.quiz, embed, args)
    expect(graded.stdout).toMatch(new RegExp(`^Wrote ${zip.replace(/\./g, '\\.')} \\([\\d.]+ MB\\): "Practice: recognizing phishing" as a SCORM 1\\.2 package \\(pass mark ${mark}\\),\\n`))
    const manifest = await unpack(join(graded.cwd, zip), 'graded')
    expect(manifest).toContain(`<adlcp:masteryscore>${mark}</adlcp:masteryscore>`)

    // First session: the first question right, then the learner leaves.
    const { context, page } = await lms('1.2', { 'cmi.student_data.mastery_score': mark })
    let { h5p } = await launch(page, 'graded')
    await h5p.getByRole('radio', { name: /known bookmark/ }).click()
    await press(h5p, 'Check')
    await holds(page, 'cmi.interactions.0.result', 'correct')
    await press(h5p, 'Next')
    await h5p.getByText('Which features of an unexpected email').waitFor()
    await leave(page)
    let values = await kept(page)
    expect(values).toMatchObject({ 'cmi.core.lesson_status': 'incomplete', 'cmi.core.exit': 'suspend' })
    expect(values['cmi.core.score.raw']).toBeUndefined()
    // The saved state, compressed as base64: nothing an LMS's storage could mangle, and within 1.2's 4,096.
    expect(values['cmi.suspend_data']).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(values['cmi.suspend_data'].length).toBeLessThan(4096)

    // Second session: the quiz continues where it was, with the first answer kept.
    let sco: Frame
    ;({ sco, h5p } = await launch(page, 'graded'))
    expect((await kept(page))['cmi.core.entry']).toBe('resume')
    await h5p.getByText('Which features of an unexpected email').waitFor({ timeout: 30_000 })
    // One of the two right answers: two of the quiz's three points, 66.67, which the quiz's own
    // 50% passes and the mark of 80 fails.
    await h5p.getByRole('checkbox', { name: /password by email/ }).click()
    await press(h5p, 'Check')
    await press(h5p, 'Finish')
    await holds(page, 'cmi.core.lesson_status', Number(mark) <= 66.67 ? 'passed' : 'failed')
    const results = await sco.evaluate(() => (window as unknown as Results).results)
    expect(results.at(-1)).toMatchObject({ success: true, score: { raw: 2, max: 3 } })
    values = await kept(page)
    expect(values).toMatchObject({ 'cmi.core.score.raw': '66.67', 'cmi.core.score.min': '0', 'cmi.core.score.max': '100' })
    expect(values['cmi.core.session_time']).toMatch(/^\d{2,4}:\d{2}:\d{2}(\.\d{1,2})?$/)
    // Each question once, under an identifier 1.2 takes, the first from the first session.
    const ids = Object.keys(values).filter((key) => /^cmi\.interactions\.\d+\.id$/.test(key)).map((key) => values[key])
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    for (const id of ids) expect(id).toMatch(/^[\x21-\x7e]{1,255}$/)
    expect(values).toMatchObject({ 'cmi.interactions.0.type': 'choice', 'cmi.interactions.0.result': 'correct', 'cmi.interactions.1.type': 'choice', 'cmi.interactions.1.result': 'wrong' })

    // A finished 1.2 session ends with nothing to resume.
    await leave(page)
    expect((await kept(page))['cmi.core.exit']).toBe('')
    await context.close()
  })

  it('in SCORM 2004 counts content that finishes without a score as 100, keeps it, and leaves what never finishes incomplete', async () => {
    const args = embedCommand('--scorm-version', '--completion-score')
    expect(args[args.indexOf('--scorm-version') + 1]).toBe('2004')
    for (const name of ['questionnaire', 'scenario', 'presentation']) {
      const { cwd, stdout } = await runIn(`s2004-${name}`, built[name], embed, args)
      expect(stdout).toMatch(/^Wrote course\.scorm\.zip \([\d.]+ MB\): ".+" as a SCORM 2004 4th Edition package \(completion counts as 100\),\n/)
      expect(await unpack(join(cwd, 'course.scorm.zip'), name)).toContain('<schemaversion>2004 4th Edition</schemaversion>')
    }
    const finishedAs100 = { 'cmi.completion_status': 'completed', 'cmi.success_status': 'unknown', 'cmi.score.raw': '100', 'cmi.score.scaled': '1' }

    // A questionnaire, submitted: completed with no score of its own.
    {
      const { context, page } = await lms('2004')
      let { sco, h5p } = await launch(page, 'questionnaire')
      await h5p.getByRole('radio', { name: 'Sometimes' }).click()
      await press(h5p, 'Continue')
      await h5p.locator('textarea').locator('visible=true').fill('The Rhine: I grew up beside it.')
      await press(h5p, 'Continue')
      await press(h5p, 'Submit')
      await holds(page, 'cmi.completion_status', 'completed')
      // One result, the questionnaire's, and no score in it: the 100 is the option's.
      const results = await sco.evaluate(() => (window as unknown as Results).results)
      expect(results).toHaveLength(1)
      expect(results[0]?.score?.max ?? 0).toBe(0)
      expect(await kept(page)).toMatchObject(finishedAs100)
      // Left and launched again: a 2004 session is suspended, and the result stays.
      await leave(page)
      expect((await kept(page))['cmi.exit']).toBe('suspend')
      ;({ sco, h5p } = await launch(page, 'questionnaire'))
      expect((await kept(page))['cmi.entry']).toBe('resume')
      await page.waitForTimeout(1000)
      expect(await kept(page)).toMatchObject(finishedAs100)
      await context.close()
    }

    // A branching scenario without scoring, played to an ending: 0 of 0, so no score either.
    {
      const { context, page } = await lms('2004')
      const { sco, h5p } = await launch(page, 'scenario')
      await pressFor(h5p, 'Start the course', 'You reach a river after heavy rain')
      await pressFor(h5p, 'Proceed', 'How do you cross?')
      await pressFor(h5p, 'Walk to the bridge', 'The bridge takes longer')
      await pressFor(h5p, 'Proceed', 'Safely across')
      await holds(page, 'cmi.completion_status', 'completed')
      const results = await sco.evaluate(() => (window as unknown as Results).results)
      expect(results).toHaveLength(1)
      expect(results[0]?.score).toMatchObject({ raw: 0, max: 0 })
      expect(await kept(page)).toMatchObject(finishedAs100)
      await context.close()
    }

    // A presentation without questions, every slide seen: it never finishes, so the option has
    // nothing to count, and the activity stays incomplete, as the skill tells the user.
    {
      const { context, page } = await lms('2004')
      const { sco, h5p } = await launch(page, 'presentation')
      await pressFor(h5p, 'Next slide', 'Courses')
      await pressFor(h5p, 'Next slide', 'Mouths')
      await expect.poll(() => h5p.getByRole('button', { name: 'Next slide' }).locator('visible=true').isDisabled()).toBe(true)
      await page.waitForTimeout(2000)
      expect(await sco.evaluate(() => (window as unknown as Results).results)).toEqual([])
      const values = await kept(page)
      expect(values['cmi.completion_status']).toBe('incomplete')
      expect(values['cmi.score.raw']).toBeUndefined()
      await context.close()
    }
  })

  it("names the embed README's supported LMSs, each added as it says and checked as far", () => {
    /** A markdown table's rows under the heading that names it, by its header's columns. */
    function table(text: string, heading: RegExp) {
      const lines = text.slice(text.search(heading)).split('\n')
      const start = lines.findIndex((line) => line.startsWith('|'))
      const block = lines.slice(start, lines.findIndex((line, i) => i > start && !line.startsWith('|')))
      const [header, , ...rows] = block.map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()))
      return rows.map((row) => Object.fromEntries(header.map((name, i) => [name, row[i]])))
    }
    const listed = table(readme, /^### Supported LMSs$/m)
    const named = table(skill, /^## 4\. Hand over$/m)
    expect(listed.length).toBeGreaterThan(0)
    const columns = ['LMS', 'Add the zip as', 'SCORM 2004 and the grading options']
    const pick = (rows: Array<Record<string, string>>) => rows.map((row) => columns.map((column) => row[column]))
    expect(pick(named)).toEqual(pick(listed))
  })
})
