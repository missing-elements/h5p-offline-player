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

import { createCmi5Client, isCmi5Launch, startCmi5 } from '@missing-elements/h5p-cmi5'

const player = document.querySelector('h5p-player')
const status = document.querySelector('#status')
const log = document.querySelector('#log')
const exitButton = document.querySelector('#exit')
const instructions = document.querySelector('#instructions')

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
        if (!simulated) note(`sent  ${[event.outcome, event.completed && 'completed'].filter(Boolean).join(', ')}`)
        say(`Recorded. ${simulated ? 'Exit sends terminated.' : returnURL ? 'Exit returns to the course.' : 'You can close this window.'}`)
        break
      case 'skipped':
        note(`finished: ${event.reason}`)
        break
      case 'registration-unread':
        note(`could not read what earlier sessions recorded, so this one counts alone: ${event.reason}`)
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

/**
 * A simulated LMS and LRS transport for `?simulate`. The production client builds every
 * statement; this transport only returns the LMS data and writes its posted statements to the log.
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
  const launchUrl = `${location.origin}${location.pathname}?${new URLSearchParams({ endpoint: launch.endpoint, fetch: launch.fetch, actor: JSON.stringify(launch.actor), registration: launch.registration, activityId: launch.activityId })}`
  const reply = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  return createCmi5Client({
    url: launchUrl,
    async fetch(input, init = {}) {
      const url = String(input)
      if (url === launch.fetch) return reply(200, { 'auth-token': 'simulated' })
      if (url.startsWith(`${launch.endpoint}activities/state?`)) return reply(200, data)
      if (url.startsWith(`${launch.endpoint}agents/profile?`)) return reply(404)
      if (url.startsWith(`${launch.endpoint}statements?`)) return reply(200, { statements: [], more: '' })
      if (url === `${launch.endpoint}statements` && init.method === 'POST') {
        const statement = JSON.parse(String(init.body))
        const verb = statement.verb?.display?.['en-US'] ?? 'statement'
        note(`sent  ${verb}\n${JSON.stringify(statement, null, 2)}`)
        return reply(200, [statement.id])
      }
      return reply(404)
    }
  })
}
