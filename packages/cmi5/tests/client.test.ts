import { describe, expect, it } from 'vitest'
import { Cmi5RequestError, createCmi5Client, isoDuration, launchParametersOf, rejectionReason, type Statement } from '../src/index'

const ACTOR = { name: 'Ada', account: { homePage: 'https://lms.example', name: 'ada' } }
const LAUNCH_URL = `https://au.example/page.html?${new URLSearchParams({
  endpoint: 'https://lrs.example/xapi',
  fetch: 'https://lms.example/fetch/1',
  actor: JSON.stringify(ACTOR),
  registration: 'reg-1',
  activityId: 'https://lms.example/au/1'
})}`
const SESSION = 'https://w3id.org/xapi/cmi5/context/extensions/sessionid'
const CMI5 = { id: 'https://w3id.org/xapi/cmi5/context/categories/cmi5' }
const MOVE_ON = { id: 'https://w3id.org/xapi/cmi5/context/categories/moveon' }
const LAUNCH_DATA = {
  contextTemplate: { contextActivities: { grouping: [{ id: 'https://lms.example/course' }] }, extensions: { [SESSION]: 's-1' } },
  launchMode: 'Normal',
  moveOn: 'CompletedAndPassed',
  masteryScore: 0.8
}

interface Seen {
  method: string
  url: string
  headers: Record<string, string>
  body?: Statement
}

/** The LMS and the LRS behind one `fetch`: a token once, the launch data, statements kept. */
function fakeNetwork({
  data = LAUNCH_DATA as Statement,
  token = { 'auth-token': 'dG9rZW4=' } as Statement,
  refuse = null as Statement | null,
  preferences = null as Statement | null,
  earlier = [] as Statement[],
  unreadable = false
} = {}) {
  const seen: Seen[] = []
  // What the LRS holds: earlier sessions' statements, then what this one posts.
  const held: Statement[] = [...earlier]
  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const entry: Seen = { method: init.method ?? 'GET', url, headers: { ...(init.headers as Record<string, string>) } }
    if (init.body) entry.body = JSON.parse(String(init.body))
    seen.push(entry)
    const reply = (status: number, value: unknown) => new Response(value === undefined ? null : JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
    if (url === 'https://lms.example/fetch/1') return reply(200, token)
    if (url.startsWith('https://lrs.example/xapi/activities/state?')) return reply(200, data)
    if (url.startsWith('https://lrs.example/xapi/agents/profile?')) return preferences ? reply(200, preferences) : reply(404, undefined)
    if (url === 'https://lrs.example/xapi/statements') {
      if (refuse) return reply(400, refuse)
      held.push(entry.body!)
      return reply(200, [entry.body?.id])
    }
    if (url.startsWith('https://lrs.example/xapi/statements?')) {
      if (unreadable) return reply(403, { message: 'This token cannot read statements' })
      const q = new URL(url).searchParams
      const found = held.filter((s) => s.verb.id === q.get('verb') && s.object.id === q.get('activity') && s.context?.registration === q.get('registration'))
      return reply(200, { statements: found.slice(0, Number(q.get('limit') ?? 0) || undefined), more: '' })
    }
    return reply(404, undefined)
  }
  const statements = () => seen.filter((s) => s.method === 'POST' && s.url.endsWith('/statements')).map((s) => s.body!)
  return { fetch: fetch as typeof globalThis.fetch, seen, statements }
}

describe('the launch in the address', () => {
  // 8.1.0.0-7, 8.1.1.0-2, 8.1.2.0-3, 8.1.3.0-2, 8.1.4.0-2, 8.1.5.0-5
  it('reads the five parameters in any order, the actor as JSON', () => {
    expect(launchParametersOf(LAUNCH_URL)).toEqual({
      endpoint: 'https://lrs.example/xapi',
      fetch: 'https://lms.example/fetch/1',
      actor: ACTOR,
      registration: 'reg-1',
      activityId: 'https://lms.example/au/1'
    })
    const reordered = new URL(LAUNCH_URL)
    reordered.search = new URLSearchParams([...reordered.searchParams].reverse()).toString()
    expect(launchParametersOf(reordered.href)).toEqual(launchParametersOf(LAUNCH_URL))
    const url = new URL(LAUNCH_URL)
    url.searchParams.set('actor', 'not json')
    expect(launchParametersOf(url.href)).toBeNull()
    url.searchParams.delete('actor')
    expect(launchParametersOf(url.href)).toBeNull()
    expect(() => createCmi5Client({ url: url.href })).toThrow(/not a cmi5 launch/)
  })

  it('writes durations as ISO 8601, to the hundredth of a second', () => {
    const at = (ms: number) => new Date(Date.UTC(2026, 9, 1) + ms)
    expect(isoDuration(at(0), at(0))).toBe('PT0S')
    expect(isoDuration(at(0), at(1234))).toBe('PT1.23S')
    expect(isoDuration(at(0), at(61_000))).toBe('PT1M1S')
    expect(isoDuration(at(0), at(3_600_000))).toBe('PT1H')
    expect(isoDuration(at(0), at(86_400_000))).toBe('P1D')
    expect(isoDuration(at(0), at(90_061_500))).toBe('P1DT1H1M1.5S')
    expect(isoDuration(at(5), at(0))).toBe('PT0S')
  })
})

describe('createCmi5Client', () => {
  // 8.1.1.0-3, 8.1.2.0-4, 8.1.2.0-5, 8.1.3.0-3, 8.1.4.0-3, 8.1.5.0-6, 8.2.1.0-2, 8.2.1.0-5,
  // 8.2.2.0-4, 8.2.2.0-5, 9.4.0.0-1, 9.4.0.0-2, 9.6.1.0-1, 9.6.2.0-1, 9.6.2.1-1, 10.2.1.0-4,
  // 10.2.1.0-5, 11.0.0.0-1, 11.0.0.0-3, 11.0.0.0-4: the token
  // by POST, then only reads, at the endpoint, with the token and the launch's actor, registration
  // and activity.
  it('trades the token, reads the launch data and sends initialized', async () => {
    const net = fakeNetwork()
    const client = createCmi5Client({ url: LAUNCH_URL, fetch: net.fetch })
    await client.initialize()

    expect(net.seen.map((s) => `${s.method} ${s.url.split('?')[0]}`)).toEqual([
      'POST https://lms.example/fetch/1',
      'GET https://lrs.example/xapi/activities/state',
      'GET https://lrs.example/xapi/agents/profile',
      'GET https://lrs.example/xapi/statements',
      'GET https://lrs.example/xapi/statements',
      'POST https://lrs.example/xapi/statements'
    ])
    const state = new URL(net.seen[1].url).searchParams
    expect(Object.fromEntries(state)).toEqual({ stateId: 'LMS.LaunchData', activityId: 'https://lms.example/au/1', agent: JSON.stringify(ACTOR), registration: 'reg-1' })
    expect(net.seen[1].headers).toMatchObject({ 'X-Experience-API-Version': '1.0.3', Authorization: 'Basic dG9rZW4=' })
    expect(Object.fromEntries(new URL(net.seen[2].url).searchParams)).toEqual({ profileId: 'cmi5LearnerPreferences', agent: JSON.stringify(ACTOR) })
    expect(net.seen[2].headers).toMatchObject({ Authorization: 'Basic dG9rZW4=' })
    expect(net.seen[5].headers).toMatchObject({ 'Content-Type': 'application/json', Authorization: 'Basic dG9rZW4=' })
    const asked = net.seen.slice(3, 5).map((s) => Object.fromEntries(new URL(s.url).searchParams))
    expect(asked.map((q) => q.verb).sort()).toEqual(['http://adlnet.gov/expapi/verbs/completed', 'http://adlnet.gov/expapi/verbs/passed'])
    expect(asked[0]).toMatchObject({ agent: JSON.stringify(ACTOR), activity: 'https://lms.example/au/1', registration: 'reg-1', limit: '1' })
    expect(net.seen[3].headers).toMatchObject({ Authorization: 'Basic dG9rZW4=' })
    expect(client.getRegistrationHistory?.()).toEqual({ completed: false, passed: false })

    const [initialized] = net.statements()
    expect(initialized).toMatchObject({
      actor: ACTOR,
      verb: { id: 'http://adlnet.gov/expapi/verbs/initialized' },
      object: { objectType: 'Activity', id: 'https://lms.example/au/1' },
      context: {
        registration: 'reg-1',
        contextActivities: { grouping: [{ id: 'https://lms.example/course' }], category: [CMI5] },
        extensions: { [SESSION]: 's-1' }
      }
    })
    expect(initialized.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(initialized.result).toBeUndefined()
    expect(client.getAuthToken()).toBe('dG9rZW4=')
    expect(client.getLaunchData().masteryScore).toBe(0.8)
    // No preferences document is the defaults, not an error.
    expect(client.getLearnerPreferences?.()).toEqual({})
  })

  it('hands over the learner preferences the LMS keeps', async () => {
    const net = fakeNetwork({ preferences: { languagePreference: 'de-DE,en-US', audioPreference: 'off' } })
    const client = createCmi5Client({ url: LAUNCH_URL, fetch: net.fetch })
    await client.initialize()
    expect(client.getLearnerPreferences?.()).toEqual({ languagePreference: 'de-DE,en-US', audioPreference: 'off' })
  })

  it('resumes on a kept token: no fetch, no second initialized', async () => {
    const net = fakeNetwork()
    const client = createCmi5Client({ url: LAUNCH_URL, fetch: net.fetch })
    const started = new Date('2026-10-01T10:00:00Z')
    await client.initialize({ authToken: 'a2VwdA==', initializedDate: started })
    expect(net.seen.map((s) => `${s.method} ${s.url.split('?')[0]}`)).toEqual([
      'GET https://lrs.example/xapi/activities/state',
      'GET https://lrs.example/xapi/agents/profile',
      'GET https://lrs.example/xapi/statements',
      'GET https://lrs.example/xapi/statements'
    ])
    expect(net.seen[0].headers.Authorization).toBe('Basic a2VwdA==')
    expect(client.getInitializedDate()).toBe(started)
  })

  // 9.3.5.0-1, 9.3.5.0-2, 9.5.1.0-1, 9.5.2.0-2, 9.5.3.0-1, 9.5.4.1-2, 9.5.4.1-4, 9.6.2.2-1,
  // 9.6.3.2-2, 10.2.4.0-2
  it('judges passed or failed by the mastery score, then completed, both in the moveon category', async () => {
    const net = fakeNetwork()
    const client = createCmi5Client({ url: LAUNCH_URL, fetch: net.fetch })
    await client.initialize()
    await client.moveOn({ score: { scaled: 0.75, raw: 3, min: 0, max: 4 }, disableSendTerminated: true })

    const [, failed, completed, ...rest] = net.statements()
    expect(rest).toEqual([])
    expect(failed.verb.id).toBe('http://adlnet.gov/expapi/verbs/failed')
    expect(failed.result).toMatchObject({ score: { scaled: 0.75, raw: 3, min: 0, max: 4 }, success: false })
    expect(failed.result.duration).toMatch(/^PT/)
    expect(failed.context.contextActivities.category).toEqual([CMI5, MOVE_ON])
    expect(failed.context.extensions).toEqual({ [SESSION]: 's-1', 'https://w3id.org/xapi/cmi5/context/extensions/masteryscore': 0.8 })
    expect(completed.verb.id).toBe('http://adlnet.gov/expapi/verbs/completed')
    expect(completed.result).toMatchObject({ completion: true, duration: expect.stringMatching(/^PT/) })
    expect(completed.result.score).toBeUndefined()
    expect(completed.context.contextActivities.category).toEqual([CMI5, MOVE_ON])
  })

  // 9.3.4.0-1, 9.3.4.0-2, 9.5.2.0-1, 9.5.2.0-3, 9.5.3.0-2, 9.5.4.1-3
  it('sends passed at or above the mastery score', async () => {
    const net = fakeNetwork()
    const client = createCmi5Client({ url: LAUNCH_URL, fetch: net.fetch })
    await client.initialize()
    await client.moveOn({ score: { scaled: 0.8, raw: 4, min: 0, max: 5 }, disableSendTerminated: true })
    const passed = net.statements()[1]
    expect(passed.verb.id).toBe('http://adlnet.gov/expapi/verbs/passed')
    expect(passed.result).toMatchObject({ success: true, duration: expect.stringMatching(/^PT/) })
    expect(passed.result.completion).toBeUndefined()
    const completed = net.statements()[2]
    expect(completed.result.success).toBeUndefined()
    expect(completed.result.completion).toBe(true)
  })

  // 9.5.1.0-2, 9.5.4.1-1, 9.6.2.2-2: without a mastery score the content's own verdict decides,
  // the score rides on passed or failed only, and terminated has no moveon category.
  it('judges by the content\'s own verdict without a mastery score, and terminates unless told not to', async () => {
    const net = fakeNetwork({ data: { ...LAUNCH_DATA, masteryScore: undefined } })
    const client = createCmi5Client({ url: LAUNCH_URL, fetch: net.fetch })
    await client.initialize()
    await client.moveOn({ score: { scaled: 1, raw: 4, min: 0, max: 4 }, success: true })
    const [, passed, completed, terminated] = net.statements()
    expect(net.statements().map((s) => s.verb.display['en-US'])).toEqual(['initialized', 'passed', 'completed', 'terminated'])
    expect(passed.result).toMatchObject({ score: { scaled: 1, raw: 4, min: 0, max: 4 }, success: true })
    expect(passed.context.extensions).toEqual({ [SESSION]: 's-1' })
    expect(completed.result.score).toBeUndefined()
    expect(completed.result.success).toBeUndefined()
    expect(terminated.context.contextActivities.category).toEqual([CMI5])
    expect(terminated.result.duration).toMatch(/^PT/)
  })

  it('sends completed alone when there is neither a mastery score nor a verdict', async () => {
    const net = fakeNetwork({ data: { ...LAUNCH_DATA, masteryScore: undefined } })
    const client = createCmi5Client({ url: LAUNCH_URL, fetch: net.fetch })
    await client.initialize()
    await client.moveOn({ score: { scaled: 0.5, raw: 2, min: 0, max: 4 }, disableSendTerminated: true })
    const sent = net.statements()
    expect(sent.map((s) => s.verb.display['en-US'])).toEqual(['initialized', 'completed'])
    expect(sent[1].result).toEqual({ completion: true, duration: expect.stringMatching(/^PT/) })
  })

  // 9.3.0.0-2, 9.3.0.0-3
  it('sends one of passed and failed per session, and no verb twice', async () => {
    const net = fakeNetwork()
    const client = createCmi5Client({ url: LAUNCH_URL, fetch: net.fetch })
    await client.initialize()
    await client.moveOn({ score: { scaled: 0.25, raw: 1, min: 0, max: 4 }, disableSendTerminated: true })
    await client.moveOn({ score: { scaled: 0.5, raw: 2, min: 0, max: 4 }, disableSendTerminated: true })
    expect(net.statements().map((s) => s.verb.display['en-US'])).toEqual(['initialized', 'failed', 'completed'])
  })

  // 9.3.0.0-6, 9.3.0.0-7, 9.3.3.0-2, 9.3.4.0-3: once per registration, across sessions.
  it('sends no second completed or passed in a later session of the registration', async () => {
    const first = fakeNetwork()
    const one = createCmi5Client({ url: LAUNCH_URL, fetch: first.fetch })
    await one.initialize()
    await one.moveOn({ score: { scaled: 1, raw: 4, min: 0, max: 4 }, disableSendTerminated: true })
    // The same session again does not repeat itself either.
    await one.moveOn({ score: { scaled: 1, raw: 4, min: 0, max: 4 }, disableSendTerminated: true })
    expect(first.statements().map((s) => s.verb.display['en-US'])).toEqual(['initialized', 'passed', 'completed'])

    const second = fakeNetwork({ earlier: first.statements() })
    const two = createCmi5Client({ url: LAUNCH_URL, fetch: second.fetch })
    await two.initialize()
    expect(two.getRegistrationHistory?.()).toEqual({ completed: true, passed: true })
    await two.moveOn({ score: { scaled: 0.25, raw: 1, min: 0, max: 4 }, disableSendTerminated: true })
    await two.terminate()
    // 9.3.0.0-8: and no failed after the registration passed.
    expect(second.statements().map((s) => s.verb.display['en-US'])).toEqual(['initialized', 'terminated'])
  })

  it('lets a later session pass after an earlier one failed, without a second completed', async () => {
    const first = fakeNetwork()
    const one = createCmi5Client({ url: LAUNCH_URL, fetch: first.fetch })
    await one.initialize()
    await one.moveOn({ score: { scaled: 0.5, raw: 2, min: 0, max: 4 }, disableSendTerminated: true })

    const second = fakeNetwork({ earlier: first.statements() })
    const two = createCmi5Client({ url: LAUNCH_URL, fetch: second.fetch })
    await two.initialize()
    expect(two.getRegistrationHistory?.()).toEqual({ completed: true, passed: false })
    await two.moveOn({ score: { scaled: 1, raw: 4, min: 0, max: 4 }, disableSendTerminated: true })
    expect(second.statements().map((s) => s.verb.display['en-US'])).toEqual(['initialized', 'passed'])
  })

  it('counts this session alone when the LRS will not say, and says why', async () => {
    const net = fakeNetwork({ unreadable: true })
    const client = createCmi5Client({ url: LAUNCH_URL, fetch: net.fetch })
    await client.initialize()
    expect(client.getRegistrationHistory?.()).toEqual({ completed: false, passed: false, unread: 'This token cannot read statements' })
    await client.moveOn({ score: { scaled: 1, raw: 4, min: 0, max: 4 }, disableSendTerminated: true })
    expect(net.statements().map((s) => s.verb.display['en-US'])).toEqual(['initialized', 'passed', 'completed'])
  })

  it('does not ask what is recorded in a launch that records nothing', async () => {
    const net = fakeNetwork({ data: { ...LAUNCH_DATA, launchMode: 'Browse' } })
    await createCmi5Client({ url: LAUNCH_URL, fetch: net.fetch }).initialize()
    expect(net.seen.filter((s) => s.url.includes('/statements?'))).toEqual([])
  })

  // 10.2.2.0-3, 10.2.2.0-11
  it('records nothing outside Normal mode', async () => {
    const net = fakeNetwork({ data: { ...LAUNCH_DATA, launchMode: 'Review' } })
    const client = createCmi5Client({ url: LAUNCH_URL, fetch: net.fetch })
    await client.initialize()
    await expect(client.moveOn({})).rejects.toThrow(/Review mode/)
  })

  it('sends a statement as it is given', async () => {
    const net = fakeNetwork()
    const client = createCmi5Client({ url: LAUNCH_URL, fetch: net.fetch })
    await client.initialize()
    const statement = { id: 'x', actor: ACTOR, verb: { id: 'http://adlnet.gov/expapi/verbs/answered' }, object: { id: 'https://host/content' } }
    await client.sendXapiStatement(statement)
    expect(net.statements()[1]).toEqual(statement)
  })

  it('carries the reason of a refused token and of a refused statement', async () => {
    const used = fakeNetwork({ token: { 'error-code': '1', 'error-text': 'Already in Use' } })
    const error = await createCmi5Client({ url: LAUNCH_URL, fetch: used.fetch }).initialize().catch((e) => e)
    expect(error).toBeInstanceOf(Cmi5RequestError)
    expect(rejectionReason(error)).toBe('Already in Use')

    const refused = fakeNetwork({ refuse: { message: '9.5.1.0-3 - min and max are required' } })
    const client = createCmi5Client({ url: LAUNCH_URL, fetch: refused.fetch })
    const sent = await client.initialize().then(() => null, (e: Cmi5RequestError) => e)
    expect(sent?.response.status).toBe(400)
    expect(rejectionReason(sent)).toBe('9.5.1.0-3 - min and max are required')
  })

  it('needs initialize before anything that reads the session', () => {
    const client = createCmi5Client({ url: LAUNCH_URL, fetch: fakeNetwork().fetch })
    expect(client.getLaunchParameters().registration).toBe('reg-1')
    expect(() => client.getLaunchData()).toThrow(/not initialized/)
  })
})
