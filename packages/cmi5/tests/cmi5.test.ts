import { describe, expect, it } from 'vitest'
import {
  allowedStatement,
  cmi5Score,
  isCmi5Launch,
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
  const client: Cmi5Client = {
    getLaunchParameters: () => LAUNCH,
    getLaunchData: () => ({ contextTemplate: TEMPLATE, launchMode: 'Normal', moveOn: 'CompletedAndPassed', masteryScore: 0.8, ...data }),
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
  context: { revision: 'sha256:abc', contextActivities: { category: [{ id: 'http://h5p.org/libraries/H5P.QuestionSet-1.20' }] } }
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
    expect(allowedStatement({ ...answered, id: 'kept' }, LAUNCH, {}).id).toBe('kept')
  })

  it('scores the cmi5 way: min and max beside raw, 0 as H5P\'s minimum', () => {
    expect(cmi5Score({ raw: 3, max: 4 })).toEqual({ scaled: 0.75, raw: 3, min: 0, max: 4 })
    expect(cmi5Score({ scaled: 0.5 })).toEqual({ scaled: 0.5 })
    expect(cmi5Score({ raw: 1, min: 1, max: 5, scaled: 0 })).toEqual({ scaled: 0, raw: 1, min: 1, max: 5 })
    expect(cmi5Score(undefined)).toBeUndefined()
    expect(cmi5Score({ raw: 2 })).toBeUndefined()
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
    expect(events).toContainEqual({ type: 'recorded', outcome: 'failed' })

    await session.terminate()
    await session.terminate()
    expect(calls.filter((c) => c.call === 'terminate')).toHaveLength(1)
    expect(session.terminated).toBe(true)

    // Nothing is relayed after `terminated`: the listeners are gone.
    const before = calls.length
    player.emit('xapi', answered)
    await tick()
    expect(calls).toHaveLength(before)
  })

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

  it('records nothing in Browse mode', async () => {
    const { client, calls } = fakeClient({ launchMode: 'Browse' })
    const player = new FakePlayer()
    const events: Cmi5Event[] = []
    await startCmi5(player, { client, storage: null, src: false, onEvent: (e) => events.push(e) })
    player.emit('finished', completed(4, 4))
    await tick()
    expect(calls.filter((c) => c.call === 'moveOn')).toHaveLength(0)
    expect(events.map((e) => e.type)).toContain('skipped')
  })

  it('takes the package from launchParameters when the address has none', async () => {
    const { client } = fakeClient({ launchParameters: 'https://host/from-launch.h5p' })
    const player = new FakePlayer()
    const session = await startCmi5(player, { client, storage: null, url: 'https://au.example/' })
    expect(player.src).toBe('https://host/from-launch.h5p')
    expect(session.src).toBe('https://host/from-launch.h5p')
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
