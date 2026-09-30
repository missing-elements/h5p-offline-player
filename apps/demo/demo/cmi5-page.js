/**
 * A cmi5 assignable unit around the player, `/demo/cmi5.html`.
 *
 * An LMS launches this page with cmi5's five query parameters (`endpoint`, `fetch`, `actor`,
 * `registration`, `activityId`) appended to the URL in the course structure, which names the
 * package as `?src=`. The page trades the one-time `fetch` token for LRS credentials, sends
 * `initialized`, relays every statement the content emits as a "cmi5 allowed" statement — the
 * launch actor, the registration and the LMS's context template merged in, the player's
 * `context.revision` kept — and, when the content reports completion, sends `passed` or `failed`
 * by the mastery score and `completed`. `terminated` goes out from the Exit button. A session
 * the learner leaves without Exit is the LMS's to close: cmi5 has it record `abandoned`. That is
 * also what lets a reload resume, since a page cannot tell a reload from a closed tab.
 * `@xapi/cmi5` does the protocol; this file does the wiring, and it is the whole of what a cmi5
 * host needs from the player.
 *
 * Opened without a launch, the page explains one. With `?simulate`, it runs the same code
 * against a stand-in for the LMS that lives in this file, so the sequence can be watched
 * without an LMS: every statement that would have gone to the LRS lands in the log instead.
 */

import Cmi5 from '@xapi/cmi5'

const player = document.querySelector('h5p-player')
const status = document.querySelector('#status')
const log = document.querySelector('#log')
const exitButton = document.querySelector('#exit')
const instructions = document.querySelector('#instructions')

const CMI5_CATEGORY = 'https://w3id.org/xapi/cmi5/context/categories/cmi5'

const say = (text) => {
  status.textContent = text
}

const note = (line) => {
  const stamp = new Date().toLocaleTimeString([], { hour12: false })
  log.textContent = `${stamp}  ${line}\n${log.textContent}`.slice(0, 20000)
}

/** What went wrong, as the LMS said it: a cmi5 launching system names the requirement a statement broke. */
const reason = (error) => {
  const data = error?.response?.data
  if (data && typeof data === 'object') return data.message ?? JSON.stringify(data)
  if (typeof data === 'string' && data) return data
  return error?.message ?? String(error)
}

const verbName = (statement) => {
  const id = statement?.verb?.id ?? ''
  return id.slice(id.lastIndexOf('/') + 1) || '(no verb)'
}

const query = new URLSearchParams(location.search)

if (Cmi5.isCmiAvailable) {
  instructions.hidden = true
  void run(new Cmi5(), false)
} else if (query.has('simulate')) {
  instructions.hidden = true
  void run(simulatedLms(), true)
} else {
  // Opened by hand: show how an LMS launches it, and offer the simulation.
  instructions.hidden = false
  exitButton.hidden = true
  say('Not launched by an LMS: the address carries no cmi5 parameters.')
}

/** @param {boolean} simulated  the LMS is the stand-in below: nothing leaves the page */
async function run(cmi5, simulated) {
  const launch = cmi5.getLaunchParameters()

  /** The launch data, once the LMS has answered; until then statements wait in `pending`. */
  let data = null
  let terminated = false
  const pending = []
  let pendingFinished = null

  // The `fetch` URL answers once. A reload of the page must not ask again — the second answer
  // is an error — nor send a second `initialized`, so the token, the start time and whether the
  // outcome was recorded are kept for this launch and handed back, and the library only resumes.
  const sessionKey = `h5p-cmi5:${launch.fetch}`
  const saved = simulated ? null : readSession(sessionKey)
  let session = saved
  let movedOn = Boolean(saved?.movedOn)

  // Listening starts before the handshake, because the package loads meanwhile: anything the
  // content emits before `initialized` has gone out waits and is sent after it.
  player.addEventListener('xapi', (event) => relay(event.detail.statement))
  player.addEventListener('finished', (event) => {
    if (data) void record(event.detail)
    else pendingFinished = event.detail
  })
  player.addEventListener('error', (event) => {
    if (event.detail.code === 'runtime' && player.state === 'ready') return
    say(event.detail.message || event.detail.code)
  })

  const src = query.get('src')?.trim()
  if (src) player.setAttribute('src', src)

  say(saved ? 'Resuming the session…' : 'Contacting the LMS…')
  try {
    await cmi5.initialize(saved ? { authToken: saved.authToken, initializedDate: saved.initializedDate } : undefined)
  } catch (error) {
    exitButton.hidden = true
    say(`The LMS did not answer the launch: ${reason(error)}`)
    return
  }
  data = cmi5.getLaunchData()
  if (!simulated && !saved) {
    session = { authToken: cmi5.getAuthToken(), initializedDate: cmi5.getInitializedDate(), movedOn: false }
    writeSession(sessionKey, session)
    note('sent  initialized')
  }
  // The stand-in logs its own `initialized`, with the statement; the library gives nothing back to show.

  // Only from the launch data, where cmi5 puts it, and only a web address: a `javascript:`
  // value would run in this page when the learner presses Exit.
  const returnURL = webAddress(data.returnURL)
  if (data.returnURL && !returnURL) note(`ignored a returnURL that is not an http or https address: ${data.returnURL}`)

  exitButton.addEventListener('click', async () => {
    if (!terminated) {
      exitButton.disabled = true
      try {
        await cmi5.terminate()
        note('sent  terminated')
      } catch (error) {
        note(`failed to send terminated: ${reason(error)}`)
      }
      terminated = true
      forgetSession(sessionKey)
    }
    if (simulated) return say('Terminated. A real launch would now return to the course.')
    if (returnURL) location.assign(returnURL)
    else {
      window.close()
      say('Terminated. You can close this window.')
    }
  })

  // The course structure can also name the package in `launchParameters` instead of the URL.
  if (!src) {
    const fromLaunch = data.launchParameters?.trim()
    if (fromLaunch) player.setAttribute('src', fromLaunch)
    else {
      say('No package to play: add ?src=<url of a .h5p> to the AU URL, or set launchParameters.')
      return
    }
  }

  const who = launch.actor?.name ?? launch.actor?.account?.name ?? launch.actor?.mbox ?? 'a learner'
  const mastery = data.masteryScore === undefined ? 'no mastery score' : `mastery score ${data.masteryScore}`
  say(`${simulated ? 'Simulated launch' : saved ? 'Resumed' : 'Launched'} for ${who}. Mode ${data.launchMode}, move on ${data.moveOn}, ${mastery}.${simulated ? ' Nothing leaves this page: the statements below are what an LRS would receive.' : ''}`)

  for (const statement of pending.splice(0)) void send(allowed(statement))
  if (pendingFinished) void record(pendingFinished)

  /** The content's statement as cmi5 allows it: the launch actor and registration, the LMS's context template underneath the statement's own context. */
  function allowed(statement) {
    const template = data.contextTemplate ?? {}
    const own = statement.context ?? {}
    return {
      ...statement,
      id: statement.id ?? crypto.randomUUID(),
      actor: launch.actor,
      timestamp: statement.timestamp ?? new Date().toISOString(),
      context: {
        ...template,
        ...own,
        registration: launch.registration,
        contextActivities: mergeActivities(template.contextActivities, own.contextActivities),
        extensions: { ...(template.extensions ?? {}), ...(own.extensions ?? {}) }
      }
    }
  }

  async function send(statement) {
    if (terminated) return
    try {
      await cmi5.sendXapiStatement(statement)
      note(`sent  ${verbName(statement)}\n${JSON.stringify(statement, null, 2)}`)
    } catch (error) {
      note(`failed to send ${verbName(statement)}: ${reason(error)}`)
    }
  }

  function relay(statement) {
    if (!data) pending.push(statement)
    else void send(allowed(statement))
  }

  /**
   * The content finished: the outcome, the cmi5 way. The content's own `completed` statement
   * has already gone out through `xapi`. Once per session, reloads included — a second
   * `completed` or `passed` is a breach of the spec.
   */
  async function record(detail) {
    if (movedOn || terminated) return
    movedOn = true
    if (data.launchMode !== 'Normal') {
      note(`finished, nothing to record in ${data.launchMode} mode`)
      return
    }
    const score = detail.statement?.result?.score
    const scaled = score?.scaled ?? (score && score.max ? score.raw / score.max : undefined)
    // cmi5 wants `min` and `max` beside `raw`; H5P gives `raw` and `max`, and its minimum is 0.
    const cmi5Score =
      scaled === undefined
        ? undefined
        : { scaled, ...(score.raw !== undefined && score.max !== undefined ? { raw: score.raw, min: score.min ?? 0, max: score.max } : {}) }
    // The library judges `passed` or `failed` only with a score and a mastery score, as here.
    const outcome = cmi5Score && data.masteryScore ? (scaled >= data.masteryScore ? 'passed, ' : 'failed, ') : ''
    try {
      // With a mastery score: `passed` or `failed` by it, then `completed`. Without one:
      // `completed`, the score on it. `terminated` stays for Exit, so the learner can keep going.
      await cmi5.moveOn({ score: cmi5Score, disableSendTerminated: true })
      if (session) writeSession(sessionKey, { ...session, movedOn: true })
      if (!simulated) note(`sent  ${outcome}completed`)
      say(`Recorded. ${simulated ? 'Exit sends terminated.' : returnURL ? 'Exit returns to the course.' : 'You can close this window.'}`)
    } catch (error) {
      note(`could not record completion: ${reason(error)}`)
    }
  }
}

/** An absolute http or https address, or null: what a page may send a learner to. */
function webAddress(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

/** The session kept for a reload of the page: the token, when `initialized` went out, and whether the outcome was recorded. Storage may be refused; then a reload asks the LMS again and gets its error. */
function readSession(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const { authToken, initializedDate, movedOn } = JSON.parse(raw)
    if (!authToken || !initializedDate) return null
    return { authToken, initializedDate: new Date(initializedDate), movedOn: Boolean(movedOn) }
  } catch {
    return null
  }
}

function writeSession(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

function forgetSession(key) {
  try {
    localStorage.removeItem(key)
  } catch {}
}

/** Context activities from both sides, each list joined; the template's come first. */
function mergeActivities(template = {}, own = {}) {
  const merged = {}
  for (const key of ['parent', 'grouping', 'category', 'other']) {
    const list = [...(template[key] ?? []), ...(own[key] ?? [])]
    if (list.length) merged[key] = list
  }
  return merged
}

/**
 * An LMS and LRS in one object, for `?simulate`: the surface of `@xapi/cmi5` this page uses,
 * with every statement written to the log instead of sent. The launch data is what a course
 * structure with `moveOn="CompletedAndPassed"` and `masteryScore="0.8"` would give.
 */
function simulatedLms() {
  const launch = {
    endpoint: 'https://lrs.example/xapi/',
    fetch: 'https://lms.example/fetch',
    actor: { name: 'Ada Lovelace', account: { homePage: 'https://lms.example', name: 'ada' } },
    registration: crypto.randomUUID(),
    activityId: 'https://lms.example/courses/quiz/au'
  }
  const data = {
    contextTemplate: {
      contextActivities: { grouping: [{ id: 'https://lms.example/courses/quiz' }] },
      extensions: { 'https://w3id.org/xapi/cmi5/context/extensions/sessionid': crypto.randomUUID() }
    },
    launchMode: 'Normal',
    moveOn: 'CompletedAndPassed',
    masteryScore: 0.8
  }
  let started = new Date()
  const duration = () => `PT${((Date.now() - started.getTime()) / 1000).toFixed(2)}S`
  const defined = (verb, extra = {}) => ({
    id: crypto.randomUUID(),
    actor: launch.actor,
    verb: { id: `http://adlnet.gov/expapi/verbs/${verb}`, display: { 'en-US': verb } },
    object: { objectType: 'Activity', id: launch.activityId },
    context: {
      ...data.contextTemplate,
      registration: launch.registration,
      contextActivities: mergeActivities(data.contextTemplate.contextActivities, { category: [{ id: CMI5_CATEGORY }] })
    },
    timestamp: new Date().toISOString(),
    ...extra
  })
  return {
    getLaunchParameters: () => launch,
    getLaunchData: () => data,
    getInitializedDate: () => started,
    getAuthToken: () => 'simulated',
    async initialize() {
      started = new Date()
      const statement = defined('initialized')
      note(`sent  initialized\n${JSON.stringify(statement, null, 2)}`)
    },
    // The page logs what it hands over, so nothing to do: the statement is already on screen.
    async sendXapiStatement() {},
    async moveOn({ score } = {}) {
      if (score && data.masteryScore) {
        const passed = score.scaled >= data.masteryScore
        const statement = defined(passed ? 'passed' : 'failed', { result: { score, success: passed, duration: duration() } })
        note(`sent  ${passed ? 'passed' : 'failed'}\n${JSON.stringify(statement, null, 2)}`)
      }
      const result = { completion: true, duration: duration(), ...(score && !data.masteryScore ? { score } : {}) }
      const statement = defined('completed', { result })
      note(`sent  completed\n${JSON.stringify(statement, null, 2)}`)
    },
    async terminate() {
      const statement = defined('terminated', { result: { duration: duration() } })
      note(`sent  terminated\n${JSON.stringify(statement, null, 2)}`)
    }
  }
}
