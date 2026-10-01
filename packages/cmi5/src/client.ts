/**
 * The assignable unit's side of cmi5, over `fetch`: the five launch parameters, the one-time
 * token, the `LMS.LaunchData` state document, and the cmi5-defined statements — `initialized`,
 * `passed` or `failed`, `completed`, `terminated` — built the way the spec and the reference
 * launching system expect them. It replaced `@xapi/cmi5`, whose browser build carried its own
 * copies of axios, `@xapi/xapi`, uuid and deepmerge for these few requests, and sends what that
 * library sent. That includes the learner preferences, which nothing here reads: the AU MUST
 * retrieve them on startup (11.0.0.0-3), and CATAPULT refuses the launch when it does not.
 */

import type { Cmi5Client, Cmi5Score, LaunchData, LaunchParameters, LearnerPreferences, RegistrationHistory, Statement } from './index.js'

const XAPI_VERSION = '1.0.3'
const VERBS = 'http://adlnet.gov/expapi/verbs/'
const CMI5_CATEGORY = { id: 'https://w3id.org/xapi/cmi5/context/categories/cmi5' }
const MOVE_ON_CATEGORY = { id: 'https://w3id.org/xapi/cmi5/context/categories/moveon' }
const MASTERY_SCORE = 'https://w3id.org/xapi/cmi5/context/extensions/masteryscore'

/** A refusal from the LMS or the LRS, with what it said. `rejectionReason` reads `response.data`. */
export class Cmi5RequestError extends Error {
  readonly response: { status: number; data: unknown }

  constructor(status: number, data: unknown, fallback: string) {
    super(reasonIn(data) ?? fallback)
    this.name = 'Cmi5RequestError'
    this.response = { status, data }
  }
}

function reasonIn(data: unknown): string | null {
  if (typeof data === 'string') return data.trim() || null
  if (data && typeof data === 'object') {
    const { message, 'error-text': errorText } = data as Record<string, unknown>
    if (typeof message === 'string') return message
    if (typeof errorText === 'string') return errorText
  }
  return null
}

/** The launch parameters in an address, or null when one of the five is missing. `actor` is JSON. */
export function launchParametersOf(url: string): LaunchParameters | null {
  let search: URLSearchParams
  try {
    search = new URL(url).searchParams
  } catch {
    return null
  }
  const endpoint = search.get('endpoint')
  const fetch = search.get('fetch')
  const actor = search.get('actor')
  const registration = search.get('registration')
  const activityId = search.get('activityId')
  if (!endpoint || !fetch || !actor || !registration || !activityId) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(actor)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  return { endpoint, fetch, actor: parsed as Record<string, unknown>, registration, activityId }
}

/** An ISO 8601 duration between two times, to the hundredth of a second xAPI keeps. */
export function isoDuration(from: Date, to: Date): string {
  let rest = Math.max(0, Math.round((to.getTime() - from.getTime()) / 10))
  const days = Math.floor(rest / 8_640_000)
  rest -= days * 8_640_000
  const hours = Math.floor(rest / 360_000)
  rest -= hours * 360_000
  const minutes = Math.floor(rest / 6_000)
  rest -= minutes * 6_000
  const seconds = rest / 100
  const time = `${hours ? `${hours}H` : ''}${minutes ? `${minutes}M` : ''}${seconds ? `${seconds}S` : ''}`
  if (!days && !time) return 'PT0S'
  return `P${days ? `${days}D` : ''}${time ? `T${time}` : ''}`
}

export interface Cmi5ClientOptions {
  /** The page's address, which carries the launch; `location.href` by default. */
  url?: string
  /** The `fetch` to make requests with; the global one by default. */
  fetch?: typeof globalThis.fetch
}

/**
 * A cmi5 client for the launch in the page's address. Throws when the address is not a launch.
 * `initialize()` trades the token, reads the launch data and sends `initialized`; given the token
 * and start time of a session already initialized, as after a reload, it reads the launch data
 * and sends nothing.
 */
export function createCmi5Client(options: Cmi5ClientOptions = {}): Cmi5Client {
  const url = options.url ?? globalThis.location?.href ?? ''
  const launch = launchParametersOf(url)
  if (!launch) throw new Error('This address is not a cmi5 launch: it lacks one of endpoint, fetch, actor, registration and activityId.')
  const request = options.fetch ?? globalThis.fetch.bind(globalThis)
  const endpoint = launch.endpoint.endsWith('/') ? launch.endpoint : `${launch.endpoint}/`

  let authToken: string | null = null
  let initializedDate: Date | null = null
  let data: LaunchData | null = null
  let preferences: LearnerPreferences = {}
  let history: RegistrationHistory = { completed: false, passed: false }
  /** One of `passed` and `failed` per session (9.3.0.0-3), whatever the registration holds. */
  let judgedThisSession = false

  const ready = () => {
    if (!authToken || !initializedDate || !data) throw new Error('The cmi5 session is not initialized.')
    return { data, initializedDate }
  }

  const lrs = async (path: string, init: RequestInit = {}) => {
    const response = await request(`${endpoint}${path}`, {
      ...init,
      headers: {
        'X-Experience-API-Version': XAPI_VERSION,
        Authorization: `Basic ${authToken}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers
      }
    })
    const body = await readBody(response)
    if (!response.ok) throw new Cmi5RequestError(response.status, body, `The LRS answered ${response.status} to ${init.method ?? 'GET'} ${path.split('?')[0]}`)
    return body
  }

  const send = (statement: Statement) => lrs('statements', { method: 'POST', body: JSON.stringify(statement) })

  /** A cmi5-defined statement: about the AU itself, the launch's context, the cmi5 category. */
  const defined = (verb: string, extra: { result?: Statement; category?: Statement[]; extensions?: Statement } = {}): Statement => {
    const { data } = ready()
    const template = data.contextTemplate ?? {}
    const activities = template.contextActivities ?? {}
    return {
      id: crypto.randomUUID(),
      actor: launch.actor,
      verb: { id: `${VERBS}${verb}`, display: { 'en-US': verb } },
      object: { objectType: 'Activity', id: launch.activityId },
      ...(extra.result ? { result: extra.result } : {}),
      context: {
        ...template,
        registration: launch.registration,
        contextActivities: { ...activities, category: [...(activities.category ?? []), CMI5_CATEGORY, ...(extra.category ?? [])] },
        ...(template.extensions || extra.extensions ? { extensions: { ...extra.extensions, ...template.extensions } } : {})
      },
      timestamp: new Date().toISOString()
    }
  }

  /** The `cmi5LearnerPreferences` agent profile. None, or one the LRS will not give, means the defaults. */
  const learnerPreferences = async (): Promise<LearnerPreferences> => {
    const query = new URLSearchParams({ profileId: 'cmi5LearnerPreferences', agent: JSON.stringify(launch.actor) })
    try {
      const found = await lrs(`agents/profile?${query}`, { cache: 'no-store' })
      return found && typeof found === 'object' ? (found as LearnerPreferences) : {}
    } catch {
      return {}
    }
  }

  /**
   * Whether an earlier session of this registration already sent `completed` or `passed`: each
   * goes out once per registration (9.3.0.0-6, 9.3.0.0-7), and `failed` never after `passed`
   * (9.3.0.0-8). One statements query per verb, about this AU, this learner, this registration.
   * An LRS that will not answer leaves the session to its own count, and says why.
   */
  const registrationHistory = async (): Promise<RegistrationHistory> => {
    const has = async (verb: string) => {
      const query = new URLSearchParams({
        agent: JSON.stringify(launch.actor),
        verb: `${VERBS}${verb}`,
        activity: launch.activityId,
        registration: launch.registration,
        limit: '1'
      })
      const found = await lrs(`statements?${query}`, { cache: 'no-store' })
      const statements = (found as { statements?: unknown } | null)?.statements
      if (!Array.isArray(statements)) throw new Error('the LRS answered the statements query with no statements list')
      return statements.length > 0
    }
    try {
      const [completed, passed] = await Promise.all([has('completed'), has('passed')])
      return { completed, passed }
    } catch (error) {
      return { completed: false, passed: false, unread: error instanceof Error ? error.message : String(error) }
    }
  }

  const duration = () => isoDuration(ready().initializedDate, new Date())

  return {
    getLaunchParameters: () => launch,
    getLaunchData: () => ready().data,
    getAuthToken: () => {
      ready()
      return authToken!
    },
    getInitializedDate: () => ready().initializedDate,
    getLearnerPreferences: () => {
      ready()
      return preferences
    },
    getRegistrationHistory: () => {
      ready()
      return history
    },

    async initialize(state) {
      authToken = state?.authToken ?? (await fetchToken(request, launch.fetch))
      const query = new URLSearchParams({
        stateId: 'LMS.LaunchData',
        activityId: launch.activityId,
        agent: JSON.stringify(launch.actor),
        registration: launch.registration
      })
      const launchData = await lrs(`activities/state?${query}`, { cache: 'no-store' })
      if (!launchData || typeof launchData !== 'object') throw new Error('The LMS gave no launch data (LMS.LaunchData).')
      data = launchData as LaunchData
      preferences = await learnerPreferences()
      // Only a Normal launch records an outcome, so only it needs to know what is recorded.
      if (data.launchMode === 'Normal') history = await registrationHistory()
      if (state) {
        initializedDate = state.initializedDate
        return
      }
      initializedDate = new Date()
      await send(defined('initialized'))
    },

    sendXapiStatement: send,

    async moveOn({ score, success, disableSendTerminated } = {}) {
      const { data } = ready()
      if (data.launchMode !== 'Normal') throw new Error(`Nothing may be recorded in ${data.launchMode} mode.`)
      const mastery = data.masteryScore
      const statements: Statement[] = []
      const passed = judge(score, success, mastery)
      // Neither `passed` nor `failed` once the registration has passed (9.3.0.0-7, 9.3.0.0-8),
      // and no second `completed` (9.3.0.0-6).
      if (passed !== null && !history.passed && !judgedThisSession) {
        judgedThisSession = true
        statements.push(defined(passed ? 'passed' : 'failed', {
          result: { ...(score ? { score } : {}), success: passed, duration: duration() },
          category: [MOVE_ON_CATEGORY],
          ...(mastery ? { extensions: { [MASTERY_SCORE]: mastery } } : {})
        }))
      }
      // No score here: only `passed` and `failed` may carry one (9.5.1.0-2).
      if (!history.completed) {
        statements.push(defined('completed', {
          result: { completion: true, duration: duration() },
          category: [MOVE_ON_CATEGORY]
        }))
      }
      if (!disableSendTerminated) statements.push(defined('terminated', { result: { duration: duration() } }))
      for (const statement of statements) {
        await send(statement)
        const verb = statement.verb.display['en-US']
        if (verb === 'completed') history = { ...history, completed: true }
        if (verb === 'passed') history = { ...history, passed: true }
      }
    },

    async terminate() {
      await send(defined('terminated', { result: { duration: duration() } }))
    }
  }
}

/**
 * Passed (true), failed (false) or neither (null). Against the mastery score when the launch has
 * one, which needs a score (9.5.1.0-1, 10.2.4.0-2); without one, by the content's own verdict.
 */
export function judge(score: Cmi5Score | undefined, success: boolean | undefined, mastery: number | undefined): boolean | null {
  if (mastery) return score ? score.scaled >= mastery : null
  return typeof success === 'boolean' ? success : null
}

/** The `fetch` URL answers once with `auth-token`, or with `error-code` and `error-text`, possibly under a 200. */
async function fetchToken(request: typeof globalThis.fetch, url: string): Promise<string> {
  const response = await request(url, { method: 'POST', cache: 'no-store' })
  const body = await readBody(response)
  const token = body && typeof body === 'object' ? (body as Record<string, unknown>)['auth-token'] : undefined
  if (response.ok && typeof token === 'string' && token) return token
  throw new Cmi5RequestError(response.status, body, `The LMS gave no token: it answered ${response.status} to the fetch URL`)
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
