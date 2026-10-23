import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { buildQuiz } from '../../../skills/h5p-author/scripts/build-quiz.mjs'
import { verifyPackage } from '../lib/verify.mjs'

const project = resolve(import.meta.dirname, '../../../apps/demo')
const parts = resolve(import.meta.dirname, '../../libraries/parts')
const example = JSON.parse(await readFile(resolve(import.meta.dirname, '../../../skills/h5p-author/assets/quiz.json'), 'utf8'))
const scenarios = JSON.parse(await readFile(resolve(import.meta.dirname, '../../../skills/h5p-author/assets/phishing-scenarios.json'), 'utf8'))
let dir
const files = new Map()

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'h5p-author-playback-'))
  for (const kind of ['multiple-choice', 'question-set']) {
    const source = { ...example, kind, questions: kind === 'multiple-choice' ? [example.questions[0]] : example.questions }
    const file = join(dir, `${kind}.h5p`)
    await buildQuiz(source, file, project)
    files.set(kind, file)
  }
  const file = join(dir, 'scenarios.h5p')
  await buildQuiz(scenarios, file, project)
  files.set('scenarios', file)
})
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

it.each([
  ['multiple-choice', false],
  ['multiple-choice', true],
  ['question-set', false],
  ['question-set', true],
  ['scenarios', false],
  ['scenarios', true]
])('plays authored %s (untrusted: %s) without warnings', async (kind, untrusted) => {
  const report = await verifyPackage({
    file: files.get(kind),
    untrusted,
    ...(untrusted ? { libraries: parts } : {}),
    settle: 500
  })
  expect(report.verdict, JSON.stringify(report)).toBe('pass')
  expect(report.warnings).toEqual([])
  expect(report.errors).toEqual([])
  expect(report.state).toBe('ready')
  expect(report.revision).toMatch(/^sha256:[0-9a-f]{64}(; libraries sha256:[0-9a-f]{64})?$/)
  expect(report.rendered.text).toBeGreaterThan(100)
}, 60_000)
