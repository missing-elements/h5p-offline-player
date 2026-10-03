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
 * `abandoned`. The single-use token stays in memory by default, so a reload must be launched
 * again by the LMS; a trusted host may opt into storing it across reloads.
 */

import { createCmi5Client, launchParametersOf } from './client.js'
import { ReadyPhase } from './ready-phase.js'
import { adaptPlayerStatement, allowedStatement as adaptAllowedStatement } from './statement-adapter.js'

export { Cmi5RequestError, createCmi5Client, isoDuration, judge, launchParametersOf, type Cmi5ClientOptions } from './client.js'

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

/**
 * What earlier sessions of this registration recorded, read from the LRS on `initialize`. With
 * `unread`, the LRS would not say, and the two flags only count this session.
 */
export interface RegistrationHistory {
  completed: boolean
  passed: boolean
  unread?: string
}

/** A score as cmi5 records it: `min` and `max` are required beside `raw`. */
export interface Cmi5Score {
  scaled: number
  raw?: number
  min?: number
  max?: number
}

/** What `moveOn()` sent to the LRS in this call. */
export interface MoveOnResult {
  outcome: 'passed' | 'failed' | null
  completed: boolean
}

/** A cmi5 client, as `createCmi5Client` makes one. Another one — a simulated LMS, a test double — can be passed as `client`. */
export interface Cmi5Client {
  getLaunchParameters(): LaunchParameters
  getLaunchData(): LaunchData
  getAuthToken(): string
  getInitializedDate(): Date
  /** The learner's preferences, read on `initialize`; a client without them reports none. */
  getLearnerPreferences?(): LearnerPreferences
  /** What the registration already holds; a client without it leaves `moveOn` to decide alone. */
  getRegistrationHistory?(): RegistrationHistory
  initialize(state?: { authToken: string; initializedDate: Date }): Promise<unknown>
  sendXapiStatement(statement: Statement): Promise<unknown>
  /**
   * `passed` or `failed`, then `completed`, then `terminated` unless disabled. `success` is the
    * content's own verdict, used when the launch has no mastery score. Resolves with only what
    * this call successfully sent.
   */
  moveOn(options: { score?: Cmi5Score; success?: boolean; disableSendTerminated?: boolean }): Promise<MoveOnResult>
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
  | {
      type: 'recorded'
      /** `passed` or `failed` went out now; null when there was no mastery score, or the registration had passed. */
      outcome: 'passed' | 'failed' | null
      /** `completed` went out now; false when an earlier session of the registration sent it. */
      completed: boolean
    }
  | {
      type: 'registration-unread'
      /** Why the LRS did not say what earlier sessions recorded; `completed` and `passed` are then kept once per session only. */
      reason: string
    }
  | { type: 'skipped'; reason: string }
  | { type: 'terminated' }
  | { type: 'unsafe-return-url'; value: string }

/** The element, or anything that dispatches its `xapi` and `finished` events and takes `src`. */
export type PlayerLike = Pick<EventTarget, 'addEventListener' | 'removeEventListener'> & {
  setAttribute(name: string, value: string): void
}

/** Where the per-launch session is kept; `null` by default. */
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
  /** Where the session is kept across a reload; `null` by default. */
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
  /** Retries a completion outcome that the LRS did not accept. */
  retry(): Promise<void>
  /**
   * `terminate()`, then the return URL. With none, it closes the window, if the page is top level;
   * a frame cannot close the LMS page around it, so a framed page stays where it is.
   */
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
  return adaptAllowedStatement(statement, launch, data)
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

const verbOf = (statement: Statement | undefined): string => {
  const id: string = statement?.verb?.id ?? ''
  return id.slice(id.lastIndexOf('/') + 1) || '(no verb)'
}

/* ------------------------------------------------------------------ the session kept across a reload */

interface KeptSession {
  authToken: string
  initializedDate: Date
  movedOn: boolean
  pendingOutcome?: Outcome
}

interface Outcome {
  score?: Cmi5Score
  success?: boolean
}

function readKept(storage: SessionStorage | null, key: string): KeptSession | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const { authToken, initializedDate, movedOn, pendingOutcome } = JSON.parse(raw)
    if (!authToken || !initializedDate) return null
    return { authToken, initializedDate: new Date(initializedDate), movedOn: Boolean(movedOn), ...(pendingOutcome ? { pendingOutcome } : {}) }
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
  // H5P libraries run in a same-origin frame, so browser storage would expose an LRS token to
  // package code. A host must explicitly opt in when it can protect its chosen storage.
  const storage = options.storage ?? null

  let data: LaunchData | null = null
  let launch: LaunchParameters | null = null
  let client: Cmi5Client | null = null
  let terminated = false
  let termination: Promise<void> | null = null
  let movedOn = false
  let recording = false
  let kept: KeptSession | null = null
  let key = ''
  const readyPhase = new ReadyPhase<Statement, Outcome>()
  let pendingOutcome: Outcome | null = null

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
    const readyStatement = readyPhase.statement(statement)
    if (readyStatement) sendPlayerStatement(readyStatement)
  }

  const sendPlayerStatement = (statement: Statement) => {
    if (!launch || !data) return
    const adapted = adaptPlayerStatement(statement, launch, data)
    if ('reason' in adapted) {
      emit({ type: 'rejected', verb: verbOf(statement), reason: adapted.reason, statement })
      return
    }
    void send(adapted.statement)
  }

  /**
   * The content finished: the outcome, the cmi5 way. Once per session, reloads included, and
   * once per registration as far as the LRS says: what an earlier session sent is not sent again.
   */
  const record = async () => {
    if (!client || !data || !pendingOutcome || movedOn || recording || terminated) return
    recording = true
    if (data.launchMode !== 'Normal') {
      emit({ type: 'skipped', reason: `nothing is recorded in ${data.launchMode} mode` })
      recording = false
      return
    }
    const { score, success } = pendingOutcome
    try {
      // `terminated` is left for the host's Exit, so the learner can keep going.
      const result = await client.moveOn({ ...(score ? { score } : {}), ...(success === undefined ? {} : { success }), disableSendTerminated: true })
      movedOn = true
      pendingOutcome = null
      keepMovedOn()
      if (!result.outcome && !result.completed) {
        emit({ type: 'skipped', reason: 'this registration already recorded its result in an earlier session' })
      } else {
        emit({ type: 'recorded', ...result })
      }
    } catch (error) {
      emit({ type: 'rejected', verb: 'move-on', reason: rejectionReason(error) })
    } finally {
      recording = false
    }
  }

  const keepMovedOn = () => {
    if (!kept) return
    kept = { ...kept, movedOn: true, pendingOutcome: undefined }
    writeKept(storage, key, kept)
  }

  const keepPendingOutcome = () => {
    if (!kept || !pendingOutcome) return
    kept = { ...kept, pendingOutcome }
    writeKept(storage, key, kept)
  }

  const onXapi = (event: Event) => relay((event as CustomEvent).detail?.statement)
  const onFinished = (event: Event) => {
    const detail = (event as CustomEvent).detail
    const result = detail?.statement?.result
    const outcome: Outcome = {
      ...(cmi5Score(result?.score) ? { score: cmi5Score(result.score) } : {}),
      ...(typeof result?.success === 'boolean' ? { success: result.success as boolean } : {})
    }
    const readyOutcome = readyPhase.outcome(outcome)
    if (!readyOutcome) return
    pendingOutcome = readyOutcome
    keepPendingOutcome()
    void record()
  }
  player.addEventListener('xapi', onXapi)
  player.addEventListener('finished', onFinished)
  const stop = () => {
    player.removeEventListener('xapi', onXapi)
    player.removeEventListener('finished', onFinished)
    readyPhase.stop()
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
    pendingOutcome = saved?.pendingOutcome ?? pendingOutcome
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
    const unread = client.getRegistrationHistory?.().unread
    if (unread) emit({ type: 'registration-unread', reason: unread })
    emit({ type: 'initialized', resumed: Boolean(saved), launchParameters: launch, launchData: data, learnerPreferences, returnURL })
    const boundClient = client
    const boundLaunch = launch
    const boundData = data

    const buffered = readyPhase.ready()
    pendingOutcome = saved?.pendingOutcome ?? buffered.outcome ?? pendingOutcome
    for (const statement of buffered.statements) sendPlayerStatement(statement)
    if (pendingOutcome) void record()

    const terminate = (): Promise<void> => {
      if (terminated) return Promise.resolve()
      if (termination) return termination
      termination = boundClient.terminate().then(
        () => {
          terminated = true
          forgetKept(storage, key)
          stop()
          emit({ type: 'terminated' })
        },
        (error) => {
          emit({ type: 'rejected', verb: 'terminated', reason: rejectionReason(error) })
          throw error
        }
      ).finally(() => {
        if (!terminated) termination = null
      })
      return termination
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
      retry: record,
      async exit() {
        await terminate()
        if (returnURL) globalThis.location?.assign(returnURL)
        else if (globalThis.top === globalThis.self) globalThis.close?.()
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
