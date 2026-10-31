import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { verifyPackage } from '@missing-elements/h5p-verify'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { buildQuiz, type Quiz } from '../../../skills/h5p-author/scripts/build-quiz.mjs'

const project = resolve(import.meta.dirname, '..')
// The pack this project installed, named to the check as `--libraries` names a copy of its parts.
const parts = resolve(project, 'node_modules/@missing-elements/h5p-libraries/parts')
const skill = resolve(project, '../../skills/h5p-author')
const example: Quiz = JSON.parse(await readFile(join(skill, 'assets/quiz.json'), 'utf8'))
const scenarios: Quiz = JSON.parse(await readFile(join(skill, 'assets/phishing-scenarios.json'), 'utf8'))
let dir: string
const files = new Map<string, string>()

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'h5p-author-verify-'))
  for (const kind of ['multiple-choice', 'question-set'] as const) {
    const source: Quiz = { ...example, kind, questions: kind === 'multiple-choice' ? [example.questions[0]] : example.questions }
    const file = join(dir, `${kind}.h5p`)
    await buildQuiz(source, file, project)
    files.set(kind, file)
  }
  const file = join(dir, 'scenarios.h5p')
  await buildQuiz(scenarios, file, project)
  files.set('scenarios', file)
  // Interface texts from the libraries' Ukrainian, one of them with an apostrophe the content check escapes.
  const translated = join(dir, 'ukrainian.h5p')
  await buildQuiz({ ...example, language: 'uk' }, translated, project)
  files.set('ukrainian', translated)
  // Titles and an author's name with quotes and markup, which the content check escapes.
  const punctuation = join(dir, 'punctuation.h5p')
  await buildQuiz({
    ...example,
    authors: [{ name: "Anne O'Brien <ed>", role: 'Author' }],
    questions: example.questions.map(question => ({ ...question, title: `${question.title}'s "draft" <b> & co` }))
  }, punctuation, project)
  files.set('punctuation', punctuation)
})
afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }) })

// Step 4 of the skill: the check, through the verifier's published API.
it.each([
  ['multiple-choice', false],
  ['multiple-choice', true],
  ['question-set', false],
  ['question-set', true],
  ['scenarios', false],
  ['scenarios', true],
  ['ukrainian', false],
  ['ukrainian', true],
  ['punctuation', false],
  ['punctuation', true]
])('plays authored %s (untrusted: %s) without warnings', async (kind, untrusted) => {
  const report = await verifyPackage({
    file: files.get(kind)!,
    untrusted,
    libraries: untrusted ? parts : undefined,
    settle: 500
  })
  expect(report.verdict, JSON.stringify(report)).toBe('pass')
  expect(report.warnings).toEqual([])
  expect(report.errors).toEqual([])
  expect(report.state).toBe('ready')
  expect(report.untrusted).toBe(untrusted)
  expect(report.revision).toMatch(/^sha256:[0-9a-f]{64}(; libraries sha256:[0-9a-f]{64})?$/)
  expect(report.rendered?.text).toBeGreaterThan(100)
}, 60_000)
