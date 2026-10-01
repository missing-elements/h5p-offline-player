/**
 * Proves /demo/cmi5.html against ADL's CATAPULT cmi5 player: the reference launching system,
 * which validates every statement an assignable unit sends against the numbered cmi5
 * requirements and rejects the ones that break one.
 *
 *   pnpm cmi5:catapult              headless: launches the page, answers a question of the real quiz,
 *                                   completes, prints the verdict
 *   pnpm cmi5:catapult --open       prints a launch URL to open in a browser, waits until the session ends
 *   pnpm cmi5:catapult --au <url>   the AU to launch instead of this dev server's page; its CSP has to allow localhost
 *   pnpm cmi5:catapult --down       stops the stack and deletes its data
 *
 * What it does: fetches CATAPULT at a pinned commit into cmi5-catapult/CATAPULT, brings up the player,
 * MySQL and the SQL LRS with Docker Compose, starts the demo's dev server for the AU, creates a
 * tenant and an API token, imports a course structure naming the AU, asks for a launch URL, and
 * either opens it headless or hands it over. At the end it reads the session back from the
 * player — initialized, completed, passed or failed, terminated — and the statements from the
 * LRS, and exits 1 if the sequence is incomplete, if `initialized` or `terminated` went out other
 * than once, or if the player rejected anything.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const rootDir = resolve(import.meta.dirname, '..')
const stackDir = resolve(rootDir, 'cmi5-catapult')
const cloneDir = resolve(stackDir, 'CATAPULT')
/** The CATAPULT commit this check passed against, 2026-01-20; a newer one may change the player. */
const CATAPULT_COMMIT = '806c0baaa0fa99c9cb4f398ad7eb21fc5461c6e4'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)

const PLAYER_PORT = Number(process.env.PLAYER_PORT ?? 63398)
const LRS_PORT = Number(process.env.LRS_PORT ?? 63390)
const player = `http://localhost:${PLAYER_PORT}`
const lrs = `http://localhost:${LRS_PORT}/xapi`
const basic = (user, pass) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`
const PLAYER_AUTH = basic('catapult', 'catapult-secret')
const LRS_AUTH = basic('catapult', 'catapult-secret')

const log = (line) => console.log(`[cmi5-catapult] ${line}`)

/** The player's session record, whose columns come back in camel case: `isTerminated`, not `is_terminated`. */
const sessionFlag = (session, name) => Boolean(session?.[name])

function output(command, commandArgs, options = {}) {
  return new Promise((done) => {
    const child = spawn(command, commandArgs, { stdio: ['ignore', 'pipe', 'ignore'], ...options })
    let text = ''
    child.stdout.on('data', (chunk) => (text += chunk))
    child.on('error', () => done(''))
    child.on('exit', () => done(text.trim()))
  })
}

function run(command, commandArgs, options = {}) {
  return new Promise((done, fail) => {
    const child = spawn(command, commandArgs, { stdio: 'inherit', ...options })
    child.on('error', fail)
    child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`${command} ${commandArgs.join(' ')} exited ${code}`))))
  })
}

async function waitFor(url, label, { headers = {}, timeoutMs = 240_000 } = {}) {
  const started = Date.now()
  for (;;) {
    try {
      const response = await fetch(url, { headers })
      if (response.status < 500) return
    } catch {}
    if (Date.now() - started > timeoutMs) throw new Error(`${label} did not come up at ${url}`)
    await sleep(1000)
  }
}

async function api(path, { method = 'GET', token, body, contentType = 'application/json' } = {}) {
  const response = await fetch(`${player}/api/v1${path}`, {
    method,
    headers: {
      Authorization: token ? `Bearer ${token}` : PLAYER_AUTH,
      ...(body === undefined ? {} : { 'Content-Type': contentType })
    },
    body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : body
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status}: ${text.slice(0, 400)}`)
  return text ? JSON.parse(text) : null
}

const courseStructure = (auUrl) => `<?xml version="1.0" encoding="utf-8"?>
<courseStructure xmlns="https://w3id.org/xapi/profiles/cmi5/v1/CourseStructure.xsd">
  <course id="https://h5p-offline-player.example/courses/demo">
    <title><langstring lang="en-US">h5p-offline-player demo</langstring></title>
    <description><langstring lang="en-US">The demo's cmi5 page around the player</langstring></description>
  </course>
  <au id="https://h5p-offline-player.example/courses/demo/au" moveOn="CompletedAndPassed" masteryScore="0.8" launchMethod="OwnWindow">
    <title><langstring lang="en-US">Quiz</langstring></title>
    <description><langstring lang="en-US">A question set</langstring></description>
    <url>${auUrl.replace(/&/g, '&amp;')}</url>
  </au>
</courseStructure>
`

const ACTOR = { name: 'Ada Lovelace', account: { homePage: 'https://lms.example', name: 'ada' } }

async function main() {
  if (flag('--down')) {
    await run('docker', ['compose', 'down', '-v'], { cwd: stackDir })
    return
  }

  const current = existsSync(cloneDir) ? await output('git', ['rev-parse', 'HEAD'], { cwd: cloneDir }) : ''
  if (current !== CATAPULT_COMMIT) {
    log(`fetching adlnet/CATAPULT at ${CATAPULT_COMMIT.slice(0, 10)}`)
    if (!existsSync(cloneDir)) await run('git', ['init', '--quiet', cloneDir])
    await run('git', ['fetch', '--quiet', '--depth', '1', 'https://github.com/adlnet/CATAPULT.git', CATAPULT_COMMIT], { cwd: cloneDir })
    await run('git', ['checkout', '--quiet', '--force', 'FETCH_HEAD'], { cwd: cloneDir })
  }
  log('starting the player, MySQL and the SQL LRS')
  await run('docker', ['compose', 'up', '-d', '--build'], { cwd: stackDir, env: { ...process.env, PLAYER_PORT: String(PLAYER_PORT), LRS_PORT: String(LRS_PORT) } })
  await waitFor(`${lrs}/about`, 'the LRS', { headers: { Authorization: LRS_AUTH, 'X-Experience-API-Version': '1.0.3' } })
  await waitFor(`${player}/api/v1/ping`, 'the player')
  log('stack is up')

  // The AU: this dev server's page, or one given. A returned learner lands on the examples index.
  let vite
  let au = option('--au')
  let returnUrl = 'https://h5p-offline-player.vercel.app/demo/'
  if (!au) {
    const { createServer } = await import('vite')
    vite = await createServer({ configFile: resolve(rootDir, 'vite.config.ts'), root: rootDir, server: { host: 'localhost', port: 0 }, logLevel: 'error' })
    await vite.listen()
    const origin = `http://localhost:${vite.httpServer.address().port}`
    au = `${origin}/demo/cmi5.html?src=${encodeURIComponent(`${origin}/demo/content/quiz.h5p`)}`
    returnUrl = `${origin}/demo/?returned`
  }
  log(`AU: ${au}`)

  const tenant = await api('/tenant', { method: 'POST', body: { code: `h5p-demo-${Date.now()}` } })
  const { token } = await api('/auth', { method: 'POST', body: { tenantId: tenant.id, audience: 'h5p-demo' } })
  const course = await api('/course', { method: 'POST', token, body: courseStructure(au), contentType: 'text/xml' })
  log(`course imported as #${course.id}`)
  const launch = await api(`/course/${course.id}/launch-url/0`, {
    method: 'POST',
    token,
    body: { actor: ACTOR, returnUrl }
  })
  const registration = new URL(launch.url).searchParams.get('registration')
  log(`session #${launch.id}, launchMethod ${launch.launchMethod}`)

  let failedSends = []
  /** The second launch of the registration, in the headless run. */
  let again = null
  if (flag('--open')) {
    console.log(`\nOpen this in a browser, play, and press Exit:\n\n  ${launch.url}\n`)
    log('waiting for the session to end (Ctrl+C to stop)')
    for (;;) {
      const session = await api(`/session/${launch.id}`, { token })
      if (sessionFlag(session, 'isTerminated') || sessionFlag(session, 'isAbandoned')) break
      await sleep(2000)
    }
  } else {
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    const page = await browser.newPage()
    page.on('pageerror', (error) => log(`page error: ${error.message}`))
    await page.goto(launch.url)
    await waitForStatus(page, 'Launched', 60_000)

    await page.waitForFunction(() => document.querySelector('h5p-player')?.state === 'ready', null, { timeout: 60_000 })

    // The real quiz: start it, pick an answer, check it. What H5P itself emits for that goes
    // through the player's validation, not a statement written here.
    const content = page.frames().find((frame) => frame.url().includes('/h5p/'))
    if (!content) throw new Error('the content frame is not there')
    const start = content.locator('button, [role=button]', { hasText: /start/i }).first()
    if (await start.count()) await start.click()
    await content.locator('.h5p-answer, [role=radio], [role=checkbox]').first().click({ timeout: 15_000 })
    await content.locator('button', { hasText: /check/i }).first().click({ timeout: 15_000 })
    await page.waitForFunction(() => /sent {2}answered/.test(document.querySelector('#log')?.textContent ?? ''), null, { timeout: 30_000 })

    // Completion stands in for playing all four questions: the element's own `finished` event,
    // with a passing score, which is what H5P raises at the end of the quiz.
    await finish(page, 4)
    const dump = async () => {
      const status = await page.evaluate(() => document.querySelector('#status')?.textContent ?? '').catch(() => '')
      const pageLog = await page.evaluate(() => document.querySelector('#log')?.textContent ?? '').catch(() => '')
      return { status, pageLog }
    }
    try {
      await waitForStatus(page, 'Recorded', 30_000)
      await page.click('#exit')
      await page.waitForURL((url) => url.href.startsWith(returnUrl), { timeout: 30_000 }).catch(() => log('did not reach the return URL'))
    } catch (error) {
      const { status, pageLog } = await dump()
      console.log(`\nThe page did not get there: ${error.message.split('\n')[0]}\n  status: ${status}\n  log:\n${pageLog.split('\n').filter(Boolean).slice(0, 12).map((l) => '    ' + l).join('\n')}`)
    }
    const { pageLog } = await dump()
    failedSends = pageLog.split('\n').filter((line) => /failed to send|could not record/.test(line))

    // The LMS launches the same registration again, in Normal mode, as it may: the result is in,
    // so the page must send neither a second `passed` or `completed` nor a `failed` after the
    // `passed`, even for a failing score (9.3.0.0-6 to 9.3.0.0-8).
    again = await api(`/course/${course.id}/launch-url/0`, {
      method: 'POST',
      token,
      body: { actor: ACTOR, returnUrl, reg: registration, launchMode: 'Normal' }
    })
    log(`session #${again.id}, the same registration launched again`)
    const second = await browser.newPage()
    second.on('pageerror', (error) => log(`page error: ${error.message}`))
    await second.goto(again.url)
    await waitForStatus(second, 'Launched', 60_000)
    await finish(second, 1)
    await second.waitForFunction(() => /already recorded its result/.test(document.querySelector('#log')?.textContent ?? ''), null, { timeout: 30_000 })
    await second.click('#exit')
    await second.waitForURL((url) => url.href.startsWith(returnUrl), { timeout: 30_000 }).catch(() => log('did not reach the return URL'))
    const secondLog = await second.evaluate(() => document.querySelector('#log')?.textContent ?? '').catch(() => '')
    failedSends.push(...secondLog.split('\n').filter((line) => /failed to send|could not record/.test(line)))
    await browser.close()
  }

  const session = await api(`/session/${launch.id}`, { token })
  const statements = await fetch(`${lrs}/statements?registration=${registration}&ascending=true&limit=100`, {
    headers: { Authorization: LRS_AUTH, 'X-Experience-API-Version': '1.0.3' }
  }).then((r) => r.json())
  const isDefined = (s) => (s.context?.contextActivities?.category ?? []).some((c) => c.id === 'https://w3id.org/xapi/cmi5/context/categories/cmi5')
  /** How many cmi5-defined statements with this verb the registration holds. */
  const defined = (verb) => (statements.statements ?? []).filter((s) => isDefined(s) && s.verb.id.endsWith(`/${verb}`)).length
  const sessions = again ? 2 : 1
  const realStatements = (statements.statements ?? []).filter((s) => s.context?.revision && !(s.context?.contextActivities?.category ?? []).some((c) => c.id === 'https://w3id.org/xapi/cmi5/context/categories/cmi5'))
  const verbs = (statements.statements ?? []).map((s) => {
    const verb = s.verb.id.slice(s.verb.id.lastIndexOf('/') + 1)
    const defined = (s.context?.contextActivities?.category ?? []).some((c) => c.id === 'https://w3id.org/xapi/cmi5/context/categories/cmi5')
    return `${verb}${defined ? ' (cmi5 defined)' : ''}${s.context?.revision ? ` revision ${s.context.revision}` : ''}`
  })

  const has = (name) => sessionFlag(session, name)
  console.log('\nSession, as the player recorded it:')
  for (const key of ['isInitialized', 'isCompleted', 'isPassed', 'isFailed', 'isTerminated', 'isAbandoned']) console.log(`  ${key.padEnd(15)} ${has(key) ? 'yes' : 'no'}`)
  console.log('\nStatements in the LRS for this registration, in order:')
  for (const verb of verbs) console.log(`  ${verb}`)
  if (failedSends.length) {
    console.log('\nThe player rejected:')
    for (const line of failedSends) console.log(`  ${line}`)
  }

  await vite?.close()
  const complete = has('isInitialized') && has('isTerminated') && (flag('--open') || (has('isCompleted') && (has('isPassed') || has('isFailed'))))
  const contentReached = flag('--open') || realStatements.length > 0
  const perSession = defined('initialized') === sessions && defined('terminated') === sessions
  if (!perSession) console.log(`\n\`initialized\` and \`terminated\` must each go out once per session, ${sessions} here; the LRS has ${defined('initialized')} and ${defined('terminated')}`)
  const perRegistration = defined('completed') <= 1 && defined('passed') <= 1 && !(defined('passed') && defined('failed'))
  if (!perRegistration) console.log(`\n\`completed\` and \`passed\` may each go out once per registration, and \`failed\` not after \`passed\`; the LRS has ${defined('completed')}, ${defined('passed')} and ${defined('failed')}`)
  let againEnded = true
  if (again) {
    const later = await api(`/session/${again.id}`, { token })
    againEnded = sessionFlag(later, 'isTerminated')
    console.log(`\nThe second session: ${againEnded ? 'terminated' : 'not terminated'}`)
  }
  if (!contentReached) console.log('\nNo statement from the content itself reached the LRS')
  const ok = complete && perSession && perRegistration && againEnded && contentReached && failedSends.length === 0
  console.log(`\n${ok ? 'PASS' : 'FAIL'}: ${ok ? 'the sequence is complete and nothing was rejected' : 'see above'}`)
  log(`the stack stays up for the next run; \`pnpm cmi5:catapult --down\` removes it`)
  process.exit(ok ? 0 : 1)
}

main().catch((error) => {
  console.error(`[cmi5-catapult] ${error.stack ?? error}`)
  process.exit(1)
})

/** The element's `finished` event with a score out of four, which is what H5P raises at the end of the quiz. */
function finish(page, raw) {
  return page.evaluate((raw) => {
    const completed = {
      actor: { name: 'H5P user' },
      verb: { id: 'http://adlnet.gov/expapi/verbs/completed', display: { 'en-US': 'completed' } },
      object: { objectType: 'Activity', id: 'https://player.example/h5p/virtual/pkg/content' },
      result: { score: { raw, max: 4 }, completion: true }
    }
    document.querySelector('h5p-player').dispatchEvent(new CustomEvent('finished', { detail: { statement: completed } }))
  }, raw)
}

/** Waits for the page's status line to start with `prefix`; on a timeout, says what it showed instead. */
async function waitForStatus(page, prefix, timeout) {
  try {
    await page.waitForFunction((p) => document.querySelector('#status')?.textContent?.startsWith(p), prefix, { timeout })
  } catch (error) {
    const shown = await page.locator('#status').textContent().catch(() => null)
    const logged = await page.locator('#log').textContent().catch(() => '')
    throw new Error(`the page never said "${prefix}…"; it said: ${shown}${logged ? `\nits log:\n${logged.slice(0, 2000)}` : ''}`, { cause: error })
  }
}
