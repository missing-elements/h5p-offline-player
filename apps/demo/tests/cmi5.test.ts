import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { chromium, type Browser } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, expect, it } from 'vitest'

/**
 * The cmi5 page against a mock LMS and LRS: the launch handshake, `initialized` first, the
 * content's statements relayed with the launch actor, the registration, the context template
 * and the player's `revision`, `failed` and `completed` by the mastery score, `terminated` from
 * Exit and the return to the course; a reload that resumes, statements emitted before the
 * handshake, and a `returnURL` that is not a web address. The mock is on `127.0.0.1` and the
 * page on `localhost`, so every request is cross-origin with a preflight, as it is against a
 * real LMS. Its token is single-use, as the spec has it: a second call to `fetch` is an error.
 */

const rootDir = resolve(import.meta.dirname, '..')
const ACTOR = { name: 'Ada', account: { homePage: 'https://lms.example', name: 'ada' } }
const REGISTRATION = '4b6f8e2c-3d7a-4c1e-9f0b-2a5d6e7f8a9b'
const ACTIVITY = 'https://lms.example/courses/quiz/au'
const SESSION_EXT = 'https://w3id.org/xapi/cmi5/context/extensions/sessionid'

type Statement = Record<string, any>
let vite: ViteDevServer
let lms: Server
let browser: Browser
let playerOrigin: string
let lmsOrigin: string
const received: Statement[] = []
let returned = 0
/** Calls to `fetch`, per launch: a registration, and which of its launches. */
const fetches = new Map<string, number>()
/** What a launch's data differs by from the default, per registration. */
const launchOverrides = new Map<string, Statement>()

const cors = (res: ServerResponse) => {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', 'GET, POST, PUT, OPTIONS')
  res.setHeader('access-control-allow-headers', 'authorization, content-type, x-experience-api-version')
}

const body = (req: IncomingMessage) =>
  new Promise<string>((done) => {
    let text = ''
    req.on('data', (chunk) => (text += chunk))
    req.on('end', () => done(text))
  })

const json = (res: ServerResponse, status: number, value: unknown) => {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(value))
}

/** The LMS: the token endpoint, the launch data, no learner preferences, and an LRS that keeps what it gets. */
async function handle(req: IncomingMessage, res: ServerResponse) {
  cors(res)
  const url = new URL(req.url!, lmsOrigin)
  if (req.method === 'OPTIONS') return void res.writeHead(204).end()
  if (req.method === 'POST' && url.pathname === '/fetch') {
    const launch = `${url.searchParams.get('reg') ?? ''}#${url.searchParams.get('launch') ?? '1'}`
    const calls = (fetches.get(launch) ?? 0) + 1
    fetches.set(launch, calls)
    const delay = Number(url.searchParams.get('delay') ?? 0)
    if (delay) await new Promise((r) => setTimeout(r, delay))
    if (calls > 1) return json(res, 200, { 'error-code': '1', 'error-text': 'Already in Use' })
    return json(res, 200, { 'auth-token': Buffer.from('user:pass').toString('base64') })
  }
  if (url.pathname === '/lrs/activities/state' && url.searchParams.get('stateId') === 'LMS.LaunchData') {
    return json(res, 200, {
      contextTemplate: {
        contextActivities: { grouping: [{ id: 'https://lms.example/courses/quiz' }] },
        extensions: { [SESSION_EXT]: 'session-1' }
      },
      launchMode: 'Normal',
      moveOn: 'CompletedAndPassed',
      masteryScore: 0.8,
      returnURL: `${lmsOrigin}/returned`,
      ...launchOverrides.get(url.searchParams.get('registration') ?? '')
    })
  }
  if (url.pathname === '/lrs/agents/profile') return json(res, 404, {})
  if (url.pathname === '/lrs/statements' && req.method === 'GET') {
    // The query an LRS answers: by verb, by the object's id, by registration.
    const q = url.searchParams
    const found = received.filter((s) => s.verb?.id === q.get('verb') && s.object?.id === q.get('activity') && s.context?.registration === q.get('registration'))
    return json(res, 200, { statements: found.slice(0, Number(q.get('limit')) || undefined), more: '' })
  }
  if (url.pathname === '/lrs/statements' && (req.method === 'PUT' || req.method === 'POST')) {
    const parsed = JSON.parse(await body(req))
    const statements: Statement[] = Array.isArray(parsed) ? parsed : [parsed]
    for (const statement of statements) received.push({ ...statement, id: statement.id ?? url.searchParams.get('statementId') ?? crypto.randomUUID() })
    return json(res, 200, statements.map((s) => s.id))
  }
  if (url.pathname === '/returned') {
    returned += 1
    res.setHeader('content-type', 'text/html')
    return void res.end('<title>returned</title>back in the course')
  }
  res.statusCode = 404
  res.end()
}

beforeAll(async () => {
  vite = await createServer({ configFile: resolve(rootDir, 'vite.config.ts'), root: rootDir, server: { host: 'localhost', port: 0 }, logLevel: 'error' })
  await vite.listen()
  playerOrigin = `http://localhost:${(vite.httpServer!.address() as AddressInfo).port}`
  lms = createHttpServer((req, res) => void handle(req, res))
  await new Promise<void>((done) => lms.listen(0, '127.0.0.1', done))
  lmsOrigin = `http://127.0.0.1:${(lms.address() as AddressInfo).port}`
  browser = await chromium.launch()
})

afterAll(async () => {
  await browser?.close()
  await vite?.close()
  await new Promise<void>((done) => lms?.close(() => done()))
})

const CMI5_CATEGORY = 'https://w3id.org/xapi/cmi5/context/categories/cmi5'
const verbOf = (s: Statement) => String(s.verb?.id ?? '').split('/').pop()
const isDefined = (s: Statement) => (s.context?.contextActivities?.category ?? []).some((c: Statement) => c.id === CMI5_CATEGORY)
/** The first statement with this verb; `defined` narrows it to a cmi5-defined one, with the cmi5 category. */
const waitForVerb = async (verb: string, defined = false, registration = REGISTRATION) => {
  const match = (s: Statement) => verbOf(s) === verb && (!defined || isDefined(s)) && s.context?.registration === registration
  const started = Date.now()
  while (!received.some(match)) {
    if (Date.now() - started > 20_000) throw new Error(`no ${verb} statement arrived; got ${received.map(verbOf).join(', ')}`)
    await new Promise((r) => setTimeout(r, 50))
  }
  return received.find(match)!
}

/** The address an LMS would open: the AU URL with the five launch parameters, the token endpoint told which launch it is for. */
const launchUrl = (registration: string, { delay = 0, launch = 1 } = {}) =>
  `${playerOrigin}/demo/cmi5.html?${new URLSearchParams({
    src: `${playerOrigin}/demo/content/how-it-works.h5p`,
    endpoint: `${lmsOrigin}/lrs/`,
    fetch: `${lmsOrigin}/fetch?reg=${registration}&launch=${launch}${delay ? `&delay=${delay}` : ''}`,
    actor: JSON.stringify(ACTOR),
    registration,
    activityId: ACTIVITY
  })}`

const ofLaunch = (registration: string) => received.filter((s) => s.context?.registration === registration)

it('runs a package as a cmi5 assignable unit', async () => {
  const page = await browser.newPage()
  await page.goto(launchUrl(REGISTRATION))

  // The handshake, and `initialized` as the first statement: cmi5-defined, so with its category.
  const initialized = await waitForVerb('initialized', true)
  expect(received[0]).toBe(initialized)
  expect(initialized.actor).toEqual(ACTOR)
  expect(initialized.object).toEqual({ objectType: 'Activity', id: ACTIVITY })
  expect(initialized.context.registration).toBe(REGISTRATION)
  expect(initialized.context.extensions[SESSION_EXT]).toBe('session-1')
  expect(initialized.context.contextActivities.category).toEqual([{ id: 'https://w3id.org/xapi/cmi5/context/categories/cmi5' }])
  await page.waitForFunction(() => document.querySelector('#status')!.textContent!.startsWith('Launched'))
  await page.waitForFunction(() => (document.querySelector('h5p-player') as any).state === 'ready')

  // A statement from the content, as the element dispatches it: H5P's actor and category, the
  // player's revision. Relayed as a cmi5 allowed statement.
  await page.evaluate(() => {
    const statement = {
      actor: { name: 'H5P user', mbox: 'mailto:nobody@h5p.invalid' },
      verb: { id: 'http://adlnet.gov/expapi/verbs/answered' },
      object: { id: 'https://player.example/h5p/virtual/pkg/content', objectType: 'Activity' },
      result: { score: { raw: 1, max: 2, scaled: 0.5 }, success: false },
      context: {
        revision: 'sha256:abc',
        platform: 'h5p-offline-player 0.1.10',
        contextActivities: { category: [{ id: 'http://h5p.org/libraries/H5P.QuestionSet-1.20' }] }
      }
    }
    document.querySelector('h5p-player')!.dispatchEvent(new CustomEvent('xapi', { detail: { statement, verb: statement.verb.id } }))
  })
  const answered = await waitForVerb('answered')
  expect(answered.actor).toEqual(ACTOR)
  expect(answered.context.registration).toBe(REGISTRATION)
  expect(answered.context.revision).toBe('sha256:abc')
  expect(answered.context.platform).toBe('h5p-offline-player 0.1.10')
  expect(answered.context.extensions[SESSION_EXT]).toBe('session-1')
  expect(answered.context.contextActivities.grouping).toEqual([{ id: 'https://lms.example/courses/quiz' }])
  expect(answered.context.contextActivities.category).toEqual([{ id: 'http://h5p.org/libraries/H5P.QuestionSet-1.20' }])
  expect(answered.result.score.raw).toBe(1)

  // Completion below the mastery score: `failed`, then `completed`; no `terminated` yet.
  await page.evaluate(() => {
    const statement = {
      actor: { name: 'H5P user' },
      verb: { id: 'http://adlnet.gov/expapi/verbs/completed' },
      object: { id: 'https://player.example/h5p/virtual/pkg/content', objectType: 'Activity' },
      result: { score: { raw: 1, max: 2 }, completion: true },
      context: { revision: 'sha256:abc' }
    }
    document.querySelector('h5p-player')!.dispatchEvent(new CustomEvent('finished', { detail: { statement } }))
  })
  const failed = await waitForVerb('failed', true)
  const completed = await waitForVerb('completed', true)
  expect(failed.result.score).toEqual({ scaled: 0.5, raw: 1, min: 0, max: 2 })
  // The content's own `completed` is not relayed twice: `finished` follows the `xapi` event for
  // the same statement, and the page relays through `xapi` only.
  expect(received.filter((s) => verbOf(s) === 'completed')).toHaveLength(1)
  expect(received.indexOf(failed)).toBeLessThan(received.indexOf(completed))
  expect(completed.result.completion).toBe(true)
  expect(received.filter((s) => verbOf(s) === 'terminated')).toHaveLength(0)

  // Exit: `terminated`, then the return URL.
  await page.click('#exit')
  const terminated = await waitForVerb('terminated', true)
  expect(terminated.object.id).toBe(ACTIVITY)
  expect(terminated.result.duration).toMatch(/^PT/)
  await page.waitForURL(`${lmsOrigin}/returned`)
  expect(returned).toBe(1)
  expect(received.filter((s) => verbOf(s) === 'terminated')).toHaveLength(1)
  await page.close()
})

it('does not persist LRS credentials across a reload by default', async () => {
  const registration = crypto.randomUUID()
  const page = await browser.newPage()
  await page.goto(launchUrl(registration))
  await waitForVerb('initialized', true, registration)
  await page.waitForFunction(() => document.querySelector('#status')!.textContent!.startsWith('Launched'))

  await page.reload()
  await page.waitForFunction(() => document.querySelector('#status')!.textContent!.includes('Already in Use'))
  expect(fetches.get(`${registration}#1`)).toBe(2)
  expect(ofLaunch(registration).map(verbOf)).toEqual(['initialized'])
  await page.close()
})

it('holds what the content emits before the handshake, and sends it after initialized', async () => {
  const registration = crypto.randomUUID()
  const page = await browser.newPage()
  // The token endpoint answers after 1.5 s; the statement goes out before it has.
  await page.goto(launchUrl(registration, { delay: 1500 }))
  await page.evaluate(() => {
    const statement = {
      actor: { name: 'H5P user' },
      verb: { id: 'http://adlnet.gov/expapi/verbs/attempted' },
      object: { objectType: 'Activity', id: 'https://x/content' },
      context: { revision: 'sha256:abc', platform: 'h5p-offline-player 0.1.10' }
    }
    document.querySelector('h5p-player')!.dispatchEvent(new CustomEvent('xapi', { detail: { statement, verb: statement.verb.id } }))
  })
  expect(ofLaunch(registration)).toHaveLength(0)
  await waitForVerb('attempted', false, registration)
  expect(ofLaunch(registration).map(verbOf)).toEqual(['initialized', 'attempted'])
  await page.close()
})

it('does not send the learner to a returnURL that is not a web address', async () => {
  const registration = crypto.randomUUID()
  launchOverrides.set(registration, { returnURL: 'javascript:document.title="ran"' })
  const page = await browser.newPage()
  await page.goto(launchUrl(registration))
  await page.waitForFunction(() => document.querySelector('#status')!.textContent!.startsWith('Launched'))
  const before = page.url()
  await page.click('#exit')
  await waitForVerb('terminated', true, registration)
  await page.waitForFunction(() => document.querySelector('#status')!.textContent!.startsWith('Terminated'))
  expect(page.url()).toBe(before)
  expect(await page.title()).not.toBe('ran')
  expect(await page.textContent('#log')).toContain('ignored a returnURL')
  await page.close()
})

it('sends no second passed or completed in a later launch of the same registration', async () => {
  const registration = 'a7c3e1f0-5b2d-4e8a-9c6f-1d0b3a2e4f5c'
  const finish = (page: import('playwright').Page) =>
    page.evaluate(() => {
      const statement = { actor: { name: 'H5P user' }, verb: { id: 'http://adlnet.gov/expapi/verbs/completed' }, object: { id: 'https://x/content', objectType: 'Activity' }, result: { score: { raw: 2, max: 2 }, completion: true }, context: { revision: 'sha256:abc' } }
      document.querySelector('h5p-player')!.dispatchEvent(new CustomEvent('finished', { detail: { statement } }))
    })
  const defined = (verb: string) => ofLaunch(registration).filter((s) => verbOf(s) === verb && isDefined(s))

  const first = await browser.newPage()
  await first.goto(launchUrl(registration))
  await first.waitForFunction(() => document.querySelector('#status')!.textContent!.startsWith('Launched'))
  await finish(first)
  await first.waitForFunction(() => document.querySelector('#status')!.textContent!.startsWith('Recorded'))
  await first.click('#exit')
  await waitForVerb('terminated', true, registration)
  await first.close()

  // The LMS launches the registration again: a new token, a new session, the result already in.
  const second = await browser.newPage()
  await second.goto(launchUrl(registration, { launch: 2 }))
  await second.waitForFunction(() => document.querySelector('#status')!.textContent!.startsWith('Launched'))
  await finish(second)
  await second.waitForFunction(() => document.querySelector('#log')!.textContent!.includes('already recorded its result'))
  expect(defined('initialized')).toHaveLength(2)
  expect(defined('passed')).toHaveLength(1)
  expect(defined('completed')).toHaveLength(1)
  await second.close()
})

it('simulates a launch with ?simulate, sending nothing', async () => {
  const before = received.length
  const page = await browser.newPage()
  const requests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('lms.example') || request.url().includes('lrs.example')) requests.push(request.url())
  })
  await page.goto(`${playerOrigin}/demo/cmi5.html?simulate&src=${encodeURIComponent(`${playerOrigin}/demo/content/how-it-works.h5p`)}`)
  await page.waitForFunction(() => document.querySelector('#status')!.textContent!.startsWith('Simulated launch'))
  await page.waitForFunction(() => document.querySelector('#log')!.textContent!.includes('sent  initialized'))
  await page.evaluate(() => {
    const statement = { actor: { name: 'H5P user' }, verb: { id: 'http://adlnet.gov/expapi/verbs/completed' }, object: { id: 'https://x/content', objectType: 'Activity' }, result: { score: { raw: 2, max: 2 }, completion: true }, context: { revision: 'sha256:abc' } }
    document.querySelector('h5p-player')!.dispatchEvent(new CustomEvent('finished', { detail: { statement } }))
  })
  await page.waitForFunction(() => document.querySelector('#log')!.textContent!.includes('sent  passed'))
  await page.waitForFunction(() => document.querySelector('#log')!.textContent!.includes('sent  completed'))
  const simulatedLog = await page.textContent('#log')
  expect(simulatedLog).toContain('https://w3id.org/xapi/cmi5/context/categories/moveon')
  expect(simulatedLog).toContain('https://w3id.org/xapi/cmi5/context/extensions/masteryscore": 0.8')
  await page.click('#exit')
  await page.waitForFunction(() => document.querySelector('#status')!.textContent!.startsWith('Terminated'))
  expect(page.url()).toContain('simulate')
  expect(requests).toEqual([])
  expect(received.length).toBe(before)
  await page.close()
})

it('explains the launch when opened without one', async () => {
  const page = await browser.newPage()
  await page.goto(`${playerOrigin}/demo/cmi5.html`)
  await page.waitForFunction(() => document.querySelector('#status')!.textContent!.includes('Not launched'))
  expect(await page.isVisible('#instructions')).toBe(true)
  expect(await page.textContent('#instructions')).toContain('launchMethod="OwnWindow"')
  expect(await page.getAttribute('#instructions a', 'href')).toContain('simulate')
  await page.close()
})
