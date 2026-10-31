import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js'
import { pack } from '@missing-elements/h5p-libraries'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildQuiz, translateDefaults, translationFiles, validateQuiz } from '../../../skills/h5p-author/scripts/build-quiz.mjs'

const skill = resolve(import.meta.dirname, '../../../skills/h5p-author')
const project = resolve(import.meta.dirname, '..')
const example = JSON.parse(await readFile(join(skill, 'assets/quiz.json'), 'utf8'))
const scenarios = JSON.parse(await readFile(join(skill, 'assets/phishing-scenarios.json'), 'utf8'))
const exec = promisify(execFile)
const require = createRequire(import.meta.url)
let dir: string

beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'h5p-author-test-')) })
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

async function archive(path: string | URL) {
  const reader = new ZipReader(new BlobReader(new Blob([await readFile(path)])), { checkSignature: true })
  try {
    const entries = (await reader.getEntries()).filter(entry => !entry.directory)
    const files = new Map<string, string>()
    // Decode every file independently; a copied entry must retain its CRC and compression method.
    for (const entry of entries) files.set(entry.filename, await entry.getData(new TextWriter()))
    return files
  } finally { await reader.close() }
}

type Field = { name: string, type: string, default?: unknown, fields?: Field[] }
type Translated = { default?: string, fields?: Translated[] }

/** A library's English and translated default for a field, named in its semantics, read from the installed part. */
async function defaults(machineName: string, code: string, path: string[]) {
  const library = pack.libraries.find(library => library.machineName === machineName && library.majorVersion === 1)!
  const files = await archive(new URL(library.url))
  let fields: Field[] = JSON.parse(files.get(`${library.folder}/semantics.json`)!)
  let translation: Translated[] = JSON.parse(files.get(`${library.folder}/language/${code}.json`)!).semantics
  let field: Field | undefined
  let translated: Translated | undefined
  for (const name of path) {
    const i = fields.findIndex(candidate => candidate.name === name)
    field = fields[i]
    translated = translation[i]
    fields = field.fields ?? []
    translation = translated.fields ?? []
  }
  return { english: field!.default, translated: translated!.default }
}

/** Builds a quiz, and reads its content back from the archive written. */
async function build(source: unknown, name: string) {
  const path = join(dir, name)
  const { translations } = await buildQuiz(source, path, project)
  return { translations, content: JSON.parse((await archive(path)).get('content/content.json')!) }
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
    // A quiz without a pass mark, and so without its messages, as before they existed.
    expect(() => validateQuiz({ ...example, passPercentage: undefined, passedFeedback: undefined, failedFeedback: undefined })).not.toThrow()
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
    [{ ...example, failedFeedback: undefined }, 'quiz.failedFeedback: set passedFeedback and failedFeedback together'],
    [{ ...example, passedFeedback: undefined }, 'quiz.passedFeedback: set passedFeedback and failedFeedback together'],
    [{ ...example, passedFeedback: ' ' }, 'quiz.passedFeedback: expected non-empty text'],
    [{ ...example, passPercentage: undefined }, 'quiz.passPercentage: set it with passedFeedback and failedFeedback'],
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
    // The pass mark as the set's own score ranges, escaped as H5P stores a text field; the rest
    // of the result page keeps its defaults, and no question inside gets the quiz's message.
    expect(content.endGame.overallFeedback).toEqual([
      { from: 0, to: 99, feedback: 'Not passed yet. Read each answer&#39;s feedback, then select Retry.' },
      { from: 100, to: 100, feedback: 'Passed. You chose the safe response every time.' }
    ])
    expect(content.endGame.retryButtonText).toBe('Retry')
    // English is the libraries' own; no file stands in for it.
    expect(result.translations.map(({ translation }) => translation)).toEqual([null, null])
    for (const question of content.questions) expect(question.params.overallFeedback).toBeUndefined()
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
      ...example, kind: 'multiple-choice', passPercentage: 0, passedFeedback: 'Done <b>& dusted</b>',
      questions: [{ ...example.questions[0], prompt: '<script>run()</script> & "quoted"\nNext line' }]
    }
    const { manifest, content, libraries } = await buildQuiz(source, path, project)
    expect(manifest.mainLibrary).toBe('H5P.MultiChoice')
    expect(content.question).toBe('<p>&lt;script&gt;run()&lt;/script&gt; &amp; &quot;quoted&quot;<br>Next line</p>')
    expect(content.behaviour).toMatchObject({ type: 'single', passPercentage: 0 })
    // With nothing to fail, one range: every score passes.
    expect(content.overallFeedback).toEqual([{ from: 0, to: 100, feedback: 'Done &lt;b&gt;&amp; dusted&lt;/b&gt;' }])
    expect(content.answers).toEqual(expect.arrayContaining([expect.objectContaining({ correct: false })]))
    expect(libraries.some(name => name.startsWith('H5P.QuestionSet-'))).toBe(false)
    await archive(path)
  })

  it('stores question titles and author names as H5P stores text, and h5p.json as its exports write it', async () => {
    const source = {
      ...example,
      authors: [{ name: "Anne O'Brien <ed>", role: 'Author' }],
      questions: [{ ...example.questions[0], title: 'Kyivan Rus\' & "Cossacks" <b>' }, { ...example.questions[1], title: undefined }]
    }
    const path = join(dir, 'punctuation.h5p')
    await buildQuiz(source, path, project)
    const files = await archive(path)
    const content = JSON.parse(files.get('content/content.json')!)
    expect(content.questions.map((question: { metadata: { title: string } }) => question.metadata.title)).toEqual(['Kyivan Rus&#39; &amp; &quot;Cossacks&quot; &lt;b&gt;', 'Question 2'])
    for (const question of content.questions) expect(question.metadata.authors).toEqual([{ name: 'Anne O&#39;Brien &lt;ed&gt;', role: 'Author' }])
    expect(JSON.parse(files.get('h5p.json')!).authors).toEqual(source.authors)
  })

  it('builds the eight-scenario example without losing questions, feedback, or its pass threshold', async () => {
    const path = join(dir, 'scenarios.h5p')
    await buildQuiz(scenarios, path, project)
    const files = await archive(path)
    const content = JSON.parse(files.get('content/content.json')!)
    expect(content.passPercentage).toBe(80)
    expect(content.endGame.overallFeedback.map(({ from, to }: { from: number, to: number }) => [from, to])).toEqual([[0, 79], [80, 100]])
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

  // Names as the pack's quiz libraries have them, `sme` and Question Set's Traditional `zh` among them.
  const files = ['de', 'es', 'es-mx', 'he', 'nb', 'nn', 'pt', 'pt-br', 'sme', 'sr', 'zh', 'zh-cn', 'zh-hans', 'zh-hant', 'zh-tw']
  it.each([
    ['de', ['de']],
    ['de-AT', ['de']],
    ['es-MX', ['es-mx', 'es']],
    ['pt-BR', ['pt-br', 'pt']],
    ['iw', ['he']],
    ['no', ['nb']],
    ['se', ['sme']],
    ['sr-Cyrl-BA', ['sr']],
    ['sr-Latn', []],
    ['sh', []],
    ['zh', ['zh-hans', 'zh-cn']],
    ['zh-TW', ['zh-hant', 'zh-tw']],
    ['zh-Hant', ['zh-hant', 'zh-tw']],
    ['en', []]
  ])('looks the translation for %s up by H5P\'s file names, never in another script', (tag, names) => {
    expect(translationFiles(files, tag)).toEqual(names)
  })

  it('takes a translation\'s text defaults only, and keeps the English where it has none, the same, or loses a placeholder', () => {
    const fields = [
      { name: 'check', type: 'text', default: 'Check' },
      { name: 'mode', type: 'select', default: 'auto' },
      { name: 'score', type: 'text', default: 'You got :num of :total' },
      {
        name: 'texts', type: 'group', fields: [
          { name: 'question', type: 'text', default: 'Question' },
          { name: 'next', type: 'text', default: 'Next' },
          { name: 'progress', type: 'text', default: '@current of @total' },
          { name: 'results', type: 'text', default: 'Results' }
        ]
      },
      { name: 'items', type: 'list', field: { name: 'item', type: 'text', default: 'Item' } }
    ]
    const { strings, translated, english } = translateDefaults(fields, [
      { default: 'Prüfen' },
      { default: 'manuell' },
      { default: 'Du hast :num von :max' },
      { fields: [{ default: 'Question' }, { default: ' ' }, { default: '@current von @total' }] },
      { field: { default: 'Eintrag' } }
    ])
    expect(strings).toBe(7)
    expect(translated.map(({ field, text }) => [field.name, text])).toEqual([['check', 'Prüfen'], ['progress', '@current von @total'], ['item', 'Eintrag']])
    expect(english).toEqual([
      { field: 'score', text: 'You got :num of :total', dropped: [':total'] },
      { field: 'texts.question', text: 'Question' },
      { field: 'texts.next', text: 'Next' },
      { field: 'texts.results', text: 'Results' }
    ])
    expect(translateDefaults(fields, { semantics: [] }).translated).toEqual([])
  })

  it('takes the interface texts from the libraries\' own translation for the quiz\'s language', async () => {
    const untitled = { ...example, language: 'de-AT', questions: example.questions.map(({ title: _, ...question }: { title?: string }) => question) }
    const { content, translations } = await build(untitled, 'german.h5p')
    expect(translations.map(({ library, translation }) => [library.split(' ')[0], translation])).toEqual([['H5P.QuestionSet', 'de'], ['H5P.MultiChoice', 'de']])
    const question = content.questions[0].params
    for (const [machineName, path, value] of [
      ['H5P.QuestionSet', ['introPage', 'startButtonText'], content.introPage.startButtonText],
      ['H5P.QuestionSet', ['texts', 'finishButton'], content.texts.finishButton],
      ['H5P.QuestionSet', ['endGame', 'retryButtonText'], content.endGame.retryButtonText],
      ['H5P.MultiChoice', ['UI', 'checkAnswerButton'], question.UI.checkAnswerButton]
    ] as const) {
      const { english, translated } = await defaults(machineName, 'de', [...path])
      expect(translated).not.toBe(english)
      expect(value, path.join('.')).toBe(translated)
    }
    // What the report names as English is what the content holds.
    for (const [report, params] of [[translations[0], content], [translations[1], question]] as const) {
      for (const { field, text } of report.english) expect(field.split('.').reduce((object, key) => object[key], params), field).toBe(text)
    }
    // An untitled question is named as the set labels it, in the result screen's list too.
    const { translated: label } = await defaults('H5P.QuestionSet', 'de', ['texts', 'questionLabel'])
    expect(content.questions.map((question: { metadata: { title: string } }) => question.metadata.title)).toEqual([`${label} 1`, `${label} 2`])
  })

  it('stores a translated text as H5P stores plain text, escaped', async () => {
    const { content } = await build({ ...example, kind: 'multiple-choice', language: 'uk', questions: [example.questions[0]] }, 'ukrainian.h5p')
    const { translated } = await defaults('H5P.MultiChoice', 'uk', ['UI', 'feedbackAvailable'])
    expect(translated).toContain("'")
    expect(content.UI.feedbackAvailable).toBe(translated!.replaceAll("'", '&#39;'))
  })

  it('never gives Simplified Chinese a Traditional file, and says when a library has no translation', async () => {
    const chinese = await build({ ...example, language: 'zh-CN' }, 'chinese.h5p')
    // Question Set's `zh.json` is Traditional, and it has no Simplified file.
    expect(chinese.translations.map(({ translation }) => translation)).toEqual([null, 'zh-hans'])
    expect(chinese.content.texts.finishButton).toBe('Finish')
    const esperanto = await build({ ...example, language: 'eo' }, 'esperanto.h5p')
    expect(esperanto.translations).toEqual([
      expect.objectContaining({ translation: null, strings: esperanto.translations[0].english.length }),
      expect.objectContaining({ translation: null, strings: esperanto.translations[1].english.length })
    ])
    expect(esperanto.content.questions[0].params.UI.checkAnswerButton).toBe('Check')
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
    // In another language, the command says where the interface texts came from.
    await writeFile(join(portable, 'german.json'), JSON.stringify({ ...example, language: 'de' }))
    const german = await exec(process.execPath, [script, 'german.json', 'german.h5p'], { cwd: portable })
    expect(german.stdout).toMatch(/H5P\.MultiChoice 1\.\d+: interface texts from its translation language\/de\.json\./)
    expect(german.stdout + german.stderr).toMatch(/H5P\.QuestionSet 1\.\d+: interface texts from its translation language\/de\.json/)
    const failed = exec(process.execPath, [script, join(portable, 'installed-skill/assets/quiz.json'), 'missing.h5p'], {
      cwd: dir, env: { ...process.env, NODE_PATH: '' }
    })
    await expect(failed).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('npm install --save-dev') })
  })
})
