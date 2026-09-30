/**
 * A cmi5 assignable unit around the player, `/demo/cmi5.html`, on
 * `@missing-elements/h5p-cmi5`: the package does the protocol, this page shows it. What a host
 * needs is the three lines in `start` — `startCmi5(player)`, and `session.exit()` on an Exit
 * button — and the rest is the log, the status line and the simulated LMS.
 *
 * An LMS launches the page with cmi5's five query parameters appended to the URL in the course
 * structure, which names the package as `?src=`. Opened without a launch, the page explains one.
 * With `?simulate`, it runs the same code against a stand-in for the LMS that lives in this file,
 * so the sequence can be watched without an LMS: every statement that would have gone to the LRS
 * lands in the log instead.
 */

import { isCmi5Launch, startCmi5 } from '@missing-elements/h5p-cmi5'

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

player.addEventListener('error', (event) => {
  if (event.detail.code === 'runtime' && player.state === 'ready') return
  say(event.detail.message || event.detail.code)
})

if (isCmi5Launch()) {
  instructions.hidden = true
  void start(undefined, false)
} else if (new URLSearchParams(location.search).has('simulate')) {
  instructions.hidden = true
  void start(simulatedLms(), true)
} else {
  // Opened by hand: show how an LMS launches it, and offer the simulation.
  instructions.hidden = false
  exitButton.hidden = true
  say('Not launched by an LMS: the address carries no cmi5 parameters.')
}

/** @param {boolean} simulated  the LMS is the stand-in below: nothing leaves the page */
async function start(client, simulated) {
  let returnURL = null

  // The simulated LMS logs its own cmi5-defined statements, with their bodies; the real one
  // gives nothing back to show, so the page notes that they went out.
  const onEvent = (event) => {
    switch (event.type) {
      case 'initialized': {
        returnURL = event.returnURL
        if (!simulated && !event.resumed) note('sent  initialized')
        const data = event.launchData
        const actor = event.launchParameters.actor
        const who = actor?.name ?? actor?.account?.name ?? actor?.mbox ?? 'a learner'
        const mastery = data.masteryScore === undefined ? 'no mastery score' : `mastery score ${data.masteryScore}`
        say(`${simulated ? 'Simulated launch' : event.resumed ? 'Resumed' : 'Launched'} for ${who}. Mode ${data.launchMode}, move on ${data.moveOn}, ${mastery}.${simulated ? ' Nothing leaves this page: the statements below are what an LRS would receive.' : ''}`)
        break
      }
      case 'sent':
        note(`sent  ${event.verb}\n${JSON.stringify(event.statement, null, 2)}`)
        break
      case 'rejected':
        note(`failed to send ${event.verb}: ${event.reason}`)
        break
      case 'recorded':
        if (!simulated) note(`sent  ${event.outcome ? `${event.outcome}, ` : ''}completed`)
        say(`Recorded. ${simulated ? 'Exit sends terminated.' : returnURL ? 'Exit returns to the course.' : 'You can close this window.'}`)
        break
      case 'skipped':
        note(`finished: ${event.reason}`)
        break
      case 'terminated':
        if (!simulated) note('sent  terminated')
        break
      case 'unsafe-return-url':
        note(`ignored a returnURL that is not an http or https address: ${event.value}`)
        break
    }
  }

  say('Contacting the LMS…')
  let session
  try {
    session = await startCmi5(player, { client, onEvent })
  } catch (error) {
    exitButton.hidden = true
    say(`The LMS did not answer the launch: ${error.message}`)
    return
  }
  if (!session.src) say('No package to play: add ?src=<url of a .h5p> to the AU URL, or set launchParameters.')

  exitButton.addEventListener('click', async () => {
    exitButton.disabled = true
    if (simulated) {
      await session.terminate()
      say('Terminated. A real launch would now return to the course.')
      return
    }
    await session.exit()
    // Still here: no return URL, and a window the page did not open will not close.
    say('Terminated. You can close this window.')
  })
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
 * An LMS and LRS in one object, for `?simulate`: a `Cmi5Client`, the surface of `@xapi/cmi5`
 * the package uses, with every statement written to the log instead of sent. The launch data is what a course
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
