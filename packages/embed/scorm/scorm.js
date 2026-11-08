/**
 * The launch page's script in a SCORM package `h5p-embed --scorm` writes: it finds the LMS's
 * API, opens the session, and plays the package beside this page. The LMS hears what the content
 * reports: its score and whether it passed when it finishes, each question's answer as it is
 * given, the time spent, and the state it saves, which comes back on the next launch so the
 * learner continues where they left off.
 *
 * SCORM 1.2 unless the writer said otherwise in the page (`h5p-scorm-version`, 2004 4th
 * Edition), and graded by the content's own result unless it gave a pass mark
 * (`h5p-scorm-pass-mark`) or counts content that finishes without a score as 100
 * (`h5p-scorm-completion-score`). A page written with none of the three is a page from before
 * they existed, and this script does with it what it did then.
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
 * The SCORM 2004 API, `API_1484_11`, as far as this page calls it.
 * @typedef {object} Scorm2004Api
 * @property {(empty: string) => string} Initialize
 * @property {(empty: string) => string} Terminate
 * @property {(element: string) => string} GetValue
 * @property {(element: string, value: string) => string} SetValue
 * @property {(empty: string) => string} Commit
 */

/**
 * Either version's API as the calls this page makes.
 * @typedef {object} Lms
 * @property {() => string} initialize
 * @property {() => string} finish
 * @property {(element: string) => string} get
 * @property {(element: string, value: string) => string} set
 * @property {() => string} commit
 */

/**
 * lz-string, which the page loads before this script (`lz-string.js`): the saved state goes into
 * `cmi.suspend_data` compressed, as base64, so that a long Interactive Book's fits where its JSON
 * would not. Without it, a page of its own that left the script out, the state goes plain.
 * @typedef {{ compressToBase64: (text: string) => string, decompressFromBase64: (text: string) => string | null }} LzString
 */

/** @param {string} name */
const told = (name) => document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? ''
/** Whether the writer made this a SCORM 2004 package; 1.2 otherwise. */
const scorm2004 = told('h5p-scorm-version') === '2004'
/** The pass mark the writer was given, out of 100, or `null`. */
const writtenPassMark = told('h5p-scorm-pass-mark') === '' ? null : Number(told('h5p-scorm-pass-mark'))
/** Whether content that finishes without a score counts as 100. */
const completionScore = told('h5p-scorm-completion-score') !== ''
const SCORM = scorm2004 ? 'SCORM 2004' : 'SCORM 1.2'

/** What the LMS keeps of `cmi.suspend_data`: SCORM 1.2's `CMIString4096`, or 2004's 64,000. */
const SUSPEND_DATA_LIMIT = scorm2004 ? 64000 : 4096
/**
 * What it keeps of an interaction's response and its pattern: SCORM 1.2's `CMIFeedback`, 255
 * characters; in 2004 the longest the format allows, 4,000.
 */
const FEEDBACK_LIMIT = scorm2004 ? 4000 : 255
/** How much of a question's words a SCORM 1.2 id carries after its number, cut at a word. */
const ID_WORDS_LIMIT = 40
/** Latin letters that no decomposition takes to ASCII, as an id spells them. */
const FOLDED = /** @type {Record<string, string>} */ ({ ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ł: 'l', þ: 'th', ð: 'd', ı: 'i' })
/** What 2004 keeps of a question's words, `cmi.interactions.n.description`: 250 characters. */
const DESCRIPTION_LIMIT = 250
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
/** SCORM 2004 has xAPI's ten, `long-fill-in` and `other` among them. */
const INTERACTION_TYPES_2004 = { ...INTERACTION_TYPES, 'long-fill-in': 'long-fill-in', other: 'other' }

/**
 * The API object an LMS puts in a window above the content, `API` for SCORM 1.2 and `API_1484_11`
 * for 2004, searched from `start` up to its top window (the run-time environment's discovery).
 * @param {Window | null} start
 * @param {'API' | 'API_1484_11'} name
 * @returns {unknown}
 */
function findApi(start, name) {
  let win = start
  for (let hops = 0; win && hops < 10; hops++) {
    try {
      const api = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (win))[name]
      if (api) return api
    } catch {
      // A window on another origin holds nothing this page can call.
    }
    if (win.parent === win) break
    win = win.parent
  }
  return null
}

/**
 * The LMS, this package's version of it: the API in a window above, or above the window that
 * opened this one, as the calls this page makes.
 * @returns {Lms | null}
 */
function connect() {
  const name = scorm2004 ? 'API_1484_11' : 'API'
  const found = findApi(window, name) ?? (window.opener ? findApi(window.opener, name) : null)
  if (!found) return null
  if (scorm2004) {
    const api = /** @type {Scorm2004Api} */ (found)
    return { initialize: () => api.Initialize(''), finish: () => api.Terminate(''), get: (element) => api.GetValue(element), set: (element, value) => api.SetValue(element, value), commit: () => api.Commit('') }
  }
  const api = /** @type {ScormApi} */ (found)
  return { initialize: () => api.LMSInitialize(''), finish: () => api.LMSFinish(''), get: (element) => api.LMSGetValue(element), set: (element, value) => api.LMSSetValue(element, value), commit: () => api.LMSCommit('') }
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
 * SCORM 2004's `timeinterval`, an ISO 8601 duration with the seconds to the hundredth.
 * @param {number} ms
 */
function duration(ms) {
  const hundredths = Math.max(0, Math.round(ms / 10))
  const hours = Math.floor(hundredths / 360000)
  const minutes = Math.floor(hundredths / 6000) % 60
  return `PT${hours ? `${hours}H` : ''}${minutes ? `${minutes}M` : ''}${(hundredths % 6000) / 100}S`
}

/** A span of time in this package's version's format. @param {number} ms */
const span = (ms) => (scorm2004 ? duration(ms) : timespan(ms))

/**
 * A statement's `result.duration`, an ISO 8601 duration the core writes as `PT12.34S`, in the
 * version's format; `null` for anything else.
 * @param {unknown} given
 */
function latencyOf(given) {
  const match = typeof given === 'string' ? /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(given) : null
  if (!match || given === 'PT') return null
  return span((Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)) * 1000)
}

/**
 * When an interaction was answered: SCORM 1.2's time of day, a `CMITime`, or 2004's date and
 * time to the hundredth of a second, in UTC.
 */
function answeredAt() {
  const now = new Date()
  if (scorm2004) return now.toISOString().replace(/(\.\d{2})\dZ$/, '$1Z')
  return `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`
}

/**
 * A `finished` statement's result as the LMS records it: the score out of 100, from `scaled`,
 * else from `raw` over `max`, or 100 for content with no score where the writer counts it so;
 * and whether it was passed, by the pass mark where there is one and a score to hold to it, else
 * by the content's own `success`, `null` when it does not say.
 * @param {{ score?: { scaled?: unknown, raw?: unknown, max?: unknown }, success?: unknown } | undefined} result
 * @param {number | null} mark
 */
function scormResult(result, mark) {
  const score = result?.score ?? {}
  const scaled =
    typeof score.scaled === 'number'
      ? score.scaled
      : typeof score.raw === 'number' && typeof score.max === 'number' && score.max > 0
        ? score.raw / score.max
        : completionScore
          ? 1
          : null
  const raw = scaled === null ? null : Math.round(Math.min(Math.max(scaled, 0), 1) * 10000) / 100
  // Held to the mark as written, as the LMS holds it: 66.67 passes a mark of 66.67.
  const passed = mark !== null && raw !== null ? raw >= mark : result?.success === true ? true : result?.success === false ? false : null
  return { raw: raw === null ? null : String(raw), passed }
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
  // SCORM 2004 calls a wrong answer `incorrect`.
  const wrong = scorm2004 ? 'incorrect' : 'wrong'
  if (result.success === true) return 'correct'
  if (result.success === false) return wrong
  const { raw, max } = result.score ?? {}
  if (typeof raw !== 'number' || typeof max !== 'number' || max <= 0) return 'neutral'
  return raw >= max ? 'correct' : raw <= 0 ? wrong : String(Math.round(raw * 100) / 100)
}

/**
 * A SCORM 1.2 answer or right answer, for the two types 1.2 takes them for, as a report shows them
 * to a person. H5P writes both in 2004's notation, which xAPI took over and 1.2 has not: a fill-in's
 * right answer opens with `{case_matters=false}` and the like, and both part a blank from the next
 * with `[,]`, so 1.2 gets `stored, Range` for `{case_matters=false}stored[,]Range`; the learner's
 * own words are kept as typed. A numeric's is a number, 1.2's `CMIDecimal`, and anything else, such
 * as 2004's range `1[:]5`, is not written. Nothing is written for what comes out empty.
 * @param {unknown} text
 * @param {string} type `fill-in` or `numeric`
 * @param {boolean} right whether it is the right answer, whose modifiers go
 * @returns {string | null}
 */
function scorm12Answer(text, type, right) {
  if (typeof text !== 'string') return null
  if (type === 'numeric') return /^-?(\d+(\.\d*)?|\.\d+)$/.test(text.trim()) ? text.trim() : null
  const plain = (right ? text.replace(/^(\{[^{}]*\})+/, '') : text).split('[,]').join(', ')
  return plain === '' ? null : plain
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
 * first it gives, as text: a question type that writes markup there has it taken out, and the
 * character references it writes, `&nbsp;` and `&rsquo;` among them, read, or a 1.2 id would
 * spell them out (`Q1_don_rsquo_t`) and a 2004 description show them as they are.
 * @param {AnsweredStatement} statement
 * @param {string} language
 */
function questionText(statement, language) {
  const description = statement.object?.definition?.description
  if (!description || typeof description !== 'object') return ''
  const map = /** @type {Record<string, unknown>} */ (description)
  const text = map[language] ?? map['en-US'] ?? Object.values(map)[0]
  if (typeof text !== 'string') return ''
  const read = new DOMParser().parseFromString(text.replace(/<[^>]*>/g, ' '), 'text/html').documentElement.textContent ?? ''
  return read.replace(/\s+/g, ' ').trim()
}

/**
 * An interaction's id. In SCORM 1.2 it is what a report shows, since 1.2 has no description: the
 * question's number, its index from 1, and its first words, as in `Q3_which_rivers_cross_germany`,
 * in letters, digits and `_` alone, which every LMS takes as a `CMIIdentifier`; the number alone
 * for a question with no words in Latin letters. The number keeps two questions with the same
 * words apart. In 2004, where the words go into the description, an identifier, as 2004 asks one
 * to be a URI: the part's id as a `urn:uuid:`, else the activity's own, else a `urn:h5p:`.
 * @param {string} text
 * @param {string} key
 * @param {number} index
 */
function interactionId(text, key, index) {
  if (scorm2004) {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) return `urn:uuid:${key.toLowerCase()}`
    if (/^[a-z][a-z0-9+.-]*:[\x21-\x7e]+$/i.test(key) && key.length <= 4000) return key
    return `urn:h5p:${encodeURIComponent(key)}`
  }
  const words = text
    .toLowerCase()
    .replace(new RegExp(`[${Object.keys(FOLDED).join('')}]`, 'g'), (letter) => FOLDED[letter] ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const cut = words.lastIndexOf('_', ID_WORDS_LIMIT)
  const shown = words.length <= ID_WORDS_LIMIT ? words : words.slice(0, cut > 0 ? cut : ID_WORDS_LIMIT)
  return shown ? `Q${index + 1}_${shown}` : `Q${index + 1}`
}

/** The package's build, as the writer stamped it: what saved state is kept against. */
const build = document.querySelector('meta[name="h5p-package-build"]')?.getAttribute('content') ?? ''
const language = document.documentElement.lang || 'en'
const player = /** @type {H5PPlayerElement} */ (document.querySelector('h5p-player'))
const loader = /** @type {HTMLElement} */ (document.getElementById('loader'))
const notice = /** @type {HTMLElement} */ (document.getElementById('notice'))
const saving = /** @type {HTMLElement | null} */ (document.getElementById('saving'))
const lz = /** @type {LzString | undefined} */ (/** @type {{ LZString?: LzString }} */ (/** @type {unknown} */ (globalThis)).LZString)

const lms = connect()
const started = Date.now()
/** Whether the LMS accepted the session; nothing is reported to one that did not. */
const initialized = lms ? String(lms.initialize()) === 'true' : false

/** @param {string} element */
const get = (element) => (initialized && lms ? String(lms.get(element)) : '')
/** @param {string} element @param {string} value */
const set = (element, value) => initialized && lms !== null && String(lms.set(element, value)) === 'true'
const commit = () => initialized && lms !== null && String(lms.commit()) === 'true'

/** The data model's names for the status, the score, the time and the exit, by version. */
const STATUS = scorm2004 ? 'cmi.completion_status' : 'cmi.core.lesson_status'
const SCORE = scorm2004 ? 'cmi.score' : 'cmi.core.score'
const SESSION_TIME = scorm2004 ? 'cmi.session_time' : 'cmi.core.session_time'
const EXIT = scorm2004 ? 'cmi.exit' : 'cmi.core.exit'

if (initialized) {
  const status = get(STATUS)
  // 2004 starts an attempt as `unknown` where no completion threshold says otherwise.
  if (status === 'not attempted' || status === '' || (scorm2004 && status === 'unknown')) set(STATUS, 'incomplete')
}

/**
 * The pass mark out of 100, read once, at launch, where the writer was given one: the LMS's, which
 * it takes from the manifest (1.2's `cmi.student_data.mastery_score`, 2004's
 * `cmi.scaled_passing_score`) and an administrator may change, else the page's own, for an LMS
 * that reads no mark from the manifest. A zip written without one is graded by the content.
 */
const passMark = (() => {
  if (writtenPassMark === null || !Number.isFinite(writtenPassMark)) return null
  const lmsMark = get(scorm2004 ? 'cmi.scaled_passing_score' : 'cmi.student_data.mastery_score')
  const read = lmsMark === '' ? NaN : Number(lmsMark) * (scorm2004 ? 100 : 1)
  return Number.isFinite(read) && read >= 0 && read <= 100 ? Math.round(read * 100) / 100 : writtenPassMark
})()

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
  // A state larger than the LMS keeps is not written, rather than written cut short; the last one
  // that fitted stays.
  if (value.length > SUSPEND_DATA_LIMIT) {
    unsaved(`it is ${value.length} characters, and ${SCORM} keeps ${SUSPEND_DATA_LIMIT}.`)
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
 * the state, after what the LMS counted at launch; a new attempt, where the LMS counts none,
 * starts them again. They are kept with each answer, not only with the content's own saves, since
 * content that keeps no state of its own sends none. SCORM 1.2 lets the content write the fields
 * and never read them, which the report does.
 */

/**
 * What the LMS counts of this attempt's interactions, read once, at launch, since an attempt the
 * LMS starts over can only start there: fewer than the questions kept is such an attempt, which
 * starts them again; more, interactions this page has no record of, which new questions go after.
 * Within the session the questions kept are the record, so an LMS whose count does not follow what
 * is written, or that counts none, does not put every new question on one index (#130).
 */
const launchCount = Math.max(0, Number(get('cmi.interactions._count')) || 0)
if (questions.length > launchCount) questions = questions.slice(0, launchCount)

/**
 * The question's index and the id it was written under: those it has, else the next index and
 * the id that names it. A question kept by an older zip, in the state it wrote, keeps its old id.
 * @param {AnsweredStatement} statement
 * @returns {{ index: number, id: string }}
 */
function interactionFor(statement) {
  const key = questionKey(statement)
  const known = questions.findIndex((entry) => entry?.[0] === key)
  if (known !== -1) return { index: known, id: /** @type {[string, string]} */ (questions[known])[1] }
  const index = Math.max(questions.length, launchCount)
  const id = interactionId(questionText(statement, language), key, index)
  questions[index] = [key, id]
  return { index, id }
}

/** @param {AnsweredStatement} statement */
function recordAnswer(statement) {
  const { index, id } = interactionFor(statement)
  /** @param {string} field */
  const at = (field) => `cmi.interactions.${index}.${field}`
  // The id first: it is the field that makes the record; then, in 2004, the question's words, and
  // the type, which 2004 needs before the pattern and the response it gives the form of.
  set(at('id'), id)
  if (scorm2004) {
    const words = questionText(statement, language)
    if (words) set(at('description'), words.slice(0, DESCRIPTION_LIMIT))
  }
  const definition = statement.object?.definition
  const types = /** @type {Record<string, string>} */ (scorm2004 ? INTERACTION_TYPES_2004 : INTERACTION_TYPES)
  const type = typeof definition?.interactionType === 'string' ? types[definition.interactionType] : undefined
  if (type) set(at('type'), type)
  // 2004 takes a pattern and a response only after the type that gives their form, and refuses
  // them without one (408); H5P writes them in 2004's own notation, which xAPI took over. 1.2 gets
  // them only where they are the learner's own text or number, `fill-in` and `numeric`, as text a
  // person reads (`scorm12Answer`): it holds a choice, true-false, matching or sequencing answer to
  // single characters, which H5P's `0[,]2` and `true` are not, and LMSs part ways on those, so such
  // an answer carries its result alone.
  const pattern = Array.isArray(definition?.correctResponsesPattern) ? definition.correctResponsesPattern[0] : undefined
  const result = statement.result ?? {}
  /** @type {string | null} */
  let right = null
  /** @type {string | null} */
  let given = null
  if (scorm2004 && type) {
    if (typeof pattern === 'string') right = pattern
    if (typeof result.response === 'string') given = result.response
  } else if (type === 'fill-in' || type === 'numeric') {
    right = scorm12Answer(pattern, type, true)
    given = scorm12Answer(result.response, type, false)
  }
  if (right !== null) set(at('correct_responses.0.pattern'), right.slice(0, FEEDBACK_LIMIT))
  if (given !== null) set(at(scorm2004 ? 'learner_response' : 'student_response'), given.slice(0, FEEDBACK_LIMIT))
  set(at('result'), outcomeOf(result))
  if (typeof result.score?.max === 'number') set(at('weighting'), String(result.score.max))
  const latency = latencyOf(result.duration)
  if (latency) set(at('latency'), latency)
  set(at(scorm2004 ? 'timestamp' : 'time'), answeredAt())
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
  const { raw, passed } = scormResult(/** @type {CustomEvent<{ statement?: { result?: any } }>} */ (event).detail?.statement?.result, passMark)
  if (raw !== null) {
    set(`${SCORE}.min`, '0')
    set(`${SCORE}.max`, '100')
    set(`${SCORE}.raw`, raw)
    if (scorm2004) set('cmi.score.scaled', String(Math.round(Number(raw) * 100) / 10000))
  }
  if (scorm2004) {
    // Completion and success are two fields in 2004; a result that says nothing of a pass leaves
    // success unknown.
    set('cmi.completion_status', 'completed')
    if (passed !== null) set('cmi.success_status', passed ? 'passed' : 'failed')
  } else {
    set('cmi.core.lesson_status', passed === true ? 'passed' : passed === false ? 'failed' : 'completed')
  }
  set(SESSION_TIME, span(Date.now() - started))
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
  set(SESSION_TIME, span(Date.now() - started))
  // Finished, a 1.2 session ends with nothing; a 2004 one is suspended all the same. Ended
  // `normal`, Moodle 4.5 handed the next launch an empty data model within the same attempt, and
  // the `incomplete` written at launch replaced the `completed` it kept, while the content started
  // over: suspended, the result and the place stay, and a retry counts, as on an H5P site.
  set(EXIT, finished && !scorm2004 ? '' : 'suspend')
}

if (initialized) {
  addEventListener('beforeunload', () => {
    if (ended) return
    writeEnd()
    commit()
  })
}

addEventListener('pagehide', () => {
  if (!initialized || ended || !lms) return
  ended = true
  writeEnd()
  lms.finish()
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
