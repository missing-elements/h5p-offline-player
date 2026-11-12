import { execFile } from 'node:child_process'
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { BlobReader, TextWriter, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js'
import { pack } from '@missing-elements/h5p-libraries'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildPackage, librariesIn, missingForInstall, SourceError } from '../lib/author.mjs'
import { readSource } from '../lib/build.mjs'
import { MediaStore } from '../lib/media.mjs'
import { nodeMedia } from '../lib/node.mjs'
import { quizProblems } from '../lib/quiz.mjs'
import { jpeg, mp4, png } from './helpers/media'

// The quiz format's two examples, from the skill that first wrote it.
const fixtures = resolve(import.meta.dirname, 'fixtures')
const parts = resolve(import.meta.dirname, '../../libraries/parts')
const bin = resolve(import.meta.dirname, '../bin/h5p-author.mjs')
const example = JSON.parse(await readFile(join(fixtures, 'quiz.json'), 'utf8'))
const scenarios = JSON.parse(await readFile(join(fixtures, 'phishing-scenarios.json'), 'utf8'))
const exec = promisify(execFile)
const META = { title: 'Rivers', language: 'en', license: 'CC BY', authors: [{ name: 'Ann Author', role: 'Author' }] }
let dir: string
let count = 0

beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'h5p-author-test-')) })
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

async function archive(path: string | URL) {
  const reader = new ZipReader(new BlobReader(new Blob([await readFile(path)])), { checkSignature: true })
  try {
    const entries = (await reader.getEntries()).filter(entry => !entry.directory)
    const files = new Map<string, string>()
    // Decode every file independently; a copied entry must retain its CRC and compression method.
    for (const entry of entries) files.set(entry.filename, await entry.getData(new TextWriter()))
    return { files, entries }
  } finally { await reader.close() }
}

/** Builds a source, and reads its content back from the archive written. */
async function build(source: unknown, options: Parameters<typeof buildPackage>[2] = {}) {
  const path = join(dir, `build-${++count}.h5p`)
  const result = await buildPackage(source, path, options)
  const { files, entries } = await archive(path)
  return { ...result, files, entries, content: JSON.parse(files.get('content/content.json')!), manifest: JSON.parse(files.get('h5p.json')!) }
}

/** The problems a source has, as `path: message`. */
async function problems(source: unknown, options: Parameters<typeof buildPackage>[2] = {}) {
  const error = await buildPackage(source, join(dir, `failed-${++count}.h5p`), options).then(() => null, (error: unknown) => error)
  expect(error).toBeInstanceOf(SourceError)
  return (error as SourceError).problems.map(({ path, message }) => `${path}: ${message}`)
}

type Field = { name: string, type: string, default?: unknown, fields?: Field[] }
type Translated = { default?: string, fields?: Translated[] }

/** A library's English and translated default for a field, named in its semantics, read from the pack's part. */
async function defaults(machineName: string, code: string, path: string[]) {
  const library = pack.libraries.find(library => library.machineName === machineName && library.majorVersion === 1)!
  const { files } = await archive(new URL(library.url))
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

describe('the quiz format', () => {
  it('accepts both kinds, multiple correct answers, and a zero pass threshold', () => {
    expect(quizProblems(example)).toEqual([])
    expect(quizProblems({ ...example, kind: 'multiple-choice', passPercentage: 0, questions: [example.questions[0]] })).toEqual([])
    // A quiz without a pass mark, and so without its messages, as before they existed.
    expect(quizProblems({ ...example, passPercentage: undefined, passedFeedback: undefined, failedFeedback: undefined })).toEqual([])
  })

  it.each([
    [null, 'source: expected an object'],
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
    expect(() => readSource(input)).toThrow(SourceError)
    expect(() => readSource(input)).toThrow(message)
  })

  it('lists every problem a quiz has at once, each by its path', () => {
    const quiz = { ...example, title: '', license: 'made-up', questions: [{ ...example.questions[0], prompt: '' }, { ...example.questions[1], answers: [{ text: 'a', correct: true }] }] }
    expect(quizProblems(quiz).map(({ path, message }) => `${path}: ${message}`)).toEqual([
      'quiz.title: expected non-empty text',
      'quiz.license: use an H5P license code (for example "U", "CC BY", or "CC0 1.0")',
      'quiz.questions[0].prompt: expected non-empty text',
      'quiz.questions[1].answers: at least two answers are required'
    ])
  })

  it('builds a self-contained Question Set using pack versions, semantics defaults, and the full dependency closure', async () => {
    const { files, content, manifest, translations, libraries, install } = await build(example)
    expect([...files.keys()][0]).toBe('h5p.json')
    // The content comes after the libraries that play; only what an H5P site's upload check wants follows it (#146).
    expect([...files.keys()].filter(name => !install.includes(name.slice(0, name.indexOf('/')))).at(-1)).toBe('content/content.json')
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
    expect(translations.map(({ translation }) => translation)).toEqual([null, null])
    for (const question of content.questions) expect((question.params.overallFeedback ?? []).filter((range: { feedback?: string }) => range.feedback)).toEqual([])
    expect(content.questions).toHaveLength(2)
    expect(content.questions[0].params.question).toContain(example.questions[0].prompt)
    expect(content.questions[0].params.UI.checkAnswerButton).toBe('Check')
    expect(content.questions[0].params.behaviour.type).toBe('single')
    expect(content.questions[1].params.behaviour.type).toBe('multi')
    expect(content.questions[0].metadata).toMatchObject({ contentType: 'Multiple Choice', license: example.license })
    const ids = content.questions.map((question: { subContentId: string }) => question.subContentId)
    expect(new Set(ids).size).toBe(2)
    expect(ids.every((id: string) => /^[0-9a-f-]{36}$/.test(id))).toBe(true)
    expect(libraries.length).toBeGreaterThan(2)
    expect(libraries.length).toBeLessThan(30)
    for (const dependency of manifest.preloadedDependencies) {
      expect(files.has(`${dependency.machineName}-${dependency.majorVersion}.${dependency.minorVersion}/library.json`)).toBe(true)
    }
    for (const [name, json] of files) {
      // The libraries that play; what an H5P site's upload check wants follows the content (#146).
      if (!name.endsWith('/library.json') || install.includes(name.slice(0, name.indexOf('/')))) continue
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
    const source = {
      ...example, kind: 'multiple-choice', passPercentage: 0, passedFeedback: 'Done <b>& dusted</b>',
      questions: [{ ...example.questions[0], prompt: '<script>run()</script> & "quoted"\nNext line' }]
    }
    const { manifest, content, libraries } = await build(source)
    expect(manifest.mainLibrary).toBe('H5P.MultiChoice')
    expect(content.question).toBe('<p>&lt;script&gt;run()&lt;/script&gt; &amp; &quot;quoted&quot;<br>Next line</p>')
    expect(content.behaviour).toMatchObject({ type: 'single', passPercentage: 0 })
    // With nothing to fail, one range: every score passes.
    expect(content.overallFeedback).toEqual([{ from: 0, to: 100, feedback: 'Done &lt;b&gt;&amp; dusted&lt;/b&gt;' }])
    expect(content.answers).toEqual(expect.arrayContaining([expect.objectContaining({ correct: false })]))
    expect(libraries.some(name => name.startsWith('H5P.QuestionSet-'))).toBe(false)
  })

  it('stores question titles and author names as H5P stores text, and h5p.json as its exports write it', async () => {
    const source = {
      ...example,
      authors: [{ name: "Anne O'Brien <ed>", role: 'Author' }],
      questions: [{ ...example.questions[0], title: 'Kyivan Rus\' & "Cossacks" <b>' }, { ...example.questions[1], title: undefined }]
    }
    const { content, manifest } = await build(source)
    expect(content.questions.map((question: { metadata: { title: string } }) => question.metadata.title)).toEqual(['Kyivan Rus&#39; &amp; &quot;Cossacks&quot; &lt;b&gt;', 'Question 2'])
    for (const question of content.questions) expect(question.metadata.authors).toEqual([{ name: 'Anne O&#39;Brien &lt;ed&gt;', role: 'Author' }])
    expect(manifest.authors).toEqual(source.authors)
  })

  it('builds the eight-scenario example without losing questions, feedback, or its pass threshold', async () => {
    const { content } = await build(scenarios)
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
        expect(generated.params.answers[j].correct).toBe(written.answers[j].correct)
        expect(generated.params.answers[j].tipsAndFeedback.chosenFeedback).toBeTruthy()
      }
    }
  })

  it('takes the interface texts from the libraries\' own translation for the quiz\'s language', async () => {
    const untitled = { ...example, language: 'de-AT', questions: example.questions.map(({ title: _, ...question }: { title?: string }) => question) }
    const { content, translations } = await build(untitled)
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
    const { content } = await build({ ...example, kind: 'multiple-choice', language: 'uk', questions: [example.questions[0]] })
    const { translated } = await defaults('H5P.MultiChoice', 'uk', ['UI', 'feedbackAvailable'])
    expect(translated).toContain("'")
    expect(content.UI.feedbackAvailable).toBe(translated!.replaceAll("'", '&#39;'))
  })

  it('never gives Simplified Chinese a Traditional file, and says when a library has no translation', async () => {
    const chinese = await build({ ...example, language: 'zh-CN' })
    // Question Set's `zh.json` is Traditional, and it has no Simplified file.
    expect(chinese.translations.map(({ translation }) => translation)).toEqual([null, 'zh-hans'])
    expect(chinese.content.texts.finishButton).toBe('Finish')
    const esperanto = await build({ ...example, language: 'eo' })
    expect(esperanto.translations).toEqual([
      expect.objectContaining({ translation: null, strings: esperanto.translations[0].english.length }),
      expect.objectContaining({ translation: null, strings: esperanto.translations[1].english.length })
    ])
    expect(esperanto.content.questions[0].params.UI.checkAnswerButton).toBe('Check')
  })
})

describe('any content type in the pack', () => {
  it('builds from the fields that differ from the defaults, the rest from the semantics', async () => {
    const { content, manifest, notes } = await build({
      ...META,
      type: 'H5P.Blanks',
      params: { questions: ['The *Danube/Donau:It flows through Vienna* reaches the Black Sea.', '<p>Paris lies on the <strong>*Seine*</strong>.</p>'], behaviour: { caseSensitive: false } }
    })
    expect(manifest).toMatchObject({ mainLibrary: 'H5P.Blanks', license: 'CC BY', title: 'Rivers' })
    expect(content.questions).toEqual(['<p>The *Danube/Donau:It flows through Vienna* reaches the Black Sea.</p>', '<p>Paris lies on the <strong>*Seine*</strong>.</p>'])
    expect(content.behaviour).toMatchObject({ caseSensitive: false, enableRetry: true })
    expect(content.text).toBe('Fill in the missing words')
    expect(notes).toEqual([])
  })

  it('stores a plain text box as plain text, though its field lists tags', async () => {
    // Question Set 1.21's intro title and result message list tags, but the editor gives both a
    // plain text box, and the set draws both with textContent: a <div> around them was shown.
    const { content, notes } = await build({
      ...META,
      type: 'H5P.QuestionSet',
      params: {
        introPage: { showIntroPage: true, title: 'World War II: Five Historic Events', introduction: 'Five questions on the war.' },
        endGame: { message: "Tom's result" },
        questions: [{ library: 'H5P.TrueFalse', params: { question: 'The war in Europe ended in 1945.', correct: 'true' } }]
      }
    })
    expect(content.introPage.title).toBe('World War II: Five Historic Events')
    // An apostrophe as typed: the content check keeps it there, and the set shows an entity as written.
    expect(content.endGame.message).toBe("Tom's result")
    // The introduction is the set's rich-text field, wrapped as that widget wraps typing.
    expect(content.introPage.introduction).toBe('<p>Five questions on the war.</p>')
    expect(notes).toEqual([])

    // German as typed, umlauts and ß included; &, " and < stored as entities, and noted.
    const german = await build({ ...META, language: 'de', type: 'H5P.QuestionSet', params: {
      introPage: { showIntroPage: true, title: 'Größte Ereignisse: "Krieg" & Frieden' },
      questions: [{ library: 'H5P.TrueFalse', params: { question: 'Ja?', correct: 'true' } }]
    } })
    expect(german.content.introPage.title).toBe('Größte Ereignisse: &quot;Krieg&quot; &amp; Frieden')
    expect(german.notes).toContainEqual({ path: 'params.introPage.title', message: expect.stringMatching(/^stores &, ", < and > as entities/) })

    // Markup there is shown as written, as the editor's box would have stored it: noted, not refused.
    const marked = await build({ ...META, type: 'H5P.QuestionSet', params: {
      introPage: { showIntroPage: true, title: '<strong>WW2</strong>' },
      questions: [{ library: 'H5P.TrueFalse', params: { question: 'Yes?', correct: 'true' } }]
    } })
    expect(marked.content.introPage.title).toBe('&lt;strong&gt;WW2&lt;/strong&gt;')
    expect(marked.notes).toContainEqual({ path: 'params.introPage.title', message: 'is plain text, so its tags are shown as written, not as markup' })
  })

  it('lists every problem a source has at once, each by its path, and writes nothing', async () => {
    expect(await problems({ ...META, type: 'H5P.Nope', params: {} })).toEqual(['type: the library pack has no content type H5P.Nope'])
    // A version is saved content's, which checkContent takes; a build plays the pack's newest (#162).
    // What is wrong in the content is said in the same round as what is wrong beside it (#174).
    expect(await problems({ ...META, type: 'H5P.Blanks 1.14', params: {} })).toEqual([
      'type: takes the machine name alone, "H5P.Blanks": the version is the pack\'s newest',
      'params.questions: is required: write at least 1 item'
    ])
    expect(await problems({ ...META, license: 'MIT', authors: [{ name: 'A' }], extra: 1, type: 'H5P.Blanks', params: { questions: ['The *Danube* flows east.'] } })).toEqual([
      'extra: is not a field of a source; the fields are type, title, language, license, licenseVersion, authors, source, yearFrom, yearTo, params',
      expect.stringMatching(/^license: use one of/),
      'authors[0].role: use one of Author, Editor, Licensee, Originator'
    ])
    // A licence written with its version, as it is spoken of: the problem says where the version
    // goes, and names the licence it read. The list of names alone had a chat drop the version.
    const blanks = { type: 'H5P.Blanks', params: { questions: ['The *Danube* flows east.'] } }
    expect(await problems({ ...META, ...blanks, license: 'CC BY 4.0' })).toEqual(['license: "CC BY 4.0" holds the version too: write "license": "CC BY" and "licenseVersion": "4.0"'])
    expect(await problems({ ...META, ...blanks, license: 'cc-by-sa-4.0' })).toEqual(['license: "cc-by-sa-4.0" holds the version too: write "license": "CC BY-SA" and "licenseVersion": "4.0"'])
    expect(await problems({ ...META, ...blanks, license: 'CC BY-NC 5.0' })).toEqual(['license: "CC BY-NC 5.0" holds a version too: write "license": "CC BY-NC" and "licenseVersion", one of 4.0, 3.0, 2.5, 2.0, 1.0'])
    expect(await problems({ ...META, ...blanks, license: 'CC BY 4.0', licenseVersion: '4.0' })).toEqual(['license: "CC BY 4.0" holds the version too, which licenseVersion names: write "license": "CC BY"'])
    expect(await problems({ ...META, ...blanks, license: 'CC-BY-4.0', licenseVersion: '9' })).toEqual([
      'license: "CC-BY-4.0" holds the version too, which licenseVersion names: write "license": "CC BY"',
      'licenseVersion: use one of 4.0, 3.0, 2.5, 2.0, 1.0'
    ])
    expect((await build({ ...META, ...blanks, license: 'CC BY', licenseVersion: '4.0' })).manifest).toMatchObject({ license: 'CC BY', licenseVersion: '4.0' })
    expect(await problems({
      ...META,
      type: 'H5P.TrueFalse',
      params: { correct: 'yes', behaviour: { autoCheck: 'no', sideways: true }, question: '<p>Is <video>this</video> true?</p>' }
    })).toEqual([
      expect.stringMatching(/^params\.question: has <video>, which this field does not take/),
      'params.correct: "yes" is not an option; the options are "true", "false"',
      'params.behaviour.autoCheck: expected true or false',
      expect.stringMatching(/^params\.behaviour\.sideways: is not a field here/)
    ])
    expect((await readdir(dir)).filter(name => name.startsWith('failed-') || name.startsWith('.h5p-author-'))).toEqual([])
  })

  it('says what to write for what is in the wrong place, checks it in the same build, and counts no list it refused an item of (#172)', async () => {
    // A book's chapters as a chat without the type's file writes them: pages of their own, with no
    // H5P.Column around them, and sub-content in the place of a page's items. Every one of it in
    // one build, by where the source has it; it was "expected sub-content" and "has 0 items".
    expect(await problems({ ...META, type: 'H5P.InteractiveBook', params: { chapters: [
      { title: 'Sources', content: [{ library: 'H5P.AdvancedText', params: { text: 'A river begins at its source.' } }] }
    ] } })).toEqual([
      // Its title beside them is the chapter's own, shown where it goes (#174): it was two more
      // problems, "is not a field here" and "metadata.title: is required".
      'params.chapters[0]: is the params of sub-content, without the sub-content around them: write params.chapters[0] as { "library": "H5P.Column", "metadata": { "title": … }, "params": { "content": … } }',
      'params.chapters[0].content[0]: is sub-content, but here it goes inside an object, in its field content: write params.chapters[0].content[0] as { "content": { "library": "H5P.AdvancedText", "params": { … } } }'
    ])
    // A chapter refused whole leaves the list shorter: no count of what is left, and nothing said
    // of the chapter after it under the index of the one refused.
    expect(await problems({ ...META, type: 'H5P.InteractiveBook', params: { chapters: [
      'Sources',
      { library: 'H5P.Column', params: { content: [{ content: { library: 'H5P.AdvancedText', params: { text: 'A river ends at its mouth.' } } }] } }
    ] } })).toEqual(['params.chapters[0]: expected sub-content, { "library": "H5P.Column", "params": { … } }'])
    // A list a level above its group, and what is wrong inside it, in the same build.
    expect(await problems({ ...META, type: 'H5P.CoursePresentation', params: { slides: [
      { elements: [{ library: 'H5P.AdvancedText', params: { text: '<h1>Water</h1>' }, x: 5, y: 5 }] }
    ] } })).toEqual([
      'params.slides: is a field of presentation, not of this level: write params.presentation.slides',
      'params.slides[0].elements[0]: is sub-content, but here it goes inside an object, in its field action: write params.slides[0].elements[0] as { "action": { "library": "H5P.AdvancedText", "params": { … } }, "x": …, "y": … }',
      expect.stringMatching(/^params\.slides\[0\]\.elements\[0\]\.params\.text: has <h1>, which this field does not take/)
    ])
    // What only the last check finds, inside what was moved, is said too, by where the source has
    // it: a scenario's node with no next. And a question with no alternatives is not a loop.
    expect(await problems({ ...META, type: 'H5P.BranchingScenario', params: { branchingScenario: { title: 'A complaint', content: [
      { library: 'H5P.AdvancedText', params: { text: 'A customer calls.' } },
      { type: { library: 'H5P.BranchingQuestion', params: { question: 'What do you say?' } } }
    ] } } })).toEqual([
      'params.branchingScenario.content[0]: is sub-content, but here it goes inside an object, in its field type: write params.branchingScenario.content[0] as { "type": { "library": "H5P.AdvancedText", "params": { … } } }',
      'params.branchingScenario.content[1].type.params.question: is a field of branchingQuestion, not of this level: write params.branchingScenario.content[1].type.params.branchingQuestion.question',
      'params.branchingScenario.content[1].type.params.branchingQuestion.alternatives: is required: write at least 2 items',
      'params.branchingScenario.content[0].nextContentId: is required: the index in content of the node that follows, or -1 to end the scenario here'
    ])
  })

  it('checks the content in the same build as the source\'s own fields, and takes what its outer shape plainly means (#174)', async () => {
    // A book as Gemini wrote it from a link to the skill and none of its text: the content type as
    // `contentType`, the source's own fields in `metadata`, as H5P keeps them, and sub-content that
    // names its library the same way. It was seven problems, all of the outer shape, and the round
    // after thirty, three an item, one of them a list of 35 libraries.
    expect(await problems({
      contentType: 'H5P.InteractiveBook',
      metadata: { title: 'Physics', license: 'CC BY', authors: [{ name: 'Ann Author', role: 'Author' }], defaultLanguage: 'en' },
      params: { chapters: [{ title: 'Newton', content: [{ contentType: 'H5P.AdvancedText', params: { text: '<h1>F = ma</h1>' } }] }] }
    })).toEqual([
      'contentType: is not a field of a source: the content type is its type: write "type": "H5P.InteractiveBook"',
      'metadata: is not a field of a source: title, license, authors are written beside type, not in an object: write "title": …, "license": …, "authors": … at the top',
      'metadata.defaultLanguage: is not a field of a source; the fields are type, title, language, license, licenseVersion, authors, source, yearFrom, yearTo, params',
      'language: expected a BCP 47 language tag, such as "en" or "de-AT"',
      'params.chapters[0]: is the params of sub-content, without the sub-content around them: write params.chapters[0] as { "library": "H5P.Column", "metadata": { "title": … }, "params": { "content": … } }',
      'params.chapters[0].content[0]: is sub-content, but here it goes inside an object, in its field content: write params.chapters[0].content[0] as { "content": { "library": "H5P.AdvancedText", "params": { … } } }',
      expect.stringMatching(/^params\.chapters\[0\]\.content\[0\]\.params\.text: has <h1>, which this field does not take/)
    ])
    // As the weakest model wrote one with no skill: the content's fields beside `type`, the type
    // by the name it is spoken of. Each round had gone to one of these, with nothing inside looked at.
    const chapter = { library: 'H5P.Column', metadata: { title: 'Newton' }, params: { content: [{ content: { library: 'H5P.AdvancedText', params: { text: 'F = ma' } } }] } }
    expect(await problems({ type: 'interactive-book', title: 'Physics', chapters: [chapter, 'Einstein'] })).toEqual([
      'params: is not written: the content\'s fields go in it, not beside type: write "params": { "chapters": … }',
      'type: takes the machine name, "H5P.InteractiveBook"',
      'language: expected a BCP 47 language tag, such as "en" or "de-AT"',
      expect.stringMatching(/^license: use one of/),
      'authors: name at least one author: [{ "name": "…", "role": "Author" }]',
      'params.chapters[1]: expected sub-content, { "library": "H5P.Column", "params": { … } }'
    ])
    // With `params` written, what is beside `type` is no field of the content.
    expect(await problems({ ...META, type: 'H5P.InteractiveBook', chapters: [], params: { chapters: [chapter] } })).toEqual([
      'chapters: is not a field of a source; the fields are type, title, language, license, licenseVersion, authors, source, yearFrom, yearTo, params'
    ])
    // A source's own field that the top has too is said so, and a year in the object is taken.
    expect(await problems({ ...META, type: 'H5P.InteractiveBook', metadata: { title: 'Other', yearFrom: 2020 }, params: { chapters: [chapter] } })).toEqual([
      'metadata: is not a field of a source: yearFrom is written beside type, not in an object: write "yearFrom": … at the top',
      'metadata.title: is written beside type already'
    ])

    // A type named as it is spoken of is the one type of those letters; one that is none has the nearest named.
    expect(await problems({ ...META, type: 'Question Set', params: { questions: [{ library: 'H5P.TrueFalse', params: { question: 'Yes?', correct: 'true' } }] } })).toEqual(['type: takes the machine name, "H5P.QuestionSet"'])
    expect(await problems({ ...META, type: 'book', params: {} })).toEqual(['type: the library pack has no content type book; nearest: H5P.InteractiveBook'])
    expect(await problems({ ...META, type: 'fill-in-the-blanks', params: {} })).toEqual(['type: the library pack has no content type fill-in-the-blanks; nearest: H5P.Blanks'])
    // "Question Set 2" is no Question Set: a number with no point is no version.
    expect(await problems({ ...META, type: 'Question Set 2', params: {} })).toEqual(['type: the library pack has no content type Question Set 2'])
    // Two keys that each name a type: neither is taken for it. A text under another key is no
    // name of the type, however it reads, nor is an object other than `metadata` the source's
    // own fields: Question Set's `introPage` has a title too.
    expect(await problems({ ...META, contentType: 'H5P.Blanks', library: 'H5P.DragText', params: {} })).toEqual([
      expect.stringMatching(/^contentType: is not a field of a source; the fields are/),
      expect.stringMatching(/^library: is not a field of a source; the fields are/),
      'type: expected a content type\'s machine name, such as "H5P.Blanks"'
    ])
    expect(await problems({ ...META, description: 'Summary', params: {} })).toEqual([
      expect.stringMatching(/^description: is not a field of a source; the fields are/),
      'type: expected a content type\'s machine name, such as "H5P.Blanks"'
    ])
    expect(await problems({ ...META, title: undefined, type: 'H5P.QuestionSet', introPage: { showIntroPage: true, title: 'Welcome' }, questions: [{ library: 'H5P.TrueFalse', params: { question: 'Yes?', correct: 'true' } }] })).toEqual([
      'params: is not written: the content\'s fields go in it, not beside type: write "params": { "introPage": …, "questions": … }',
      'title: expected the activity\'s title'
    ])

    // Sub-content with its library under another key and its parameters beside it, in a field
    // that takes several libraries: the parameters of the one it names, checked as such.
    expect(await problems({ ...META, type: 'H5P.QuestionSet', params: { questions: [
      { type: 'H5P.MultiChoice', question: 'Which?', answers: [{ text: 'a', correct: true }, { text: 'b', correct: false }], sideways: 1 }
    ] } })).toEqual([
      'params.questions[0]: is the params of sub-content, without the sub-content around them: write params.questions[0] as { "library": "H5P.MultiChoice", "params": { "question": … } }',
      expect.stringMatching(/^params\.questions\[0\]\.sideways: is not a field here; the fields are media, question, answers/)
    ])
    // The same in the place of the group that holds it: what is no field of the group is its parameters.
    expect(await problems({ ...META, type: 'H5P.CoursePresentation', params: { presentation: { slides: [
      { elements: [{ type: 'H5P.AdvancedText', x: 5, y: 5, width: 90, height: 20, text: '<h1>Water</h1>' }] }
    ] } } })).toEqual([
      'params.presentation.slides[0].elements[0]: is sub-content, but here it goes inside an object, in its field action: write params.presentation.slides[0].elements[0] as { "action": { "library": "H5P.AdvancedText", "params": { … } }, "x": …, "y": …, "width": …, "height": … }',
      expect.stringMatching(/^params\.presentation\.slides\[0\]\.elements\[0\]\.text: has <h1>, which this field does not take/)
    ])
    // A name under `type` or `contentType` written loosely, in a field that takes several
    // libraries: the library it names is loaded, so what is written for it is checked against its
    // fields in the same round, and not against none.
    expect(await problems({ ...META, type: 'H5P.Column', params: { content: [{ type: 'advancedtext', text: '<h1>Hi</h1>' }, { content: { contentType: 'advanced-text', params: { text: '<h1>Hi</h1>' } } }] } })).toEqual([
      'params.content[0]: is sub-content, but here it goes inside an object, in its field content: write params.content[0] as { "content": { "library": "H5P.AdvancedText", "params": { … } } }',
      expect.stringMatching(/^params\.content\[0\]\.text: has <h1>, which this field does not take/),
      'params.content[1].content.contentType: is the sub-content\'s library: write "library": "H5P.AdvancedText"',
      expect.stringMatching(/^params\.content\[1\]\.content\.params\.text: has <h1>, which this field does not take/)
    ])
    // A title beside sub-content in its group's place is its own, with `library` or another key.
    expect(await problems({ ...META, type: 'H5P.Column', params: { content: [{ library: 'H5P.AdvancedText', title: 'One', params: { text: 'x' } }, { type: 'H5P.AdvancedText', title: 'Two', text: 'y' }] } })).toEqual([
      'params.content[0]: is sub-content, but here it goes inside an object, in its field content: write params.content[0] as { "content": { "library": "H5P.AdvancedText", "params": { … } } }',
      'params.content[0].title: is the sub-content\'s title, which is in its metadata: write "metadata": { "title": … }',
      'params.content[1]: is sub-content, but here it goes inside an object, in its field content: write params.content[1] as { "content": { "library": "H5P.AdvancedText", "params": { … } } }',
      'params.content[1].title: is the sub-content\'s title, which is in its metadata: write "metadata": { "title": … }'
    ])
    // A library named loosely, or with a version of three parts, a title beside `library`, and
    // two keys that each name a library.
    expect(await problems({ ...META, type: 'H5P.Column', params: { content: [{ content: { library: 'advancedtext', params: { text: 'x' } } }, { content: { library: 'H5P.AdvancedText 1.1.5', params: { text: 'x' } } }] } })).toEqual([
      'params.content[0].content.library: takes the machine name, "H5P.AdvancedText"',
      'params.content[1].content.library: takes the machine name, "H5P.AdvancedText"'
    ])
    expect(await problems({ ...META, type: 'H5P.InteractiveBook', params: { chapters: [{ ...chapter, metadata: undefined, title: 'Newton' }] } })).toEqual([
      'params.chapters[0].title: is the sub-content\'s title, which is in its metadata: write "metadata": { "title": … }'
    ])
    expect(await problems({ ...META, type: 'H5P.QuestionSet', params: { questions: [{ type: 'H5P.MultiChoice', contentType: 'H5P.TrueFalse', question: 'Which?' }] } })).toEqual([
      expect.stringMatching(/^params\.questions\[0\]: expected sub-content, \{ "library": "…", "params": \{ … \} \}, of H5P\.MultiChoice, /)
    ])
    expect((await readdir(dir)).filter(name => name.startsWith('failed-') || name.startsWith('.h5p-author-'))).toEqual([])
  })

  it('takes sub-content by machine name, at the pack\'s version, with its title', async () => {
    const { content, manifest } = await build({
      ...META,
      type: 'H5P.Column',
      params: { content: [{ content: { library: 'H5P.TrueFalse', params: { question: 'The Rhine reaches the sea.' }, metadata: { title: 'The Rhine' } } }, { content: { library: 'H5P.AdvancedText', params: { text: 'Done.' } } }] }
    })
    expect(content.content[0].content).toMatchObject({ library: expect.stringMatching(/^H5P\.TrueFalse 1\.\d+$/), metadata: { title: 'The Rhine', contentType: 'True/False Question' } })
    expect(content.content[1].content.metadata.title).toBe('Text')
    expect(manifest.preloadedDependencies.map(({ machineName }: { machineName: string }) => machineName)).toEqual(expect.arrayContaining(['H5P.Column', 'H5P.TrueFalse', 'H5P.AdvancedText']))
  })

  it('lists the libraries depth first from the content type, the order the runtime keeps between libraries that do not depend on each other', async () => {
    const { content, manifest, files } = await build({
      ...META,
      type: 'H5P.Column',
      params: { content: [{ content: { library: 'H5P.TrueFalse', params: { question: 'The Rhine reaches the sea.' } } }, { content: { library: 'H5P.AdvancedText', params: { text: 'Done.' } } }] }
    })
    // The order the build has always written, from the libraries the zip carries: the content type,
    // then each library the content names, each followed by its own dependencies before the next.
    const libraries = new Map<string, { preloadedDependencies?: { machineName: string }[] }>()
    for (const [name, json] of files) {
      if (!name.endsWith('/library.json')) continue
      const library = JSON.parse(json)
      libraries.set(library.machineName, library)
    }
    const expected: string[] = []
    const visit = (machineName: string) => {
      if (expected.includes(machineName)) return
      expected.push(machineName)
      for (const dependency of libraries.get(machineName)?.preloadedDependencies ?? []) visit(dependency.machineName)
    }
    for (const name of ['H5P.Column', ...librariesIn(content)]) visit(name.split(' ')[0])
    const listed = manifest.preloadedDependencies.map(({ machineName }: { machineName: string }) => machineName)
    expect(listed).toEqual(expected)
    // Depth first, not breadth first: True/False's own dependencies come before the text beside it.
    const [dependency] = libraries.get('H5P.TrueFalse')!.preloadedDependencies!
    expect(listed.indexOf(dependency.machineName)).toBeLessThan(listed.indexOf('H5P.AdvancedText'))
  })

  it('adds the formula addon the pack carries when the text holds LaTeX, as a site with it installed exports it', async () => {
    const { manifest, notes } = await build({ ...META, type: 'H5P.TrueFalse', params: { question: 'Is \\(e^{i\\pi} + 1 = 0\\)?' } })
    expect(manifest.preloadedDependencies.map(({ machineName }: { machineName: string }) => machineName)).toContain('H5P.MathDisplay')
    expect(notes.map(({ message }) => message).join()).toContain('H5P.MathDisplay')
  })
})

describe('media', () => {
  let server: Server
  let origin: string
  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === '/pictures/map.png') response.writeHead(200, { 'content-type': 'image/png' }).end(png(40, 20))
      else if (request.url === '/picture') response.writeHead(200, { 'content-type': 'image/png' }).end(png(10, 30))
      else if (request.url === '/page.html') response.writeHead(200, { 'content-type': 'text/html' }).end('<p>no</p>')
      else if (request.url === '/odd%zz.png') response.writeHead(200, { 'content-type': 'image/png' }).end(png(20, 10))
      else if (request.url === '/trickle.png') {
        // Slow, and never silent for long: eight pieces, 100 ms apart.
        const bytes = png(40, 30)
        const step = Math.ceil(bytes.length / 8)
        response.writeHead(200, { 'content-type': 'image/png' })
        let at = 0
        const timer = setInterval(() => {
          response.write(bytes.subarray(at, (at += step)))
          if (at >= bytes.length) {
            clearInterval(timer)
            response.end()
          }
        }, 100)
      } else if (request.url === '/stalled.png') {
        // Its first bytes, then silence.
        response.writeHead(200, { 'content-type': 'image/png' }).write(png(40, 30).subarray(0, 10))
        setTimeout(() => response.end(), 5000).unref()
      } else response.writeHead(404).end()
    })
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => {
    server.closeAllConnections()
    server.close()
  })

  it('copies files beside the source and from the web, with their type, size and copyright', async () => {
    await writeFile(join(dir, 'red.png'), png(300, 200))
    // A colour profile of 100 kB before the frame header, past the first read.
    await writeFile(join(dir, 'photo.jpg'), jpeg(640, 480, 100_000))
    const { content, entries, media } = await build({
      ...META,
      type: 'H5P.Dialogcards',
      params: {
        dialogs: [
          { text: 'Red', answer: 'Rot', image: { path: 'red.png', copyright: { license: 'CC BY', author: "O'Neil" } }, imageAltText: 'A red square' },
          { text: 'Map', answer: 'Karte', image: { path: `${origin}/pictures/map.png` }, imageAltText: 'A map' },
          { text: 'Tall', answer: 'Hoch', image: { path: `${origin}/picture` }, imageAltText: 'Tall' },
          { text: 'Again', answer: 'Wieder', image: { path: 'red.png' }, imageAltText: 'The same red square' },
          { text: 'Photo', answer: 'Foto', image: { path: 'photo.jpg' }, imageAltText: 'A photo' }
        ]
      }
    }, { base: dir })
    expect(content.dialogs.map(({ image }: { image: unknown }) => image)).toEqual([
      { path: 'images/red.png', mime: 'image/png', width: 300, height: 200, copyright: { license: 'CC BY', author: 'O&#39;Neil' } },
      { path: 'images/map.png', mime: 'image/png', width: 40, height: 20, copyright: { license: 'U' } },
      { path: 'images/picture.png', mime: 'image/png', width: 10, height: 30, copyright: { license: 'U' } },
      { path: 'images/red.png', mime: 'image/png', width: 300, height: 200, copyright: { license: 'U' } },
      { path: 'images/photo.jpg', mime: 'image/jpeg', width: 640, height: 480, copyright: { license: 'U' } }
    ])
    expect(media).toEqual(['images/red.png', 'images/map.png', 'images/picture.png', 'images/photo.jpg'])
    // Media stored, after the content, as the normalizer lays a package out to stream.
    const names = entries.map(entry => entry.filename)
    expect(names.indexOf('content/images/red.png')).toBeGreaterThan(names.indexOf('content/content.json'))
    expect(entries.find(entry => entry.filename === 'content/images/red.png')!.compressionMethod).toBe(0)
  })

  it('keeps a hosted video where it is, and moves an mp4\'s index to the front', async () => {
    await writeFile(join(dir, 'slow.mp4'), mp4(false))
    const { content, entries } = await build({
      ...META,
      type: 'H5P.Column',
      params: {
        content: [
          { content: { library: 'H5P.Video', params: { sources: [{ path: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }] } } },
          { content: { library: 'H5P.Video', params: { sources: { path: 'slow.mp4' } } } }
        ]
      }
    }, { base: dir })
    expect(content.content[0].content.params.sources).toEqual([{ path: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', mime: 'video/YouTube', copyright: { license: 'U' } }])
    expect(content.content[1].content.params.sources).toEqual([{ path: 'videos/slow.mp4', mime: 'video/mp4', copyright: { license: 'U' } }])
    const reader = new ZipReader(new BlobReader(new Blob([await readFile(join(dir, `build-${count}.h5p`))])))
    try {
      const entry = (await reader.getEntries()).find(each => each.filename === 'content/videos/slow.mp4')!
      const bytes = await (entry as import('@zip.js/zip.js').FileEntry).getData(new Uint8ArrayWriter())
      expect(Buffer.from(bytes.subarray(4, 8)).toString()).toBe('ftyp')
      expect(Buffer.from(bytes).indexOf('moov')).toBeLessThan(Buffer.from(bytes).indexOf('mdat'))
    } finally { await reader.close() }
    expect(entries.length).toBeGreaterThan(3)
  })

  it('takes a hosted video at an address H5P.Video plays, a Short\'s as its video\'s, and refuses another', async () => {
    const video = (path: string) => ({ content: { library: 'H5P.Video', params: { sources: { path } } } })
    const { content } = await build({
      ...META,
      type: 'H5P.Column',
      params: {
        content: [
          'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
          'https://youtu.be/dQw4w9WgXcQ?si=abc',
          'https://youtube.com/shorts/aqz-KE-bpKQ?feature=share',
          'https://vimeo.com/76979871',
          'https://video.example.edu/Panopto/Pages/Viewer.aspx?id=0b6d3a5e-1f2c-4c3e-9a51-b0d1a2c3d4e5',
          'https://echo360.org/media/0b6d3a5e-1f2c-4c3e/h5p'
        ].map(video)
      }
    })
    const sources: { path: string, mime: string }[] = content.content.map(({ content }: { content: { params: { sources: unknown[] } } }) => content.params.sources[0])
    expect(sources.map(({ mime, path }) => `${mime} ${path}`)).toEqual([
      'video/YouTube https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
      'video/YouTube https://youtu.be/dQw4w9WgXcQ?si=abc',
      'video/YouTube https://www.youtube.com/watch?v=aqz-KE-bpKQ',
      'video/Vimeo https://vimeo.com/76979871',
      'video/Panopto https://video.example.edu/Panopto/Pages/Viewer.aspx?id=0b6d3a5e-1f2c-4c3e-9a51-b0d1a2c3d4e5',
      'video/Echo360 https://echo360.org/media/0b6d3a5e-1f2c-4c3e/h5p'
    ])
    // H5P.Video's own patterns, read from its scripts in the pack: it chooses a player by them.
    const library = pack.libraries.find(library => library.machineName === 'H5P.Video' && library.majorVersion === 1)!
    const { files } = await archive(new URL(library.url))
    const plays = Object.fromEntries(['YouTube', 'Vimeo', 'Panopto', 'Echo360'].map((host) => {
      const [, body, flags] = /url\.match\(\/(.+)\/([a-z]*)\);/.exec(files.get(`${library.folder}/scripts/${host.toLowerCase()}.js`)!)!
      return [`video/${host}`, new RegExp(body, flags)]
    }))
    for (const { mime, path } of sources) expect(plays[mime].test(path), path).toBe(true)
    const refused = ['https://player.vimeo.com/video/76979871', 'https://www.youtube.com/playlist?list=PL0123456789', 'https://example.panopto.eu/Panopto/Pages/Sessions/List.aspx', 'https://echo360.org/lesson/0b6d3a5e/classroom']
    for (const path of refused) expect(Object.values(plays).some((pattern) => pattern.test(path)), path).toBe(false)
    expect(await problems({ ...META, type: 'H5P.Column', params: { content: refused.map(video) } })).toEqual([
      'params.content[0].content.params.sources.path: https://player.vimeo.com/video/76979871 is an address on Vimeo that H5P.Video cannot play: give https://vimeo.com/ and the video\'s number',
      'params.content[1].content.params.sources.path: https://www.youtube.com/playlist?list=PL0123456789 is an address on YouTube that H5P.Video cannot play: give https://www.youtube.com/watch?v= and the video\'s id',
      'params.content[2].content.params.sources.path: https://example.panopto.eu/Panopto/Pages/Sessions/List.aspx is an address on Panopto that H5P.Video cannot play: give the viewer\'s, …/Panopto/Pages/Viewer.aspx?id= and the session\'s id',
      'params.content[3].content.params.sources.path: https://echo360.org/lesson/0b6d3a5e/classroom is an address on Echo360 that H5P.Video cannot play: give its H5P address, https://echo360.org/media/, the media\'s id and /h5p'
    ])
  })

  it('gives a download up once nothing has arrived for a while, however long a slow one takes', async () => {
    const reported: string[] = []
    const report = (path: string, message: string) => reported.push(`${path}: ${message}`)
    const store = new MediaStore(nodeMedia({ base: dir, temporary: dir }), { idle: 300 })
    expect(await store.resolve({ type: 'image' }, { path: `${origin}/trickle.png` }, 'params.slow', report)).toMatchObject({ path: 'images/trickle.png', width: 40, height: 30 })
    expect(await store.resolve({ type: 'image' }, { path: `${origin}/stalled.png` }, 'params.silent', report)).toEqual({ path: `${origin}/stalled.png`, copyright: { license: 'U' } })
    expect(reported).toEqual([`params.silent.path: ${origin}/stalled.png could not be downloaded: nothing arrived for 0.3 s`])
  })

  it('keeps a download whose address has an escape that is not one, under its name as written (#162)', async () => {
    const reported: string[] = []
    const store = new MediaStore(nodeMedia({ base: dir, temporary: dir }))
    expect(await store.resolve({ type: 'image' }, { path: `${origin}/odd%zz.png` }, 'params.odd', (path, message) => reported.push(`${path}: ${message}`))).toMatchObject({ path: 'images/odd-zz.png', width: 20, height: 10 })
    expect(reported).toEqual([])
  })

  it('copies one file named in an image field and a file field once for each, as H5P keeps them apart (#162)', async () => {
    await writeFile(join(dir, 'chart.png'), png(30, 20))
    const store = new MediaStore(nodeMedia({ base: dir, temporary: dir }))
    const report = () => { throw new Error('no problem expected') }
    expect(await store.resolve({ type: 'file' }, { path: 'chart.png' }, 'params.download', report)).toEqual({ path: 'files/chart.png', mime: 'image/png', copyright: { license: 'U' } })
    expect(await store.resolve({ type: 'image' }, { path: 'chart.png' }, 'params.picture', report)).toEqual({ path: 'images/chart.png', mime: 'image/png', width: 30, height: 20, copyright: { license: 'U' } })
    expect(await store.resolve({ type: 'image' }, { path: 'chart.png' }, 'params.again', report)).toMatchObject({ path: 'images/chart.png' })
    expect(store.files.map(({ name }) => name)).toEqual(['files/chart.png', 'images/chart.png'])
  })

  it('names a file that is missing, of a type the field does not take, or not downloadable', async () => {
    await writeFile(join(dir, 'notes.txt'), 'x')
    await writeFile(join(dir, 'x.constructor'), 'x')
    expect(await problems({
      ...META,
      type: 'H5P.MemoryGame',
      params: {
        cards: [
          { image: { path: 'missing.png' }, imageAlt: 'a' },
          { image: { path: 'notes.txt' }, imageAlt: 'b' },
          { image: { path: `${origin}/gone.png` }, imageAlt: 'c' },
          { image: { path: `${origin}/page.html` }, imageAlt: 'd' },
          { image: { path: 'ftp://example.org/a.png' }, imageAlt: 'e' },
          { image: { path: 'x.constructor' }, imageAlt: 'f' }
        ]
      }
    }, { base: dir })).toEqual([
      expect.stringMatching(/^params\.cards\[0\]\.image\.path: missing\.png: no such file beside the source/),
      'params.cards[1].image.path: notes.txt: this field takes .png, .jpg, .jpeg, .gif, .bmp',
      `params.cards[2].image.path: ${origin}/gone.png answered 404`,
      `params.cards[3].image.path: ${origin}/page.html is text/html: this field takes .png, .jpg, .jpeg, .gif, .bmp`,
      'params.cards[4].image.path: expected a file beside the source or an http(s) address',
      // A name an object's prototype has is no type (#162).
      'params.cards[5].image.path: x.constructor: this field takes .png, .jpg, .jpeg, .gif, .bmp'
    ])
  })
})

describe('the build', () => {
  it('does not overwrite an output, publish partial failures, or leave staging directories', async () => {
    const path = join(dir, 'existing.h5p')
    await writeFile(path, 'keep me')
    const refusal = { code: 'EEXIST', message: `${path} exists, and a build never writes over a file: name a new one` }
    await expect(buildPackage(example, path)).rejects.toMatchObject(refusal)
    // Before any work: a source with problems is not read.
    await expect(buildPackage({}, path)).rejects.toMatchObject(refusal)
    expect(await readFile(path, 'utf8')).toBe('keep me')
    await expect(buildPackage(example, join(dir, 'nowhere', 'quiz.h5p'))).rejects.toThrow(`${join(dir, 'nowhere')} is not a folder to write the package in`)
    expect((await readdir(dir)).filter(name => name.startsWith('.h5p-author-'))).toEqual([])
    await expect(buildPackage({ ...example, questions: [] }, join(dir, 'invalid.h5p'))).rejects.toThrow('quiz.questions')
    expect(await readdir(dir)).not.toContain('invalid.h5p')
  })

  it('refuses a damaged library part before publishing an archive', async () => {
    const damaged = join(dir, 'damaged-parts')
    await cp(parts, damaged, { recursive: true })
    const library = pack.libraries.find(library => library.machineName === 'H5P.MultiChoice' && library.majorVersion === 1)!
    const part = join(damaged, `${library.folder}.h5p`)
    const bytes = await readFile(part)
    const reader = new ZipReader(new BlobReader(new Blob([bytes])))
    try {
      const entry = (await reader.getEntries()).find(entry => !entry.directory && entry.filename.endsWith('.js'))!
      const offset = entry.offset + 30 + bytes.readUInt16LE(entry.offset + 26) + bytes.readUInt16LE(entry.offset + 28)
      // Damage script data without changing library.json, semantics, or the central directory.
      bytes[offset + Math.floor(entry.compressedSize / 2)] ^= 1
    } finally { await reader.close() }
    await writeFile(part, bytes)
    const output = join(dir, 'damaged.h5p')
    await expect(buildPackage(example, output, { libraries: damaged })).rejects.toThrow(`The library part ${library.folder} does not match the pack's index (SHA-256)`)
    expect(await readdir(dir)).not.toContain('damaged.h5p')
  })

  it('runs as a command: build, with the interface texts\' languages said, and schema', async () => {
    const project = await mkdtemp(join(dir, 'project-'))
    await writeFile(join(project, 'german.json'), JSON.stringify({ ...example, language: 'de' }))
    const german = await exec(process.execPath, [bin, 'build', 'german.json', 'german.h5p'], { cwd: project })
    expect(german.stdout).toMatch(/^Built .*german\.h5p: H5P\.QuestionSet, \d+ libraries from the library pack \d+\.\d+\.\d+, \d+ more for installing on an H5P site\./)
    expect(german.stdout).toMatch(/H5P\.MultiChoice 1\.\d+: interface texts from its translation language\/de\.json\./)
    expect(german.stdout + german.stderr).toMatch(/H5P\.QuestionSet 1\.\d+: interface texts from its translation language\/de\.json/)
    expect(german.stdout).toContain('Not verified')
    const failed = exec(process.execPath, [bin, 'build', 'german.json', 'german.h5p'], { cwd: project })
    await expect(failed).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('german.h5p exists, and a build never writes over a file: name a new one') })
    await writeFile(join(project, 'wrong.json'), JSON.stringify({ ...META, type: 'H5P.TrueFalse', params: { correct: 'maybe' } }))
    await expect(exec(process.execPath, [bin, 'build', 'wrong.json', 'wrong.h5p'], { cwd: project })).rejects.toMatchObject({
      code: 1, stderr: expect.stringContaining('params.correct: "maybe" is not an option')
    })
    const { stdout: schema } = await exec(process.execPath, [bin, 'schema', 'H5P.TrueFalse'])
    expect(schema).toMatch(/^H5P\.TrueFalse 1\.\d+: True\/False Question\n- `media` group/)
    expect(schema).toContain('- `correct` one of "true" | "false" = "true"')
    await expect(exec(process.execPath, [bin, 'schema', 'H5P.Nope'])).rejects.toMatchObject({ stderr: expect.stringContaining('H5P.Blanks (Fill in the Blanks)') })
    // --name=value, -h and -v, as the verifier and embed read them (#162).
    expect((await exec(process.execPath, [bin, 'schema', 'H5P.TrueFalse', `--libraries=${parts}`])).stdout).toBe(schema)
    expect((await exec(process.execPath, [bin, '-h'])).stdout).toMatch(/^Usage:\n {2}h5p-author build/)
    expect((await exec(process.execPath, [bin, '-v'])).stdout).toMatch(/^@missing-elements\/h5p-author \d+\.\d+\.\d+, library pack \d+\.\d+\.\d+\n$/)
    await expect(exec(process.execPath, [bin, 'build', 'a.json', 'a.h5p', '--markdown'])).rejects.toMatchObject({ code: 1, stderr: 'h5p-author: build does not take --markdown\n' })
  }, 120_000)
})

describe('the package', () => {
  it('carries the skill\'s text and type files, copied as it is packed, for a page to hand to a chat (#172, #178)', async () => {
    const skill = resolve(import.meta.dirname, '../../../skills/h5p-author')
    const copied = resolve(import.meta.dirname, '../references/types')
    const { stdout } = await exec(process.execPath, [resolve(import.meta.dirname, '../scripts/copy-skill.mjs')])
    const names = (await readdir(join(skill, 'references/types'))).filter(name => name.endsWith('.md')).sort()
    expect(names).toContain('H5P.InteractiveBook.md')
    expect(stdout).toContain(`Copied SKILL.md, references/authoring.md and ${names.length} type files`)
    expect((await readdir(copied)).sort()).toEqual(names)
    for (const name of names) expect(await readFile(join(copied, name), 'utf8'), name).toBe(await readFile(join(skill, 'references/types', name), 'utf8'))
    // The skill's text beside them, as it is, for a site to serve to a chat given a link.
    for (const name of ['SKILL.md', 'references/authoring.md']) {
      expect(await readFile(resolve(import.meta.dirname, '..', name), 'utf8'), name).toBe(await readFile(join(skill, name), 'utf8'))
    }
    // Packed and found: in `files`, copied by `prepack`, and each one an export of its own.
    const manifest = JSON.parse(await readFile(resolve(import.meta.dirname, '../package.json'), 'utf8'))
    expect(manifest.files).toEqual(expect.arrayContaining(['references', 'SKILL.md']))
    expect(manifest.scripts.prepack).toContain('node scripts/copy-skill.mjs')
    const require = createRequire(import.meta.url)
    expect(require.resolve('@missing-elements/h5p-author/references/types/H5P.InteractiveBook.md')).toBe(join(copied, 'H5P.InteractiveBook.md'))
    expect(require.resolve('@missing-elements/h5p-author/SKILL.md')).toBe(resolve(import.meta.dirname, '../SKILL.md'))
    expect(require.resolve('@missing-elements/h5p-author/references/authoring.md')).toBe(resolve(import.meta.dirname, '../references/authoring.md'))
  })
})

describe('installing on an H5P site (#146)', () => {
  /** Every `library.json` an archive carries. */
  const carried = (files: Map<string, string>) => [...files].filter(([name]) => /^[^/]+\/library\.json$/.test(name)).map(([, text]) => JSON.parse(text))

  it('carries what H5P core\'s upload check wants of its libraries, after the content, and lists only what plays in h5p.json', async () => {
    const { files, entries, manifest, libraries, install } = await build(example)
    expect(libraries).toContain('H5P.QuestionSet-1.21')
    expect(install.length).toBeGreaterThan(0)
    // The editor libraries at least; an older minor a library names may join them as the hub moves.
    expect(install.some(folder => folder.startsWith('H5PEditor.'))).toBe(true)
    // Nothing a carried library names, preloaded, dynamic or editor, is missing at its exact version.
    expect(missingForInstall(carried(files))).toEqual([])
    // Not in the manifest, as the platforms' own exports write it.
    const named = new Set(manifest.preloadedDependencies.map((each: { machineName: string }) => each.machineName))
    for (const folder of install) expect(named.has(folder.slice(0, folder.lastIndexOf('-')))).toBe(false)
    // After the content, where nothing reads them as the package plays; the media come last.
    const names = entries.map(entry => entry.filename)
    const content = names.indexOf('content/content.json')
    for (const folder of install) for (const name of names.filter(each => each.startsWith(`${folder}/`))) expect(names.indexOf(name)).toBeGreaterThan(content)
    for (const folder of libraries) for (const name of names.filter(each => each.startsWith(`${folder}/`))) expect(names.indexOf(name)).toBeLessThan(content)
  })

  it('carries the older minor a library names exactly, beside the newer one that plays', async () => {
    const base = await mkdtemp(join(dir, 'sequence-'))
    for (const name of ['a.png', 'b.png', 'c.png']) await writeFile(join(base, name), png(40, 20))
    // Image Sequencing 1.1 names H5P.Audio 1.2; the pack plays 1.5, which the package carries for it.
    const { libraries, install, files } = await build({
      ...META,
      type: 'H5P.ImageSequencing',
      params: { sequenceImages: ['a', 'b', 'c'].map(name => ({ image: { path: `${name}.png` }, imageDescription: name.toUpperCase() })) }
    }, { base })
    expect(libraries).toContain('H5P.Audio-1.5')
    expect(install).toContain('H5P.Audio-1.2')
    expect(missingForInstall(carried(files))).toEqual([])
  })

  it('refuses to build from a pack that lacks them, naming the first and where the pack with them is', async () => {
    const lean = join(dir, 'lean-parts')
    await cp(parts, lean, { recursive: true })
    const index = JSON.parse(await readFile(join(lean, 'index.json'), 'utf8'))
    await writeFile(join(lean, 'index.json'), JSON.stringify({ libraries: index.libraries.filter((entry: { installOnly?: true }) => !entry.installOnly) }))
    await expect(buildPackage(example, join(dir, 'lean.h5p'), { libraries: lean })).rejects.toThrow(
      /^The library pack cannot supply H5PEditor\.\S+ \d+\.\d+, which H5P\.\S+ \d+\.\d+ needs to install on an H5P site: a page imports the pack from '@missing-elements\/h5p-libraries\/install'/
    )
    expect(await readdir(dir)).not.toContain('lean.h5p')
  })
})
