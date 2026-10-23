import { constants, createReadStream } from 'node:fs'
import { copyFile, mkdtemp, open, readFile, realpath, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'

/**
 * @typedef {{ text: string, correct: boolean, feedback?: string }} Answer
 * @typedef {{ title?: string, prompt: string, multipleAnswers?: boolean, answers: Answer[] }} Question
 * @typedef {{
 *   kind: 'multiple-choice' | 'question-set', title: string, language: string, license: string,
 *   authors: { name: string, role: 'Author' }[], passPercentage?: number, questions: Question[]
 * }} Quiz
 * @typedef {{
 *   name: string, type: string, optional?: boolean, default?: unknown,
 *   fields?: Field[], field?: Field, min?: number, defaultNum?: number
 * }} Field
 */

function record(value, path, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path}: expected an object`)
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`${path}.${key}: unsupported field`)
  }
}

function text(value, path) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${path}: expected non-empty text`)
}

/** @param {unknown} source @returns {asserts source is Quiz} */
export function validateQuiz(source) {
  record(source, 'quiz', ['kind', 'title', 'language', 'license', 'authors', 'passPercentage', 'questions'])
  const quiz = /** @type {Quiz} */ (source)
  if (!['multiple-choice', 'question-set'].includes(quiz.kind)) throw new Error('quiz.kind: use "multiple-choice" or "question-set"')
  for (const key of ['title', 'language', 'license']) text(quiz[key], `quiz.${key}`)
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
    const correct = question.answers.filter(answer => answer.correct).length
    if (question.multipleAnswers ? correct === 0 : correct !== 1) {
      throw new Error(`${path}.answers: ${question.multipleAnswers ? 'at least one' : 'exactly one'} answer must be correct`)
    }
  })
}

/** Fill only the field kinds these two content types use; a changed schema must fail loudly.
 * @param {Field[]} fields @param {Record<string, unknown>} written
 * @returns {Record<string, unknown>}
 */
function parameters(fields, written) {
  for (const key of Object.keys(written)) {
    if (!fields.some(field => field.name === key)) throw new Error(`Installed semantics do not name "${key}"`)
  }
  return Object.fromEntries(fields.map(field => [field.name, valueFor(field, written[field.name])]).filter(([, value]) => value !== undefined))
}

/** @param {Field} field @param {unknown} written @returns {unknown} */
function valueFor(field, written) {
  if (field.type === 'group') {
    const fields = field.fields
    if (!fields?.length) throw new Error(`Invalid group semantics: ${field.name}`)
    // H5P saves a group with one field as that field, without the group's wrapper.
    if (fields.length === 1) return valueFor(fields[0], written)
    return parameters(fields, /** @type {Record<string, unknown>} */ (written ?? field.default ?? {}))
  }
  if (field.type === 'list') {
    const list = written ?? field.default
    if (list !== undefined) {
      if (!Array.isArray(list)) throw new Error(`Expected a list: ${field.name}`)
      return list.map(item => valueFor(field.field, item))
    }
    if (field.optional) return undefined
    throw new Error(`Missing required list: ${field.name}`)
  }
  if (field.type === 'library' && written !== undefined) return written
  if (written !== undefined) return written
  if (field.default !== undefined) return structuredClone(field.default)
  if (field.type === 'boolean') return false
  if (field.optional) return undefined
  throw new Error(`No authoring value or default for required field: ${field.name} (${field.type})`)
}

function html(value) {
  return `<p>${value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;').replaceAll('\n', '<br>')}</p>`
}

/** The versions the helper is tested with; a missing or older install is refused with this command. */
const INSTALL = 'npm install --save-dev @missing-elements/h5p-libraries@^1 @zip.js/zip.js@^2.24'

/**
 * Dependencies are resolved from the caller's project, not from the installed skill directory.
 * @param {string} project
 */
async function dependencies(project) {
  const require = createRequire(join(resolve(project), 'package.json'))
  try {
    // appendZip has no filter before zip.js 2.20, so each part's own h5p.json would be copied too.
    const { version } = require('@zip.js/zip.js/package.json')
    const [major, minor] = version.split('.').map(Number)
    if (major < 2 || (major === 2 && minor < 24)) throw new Error(`@zip.js/zip.js ${version} is older than 2.24`)
    const [zip, { pack }] = await Promise.all([
      import(pathToFileURL(require.resolve('@zip.js/zip.js')).href),
      import(pathToFileURL(require.resolve('@missing-elements/h5p-libraries')).href)
    ])
    return { zip, pack }
  } catch (error) {
    throw new Error(`Cannot load authoring dependencies from the current project. Run: ${INSTALL}`, { cause: error })
  }
}

/** @param {unknown} source @param {string} output @param {string} [project] */
export async function buildQuiz(source, output, project = process.cwd()) {
  validateQuiz(source)
  const { zip, pack } = await dependencies(project)
  const { ZipReader, ZipWriter, Reader, TextReader, TextWriter } = zip
  const selected = new Map()
  const readers = new Map()

  // The pack's largest library need not fit in memory.
  class FileReader extends Reader {
    constructor(path) { super(); this.path = path }
    async init() {
      await super.init()
      this.file = await open(this.path, 'r')
      this.size = (await this.file.stat()).size
    }
    async readUint8Array(offset, length) {
      const bytes = new Uint8Array(length)
      let read = 0
      while (read < length) {
        const { bytesRead } = await this.file.read(bytes, read, length - read, offset + read)
        if (!bytesRead) throw new Error(`Short read from library part: ${this.path}`)
        read += bytesRead
      }
      return bytes
    }
    createReadable({ offset = 0, size = this.size - offset } = {}) {
      if (!size) return new ReadableStream({ start(controller) { controller.close() } })
      return Readable.toWeb(createReadStream(this.path, { start: offset, end: offset + size - 1 }))
    }
  }

  async function use(machineName, major, minor = 0) {
    const candidates = pack.libraries.filter(lib => lib.machineName === machineName && (major === undefined || lib.majorVersion === major) && lib.minorVersion >= minor)
    candidates.sort((a, b) => b.majorVersion - a.majorVersion || b.minorVersion - a.minorVersion || b.patchVersion - a.patchVersion)
    const candidate = candidates[0]
    if (!candidate) throw new Error(`Installed pack cannot supply ${machineName} ${major ?? ''}.${minor}`)
    if (selected.has(candidate.folder)) return selected.get(candidate.folder)
    const library = { ...candidate }
    selected.set(library.folder, library)
    const path = new URL(library.url)
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path)) hash.update(chunk)
    if (hash.digest('hex') !== library.sha256) throw new Error(`Library part failed SHA-256: ${library.folder}. Reinstall the library pack.`)
    const file = new FileReader(path)
    const reader = new ZipReader(file, { checkSignature: true })
    readers.set(library.folder, { reader, file })
    const entries = (await reader.getEntries()).filter(entry => !entry.directory && entry.filename.startsWith(`${library.folder}/`))
    const metadata = entries.find(entry => entry.filename === `${library.folder}/library.json`)
    if (!metadata) throw new Error(`Library part has no library.json: ${library.folder}`)
    const info = JSON.parse(await metadata.getData(new TextWriter()))
    if (info.machineName !== library.machineName || Number(info.majorVersion) !== library.majorVersion || Number(info.minorVersion) !== library.minorVersion || Number(info.patchVersion) !== library.patchVersion) {
      throw new Error(`Library part disagrees with pack index: ${library.folder}`)
    }
    const semantics = entries.find(entry => entry.filename === `${library.folder}/semantics.json`)
    if (semantics) library.semantics = JSON.parse(await semantics.getData(new TextWriter()))
    for (const dependency of [...(info.preloadedDependencies ?? []), ...(info.dynamicDependencies ?? [])]) {
      await use(dependency.machineName, Number(dependency.majorVersion), Number(dependency.minorVersion))
    }
    return library
  }

  let temporary
  try {
    const choice = await use('H5P.MultiChoice', 1)
    const set = source.kind === 'question-set' ? await use('H5P.QuestionSet', 1) : null
    if (!choice.semantics || (set && !set.semantics)) throw new Error('The installed quiz libraries must carry semantics.json')
    const questions = source.questions.map((question, i) => {
      const written = {
        question: html(question.prompt),
        answers: question.answers.map(answer => ({
          text: html(answer.text), correct: answer.correct,
          tipsAndFeedback: answer.feedback ? { chosenFeedback: html(answer.feedback) } : {}
        })),
        behaviour: {
          type: question.multipleAnswers ? 'multi' : 'single',
          ...(!set && source.passPercentage !== undefined ? { passPercentage: source.passPercentage } : {})
        }
      }
      return {
        library: `${choice.machineName} ${choice.majorVersion}.${choice.minorVersion}`,
        params: parameters(choice.semantics, written),
        subContentId: randomUUID(),
        metadata: { title: question.title ?? `Question ${i + 1}`, license: source.license, authors: source.authors }
      }
    })
    const content = set
      ? parameters(set.semantics, { questions, ...(source.passPercentage === undefined ? {} : { passPercentage: source.passPercentage }) })
      : questions[0].params
    const root = set ?? choice
    const manifest = {
      title: source.title, language: source.language, defaultLanguage: source.language,
      license: source.license, authors: source.authors, mainLibrary: root.machineName, embedTypes: ['div'],
      preloadedDependencies: [...selected.values()].map(lib => ({
        machineName: lib.machineName, majorVersion: String(lib.majorVersion), minorVersion: String(lib.minorVersion)
      }))
    }

    output = resolve(output)
    temporary = await mkdtemp(join(dirname(output), '.h5p-author-'))
    const staged = join(temporary, 'quiz.h5p')
    const file = await open(staged, 'wx')
    try {
      const writer = new ZipWriter(Writable.toWeb(file.createWriteStream()), { useWebWorkers: false })
      await writer.add('h5p.json', new TextReader(JSON.stringify(manifest)))
      for (const library of selected.values()) {
        await writer.appendZip(readers.get(library.folder).file, {
          filter: entry => !entry.directory && entry.filename.startsWith(`${library.folder}/`)
        })
      }
      await writer.add('content/content.json', new TextReader(JSON.stringify(content)))
      await writer.close()
    } finally {
      await file.close()
    }
    // Unlike a hard link, an exclusive copy also works on FAT/exFAT destinations.
    await copyFile(staged, output, constants.COPYFILE_EXCL)
    return { output, manifest, content, libraries: [...selected.keys()] }
  } finally {
    for (const { reader, file } of readers.values()) {
      try { await reader.close() } finally { await file.file?.close() }
    }
    if (temporary) await rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && await realpath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--help') {
    console.log(`Usage: node <skill>/scripts/build-quiz.mjs <quiz.json> <output.h5p>\nRun from a project with the dependencies installed: ${INSTALL}\nBuilds a self-contained, text-only Multiple Choice or Question Set. Refuses to overwrite output.`)
  } else {
    try {
      if (args.length !== 2 || args.some(arg => arg.startsWith('--'))) throw new Error('Usage: node <skill>/scripts/build-quiz.mjs <quiz.json> <output.h5p>')
      const source = JSON.parse(await readFile(resolve(args[0]), 'utf8'))
      const result = await buildQuiz(source, args[1])
      console.log(`Built ${result.output}\n${result.manifest.mainLibrary}; ${result.libraries.length} libraries from the installed pack.\nNot verified: run h5p-verify and inspect its screenshot before handing this package over.`)
      if (!/^en(?:-|$)/i.test(source.language)) console.warn('Library UI defaults are English; the language tag does not translate the Check, Retry, or result labels.')
    } catch (error) {
      console.error(`h5p-author: ${error.message}`)
      if (error.cause) console.error(error.cause.message)
      process.exitCode = 1
    }
  }
}
