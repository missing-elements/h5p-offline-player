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

/** @param {unknown} value @param {string} path @param {string[]} keys */
function record(value, path, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path}: expected an object`)
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`${path}.${key}: unsupported field`)
  }
}

/** @param {unknown} value @param {string} path */
function text(value, path) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${path}: expected non-empty text`)
}

/** @param {unknown} source @returns {asserts source is Quiz} @internal */
export function validateQuiz(source) {
  record(source, 'quiz', ['kind', 'title', 'language', 'license', 'authors', 'passPercentage', 'passedFeedback', 'failedFeedback', 'questions'])
  const quiz = /** @type {Quiz} */ (source)
  if (!['multiple-choice', 'question-set'].includes(quiz.kind)) throw new Error('quiz.kind: use "multiple-choice" or "question-set"')
  for (const key of /** @type {const} */ (['title', 'language', 'license'])) text(quiz[key], `quiz.${key}`)
  if (quiz.title.length > 255) throw new Error('quiz.title: at most 255 characters')
  try {
    Intl.getCanonicalLocales(quiz.language)
  } catch {
    throw new Error('quiz.language: expected a BCP 47 language tag, such as "en"')
  }
  if (!['U', 'CC BY', 'CC BY-SA', 'CC BY-ND', 'CC BY-NC', 'CC BY-NC-SA', 'CC BY-NC-ND', 'CC0 1.0', 'PD', 'C'].includes(quiz.license)) {
    throw new Error('quiz.license: use an H5P license code (for example "U", "CC BY", or "CC0 1.0")')
  }
  if (!Array.isArray(quiz.authors) || !quiz.authors.length) throw new Error('quiz.authors: name at least one author')
  quiz.authors.forEach((author, i) => {
    record(author, `quiz.authors[${i}]`, ['name', 'role'])
    text(author.name, `quiz.authors[${i}].name`)
    if (author.role !== 'Author') throw new Error(`quiz.authors[${i}].role: use "Author"`)
  })
  if (quiz.passPercentage !== undefined && (!Number.isInteger(quiz.passPercentage) || quiz.passPercentage < 0 || quiz.passPercentage > 100)) {
    throw new Error('quiz.passPercentage: expected an integer from 0 to 100')
  }
  if (quiz.passedFeedback !== undefined || quiz.failedFeedback !== undefined) {
    // One without the other leaves some learners with no word on the result.
    for (const key of /** @type {const} */ (['passedFeedback', 'failedFeedback'])) {
      if (quiz[key] === undefined) throw new Error(`quiz.${key}: set passedFeedback and failedFeedback together`)
      text(quiz[key], `quiz.${key}`)
    }
    if (quiz.passPercentage === undefined) throw new Error('quiz.passPercentage: set it with passedFeedback and failedFeedback; the library defaults differ by kind')
  }
  if (!Array.isArray(quiz.questions) || !quiz.questions.length) throw new Error('quiz.questions: at least one question is required')
  if (quiz.kind === 'multiple-choice' && quiz.questions.length !== 1) throw new Error('quiz.questions: multiple-choice requires exactly one question')
  quiz.questions.forEach((question, i) => {
    const path = `quiz.questions[${i}]`
    record(question, path, ['title', 'prompt', 'multipleAnswers', 'answers'])
    text(question.prompt, `${path}.prompt`)
    if (question.title !== undefined) text(question.title, `${path}.title`)
    if (question.multipleAnswers !== undefined && typeof question.multipleAnswers !== 'boolean') throw new Error(`${path}.multipleAnswers: expected a boolean`)
    if (!Array.isArray(question.answers) || question.answers.length < 2) throw new Error(`${path}.answers: at least two answers are required`)
    question.answers.forEach((answer, j) => {
      const answerPath = `${path}.answers[${j}]`
      record(answer, answerPath, ['text', 'correct', 'feedback'])
      text(answer.text, `${answerPath}.text`)
      if (typeof answer.correct !== 'boolean') throw new Error(`${answerPath}.correct: expected a boolean`)
      if (answer.feedback !== undefined) text(answer.feedback, `${answerPath}.feedback`)
    })
    const correct = question.answers.filter((answer) => answer.correct).length
    if (question.multipleAnswers ? correct === 0 : correct !== 1) {
      throw new Error(`${path}.answers: ${question.multipleAnswers ? 'at least one' : 'exactly one'} answer must be correct`)
    }
  })
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
