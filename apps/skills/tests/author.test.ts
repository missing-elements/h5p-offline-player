import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js'
import { pack } from '@missing-elements/h5p-libraries'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildQuiz, validateQuiz } from '../../../skills/h5p-author/scripts/build-quiz.mjs'

const skill = resolve(import.meta.dirname, '../../../skills/h5p-author')
const project = resolve(import.meta.dirname, '..')
const example = JSON.parse(await readFile(join(skill, 'assets/quiz.json'), 'utf8'))
const scenarios = JSON.parse(await readFile(join(skill, 'assets/phishing-scenarios.json'), 'utf8'))
const exec = promisify(execFile)
const require = createRequire(import.meta.url)
let dir: string

beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'h5p-author-test-')) })
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

async function archive(path: string) {
  const reader = new ZipReader(new BlobReader(new Blob([await readFile(path)])), { checkSignature: true })
  try {
    const entries = (await reader.getEntries()).filter(entry => !entry.directory)
    const files = new Map<string, string>()
    // Decode every file independently; a copied entry must retain its CRC and compression method.
    for (const entry of entries) files.set(entry.filename, await entry.getData(new TextWriter()))
    return files
  } finally { await reader.close() }
}

async function copyDependencies(projectDir: string) {
  for (const name of ['@missing-elements/h5p-libraries', '@zip.js/zip.js']) {
    await cp(dirname(require.resolve(name)), join(projectDir, 'node_modules', name), {
      recursive: true, filter: path => basename(path) !== 'node_modules'
    })
  }
}

describe('quiz authoring', () => {
  it('accepts both kinds, multiple correct answers, and a zero pass threshold', () => {
    expect(() => validateQuiz(example)).not.toThrow()
    expect(() => validateQuiz({ ...example, kind: 'multiple-choice', passPercentage: 0, questions: [example.questions[0]] })).not.toThrow()
  })

  it.each([
    [null, 'quiz: expected an object'],
    [{ ...example, kind: 'slides' }, 'quiz.kind'],
    [{ ...example, title: '' }, 'quiz.title'],
    [{ ...example, title: 'a'.repeat(256) }, 'quiz.title'],
    [{ ...example, language: 'not_a_tag' }, 'quiz.language'],
    [{ ...example, license: 'made-up' }, 'quiz.license'],
    [{ ...example, authors: [] }, 'quiz.authors'],
    [{ ...example, authors: [{ name: 'A', role: 'Editor' }] }, 'quiz.authors[0].role'],
    [{ ...example, passPercentage: 101 }, 'quiz.passPercentage'],
    [{ ...example, passPercentage: '50' }, 'quiz.passPercentage'],
    [{ ...example, questions: [] }, 'quiz.questions'],
    [{ ...example, kind: 'multiple-choice' }, 'exactly one question'],
    [{ ...example, customJs: 'evil.js' }, 'quiz.customJs: unsupported field'],
    [{ ...example, questions: [null] }, 'quiz.questions[0]'],
    [{ ...example, questions: [{ ...example.questions[0], prompt: '' }] }, 'quiz.questions[0].prompt'],
    [{ ...example, questions: [{ ...example.questions[0], multipleAnswers: 'yes' }] }, 'quiz.questions[0].multipleAnswers'],
    [{ ...example, questions: [{ ...example.questions[0], answers: [] }] }, 'at least two answers'],
    [{ ...example, questions: [{ ...example.questions[0], answers: [{ text: 'a', correct: 'true' }, { text: 'b', correct: false }] }] }, '.correct'],
    [{ ...example, questions: [{ ...example.questions[0], answers: [{ text: 'a', correct: true }, { text: 'b', correct: true }] }] }, 'exactly one answer'],
    [{ ...example, questions: [{ ...example.questions[0], multipleAnswers: true, answers: [{ text: 'a', correct: false }, { text: 'b', correct: false }] }] }, 'at least one answer'],
    [{ ...example, questions: [{ ...example.questions[0], answers: [{ text: 'a', correct: true, typo: 'lost' }, { text: 'b', correct: false }] }] }, '.typo: unsupported field']
  ])('rejects malformed input with its field path (%#)', (input, message) => {
    expect(() => validateQuiz(input)).toThrow(message)
  })

  it('builds a self-contained Question Set using pack versions, semantics defaults, and the full dependency closure', async () => {
    const path = join(dir, 'set.h5p')
    const result = await buildQuiz(example, path, project)
    const files = await archive(path)
    const manifest = JSON.parse(files.get('h5p.json')!)
    const content = JSON.parse(files.get('content/content.json')!)
    expect([...files.keys()][0]).toBe('h5p.json')
    expect([...files.keys()].at(-1)).toBe('content/content.json')
    expect(manifest.mainLibrary).toBe('H5P.QuestionSet')
    expect(manifest.defaultLanguage).toBe(example.language)
    expect(manifest.authors).toEqual(example.authors)
    expect(content.passPercentage).toBe(100)
    expect(content.texts.finishButton).toBeTruthy()
    expect(content.endGame.showResultPage).toBe(true)
    expect(content.questions).toHaveLength(2)
    expect(content.questions[0].params.question).toContain(example.questions[0].prompt)
    expect(content.questions[0].params.UI.checkAnswerButton).toBe('Check')
    expect(content.questions[0].params.behaviour.type).toBe('single')
    expect(content.questions[1].params.behaviour.type).toBe('multi')
    const ids = content.questions.map((question: { subContentId: string }) => question.subContentId)
    expect(new Set(ids).size).toBe(2)
    expect(ids.every((id: string) => /^[0-9a-f-]{36}$/.test(id))).toBe(true)
    expect(result.libraries.length).toBeGreaterThan(2)
    expect(result.libraries.length).toBeLessThan(30)
    for (const dependency of manifest.preloadedDependencies) {
      expect(files.has(`${dependency.machineName}-${dependency.majorVersion}.${dependency.minorVersion}/library.json`)).toBe(true)
    }
    for (const [name, json] of files) {
      if (!name.endsWith('/library.json')) continue
      const library = JSON.parse(json)
      expect(library.machineName).not.toMatch(/H5PEditor/)
      for (const dependency of [...(library.preloadedDependencies ?? []), ...(library.dynamicDependencies ?? [])]) {
        const available = manifest.preloadedDependencies.find((candidate: { machineName: string, majorVersion: string, minorVersion: string }) =>
          candidate.machineName === dependency.machineName && Number(candidate.majorVersion) === Number(dependency.majorVersion) && Number(candidate.minorVersion) >= Number(dependency.minorVersion))
        expect(available, `${name}: ${dependency.machineName}`).toBeDefined()
      }
    }
  })

  it('builds standalone Multiple Choice, escapes markup, and preserves false and zero values', async () => {
    const path = join(dir, 'single.h5p')
    const source = {
      ...example, kind: 'multiple-choice', passPercentage: 0,
      questions: [{ ...example.questions[0], prompt: '<script>run()</script> & "quoted"\nNext line' }]
    }
    const { manifest, content, libraries } = await buildQuiz(source, path, project)
    expect(manifest.mainLibrary).toBe('H5P.MultiChoice')
    expect(content.question).toBe('<p>&lt;script&gt;run()&lt;/script&gt; &amp; &quot;quoted&quot;<br>Next line</p>')
    expect(content.behaviour).toMatchObject({ type: 'single', passPercentage: 0 })
    expect(content.answers).toEqual(expect.arrayContaining([expect.objectContaining({ correct: false })]))
    expect(libraries.some(name => name.startsWith('H5P.QuestionSet-'))).toBe(false)
    await archive(path)
  })

  it('builds the eight-scenario example without losing questions, feedback, or its pass threshold', async () => {
    const path = join(dir, 'scenarios.h5p')
    await buildQuiz(scenarios, path, project)
    const files = await archive(path)
    const content = JSON.parse(files.get('content/content.json')!)
    expect(content.passPercentage).toBe(80)
    expect(content.questions).toHaveLength(8)
    expect(content.questions.filter((question: { params: { behaviour: { type: string } } }) => question.params.behaviour.type === 'multi')).toHaveLength(4)
    expect(content.questions[0].params.question).toContain('&quot;Benefits &amp; Payroll:')
    expect(content.questions[0].params.question).toContain('<br>')
    for (let i = 0; i < scenarios.questions.length; i++) {
      const written = scenarios.questions[i]
      const generated = content.questions[i]
      expect(generated.metadata.title).toBe(written.title)
      expect(generated.params.answers).toHaveLength(4)
      for (let j = 0; j < written.answers.length; j++) {
        expect(written.answers[j].feedback).toBeTruthy()
        expect(generated.params.answers[j].correct).toBe(written.answers[j].correct)
        expect(generated.params.answers[j].tipsAndFeedback.chosenFeedback).toBeTruthy()
      }
    }
  })

  it('does not overwrite an output, publish partial failures, or leave staging directories', async () => {
    const path = join(dir, 'existing.h5p')
    await writeFile(path, 'keep me')
    await expect(buildQuiz(example, path, project)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(path, 'utf8')).toBe('keep me')
    expect((await readdir(dir)).filter(name => name.startsWith('.h5p-author-'))).toEqual([])
    await expect(buildQuiz({ ...example, questions: [] }, join(dir, 'invalid.h5p'), project)).rejects.toThrow('quiz.questions')
    expect(await readdir(dir)).not.toContain('invalid.h5p')
  })

  it('refuses a damaged library part before publishing an archive', async () => {
    const damaged = join(dir, 'damaged-pack')
    await copyDependencies(damaged)
    const library = pack.libraries.find(library => library.machineName === 'H5P.MultiChoice' && library.majorVersion === 1)!
    const part = join(damaged, `node_modules/@missing-elements/h5p-libraries/parts/${library.folder}.h5p`)
    const bytes = await readFile(part)
    const reader = new ZipReader(new BlobReader(new Blob([bytes])))
    try {
      const entry = (await reader.getEntries()).find(entry => !entry.directory && entry.filename.endsWith('.js'))!
      const offset = entry.offset + 30 + bytes.readUInt16LE(entry.offset + 26) + bytes.readUInt16LE(entry.offset + 28)
      // Damage script data without changing library.json, semantics, or the central directory.
      bytes[offset + Math.floor(entry.compressedSize / 2)] ^= 1
    } finally { await reader.close() }
    await writeFile(part, bytes)
    const output = join(damaged, 'quiz.h5p')
    await expect(buildQuiz(example, output, damaged)).rejects.toThrow(`Library part failed SHA-256: ${library.folder}`)
    expect(await readdir(damaged)).not.toContain('quiz.h5p')
    expect((await readdir(damaged)).filter(name => name.startsWith('.h5p-author-'))).toEqual([])
  })

  it('stops with the install command when the project has an older zip.js', async () => {
    const old = join(dir, 'old-zip')
    const installed = join(old, 'node_modules/@zip.js/zip.js')
    await mkdir(installed, { recursive: true })
    // 2.15 has appendZip without its filter option; only the version is read before the refusal.
    await writeFile(join(installed, 'package.json'), JSON.stringify({ name: '@zip.js/zip.js', version: '2.15.0', exports: { './package.json': './package.json' } }))
    const error = await buildQuiz(example, join(old, 'quiz.h5p'), old).catch(error => error)
    expect(error.message).toContain('Run: npm install --save-dev @missing-elements/h5p-libraries@^1 @zip.js/zip.js@^2.24')
    expect(error.cause.message).toBe('@zip.js/zip.js 2.15.0 is older than 2.24')
    expect(await readdir(old)).toEqual(['node_modules'])
  })

  it('runs a copied skill outside the checkout and resolves dependencies from the calling project', async () => {
    const portable = join(dir, 'portable')
    await cp(skill, join(portable, 'installed-skill'), { recursive: true })
    expect(await readFile(join(portable, 'installed-skill/LICENSE'), 'utf8')).toBe(await readFile(resolve(project, '../../LICENSE'), 'utf8'))
    await writeFile(join(portable, 'package.json'), '{"private":true}')
    await copyDependencies(portable)
    const script = join(portable, 'installed-skill/scripts/build-quiz.mjs')
    const { stdout } = await exec(process.execPath, [script, join(portable, 'installed-skill/assets/quiz.json'), 'portable.h5p'], { cwd: portable })
    expect(stdout).toContain('Not verified')
    const files = await archive(join(portable, 'portable.h5p'))
    expect(JSON.parse(files.get('h5p.json')!).mainLibrary).toBe('H5P.QuestionSet')
    const failed = exec(process.execPath, [script, join(portable, 'installed-skill/assets/quiz.json'), 'missing.h5p'], {
      cwd: dir, env: { ...process.env, NODE_PATH: '' }
    })
    await expect(failed).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('npm install --save-dev') })
  })
})
