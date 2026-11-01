import { escapeText } from './text.mjs'

/**
 * The quiz format the h5p-author skill published on 2026-10-23: a Multiple Choice question or a
 * Question Set of them, in plain text. It stays a source the build takes, mapped here onto the
 * general one, so nothing written in it breaks.
 */

/**
 * @typedef {{ text: string, correct: boolean, feedback?: string }} Answer
 * @typedef {{ title?: string, prompt: string, multipleAnswers?: boolean, answers: Answer[] }} Question
 * @typedef {{
 *   kind: 'multiple-choice' | 'question-set', title: string, language: string, license: string,
 *   authors: { name: string, role: 'Author' }[], passPercentage?: number,
 *   passedFeedback?: string, failedFeedback?: string, questions: Question[]
 * }} Quiz
 */

/** @param {unknown} value @returns {value is Record<string, any>} */
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * What is wrong with a quiz, all of it, each by its path, as a general source's problems are
 * listed: a fix takes one round.
 * @param {unknown} source
 * @returns {{ path: string, message: string }[]}
 * @internal
 */
export function quizProblems(source) {
  /** @type {{ path: string, message: string }[]} */
  const problems = []
  const report = (/** @type {string} */ path, /** @type {string} */ message) => problems.push({ path, message })
  /** Whether a value is an object; a field it should not have is reported. @param {unknown} value @param {string} path @param {string[]} keys */
  const record = (value, path, keys) => {
    if (!isObject(value)) {
      report(path, 'expected an object')
      return false
    }
    for (const key of Object.keys(value)) if (!keys.includes(key)) report(`${path}.${key}`, 'unsupported field')
    return true
  }
  /** Whether a value is text with something in it. @param {unknown} value @param {string} path */
  const text = (value, path) => {
    if (typeof value === 'string' && value.trim()) return true
    report(path, 'expected non-empty text')
    return false
  }

  if (!record(source, 'quiz', ['kind', 'title', 'language', 'license', 'authors', 'passPercentage', 'passedFeedback', 'failedFeedback', 'questions'])) return problems
  const quiz = /** @type {Record<string, any>} */ (source)
  if (!['multiple-choice', 'question-set'].includes(quiz.kind)) report('quiz.kind', 'use "multiple-choice" or "question-set"')
  if (text(quiz.title, 'quiz.title') && quiz.title.length > 255) report('quiz.title', 'at most 255 characters')
  if (text(quiz.language, 'quiz.language')) {
    try {
      Intl.getCanonicalLocales(quiz.language)
    } catch {
      report('quiz.language', 'expected a BCP 47 language tag, such as "en"')
    }
  }
  if (text(quiz.license, 'quiz.license') && !['U', 'CC BY', 'CC BY-SA', 'CC BY-ND', 'CC BY-NC', 'CC BY-NC-SA', 'CC BY-NC-ND', 'CC0 1.0', 'PD', 'C'].includes(quiz.license)) {
    report('quiz.license', 'use an H5P license code (for example "U", "CC BY", or "CC0 1.0")')
  }
  if (!Array.isArray(quiz.authors) || !quiz.authors.length) report('quiz.authors', 'name at least one author')
  else quiz.authors.forEach((/** @type {unknown} */ author, /** @type {number} */ i) => {
    if (!record(author, `quiz.authors[${i}]`, ['name', 'role'])) return
    const { name, role } = /** @type {Record<string, unknown>} */ (author)
    text(name, `quiz.authors[${i}].name`)
    if (role !== 'Author') report(`quiz.authors[${i}].role`, 'use "Author"')
  })
  if (quiz.passPercentage !== undefined && (!Number.isInteger(quiz.passPercentage) || quiz.passPercentage < 0 || quiz.passPercentage > 100)) {
    report('quiz.passPercentage', 'expected an integer from 0 to 100')
  }
  if (quiz.passedFeedback !== undefined || quiz.failedFeedback !== undefined) {
    // One without the other leaves some learners with no word on the result.
    for (const key of ['passedFeedback', 'failedFeedback']) {
      if (quiz[key] === undefined) report(`quiz.${key}`, 'set passedFeedback and failedFeedback together')
      else text(quiz[key], `quiz.${key}`)
    }
    if (quiz.passPercentage === undefined) report('quiz.passPercentage', 'set it with passedFeedback and failedFeedback; the library defaults differ by kind')
  }
  if (!Array.isArray(quiz.questions) || !quiz.questions.length) {
    report('quiz.questions', 'at least one question is required')
    return problems
  }
  if (quiz.kind === 'multiple-choice' && quiz.questions.length !== 1) report('quiz.questions', 'multiple-choice requires exactly one question')
  quiz.questions.forEach((/** @type {unknown} */ written, /** @type {number} */ i) => {
    const path = `quiz.questions[${i}]`
    if (!record(written, path, ['title', 'prompt', 'multipleAnswers', 'answers'])) return
    const question = /** @type {Record<string, any>} */ (written)
    text(question.prompt, `${path}.prompt`)
    if (question.title !== undefined) text(question.title, `${path}.title`)
    const multiple = question.multipleAnswers
    if (multiple !== undefined && typeof multiple !== 'boolean') report(`${path}.multipleAnswers`, 'expected a boolean')
    if (!Array.isArray(question.answers) || question.answers.length < 2) {
      report(`${path}.answers`, 'at least two answers are required')
      return
    }
    let marked = true
    question.answers.forEach((/** @type {unknown} */ answer, /** @type {number} */ j) => {
      const answerPath = `${path}.answers[${j}]`
      if (!record(answer, answerPath, ['text', 'correct', 'feedback'])) {
        marked = false
        return
      }
      const { text: words, correct, feedback } = /** @type {Record<string, unknown>} */ (answer)
      text(words, `${answerPath}.text`)
      if (typeof correct !== 'boolean') {
        report(`${answerPath}.correct`, 'expected a boolean')
        marked = false
      }
      if (feedback !== undefined) text(feedback, `${answerPath}.feedback`)
    })
    // Counted once every answer says whether it is correct, and the question how many may be.
    if (!marked || (multiple !== undefined && typeof multiple !== 'boolean')) return
    const correct = question.answers.filter((/** @type {{ correct: boolean }} */ answer) => answer.correct).length
    if (multiple ? correct === 0 : correct !== 1) report(`${path}.answers`, `${multiple ? 'at least one' : 'exactly one'} answer must be correct`)
  })
  return problems
}

/** A plain text written as the paragraph the quiz format has always made of it. @param {string} value */
function paragraph(value) {
  return `<p>${escapeText(value).replaceAll('\n', '<br>')}</p>`
}

/**
 * The pass mark as two score ranges for the content's overall feedback. The libraries pick a
 * range by the floored percentage and judge `success` by the exact one, which agree for a whole
 * number, so the message a learner gets matches the result an LMS records.
 * @param {Quiz} quiz
 */
function passFeedback(quiz) {
  if (quiz.passedFeedback === undefined || quiz.failedFeedback === undefined || quiz.passPercentage === undefined) return undefined
  const pass = quiz.passPercentage
  return [
    ...(pass > 0 ? [{ from: 0, to: pass - 1, feedback: quiz.failedFeedback }] : []),
    { from: pass, to: 100, feedback: quiz.passedFeedback }
  ]
}

/**
 * A quiz as a general source: Multiple Choice's parameters for each question, inside a Question
 * Set's for a set. A question with no title takes the set's own label and number, as the set's
 * layout does (`H5P.QuestionSet` in types.mjs).
 * @param {Quiz} quiz
 * @internal
 */
export function quizSource(quiz) {
  const overallFeedback = passFeedback(quiz)
  const set = quiz.kind === 'question-set'
  const questions = quiz.questions.map((question) => ({
    question: paragraph(question.prompt),
    answers: question.answers.map((answer) => ({
      text: paragraph(answer.text),
      correct: answer.correct,
      tipsAndFeedback: answer.feedback ? { chosenFeedback: paragraph(answer.feedback) } : {}
    })),
    behaviour: {
      type: question.multipleAnswers ? 'multi' : 'single',
      ...(!set && quiz.passPercentage !== undefined ? { passPercentage: quiz.passPercentage } : {})
    },
    ...(!set && overallFeedback ? { overallFeedback } : {})
  }))
  const params = set
    ? {
        questions: questions.map((params, i) => ({
          library: 'H5P.MultiChoice',
          params,
          ...(quiz.questions[i].title === undefined ? {} : { metadata: { title: quiz.questions[i].title } })
        })),
        ...(quiz.passPercentage === undefined ? {} : { passPercentage: quiz.passPercentage }),
        ...(overallFeedback ? { endGame: { overallFeedback } } : {})
      }
    : questions[0]
  return {
    type: set ? 'H5P.QuestionSet' : 'H5P.MultiChoice',
    title: quiz.title,
    language: quiz.language,
    license: quiz.license,
    authors: quiz.authors,
    params
  }
}
