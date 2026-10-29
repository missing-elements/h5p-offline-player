import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { previewPackage } from '../../../packages/verify/lib/preview.mjs'
import { buildQuiz, type Quiz } from '../../../skills/h5p-author/scripts/build-quiz.mjs'

const project = resolve(import.meta.dirname, '..')
// The pack this project installed, named to the preview as `--libraries` names a copy of its parts.
const parts = resolve(project, 'node_modules/@missing-elements/h5p-libraries/parts')
const source: Quiz = JSON.parse(await readFile(resolve(project, '../../skills/h5p-author/assets/phishing-scenarios.json'), 'utf8'))
const example: Quiz = JSON.parse(await readFile(resolve(project, '../../skills/h5p-author/assets/quiz.json'), 'utf8'))
const single: Quiz = { ...example, kind: 'multiple-choice', questions: [example.questions[0]] }
let dir: string
let file: string
let singleFile: string
let browser: Browser

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'h5p-author-interaction-'))
  file = join(dir, 'scenarios.h5p')
  await buildQuiz(source, file, project)
  singleFile = join(dir, 'single.h5p')
  await buildQuiz(single, singleFile, project)
  browser = await chromium.launch()
})
afterAll(async () => {
  await browser?.close()
  if (dir) await rm(dir, { recursive: true, force: true })
})

type Player = HTMLElement & { state: string; untrusted: boolean }
type ResultsWindow = Window & typeof globalThis & { authorFinished: unknown[] }

async function finished(page: Page, count: number) {
  await page.waitForFunction(count => (window as ResultsWindow).authorFinished.length === count, count)
  return page.evaluate(() => (window as ResultsWindow).authorFinished.at(-1))
}

/** Opens a package in the preview once it is ready, recording each `finished` statement. */
async function open(page: Page, url: string, untrusted: boolean) {
  await page.goto(`${url}/`)
  await page.waitForFunction(() => ['ready', 'error'].includes((document.querySelector('h5p-player') as Player).state), null, { timeout: 60_000 })
  expect(await page.locator('h5p-player').evaluate(player => [(player as Player).state, (player as Player).untrusted])).toEqual(['ready', untrusted])
  await page.locator('h5p-player').evaluate(player => {
    const results: unknown[] = []
    Object.defineProperty(window, 'authorFinished', { value: results })
    player.addEventListener('finished', event => {
      if (event instanceof CustomEvent) results.push(event.detail.statement)
    })
  })
  return page.frameLocator('h5p-player iframe')
}

async function attempt(page: Page, correctQuestions: number, previousResults: number) {
  const frame = page.frameLocator('h5p-player iframe')
  for (let i = 0; i < source.questions.length; i++) {
    const question = source.questions[i]
    const candidates = question.answers.filter(answer => i < correctQuestions ? answer.correct : !answer.correct)
    const selected = question.multipleAnswers ? candidates : candidates.slice(0, 1)
    for (const answer of selected) {
      await frame.getByRole(question.multipleAnswers ? 'checkbox' : 'radio').filter({ hasText: answer.text }).click()
    }
    await frame.getByRole('button', { name: /^Check the answers/ }).click()
    for (const answer of selected) {
      if (!answer.feedback) throw new Error('The scenario example must explain every answer')
      await frame.getByText(answer.feedback, { exact: true }).waitFor({ state: 'visible' })
    }
    // Sub-question answers must not finish the parent Question Set.
    expect(await page.evaluate(() => (window as ResultsWindow).authorFinished.length)).toBe(previousResults)
    await frame.getByRole('button', { name: i === source.questions.length - 1 ? 'Finish' : 'Next', exact: true }).click()
  }
}

// In the verifier's preview, the page the skill's review hands a person: trusted, and untrusted
// against the installed pack, as a site that did not make the quiz plays it.
it.each([false, true])('plays every scenario in the preview across the 80% threshold and retries to 100% (untrusted: %s)', async untrusted => {
  const preview = await previewPackage({ file, port: 0, untrusted, libraries: untrusted ? parts : undefined })
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    const frame = await open(page, preview.url, untrusted)
    // Question Set 1.21 draws neither its score ranges' feedback nor its score bar on the result
    // page (h5p/h5p-question-set#183, fixed by the open #184), so for now only the screen-reader
    // announcement carries the pass and fail messages. This checks that it does.
    const announced = (text: string) => frame.locator('.qs-progress-announcer').filter({ hasText: text }).waitFor({ state: 'attached' })

    await attempt(page, 6, 0)
    expect(await finished(page, 1)).toMatchObject({
      verb: { id: 'http://adlnet.gov/expapi/verbs/completed' },
      result: { completion: true, success: false, score: { raw: 9, max: 12, scaled: 0.75 } },
      context: { revision: expect.stringMatching(/^sha256:[0-9a-f]{64}/) }
    })
    await announced(source.failedFeedback!)
    await frame.getByRole('button', { name: 'Retry', exact: true }).click()
    await attempt(page, 7, 1)
    expect(await finished(page, 2)).toMatchObject({
      result: { completion: true, success: true, score: { raw: 10, max: 12, scaled: 0.8333 } }
    })
    await announced(source.passedFeedback!)
    await frame.getByRole('button', { name: 'Retry', exact: true }).click()
    await attempt(page, source.questions.length, 2)
    expect(await finished(page, 3)).toMatchObject({
      result: { completion: true, success: true, score: { raw: 12, max: 12, scaled: 1 } }
    })
    await frame.getByRole('button', { name: 'Show solution', exact: true }).click()
    await frame.getByText(source.questions[0].answers[2].text, { exact: true }).waitFor({ state: 'visible' })
    expect(await frame.getByRole('button', { name: /^Check the answers/ }).count()).toBe(0)
    expect(errors).toEqual([])
  } finally {
    await page.close()
    preview.close()
  }
})

// A question on its own draws its score ranges' feedback after Check, so the learner sees the
// message, and it says what the `finished` statement records. The text survives the content check.
it.each([false, true])('shows a standalone question\'s pass and fail messages after Check (untrusted: %s)', async untrusted => {
  const preview = await previewPackage({ file: singleFile, port: 0, untrusted, libraries: untrusted ? parts : undefined })
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    const frame = await open(page, preview.url, untrusted)
    const question = single.questions[0]
    for (const [correct, message, count] of [[false, single.failedFeedback!, 1], [true, single.passedFeedback!, 2]] as const) {
      if (correct) await frame.getByRole('button', { name: /^Retry/ }).click()
      await frame.getByRole('radio').filter({ hasText: question.answers.find(answer => answer.correct === correct)!.text }).click()
      await frame.getByRole('button', { name: /^Check the answers/ }).click()
      await frame.getByText(message, { exact: true }).waitFor({ state: 'visible' })
      expect(await finished(page, count)).toMatchObject({ result: { success: correct } })
    }
    expect(errors).toEqual([])
  } finally {
    await page.close()
    preview.close()
  }
})
