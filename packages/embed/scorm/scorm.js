/**
 * The launch page's script in a SCORM 1.2 package `h5p-embed --scorm` writes: it finds the LMS's
 * API, opens the session, and plays the package beside this page. The LMS hears what the content
 * reports: its score and whether it passed when it finishes, each question's answer as it is
 * given, the time spent, and the state it saves, which comes back on the next launch so the
 * learner continues where they left off.
 *
 * Outside an LMS, with no API to find, it plays the package and reports nothing.
 *
 * @import { H5PPlayerElement, PlayerErrorDetail, PlayerStateChangeDetail, UserDataDetail } from '@missing-elements/h5p-offline-player'
 */

/**
 * The SCORM 1.2 API, as far as this page calls it: every call takes and returns strings.
 * @typedef {object} ScormApi
 * @property {(empty: string) => string} LMSInitialize
 * @property {(empty: string) => string} LMSFinish
 * @property {(element: string) => string} LMSGetValue
 * @property {(element: string, value: string) => string} LMSSetValue
 * @property {(empty: string) => string} LMSCommit
 */

/**
 * lz-string, which the page loads before this script (`lz-string.js`): the saved state goes into
 * `cmi.suspend_data` compressed, as base64, so that a long Interactive Book's fits where its JSON
 * would not. Without it, a page of its own that left the script out, the state goes plain.
 * @typedef {{ compressToBase64: (text: string) => string, decompressFromBase64: (text: string) => string | null }} LzString
 */

/** What SCORM 1.2 keeps of `cmi.suspend_data`: a `CMIString4096`. */
const SUSPEND_DATA_LIMIT = 4096
/** What it keeps of an interaction's response and its pattern: a `CMIFeedback`, 255 characters. */
const FEEDBACK_LIMIT = 255
/** An interaction's id, a `CMIIdentifier`: 255 characters of printable ASCII, no spaces. */
const IDENTIFIER_LIMIT = 255
/** The verb of a question answered. */
const ANSWERED = 'http://adlnet.gov/expapi/verbs/answered'
/** Where the core writes a part's id on every statement about it. */
const SUB_CONTENT_ID = 'http://h5p.org/x-api/h5p-subContentId'
/**
 * xAPI's interaction types as SCORM 1.2 names them: the same eight, and `long-fill-in`, an Essay,
 * as `fill-in`. A statement with `other`, or none, writes no type.
 * @type {Record<string, string>}
 */
const INTERACTION_TYPES = { 'true-false': 'true-false', choice: 'choice', 'fill-in': 'fill-in', 'long-fill-in': 'fill-in', matching: 'matching', performance: 'performance', sequencing: 'sequencing', likert: 'likert', numeric: 'numeric' }

/**
 * The `API` object an LMS puts in a window above the content, searched from `start` up to its top
 * window (the run-time environment's discovery, 3.3.6.1).
 * @param {Window | null} start
 * @returns {ScormApi | null}
 */
function findApi(start) {
  let win = start
  for (let hops = 0; win && hops < 10; hops++) {
    try {
      const api = /** @type {{ API?: ScormApi }} */ (/** @type {unknown} */ (win)).API
      if (api) return api
    } catch {
      // A window on another origin holds nothing this page can call.
    }
    if (win.parent === win) break
    win = win.parent
  }
  return null
}

/** @param {number} value */
const two = (value) => String(value).padStart(2, '0')

/**
 * `cmi.core.session_time`'s format, a `CMITimespan`: hours, minutes and seconds to the hundredth.
 * @param {number} ms
 */
function timespan(ms) {
  const hundredths = Math.max(0, Math.round(ms / 10))
  const hours = Math.floor(hundredths / 360000)
  const minutes = Math.floor(hundredths / 6000) % 60
  const seconds = (hundredths % 6000) / 100
  return `${two(hours)}:${two(minutes)}:${seconds.toFixed(2).padStart(5, '0')}`
}

/**
 * A statement's `result.duration`, an ISO 8601 duration the core writes as `PT12.34S`, as a
 * `CMITimespan`; `null` for anything else.
 * @param {unknown} duration
 */
function latencyOf(duration) {
  const match = typeof duration === 'string' ? /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(duration) : null
  if (!match || duration === 'PT') return null
  return timespan((Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)) * 1000)
}

/** The time of day, a `CMITime`: when an interaction was answered. */
function timeOfDay() {
  const now = new Date()
  return `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`
}

/**
 * A `finished` statement's result as SCORM 1.2 records it: the score out of 100, and the status,
 * `passed` or `failed` when the content says whether it was passed, `completed` when it does not.
 * @param {{ score?: { scaled?: unknown, raw?: unknown, max?: unknown }, success?: unknown } | undefined} result
 */
function scormResult(result) {
  const score = result?.score ?? {}
  const scaled =
    typeof score.scaled === 'number'
      ? score.scaled
      : typeof score.raw === 'number' && typeof score.max === 'number' && score.max > 0
        ? score.raw / score.max
        : null
  return {
    raw: scaled === null ? null : String(Math.round(Math.min(Math.max(scaled, 0), 1) * 10000) / 100),
    status: result?.success === true ? 'passed' : result?.success === false ? 'failed' : 'completed'
  }
}

/**
 * A statement about a question, as far as the interaction reads it.
 * @typedef {object} AnsweredStatement
 * @property {{ id?: unknown, definition?: { description?: unknown, interactionType?: unknown, correctResponsesPattern?: unknown, extensions?: Record<string, unknown> } }} [object]
 * @property {{ response?: unknown, success?: unknown, duration?: unknown, score?: { raw?: unknown, max?: unknown } }} [result]
 */

/**
 * An interaction's `result`: `correct` or `wrong` as the content says, and where it says nothing,
 * as Fill in the Blanks does not, by its score: full marks, none, or the marks themselves, a
 * number SCORM 1.2 takes there; `neutral` with no score either.
 * @param {NonNullable<AnsweredStatement['result']>} result
 */
function outcomeOf(result) {
  if (result.success === true) return 'correct'
  if (result.success === false) return 'wrong'
  const { raw, max } = result.score ?? {}
  if (typeof raw !== 'number' || typeof max !== 'number' || max <= 0) return 'neutral'
  return raw >= max ? 'correct' : raw <= 0 ? 'wrong' : String(Math.round(raw * 100) / 100)
}

/**
 * Which question a statement is about: the part's id, which the core writes on every statement
 * about a part; the content's own, for a question that is the whole package, has none.
 * @param {AnsweredStatement} statement
 */
function questionKey(statement) {
  const sub = statement.object?.definition?.extensions?.[SUB_CONTENT_ID]
  if (typeof sub === 'string' && sub) return sub
  return typeof statement.object?.id === 'string' && statement.object.id ? statement.object.id : 'content'
}

/**
 * The question's words, from the statement's description in the content's language, else the
 * first it gives; a question type that writes markup there has it taken out.
 * @param {AnsweredStatement} statement
 * @param {string} language
 */
function questionText(statement, language) {
  const description = statement.object?.definition?.description
  if (!description || typeof description !== 'object') return ''
  const map = /** @type {Record<string, unknown>} */ (description)
  const text = map[language] ?? map['en-US'] ?? Object.values(map)[0]
  return typeof text === 'string' ? text.replace(/<[^>]*>/g, ' ') : ''
}

/**
 * An interaction's id, which is what a report shows, since SCORM 1.2 has no description: the
 * question's words as a slug in printable ASCII, else the question's key with anything else
 * taken out, else `question`.
 * @param {string} text
 * @param {string} key
 */
function interactionId(text, key) {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '')
  return (slug || key.replace(/[^\x21-\x7e]/g, '')).slice(0, IDENTIFIER_LIMIT) || 'question'
}

/** The package's build, as the writer stamped it: what saved state is kept against. */
const build = document.querySelector('meta[name="h5p-package-build"]')?.getAttribute('content') ?? ''
const language = document.documentElement.lang || 'en'
const player = /** @type {H5PPlayerElement} */ (document.querySelector('h5p-player'))
const loader = /** @type {HTMLElement} */ (document.getElementById('loader'))
const notice = /** @type {HTMLElement} */ (document.getElementById('notice'))
const saving = /** @type {HTMLElement | null} */ (document.getElementById('saving'))
const lz = /** @type {LzString | undefined} */ (/** @type {{ LZString?: LzString }} */ (/** @type {unknown} */ (globalThis)).LZString)

const api = findApi(window) ?? (window.opener ? findApi(window.opener) : null)
const started = Date.now()
/** Whether the LMS accepted the session; nothing is reported to one that did not. */
const initialized = api ? String(api.LMSInitialize('')) === 'true' : false

/** @param {string} element */
const get = (element) => (initialized && api ? String(api.LMSGetValue(element)) : '')
/** @param {string} element @param {string} value */
const set = (element, value) => initialized && api !== null && String(api.LMSSetValue(element, value)) === 'true'
const commit = () => initialized && api !== null && String(api.LMSCommit('')) === 'true'

if (initialized) {
  const status = get('cmi.core.lesson_status')
  if (status === 'not attempted' || status === '') set('cmi.core.lesson_status', 'incomplete')
}

/*
 * The learner's place. The content saves its state through the element (`resume="host"`), and
 * the whole of it goes into `cmi.suspend_data`, compressed, stamped with the package's build so
 * that a teacher who replaces the package does not hand its learners state saved against another
 * one. With it go the questions answered, by interaction index, so that a question keeps its
 * index and its id across the sessions of an attempt (below). A state written plain, by a zip
 * from before 1.5, is read as it is.
 */

/** @type {Map<string, { dataType: string, subContentId: string, data: string }>} */
const saved = new Map()
/**
 * The question each interaction index is about and the id written for it, by index; kept with
 * the state. @type {([key: string, id: string] | null)[]}
 */
let questions = []

/**
 * `cmi.suspend_data` read back: compressed since embed 1.5, plain JSON before, which begins
 * with a brace, as no base64 does.
 * @param {string} text
 * @returns {unknown}
 */
function readState(text) {
  if (!text) return null
  const json = text.startsWith('{') ? text : (lz?.decompressFromBase64(text) ?? '')
  try {
    return JSON.parse(json || 'null')
  } catch {
    return null
  }
}

if (initialized) {
  const kept = /** @type {{ build?: unknown, entries?: unknown, questions?: unknown } | null} */ (readState(get('cmi.suspend_data')))
  // Not ours, or cut short by an LMS: the content starts over.
  if (build && kept?.build === build && Array.isArray(kept.entries)) {
    for (const [dataType, subContentId, data] of kept.entries) {
      if (typeof data === 'string') saved.set(`${dataType}\n${subContentId}`, { dataType: String(dataType), subContentId: String(subContentId), data })
    }
    if (Array.isArray(kept.questions)) {
      questions = kept.questions.map((entry) => (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string' ? [entry[0], entry[1]] : null))
    }
  }
  player.setAttribute('resume', 'host')
  player.userData = [...saved.values()]
}

let unsavedSaid = false

/**
 * Said once, under the content, when the state cannot be kept: it does not fit, or the LMS
 * refused it. The content plays on; the learner's next launch starts from the last state that
 * was kept, and the reason is in the console.
 * @param {string} reason
 */
function unsaved(reason) {
  console.warn(`The saved state was not kept: ${reason}`)
  if (unsavedSaid || !saving) return
  unsavedSaid = true
  saving.textContent = 'Your progress past this point may not be saved for the next time you open this.'
  saving.hidden = false
}

/**
 * Writes the state and commits it; says so when it cannot.
 * @returns {boolean} whether it was written and committed
 */
function saveState() {
  const json = JSON.stringify({ build, entries: [...saved.values()].map((entry) => [entry.dataType, entry.subContentId, entry.data]), questions })
  const value = lz ? lz.compressToBase64(json) : json
  // A state larger than SCORM 1.2 keeps is not written, rather than written cut short; the last
  // one that fitted stays.
  if (value.length > SUSPEND_DATA_LIMIT) {
    unsaved(`it is ${value.length} characters, and SCORM 1.2 keeps ${SUSPEND_DATA_LIMIT}.`)
    return false
  }
  if (!set('cmi.suspend_data', value)) {
    unsaved('the LMS refused to keep it.')
    return false
  }
  return commit()
}

player.addEventListener('userdata', (event) => {
  if (!initialized) return
  const { dataType, subContentId, data } = /** @type {CustomEvent<UserDataDetail>} */ (event).detail
  const key = `${dataType}\n${subContentId}`
  if (data === null) saved.delete(key)
  else saved.set(key, { dataType, subContentId, data })
  saveState()
})

/*
 * Each question's answer, as `cmi.interactions`: what Moodle's interactions report shows, a
 * column per interaction index for every learner. So a question keeps one index, written over
 * when it is answered again, rather than taking a new one on every attempt, which would set one
 * learner's columns against another's. The index and the id come from the questions kept with
 * the state, after what the LMS already counts; a new attempt, where the LMS counts none, starts
 * them again. They are kept with each answer, not only with the content's own saves, since
 * content that keeps no state of its own sends none. SCORM 1.2 lets the content write the fields
 * and never read them, which the report does.
 */

/**
 * The question's index and the id it was written under: those it has, else the next index and
 * an id no other question has, so that two with the same words differ.
 * @param {AnsweredStatement} statement
 * @returns {{ index: number, id: string }}
 */
function interactionFor(statement) {
  const key = questionKey(statement)
  const count = Math.max(0, Number(get('cmi.interactions._count')) || 0)
  // The LMS counts fewer than the state names: a new attempt, which starts them again.
  if (questions.length > count) questions = questions.slice(0, count)
  const known = questions.findIndex((entry) => entry?.[0] === key)
  if (known !== -1) return { index: known, id: /** @type {[string, string]} */ (questions[known])[1] }
  const base = interactionId(questionText(statement, language), key)
  const taken = new Set(questions.map((entry) => entry?.[1]))
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base.slice(0, IDENTIFIER_LIMIT - 1 - String(n).length)}-${n}`
  const index = Math.max(questions.length, count)
  questions[index] = [key, id]
  return { index, id }
}

/** @param {AnsweredStatement} statement */
function recordAnswer(statement) {
  const { index, id } = interactionFor(statement)
  /** @param {string} field */
  const at = (field) => `cmi.interactions.${index}.${field}`
  // The id first: it is the field that makes the record.
  set(at('id'), id)
  const definition = statement.object?.definition
  const type = typeof definition?.interactionType === 'string' ? INTERACTION_TYPES[definition.interactionType] : undefined
  if (type) set(at('type'), type)
  const pattern = Array.isArray(definition?.correctResponsesPattern) ? definition.correctResponsesPattern[0] : undefined
  if (typeof pattern === 'string') set(at('correct_responses.0.pattern'), pattern.slice(0, FEEDBACK_LIMIT))
  const result = statement.result ?? {}
  if (typeof result.response === 'string') set(at('student_response'), result.response.slice(0, FEEDBACK_LIMIT))
  set(at('result'), outcomeOf(result))
  if (typeof result.score?.max === 'number') set(at('weighting'), String(result.score.max))
  const latency = latencyOf(result.duration)
  if (latency) set(at('latency'), latency)
  set(at('time'), timeOfDay())
}

player.addEventListener('xapi', (event) => {
  if (!initialized) return
  const { statement, verb } = /** @type {CustomEvent<{ statement?: AnsweredStatement, verb?: string }>} */ (event).detail
  if (verb !== ANSWERED || !statement) return
  recordAnswer(statement)
  // The questions go with the state; where the state cannot be written, the answer is still
  // committed.
  if (!saveState()) commit()
})

/*
 * The result. The content's last `finished` is its result, as on an H5P site: a learner who
 * retries replaces it.
 */
let finished = false

player.addEventListener('finished', (event) => {
  if (!initialized) return
  const { raw, status } = scormResult(/** @type {CustomEvent<{ statement?: { result?: any } }>} */ (event).detail?.statement?.result)
  if (raw !== null) {
    set('cmi.core.score.min', '0')
    set('cmi.core.score.max', '100')
    set('cmi.core.score.raw', raw)
  }
  set('cmi.core.lesson_status', status)
  set('cmi.core.session_time', timespan(Date.now() - started))
  finished = true
  commit()
})

/*
 * The session ends with the page. Unfinished, it is suspended, so the next launch resumes it.
 *
 * Its time and how it ended are committed on `beforeunload` too, while the page is still there,
 * and the session is finished on `pagehide`, once the page is going for good. ILIAS sends what a
 * closing page writes with a beacon only during `beforeunload`, `unload` or a click; on `pagehide`
 * it tries a synchronous request, which Chrome refuses while a page goes, so the finish alone lost
 * the session's time there (#94). The commit is all `beforeunload` does: the content saves its
 * state for the last time on its own frame's `beforeunload`, which comes after this page's, and a
 * learner asked whether to leave may stay.
 */
let ended = false

function writeEnd() {
  set('cmi.core.session_time', timespan(Date.now() - started))
  set('cmi.core.exit', finished ? '' : 'suspend')
}

if (initialized) {
  addEventListener('beforeunload', () => {
    if (ended) return
    writeEnd()
    commit()
  })
}

addEventListener('pagehide', () => {
  if (!initialized || ended || !api) return
  ended = true
  writeEnd()
  api.LMSFinish('')
})

player.addEventListener('statechange', (event) => {
  const { state } = /** @type {CustomEvent<PlayerStateChangeDetail>} */ (event).detail
  if (state === 'ready' || state === 'error') loader.hidden = true
})

player.addEventListener('error', (event) => {
  // After `ready` the content is up and an error leaves it running.
  if (player.state === 'ready') return
  notice.textContent = /** @type {CustomEvent<PlayerErrorDetail>} */ (/** @type {unknown} */ (event)).detail.message
  notice.hidden = false
})

player.setAttribute('src', new URL('./package.h5p', location.href).href)
