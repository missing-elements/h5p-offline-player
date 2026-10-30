/**
 * The launch page's script in a SCORM 1.2 package `h5p-embed --scorm` writes: it finds the LMS's
 * API, opens the session, and plays the package beside this page. The LMS hears what the content
 * reports: its score and whether it passed when it finishes, the time spent, and the state it
 * saves, which comes back on the next launch so the learner continues where they left off.
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

/** What SCORM 1.2 keeps of `cmi.suspend_data`: a `CMIString4096`. */
const SUSPEND_DATA_LIMIT = 4096

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

/**
 * `cmi.core.session_time`'s format, a `CMITimespan`: hours, minutes and seconds to the hundredth.
 * @param {number} ms
 */
function timespan(ms) {
  const hundredths = Math.max(0, Math.round(ms / 10))
  const hours = Math.floor(hundredths / 360000)
  const minutes = Math.floor(hundredths / 6000) % 60
  const seconds = (hundredths % 6000) / 100
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}`
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

/** The package's build, as the writer stamped it: what saved state is kept against. */
const build = document.querySelector('meta[name="h5p-package-build"]')?.getAttribute('content') ?? ''
const player = /** @type {H5PPlayerElement} */ (document.querySelector('h5p-player'))
const loader = /** @type {HTMLElement} */ (document.getElementById('loader'))
const notice = /** @type {HTMLElement} */ (document.getElementById('notice'))

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
 * the whole of it goes into `cmi.suspend_data`, stamped with the package's build so that a teacher
 * who replaces the package does not hand its learners state saved against another one.
 */

/** @type {Map<string, { dataType: string, subContentId: string, data: string }>} */
const saved = new Map()

if (initialized) {
  try {
    const kept = JSON.parse(get('cmi.suspend_data') || 'null')
    if (build && kept?.build === build && Array.isArray(kept.entries)) {
      for (const [dataType, subContentId, data] of kept.entries) {
        if (typeof data === 'string') saved.set(`${dataType}\n${subContentId}`, { dataType: String(dataType), subContentId: String(subContentId), data })
      }
    }
  } catch {
    // Not ours, or cut short by an LMS: the content starts over.
  }
  player.setAttribute('resume', 'host')
  player.userData = [...saved.values()]
}

player.addEventListener('userdata', (event) => {
  const { dataType, subContentId, data } = /** @type {CustomEvent<UserDataDetail>} */ (event).detail
  const key = `${dataType}\n${subContentId}`
  if (data === null) saved.delete(key)
  else saved.set(key, { dataType, subContentId, data })
  const value = JSON.stringify({ build, entries: [...saved.values()].map((entry) => [entry.dataType, entry.subContentId, entry.data]) })
  // A state larger than SCORM 1.2 keeps is not saved, rather than saved cut short; the last one
  // that fitted stays.
  if (value.length <= SUSPEND_DATA_LIMIT && set('cmi.suspend_data', value)) commit()
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
