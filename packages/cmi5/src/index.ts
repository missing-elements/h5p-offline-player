/**
 * cmi5 for `<h5p-player>`: turns a page holding the element into a cmi5 assignable unit.
 *
 * `startCmi5(player)` reads the launch an LMS put in the page's address, trades the one-time
 * `fetch` token for LRS credentials, sends `initialized`, relays every statement the content
 * emits as a "cmi5 allowed" statement — the launch actor, the registration and the LMS's context
 * template merged in, the player's `context.revision` kept — and, when the content finishes,
 * sends `passed` or `failed` by the mastery score and `completed`. The session it returns sends
 * `terminated`. `client.ts` speaks the protocol over `fetch`; this module is the wiring between it
 * and the element, and both have been run against ADL's CATAPULT player, the reference cmi5
 * launching system.
 *
 * Two rules it keeps that are easy to get wrong. Nothing is sent as the page unloads: a page
 * cannot tell a reload from a closed tab, and a `terminated` sent on a reload ends the session
 * the reloaded page goes on using; a session left without `terminated` is the LMS's to record as
 * `abandoned`. And the single-use token is kept per launch, with the start time and whether the
 * outcome went out, so a reload resumes without a second `initialized` or `completed`.
 */

import { createCmi5Client, launchParametersOf } from './client.js'

export { Cmi5RequestError, createCmi5Client, isoDuration, launchParametersOf, type Cmi5ClientOptions } from './client.js'

/* ------------------------------------------------------------------ types */

/** An xAPI statement, as the element dispatches it and the LRS receives it. */
export type Statement = Record<string, any>

/** The five parameters an LMS appends to the assignable unit's URL. */
export interface LaunchParameters {
  endpoint: string
  fetch: string
  actor: Record<string, unknown>
  registration: string
  activityId: string
}

/** The `LMS.LaunchData` state document the LMS writes before the launch. */
export interface LaunchData {
  contextTemplate?: Record<string, any>
  launchMode: 'Normal' | 'Browse' | 'Review'
  moveOn: 'Passed' | 'Completed' | 'CompletedAndPassed' | 'CompletedOrPassed' | 'NotApplicable'
  masteryScore?: number
  returnURL?: string
  launchParameters?: string
  launchMethod?: 'OwnWindow' | 'AnyWindow'
}

/** The `cmi5LearnerPreferences` agent profile: what the learner set in the LMS, when they set it. */
export interface LearnerPreferences {
  languagePreference?: string
  audioPreference?: 'on' | 'off'
}

/** A score as cmi5 records it: `min` and `max` are required beside `raw`. */
export interface Cmi5Score {
  scaled: number
  raw?: number
  min?: number
  max?: number
}

/** A cmi5 client, as `createCmi5Client` makes one. Another one — a simulated LMS, a test double — can be passed as `client`. */
export interface Cmi5Client {
  getLaunchParameters(): LaunchParameters
  getLaunchData(): LaunchData
  getAuthToken(): string
  getInitializedDate(): Date
  /** The learner's preferences, read on `initialize`; a client without them reports none. */
  getLearnerPreferences?(): LearnerPreferences
  initialize(state?: { authToken: string; initializedDate: Date }): Promise<unknown>
  sendXapiStatement(statement: Statement): Promise<unknown>
  moveOn(options: { score?: Cmi5Score; disableSendTerminated?: boolean }): Promise<unknown>
  terminate(): Promise<unknown>
}

/** What happened, for a host that shows or logs it. */
export type Cmi5Event =
  | {
      type: 'initialized'
      /** A reload picked the session up; nothing was sent. */
      resumed: boolean
      launchParameters: LaunchParameters
      launchData: LaunchData
      /** What the learner set in the LMS; `audioPreference` is the page's to apply. */
      learnerPreferences: LearnerPreferences
      /** The address Exit goes to, or null. */
      returnURL: string | null
    }
  | { type: 'sent'; verb: string; statement: Statement }
  | { type: 'rejected'; verb: string; reason: string; statement?: Statement }
  | { type: 'recorded'; outcome: 'passed' | 'failed' | null }
  | { type: 'skipped'; reason: string }
  | { type: 'terminated' }
  | { type: 'unsafe-return-url'; value: string }

/** The element, or anything that dispatches its `xapi` and `finished` events and takes `src`. */
export type PlayerLike = Pick<EventTarget, 'addEventListener' | 'removeEventListener'> & {
  setAttribute(name: string, value: string): void
}

/** Where the per-launch session is kept; `localStorage` by default. */
export type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface Cmi5Options {
  /** The cmi5 client; by default `createCmi5Client` on the launch in `url`. */
  client?: Cmi5Client
  /**
   * The package to play. By default the `src` parameter of the page's address, then the AU's
   * `launchParameters` from the launch data. `false` leaves the element's `src` alone.
   */
  src?: string | false
  /** The page's address, for `src`; `location.href` by default. */
  url?: string
  /** Where the session is kept across a reload; `localStorage` by default, `null` for nowhere. */
  storage?: SessionStorage | null
  /** Told about each step. Called synchronously; a throw in it is ignored. */
  onEvent?: (event: Cmi5Event) => void
}

export interface Cmi5Session {
  readonly launchParameters: LaunchParameters
  readonly launchData: LaunchData
  /** The learner's language and audio preferences, from the LMS; empty when none were set. */
  readonly learnerPreferences: LearnerPreferences
  /** A reload picked this session up. */
  readonly resumed: boolean
  /** The package the element was given, or null when neither the address nor the launch named one. */
  readonly src: string | null
  /** The launch data's `returnURL`, when it is an http or https address. */
  readonly returnURL: string | null
  readonly terminated: boolean
  /** Sends `terminated` once; nothing is relayed after it. */
  terminate(): Promise<void>
  /** `terminate()`, then the return URL, or closes the window when there is none. */
  exit(): Promise<void>
  /** Stops listening to the element, without terminating. */
  stop(): void
}

/* ------------------------------------------------------------------ pure parts */

/** Whether this address is a cmi5 launch: all five parameters are there, the actor as JSON. */
export function isCmi5Launch(url: string = globalThis.location?.href ?? ''): boolean {
  return launchParametersOf(url) !== null
}

/**
 * The content's statement as cmi5 allows it: the launch actor in place of H5P's, the
 * registration, and the LMS's context template merged into the statement's own context: the
 * template's values win, lists in `contextActivities` are joined, the template's first. No cmi5
 * category: that would mark it as a cmi5-defined statement, which it is not. An id is added when
 * it has none that is a UUID, as every statement an AU issues needs one (9.1.0.0-1).
 */
export function allowedStatement(statement: Statement, launch: LaunchParameters, data: Pick<LaunchData, 'contextTemplate'>): Statement {
  const template = data.contextTemplate ?? {}
  const own = statement.context ?? {}
  return {
    ...statement,
    id: typeof statement.id === 'string' && UUID.test(statement.id) ? statement.id : crypto.randomUUID(),
    actor: launch.actor,
    timestamp: statement.timestamp ?? new Date().toISOString(),
    // The template's values win: the AU may add to the context, never overwrite it (10.2.1.0-7).
    context: {
      ...own,
      ...template,
      registration: launch.registration,
      contextActivities: mergeActivities(template.contextActivities, own.contextActivities),
      extensions: { ...(own.extensions ?? {}), ...(template.extensions ?? {}) }
    }
  }
}

/**
 * An H5P score as cmi5 records it. H5P reports `raw` and `max` and sometimes `scaled`; cmi5
 * requires `min` and `max` beside `raw` (requirement 9.5.1.0-3), and H5P's minimum is 0.
 * Undefined when there is nothing to scale.
 */
export function cmi5Score(score: Statement | undefined | null): Cmi5Score | undefined {
  if (!score) return undefined
  const scaled = typeof score.scaled === 'number' ? score.scaled : typeof score.raw === 'number' && score.max ? score.raw / score.max : undefined
  if (scaled === undefined) return undefined
  const hasRange = typeof score.raw === 'number' && typeof score.max === 'number'
  return { scaled, ...(hasRange ? { raw: score.raw, min: typeof score.min === 'number' ? score.min : 0, max: score.max } : {}) }
}

/** An absolute http or https address, or null: all a page may send a learner to. A `javascript:` return URL would run in the page. */
export function webAddress(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

/** What went wrong, as the LMS said it: a cmi5 launching system names the requirement a statement broke. */
export function rejectionReason(error: unknown): string {
  const data = (error as { response?: { data?: unknown } } | null)?.response?.data
  if (data && typeof data === 'object') {
    // A launching system's refusal carries `message`; a refused token, cmi5's `error-text`.
    const { message, 'error-text': errorText } = data as { message?: unknown; 'error-text'?: unknown }
    if (typeof message === 'string') return message
    return typeof errorText === 'string' ? errorText : JSON.stringify(data)
  }
  if (typeof data === 'string' && data) return data
  return error instanceof Error ? error.message : String(error)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function mergeActivities(template: Record<string, unknown[]> = {}, own: Record<string, unknown[]> = {}) {
  const merged: Record<string, unknown[]> = {}
  for (const key of ['parent', 'grouping', 'category', 'other']) {
    const list = [...(template[key] ?? []), ...(own[key] ?? [])]
    if (list.length) merged[key] = list
  }
  return merged
}

const verbOf = (statement: Statement | undefined): string => {
  const id: string = statement?.verb?.id ?? ''
  return id.slice(id.lastIndexOf('/') + 1) || '(no verb)'
}

/* ------------------------------------------------------------------ the session kept across a reload */

interface KeptSession {
  authToken: string
  initializedDate: Date
  movedOn: boolean
}

function readKept(storage: SessionStorage | null, key: string): KeptSession | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const { authToken, initializedDate, movedOn } = JSON.parse(raw)
    if (!authToken || !initializedDate) return null
    return { authToken, initializedDate: new Date(initializedDate), movedOn: Boolean(movedOn) }
  } catch {
    return null
  }
}

function writeKept(storage: SessionStorage | null, key: string, value: KeptSession): void {
  try {
    storage?.setItem(key, JSON.stringify(value))
  } catch {}
}

function forgetKept(storage: SessionStorage | null, key: string): void {
  try {
    storage?.removeItem(key)
  } catch {}
}

function defaultStorage(): SessionStorage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ the session */

/**
 * Starts the cmi5 session for this launch around the element. Listening begins at once, before
 * the handshake, because the package loads meanwhile: what the content emits before
 * `initialized` has gone out waits and is sent after it. Resolves once `initialized` is sent, or
 * the session resumed; rejects with the LMS's reason when the launch fails.
 */
export async function startCmi5(player: PlayerLike, options: Cmi5Options = {}): Promise<Cmi5Session> {
  const emit = (event: Cmi5Event) => {
    try {
      options.onEvent?.(event)
    } catch {}
  }
  const url = options.url ?? globalThis.location?.href ?? ''
  const storage = options.storage === undefined ? defaultStorage() : options.storage

  let data: LaunchData | null = null
  let launch: LaunchParameters | null = null
  let client: Cmi5Client | null = null
  let terminated = false
  let movedOn = false
  let kept: KeptSession | null = null
  let key = ''
  const pending: Statement[] = []
  let pendingFinished: Statement | null = null

  const send = async (statement: Statement) => {
    if (terminated || !client) return
    try {
      await client.sendXapiStatement(statement)
      emit({ type: 'sent', verb: verbOf(statement), statement })
    } catch (error) {
      emit({ type: 'rejected', verb: verbOf(statement), reason: rejectionReason(error), statement })
    }
  }

  const relay = (statement: Statement) => {
    if (!statement) return
    if (!data || !launch) pending.push(statement)
    else void send(allowedStatement(statement, launch, data))
  }

  /** The content finished: the outcome, the cmi5 way, once per session, reloads included. */
  const record = async (detail: Statement) => {
    if (!client || !data || movedOn || terminated) return
    movedOn = true
    if (data.launchMode !== 'Normal') {
      emit({ type: 'skipped', reason: `nothing is recorded in ${data.launchMode} mode` })
      return
    }
    const score = cmi5Score(detail?.statement?.result?.score)
    // As the client judges: `passed` or `failed` only with a score and a mastery score.
    const outcome = score && data.masteryScore ? (score.scaled >= data.masteryScore ? 'passed' : 'failed') : null
    try {
      // `terminated` is left for the host's Exit, so the learner can keep going.
      await client.moveOn({ ...(score ? { score } : {}), disableSendTerminated: true })
      if (kept) {
        kept = { ...kept, movedOn: true }
        writeKept(storage, key, kept)
      }
      emit({ type: 'recorded', outcome })
    } catch (error) {
      emit({ type: 'rejected', verb: outcome ?? 'completed', reason: rejectionReason(error) })
    }
  }

  const onXapi = (event: Event) => relay((event as CustomEvent).detail?.statement)
  const onFinished = (event: Event) => {
    const detail = (event as CustomEvent).detail
    if (data) void record(detail)
    else pendingFinished = detail
  }
  player.addEventListener('xapi', onXapi)
  player.addEventListener('finished', onFinished)
  const stop = () => {
    player.removeEventListener('xapi', onXapi)
    player.removeEventListener('finished', onFinished)
  }

  let src: string | null = null
  if (options.src !== false) {
    src = options.src ?? readSrc(url)
    if (src) player.setAttribute('src', src)
  }

  try {
    client = options.client ?? createCmi5Client({ url })
    launch = client.getLaunchParameters()
    key = `h5p-cmi5:${launch.fetch}`
    const saved = readKept(storage, key)
    movedOn = Boolean(saved?.movedOn)
    await client.initialize(saved ? { authToken: saved.authToken, initializedDate: saved.initializedDate } : undefined)
    data = client.getLaunchData()
    kept = saved ?? { authToken: client.getAuthToken(), initializedDate: client.getInitializedDate(), movedOn: false }
    if (!saved) writeKept(storage, key, kept)

    const returnURL = webAddress(data.returnURL)
    if (data.returnURL && !returnURL) emit({ type: 'unsafe-return-url', value: data.returnURL })

    if (options.src !== false && !src) {
      const fromLaunch = data.launchParameters?.trim()
      if (fromLaunch) {
        src = fromLaunch
        player.setAttribute('src', src)
      }
    }

    const learnerPreferences = client.getLearnerPreferences?.() ?? {}
    emit({ type: 'initialized', resumed: Boolean(saved), launchParameters: launch, launchData: data, learnerPreferences, returnURL })
    const boundClient = client
    const boundLaunch = launch
    const boundData = data

    for (const statement of pending.splice(0)) void send(allowedStatement(statement, boundLaunch, boundData))
    if (pendingFinished) void record(pendingFinished)

    const terminate = async () => {
      if (terminated) return
      try {
        await boundClient.terminate()
        emit({ type: 'terminated' })
      } catch (error) {
        emit({ type: 'rejected', verb: 'terminated', reason: rejectionReason(error) })
      }
      terminated = true
      forgetKept(storage, key)
      stop()
    }

    return {
      launchParameters: boundLaunch,
      launchData: boundData,
      learnerPreferences,
      resumed: Boolean(saved),
      src,
      returnURL,
      get terminated() {
        return terminated
      },
      terminate,
      async exit() {
        await terminate()
        if (returnURL) globalThis.location?.assign(returnURL)
        else globalThis.close?.()
      },
      stop
    }
  } catch (error) {
    stop()
    throw new Error(rejectionReason(error))
  }
}

function readSrc(url: string): string | null {
  try {
    return new URL(url).searchParams.get('src')?.trim() || null
  } catch {
    return null
  }
}
