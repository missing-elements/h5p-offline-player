import { describe, expect, it } from 'vitest'
import {
  allowedStatement,
  cmi5Score,
  isCmi5Launch,
  judge,
  rejectionReason,
  startCmi5,
  webAddress,
  type Cmi5Client,
  type Cmi5Event,
  type LaunchData,
  type LaunchParameters,
  type SessionStorage,
  type Statement
} from '../src/index'

const LAUNCH: LaunchParameters = {
  endpoint: 'https://lrs.example/xapi/',
  fetch: 'https://lms.example/fetch/1',
  actor: { name: 'Ada', account: { homePage: 'https://lms.example', name: 'ada' } },
  registration: 'reg-1',
  activityId: 'https://lms.example/au/1'
}
const SESSION = 'https://w3id.org/xapi/cmi5/context/extensions/sessionid'
const TEMPLATE = { contextActivities: { grouping: [{ id: 'https://lms.example/course' }] }, extensions: { [SESSION]: 's-1' } }

/** An LMS in memory: what the client was asked to do, in order. */
function fakeClient(data: Partial<LaunchData> = {}, { failInitialize = false, deferInitialize = false } = {}) {
  const calls: Array<{ call: string; arg?: any }> = []
  let release: () => void = () => {}
  const launchData = { contextTemplate: TEMPLATE, launchMode: 'Normal' as const, moveOn: 'CompletedAndPassed' as const, masteryScore: 0.8, ...data }
  const client: Cmi5Client = {
    getLaunchParameters: () => LAUNCH,
    getLaunchData: () => launchData,
    getAuthToken: () => 'token-1',
    getInitializedDate: () => new Date('2026-10-01T10:00:00Z'),
    async initialize(state) {
      calls.push({ call: 'initialize', arg: state })
      if (deferInitialize) await new Promise<void>((done) => (release = done))
      if (failInitialize) throw { response: { data: { message: '8.1.2.0-2 - token already used' } } }
    },
    async sendXapiStatement(statement) {
      calls.push({ call: 'send', arg: statement })
    },
    async moveOn(options) {
      calls.push({ call: 'moveOn', arg: options })
      const passed = judge(options.score, options.success, launchData.masteryScore)
      return { outcome: passed === null ? null : passed ? 'passed' : 'failed', completed: true }
    },
    async terminate() {
      calls.push({ call: 'terminate' })
    }
  }
  return { client, calls, release: () => release() }
}

/** The element's surface: events in, `src` out. */
class FakePlayer extends EventTarget {
  src: string | null = null
  setAttribute(name: string, value: string) {
    if (name === 'src') this.src = value
  }
  emit(type: 'xapi' | 'finished', statement: Statement) {
    this.dispatchEvent(new CustomEvent(type, { detail: { statement } }))
  }
}

function memoryStorage(): SessionStorage & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) }
}

const tick = () => new Promise((r) => setTimeout(r, 0))
const answered: Statement = {
  actor: { name: 'H5P user' },
  verb: { id: 'http://adlnet.gov/expapi/verbs/answered' },
  object: { objectType: 'Activity', id: 'https://host/content' },
  context: { revision: 'sha256:abc', platform: 'h5p-offline-player 0.1.10', contextActivities: { category: [{ id: 'http://h5p.org/libraries/H5P.QuestionSet-1.20' }] } }
}
const completed = (raw: number, max: number): Statement => ({ ...answered, verb: { id: 'http://adlnet.gov/expapi/verbs/completed' }, result: { score: { raw, max } } })

describe('the pure parts', () => {
  it('recognises a launch by its five parameters', () => {
    const q = new URLSearchParams({ endpoint: 'e', fetch: 'f', actor: '{}', registration: 'r', activityId: 'a' })
    expect(isCmi5Launch(`https://x.example/au?${q}`)).toBe(true)
    q.delete('fetch')
    expect(isCmi5Launch(`https://x.example/au?${q}`)).toBe(false)
    expect(isCmi5Launch('not a url')).toBe(false)
  })

  it('makes an allowed statement: launch actor, registration, template under the statement\'s own context', () => {
    const out = allowedStatement(answered, LAUNCH, { contextTemplate: TEMPLATE })
    expect(out.actor).toEqual(LAUNCH.actor)
    expect(out.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(out.context.registration).toBe('reg-1')
    expect(out.context.revision).toBe('sha256:abc')
    expect(out.context.extensions[SESSION]).toBe('s-1')
    expect(out.context.contextActivities.grouping).toEqual([{ id: 'https://lms.example/course' }])
    expect(out.context.contextActivities.category).toEqual([{ id: 'http://h5p.org/libraries/H5P.QuestionSet-1.20' }])
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e'
    expect(allowedStatement({ ...answered, id }, LAUNCH, {}).id).toBe(id)
  })

  it('puts every statement in UTC, its own time kept (9.7.0.0-1, 9.7.0.0-2)', () => {
    expect(allowedStatement({ ...answered, timestamp: '2026-10-01T12:00:00+02:00' }, LAUNCH, {}).timestamp).toBe('2026-10-01T10:00:00.000Z')
    expect(allowedStatement(answered, LAUNCH, {}).timestamp).toMatch(/Z$/)
  })

  it('gives every statement a UUID id (9.1.0.0-1)', () => {
    expect(allowedStatement({ ...answered, id: 'not-a-uuid' }, LAUNCH, {}).id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('uses the context template and never overwrites it (10.2.1.0-6, 10.2.1.0-7, 9.6.3.1-4)', () => {
    const own = { ...answered, context: { ...answered.context, language: 'en', extensions: { [SESSION]: 'forged', 'https://h5p.example/x': 1 } } }
    const out = allowedStatement(own, LAUNCH, { contextTemplate: { ...TEMPLATE, language: 'de' } })
    expect(out.context.language).toBe('de')
    expect(out.context.extensions).toEqual({ [SESSION]: 's-1', 'https://h5p.example/x': 1 })
    expect(out.context.revision).toBe('sha256:abc')
  })

  it('scores the cmi5 way: min and max beside raw, 0 as H5P\'s minimum', () => {
    expect(cmi5Score({ raw: 3, max: 4 })).toEqual({ scaled: 0.75, raw: 3, min: 0, max: 4 })
    expect(cmi5Score({ scaled: 0.5 })).toEqual({ scaled: 0.5 })
    expect(cmi5Score({ raw: 1, min: 1, max: 5, scaled: 0 })).toEqual({ scaled: 0, raw: 1, min: 1, max: 5 })
    expect(cmi5Score(undefined)).toBeUndefined()
    expect(cmi5Score({ raw: 2 })).toBeUndefined()
  })

  it('treats a zero mastery score as a mastery score', () => {
    expect(judge({ scaled: 0, raw: 0, min: 0, max: 1 }, false, 0)).toBe(true)
  })

  it('follows only http and https return addresses', () => {
    expect(webAddress('https://lms.example/back')).toBe('https://lms.example/back')
    expect(webAddress('javascript:alert(1)')).toBeNull()
    expect(webAddress('/relative')).toBeNull()
    expect(webAddress(undefined)).toBeNull()
  })

  it('reads the LMS\'s reason out of a refusal', () => {
    expect(rejectionReason({ response: { data: { message: '9.5.1.0-3 - min and max' } } })).toBe('9.5.1.0-3 - min and max')
    expect(rejectionReason({ response: { data: 'Forbidden' } })).toBe('Forbidden')
    expect(rejectionReason(new Error('Network Error'))).toBe('Network Error')
  })
})

describe('startCmi5', () => {
  // 7.1.1.0-1, 7.1.2.0-1, 7.1.3.0-1, 9.3.0.0-5, 9.3.3.0-1, 9.3.8.0-1, 9.3.8.0-2, and in Normal mode
  // 10.2.2.0-1, 10.2.2.0-6, 10.2.2.0-7: initialized, then the content, the outcome on
  // completion, terminated last and nothing after it.
  it('sends initialized, relays the content\'s statements, records the outcome once and terminates', async () => {
    const { client, calls } = fakeClient()
    const player = new FakePlayer()
    const events: Cmi5Event[] = []
    const session = await startCmi5(player, { client, storage: memoryStorage(), url: 'https://au.example/?src=https://host/quiz.h5p', onEvent: (e) => events.push(e) })

    expect(player.src).toBe('https://host/quiz.h5p')
    expect(session.src).toBe('https://host/quiz.h5p')
    expect(calls[0]).toEqual({ call: 'initialize', arg: undefined })
    expect(events[0]).toMatchObject({ type: 'initialized', resumed: false, returnURL: null })

    player.emit('xapi', answered)
    await tick()
    expect(calls[1].call).toBe('send')
    expect(calls[1].arg.actor).toEqual(LAUNCH.actor)

    player.emit('finished', completed(3, 4))
    player.emit('finished', completed(4, 4))
    await tick()
    const moveOns = calls.filter((c) => c.call === 'moveOn')
    expect(moveOns).toHaveLength(1)
    expect(moveOns[0].arg).toEqual({ score: { scaled: 0.75, raw: 3, min: 0, max: 4 }, disableSendTerminated: true })
    expect(events).toContainEqual({ type: 'recorded', outcome: 'failed', completed: true })

    await Promise.all([session.terminate(), session.terminate()])
    expect(calls.filter((c) => c.call === 'terminate')).toHaveLength(1)
    expect(session.terminated).toBe(true)

    // Nothing is relayed after `terminated`: the listeners are gone.
    const before = calls.length
    player.emit('xapi', answered)
    await tick()
    expect(calls).toHaveLength(before)
  })

  it('drops player statements without the platform or an Activity and keeps the session running', async () => {
    const { client, calls } = fakeClient()
    const player = new FakePlayer()
    const events: Cmi5Event[] = []
    await startCmi5(player, { client, storage: null, src: false, onEvent: (event) => events.push(event) })

    player.emit('xapi', { ...answered, context: { ...answered.context, platform: undefined } })
    player.emit('xapi', { ...answered, context: { ...answered.context, revision: undefined, platform: undefined } })
    player.emit('xapi', { ...answered, object: { objectType: 'Agent', id: 'https://host/person' } })
    await tick()
    expect(calls.filter((call) => call.call === 'send')).toHaveLength(0)
    expect(events.filter((event) => event.type === 'rejected').map((event) => event.reason)).toEqual([
      'the player statement has no context.platform',
      'the player statement has no context.platform',
      'the player statement does not describe an Activity'
    ])

    player.emit('xapi', { ...answered, object: { id: 'https://host/content' } })
    await tick()
    expect(calls.filter((call) => call.call === 'send')).toHaveLength(1)

    player.emit('xapi', answered)
    await tick()
    expect(calls.filter((call) => call.call === 'send')).toHaveLength(2)
  })

  // The element releases held statements without a revision on a host without Range when the
  // load ends or the page is hidden before the index answered; cmi5 must not lose them again.
  it('relays a player statement that carries the platform but no revision', async () => {
    const { client, calls } = fakeClient()
    const player = new FakePlayer()
    const events: Cmi5Event[] = []
    await startCmi5(player, { client, storage: null, src: false, onEvent: (event) => events.push(event) })

    const { revision: _revision, ...withoutRevision } = answered.context
    player.emit('xapi', { ...answered, context: withoutRevision })
    await tick()
    const sent = calls.filter((call) => call.call === 'send')
    expect(sent).toHaveLength(1)
    expect(sent[0].arg.context.platform).toBe('h5p-offline-player 0.1.10')
    expect(sent[0].arg.context).not.toHaveProperty('revision')
    expect(events.some((event) => event.type === 'rejected')).toBe(false)
  })

  // 9.3.0.0-4, 9.3.2.0-2: initialized is the first statement of the session, whatever the
  // content emitted.
  it('listens before the handshake, and sends what arrived meanwhile after initialized', async () => {
    const { client, calls, release } = fakeClient({}, { deferInitialize: true })
    const player = new FakePlayer()
    const started = startCmi5(player, { client, storage: null, src: false })
    await tick()
    player.emit('xapi', answered)
    player.emit('finished', completed(4, 4))
    await tick()
    expect(calls.map((c) => c.call)).toEqual(['initialize'])
    release()
    await started
    await tick()
    expect(calls.map((c) => c.call)).toEqual(['initialize', 'send', 'moveOn'])
    expect(player.src).toBeNull()
  })

  // 9.3.2.0-3, 9.5.4.2-2: one initialized per session, durations from the session's own start.
  it('resumes after a reload on the kept token, with no second completed', async () => {
    const storage = memoryStorage()
    const first = fakeClient()
    const player = new FakePlayer()
    await startCmi5(player, { client: first.client, storage, src: false })
    player.emit('finished', completed(4, 4))
    await tick()
    expect(first.calls.filter((c) => c.call === 'moveOn')).toHaveLength(1)

    // The reload: a new page, a new client, the same launch.
    const second = fakeClient()
    const reloaded = new FakePlayer()
    const events: Cmi5Event[] = []
    const session = await startCmi5(reloaded, { client: second.client, storage, src: false, onEvent: (e) => events.push(e) })
    expect(session.resumed).toBe(true)
    expect(second.calls[0].arg).toEqual({ authToken: 'token-1', initializedDate: new Date('2026-10-01T10:00:00Z') })
    reloaded.emit('finished', completed(4, 4))
    await tick()
    expect(second.calls.filter((c) => c.call === 'moveOn')).toHaveLength(0)

    await session.terminate()
    expect(storage.map.size).toBe(0)
  })

  // The record is found by the fetch URL alone, and its token is sent to the endpoint the launch
  // names: a record made for another endpoint must not hand its token over.
  it('ignores a kept session made for another endpoint, registration or activity', async () => {
    const storage = memoryStorage()
    const first = fakeClient()
    await startCmi5(new FakePlayer(), { client: first.client, storage, src: false })
    const [[key, raw]] = [...storage.map.entries()]

    for (const field of ['endpoint', 'registration', 'activityId'] as const) {
      storage.map.set(key, JSON.stringify({ ...JSON.parse(raw), [field]: 'https://elsewhere.example/' }))
      const next = fakeClient()
      const session = await startCmi5(new FakePlayer(), { client: next.client, storage, src: false })
      expect(session.resumed).toBe(false)
      expect(next.calls[0]).toEqual({ call: 'initialize', arg: undefined })
    }

    // A record from before the binding names none of the three, and starts over the same way.
    const { endpoint, registration, activityId, ...unbound } = JSON.parse(raw)
    storage.map.set(key, JSON.stringify(unbound))
    const old = fakeClient()
    expect((await startCmi5(new FakePlayer(), { client: old.client, storage, src: false })).resumed).toBe(false)
  })

  it('retains a rejected outcome for retrying in the page or after a trusted-storage reload', async () => {
    const storage = memoryStorage()
    const failed = fakeClient()
    let attempts = 0
    const failingClient: Cmi5Client = {
      ...failed.client,
      async moveOn(options) {
        failed.calls.push({ call: 'moveOn', arg: options })
        attempts += 1
        if (attempts === 1) throw new Error('temporary LRS failure')
        return { outcome: 'passed', completed: true }
      }
    }
    const player = new FakePlayer()
    const events: Cmi5Event[] = []
    const session = await startCmi5(player, { client: failingClient, storage, src: false, onEvent: (event) => events.push(event) })
    player.emit('finished', completed(4, 4))
    await tick()
    expect(events.at(-1)).toMatchObject({ type: 'rejected', verb: 'move-on' })
    expect(failed.calls.filter((call) => call.call === 'moveOn')).toHaveLength(1)

    await session.retry()
    expect(failed.calls.filter((call) => call.call === 'moveOn')).toHaveLength(2)
    expect(events.at(-1)).toEqual({ type: 'recorded', outcome: 'passed', completed: true })

    const reloadStorage = memoryStorage()
    const failedAgain = fakeClient()
    const reloadedClient: Cmi5Client = {
      ...failedAgain.client,
      async moveOn(options) {
        failedAgain.calls.push({ call: 'moveOn', arg: options })
        throw new Error('temporary LRS failure')
      }
    }
    const reloadedPlayer = new FakePlayer()
    const failedSession = await startCmi5(reloadedPlayer, { client: reloadedClient, storage: reloadStorage, src: false })
    reloadedPlayer.emit('finished', completed(4, 4))
    await tick()
    failedSession.stop()

    const recovered = fakeClient()
    await startCmi5(new FakePlayer(), { client: recovered.client, storage: reloadStorage, src: false })
    await tick()
    expect(recovered.calls.filter((call) => call.call === 'moveOn')).toHaveLength(1)
  })

  // 10.2.2.0-2, 10.2.2.0-3, 10.2.2.0-8, 10.2.2.0-9, 10.2.2.0-10, 10.2.2.0-11: initialized and
  // terminated, and no outcome.
  it.each(['Browse', 'Review'] as const)('records nothing in %s mode', async (launchMode) => {
    const { client, calls } = fakeClient({ launchMode })
    const player = new FakePlayer()
    const events: Cmi5Event[] = []
    const session = await startCmi5(player, { client, storage: null, src: false, onEvent: (e) => events.push(e) })
    player.emit('finished', completed(4, 4))
    await tick()
    await session.terminate()
    expect(calls.map((c) => c.call)).toEqual(['initialize', 'terminate'])
    expect(events.map((e) => e.type)).toContain('skipped')
  })

  it('takes the package from launchParameters when the address has none', async () => {
    const { client } = fakeClient({ launchParameters: 'https://host/from-launch.h5p' })
    const player = new FakePlayer()
    const session = await startCmi5(player, { client, storage: null, url: 'https://au.example/' })
    expect(player.src).toBe('https://host/from-launch.h5p')
    expect(session.src).toBe('https://host/from-launch.h5p')
  })

  it('passes the content\'s own verdict on when the launch has no mastery score', async () => {
    const { client, calls } = fakeClient({ masteryScore: undefined })
    const events: Cmi5Event[] = []
    const player = new FakePlayer()
    await startCmi5(player, { client, storage: null, src: false, onEvent: (e) => events.push(e) })
    player.emit('finished', { ...completed(3, 4), result: { score: { raw: 3, max: 4 }, success: true } })
    await tick()
    expect(calls.find((c) => c.call === 'moveOn')?.arg).toEqual({ score: { scaled: 0.75, raw: 3, min: 0, max: 4 }, success: true, disableSendTerminated: true })
    expect(events.at(-1)).toEqual({ type: 'recorded', outcome: 'passed', completed: true })
  })

  it('reports what an earlier session of the registration already recorded', async () => {
    const recorded = async (history: { completed: boolean; passed: boolean; unread?: string }, raw: number) => {
      const { client, calls } = fakeClient()
      const events: Cmi5Event[] = []
      const player = new FakePlayer()
      await startCmi5(player, {
        client: {
          ...client,
          getRegistrationHistory: () => history,
          async moveOn(options) {
            calls.push({ call: 'moveOn', arg: options })
            const passed = judge(options.score, options.success, 0.8)
            return {
              outcome: history.passed || passed === null ? null : passed ? 'passed' : 'failed',
              completed: !history.completed
            }
          }
        },
        storage: null,
        src: false,
        onEvent: (e) => events.push(e)
      })
      player.emit('finished', completed(raw, 4))
      await tick()
      return { events, moveOns: calls.filter((c) => c.call === 'moveOn').length }
    }

    const done = await recorded({ completed: true, passed: true }, 4)
    expect(done.moveOns).toBe(1)
    expect(done.events.at(-1)).toMatchObject({ type: 'skipped', reason: expect.stringMatching(/earlier session/) })

    const retried = await recorded({ completed: true, passed: false }, 4)
    expect(retried.moveOns).toBe(1)
    expect(retried.events.at(-1)).toEqual({ type: 'recorded', outcome: 'passed', completed: false })

    const unread = await recorded({ completed: false, passed: false, unread: 'no read access' }, 4)
    expect(unread.events).toContainEqual({ type: 'registration-unread', reason: 'no read access' })
    expect(unread.events.at(-1)).toEqual({ type: 'recorded', outcome: 'passed', completed: true })
  })

  // 10.2.6.0-1
  it('goes to the returnURL on exit, after terminated', async () => {
    const { client, calls } = fakeClient({ returnURL: 'https://lms.example/back' })
    const session = await startCmi5(new FakePlayer(), { client, storage: null, src: false })
    const assigned: string[] = []
    const location = globalThis.location
    Object.defineProperty(globalThis, 'location', { value: { assign: (to: string) => assigned.push(to) }, configurable: true })
    try {
      await session.exit()
    } finally {
      Object.defineProperty(globalThis, 'location', { value: location, configurable: true })
    }
    expect(calls.at(-1)).toEqual({ call: 'terminate' })
    expect(assigned).toEqual(['https://lms.example/back'])
  })

  it('does not try to close a framed page that has no returnURL', async () => {
    const { client, calls } = fakeClient({})
    const session = await startCmi5(new FakePlayer(), { client, storage: null, src: false })
    let closed = 0
    const saved = { top: globalThis.top, self: globalThis.self, close: globalThis.close }
    // In a frame, `top` is the LMS page's window and `self` this one.
    Object.assign(globalThis, { top: {}, self: globalThis, close: () => closed++ })
    try {
      await session.exit()
    } finally {
      Object.assign(globalThis, saved)
    }
    expect(calls.at(-1)).toEqual({ call: 'terminate' })
    expect(closed).toBe(0)
  })

  it('drops a returnURL that is not a web address, and says so', async () => {
    const { client } = fakeClient({ returnURL: 'javascript:alert(1)' })
    const events: Cmi5Event[] = []
    const session = await startCmi5(new FakePlayer(), { client, storage: null, src: false, onEvent: (e) => events.push(e) })
    expect(session.returnURL).toBeNull()
    expect(events).toContainEqual({ type: 'unsafe-return-url', value: 'javascript:alert(1)' })
  })

  it('rejects with the LMS\'s reason when the launch fails, and stops listening', async () => {
    const { client, calls } = fakeClient({}, { failInitialize: true })
    const player = new FakePlayer()
    await expect(startCmi5(player, { client, storage: null, src: false })).rejects.toThrow('8.1.2.0-2 - token already used')
    player.emit('xapi', answered)
    await tick()
    expect(calls.map((c) => c.call)).toEqual(['initialize'])
  })
})
