/**
 * Brings content written for an older minor version of a library up to the minor that is served.
 *
 * The player serves a newer minor of a library when the exact one is absent, which is always the
 * case for a stripped export played against the library pack: the pack keeps one minor per major.
 * A library's `upgrades.js` holds a step for each minor that changed the shape of its parameters,
 * and the platforms run those steps before content written for an earlier minor is shown against
 * a later one, so a library's own code assumes they have run. Without them, Question Set 1.20
 * content loses its background image under 1.21, which reads it from `override.backgroundImage`.
 * This runs the steps in the frame, before the runtime starts, by the rules of H5P's own
 * `h5p-content-upgrade-process.js` from h5p-php-library: the steps after the content's minor up
 * to the served one, in order, each handed the parameters, a callback and `{ metadata }`, the
 * object form `{ contentUpgrade }` accepted beside a bare function, and any failure leaving the
 * content as it was written.
 *
 * Two things differ from that file. Each library is brought to the version served, not to the
 * one its parent's semantics name, because what is served is what runs. And sub-content is found
 * by its shape — an object whose `library` is `"<machineName> <major>.<minor>"` beside a `params`
 * object — rather than by walking each library's semantics, so a parent that did not change still
 * has its children upgraded, and no `semantics.json` is read.
 */
import { MAX_DEPTH, libraryKey, librariesIn, parseLibrary } from './library-names'


export interface LibraryVersion {
  major: number
  minor: number
}

/** A served version and the folder it is served from, which is where its `upgrades.js` would be. */
export interface ServedLibrary extends LibraryVersion {
  folder: string
}

type Finished = (error?: unknown, params?: unknown, extras?: { metadata?: unknown }) => void
type UpgradeStep = (params: unknown, finished: Finished, extras: { metadata?: unknown }) => void

/** What a library's `upgrades.js` puts in `H5PUpgrades[machineName]`: its steps by major, then by minor. */
export type UpgradeTable = Record<string, Record<string, UpgradeStep | { contentUpgrade?: UpgradeStep } | undefined> | undefined>

export interface UpgradeSource {
  /**
   * The version served for a library the content names at `wanted`, or `null` when none is. A
   * rejection — the answer could not be had — fails the whole upgrade, as a failed step does.
   */
  served(machineName: string, wanted: LibraryVersion): Promise<ServedLibrary | null>
  /** The upgrade steps of a served version, or `null` when it has none. */
  steps(machineName: string, library: ServedLibrary): Promise<UpgradeTable | null>
}

export interface UpgradeResult {
  params: unknown
  metadata: unknown
  /** The main library as the runtime should name it, `"<machineName> <major>.<minor>"` of the version served. */
  library: string | null
  /** Whether a step ran or a sub-content's version changed, so the parameters need writing back. */
  changed: boolean
}

/**
 * How long a single step may take to call back. Steps are synchronous rewrites of a JSON tree in
 * practice; one that never calls back would otherwise hold the content back for good.
 */
const STEP_TIMEOUT_MS = 3000

/** A newer minor of the same major: the only move the player's file server makes for a library. */
const isUpgrade = (from: LibraryVersion, to: LibraryVersion) => to.major === from.major && to.minor > from.minor

const libraryString = (machineName: string, version: LibraryVersion) => libraryKey({ machineName, major: version.major, minor: version.minor })

/**
 * Upgrades the main content and every sub-content in it. Rejects on the first step that fails,
 * with the parameters it was given left in an unknown state, so the caller keeps its own copy.
 */
export async function upgradeContent(
  main: { machineName: string; version: LibraryVersion },
  params: unknown,
  metadata: unknown,
  source: UpgradeSource,
  timeoutMs = STEP_TIMEOUT_MS
): Promise<UpgradeResult> {
  // Every library the parameters name is looked up at once, the main one with them; the walk
  // below then finds each answer waiting rather than asking one library at a time.
  const [served] = await Promise.all([
    source.served(main.machineName, main.version),
    ...librariesIn(params).map((library) => source.served(library.machineName, { major: library.major, minor: library.minor }))
  ])
  let changed = false
  if (served && isUpgrade(main.version, served)) {
    const steps = await source.steps(main.machineName, served)
    if (steps) {
      ;({ params, metadata } = await runSteps(steps, main.version, served, params, metadata, timeoutMs))
    }
    changed = true
  }
  if (await upgradeSubContent(params, source, timeoutMs, 0)) changed = true

  return { params, metadata, library: served ? libraryString(main.machineName, served) : null, changed }
}

/** Runs the steps after `from` up to and including `to`, lowest first. */
export async function runSteps(
  table: UpgradeTable,
  from: LibraryVersion,
  to: LibraryVersion,
  params: unknown,
  metadata: unknown,
  timeoutMs = STEP_TIMEOUT_MS
): Promise<{ params: unknown; metadata: unknown }> {
  const minors = table[String(to.major)]
  if (!minors || from.major !== to.major) return { params, metadata }

  // By the keys as written, ordered as numbers: "10" sorts before "2" as text.
  const due = Object.keys(minors)
    .filter((key) => Number(key) > from.minor && Number(key) <= to.minor)
    .sort((a, b) => Number(a) - Number(b))

  for (const key of due) {
    const entry = minors[key]
    const step = typeof entry === 'function' ? entry : entry?.contentUpgrade
    if (typeof step !== 'function') throw new Error(`the step to ${to.major}.${key} is not a function`)
    ;({ params, metadata } = await runStep(step, params, metadata, timeoutMs, `${to.major}.${key}`))
  }
  return { params, metadata }
}

function runStep(
  step: UpgradeStep,
  params: unknown,
  metadata: unknown,
  timeoutMs: number,
  label: string
): Promise<{ params: unknown; metadata: unknown }> {
  return new Promise((resolve, reject) => {
    // The first answer counts: a step may call back and then throw, or call back twice.
    let settled = false
    const finish = (error: unknown, result?: { params: unknown; metadata: unknown }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (result) resolve(result)
      else reject(error instanceof Error ? error : new Error(`the step to ${label} failed: ${String(error)}`))
    }
    const timer = setTimeout(() => finish(new Error(`the step to ${label} did not finish in ${timeoutMs} ms`)), timeoutMs)

    try {
      step(
        params,
        (error, upgraded, extras) => {
          if (error) return finish(error)
          // A step that hands back nothing would leave the content with no parameters at all.
          if (upgraded === undefined || upgraded === null) return finish(new Error(`the step to ${label} returned no parameters`))
          finish(undefined, { params: upgraded, metadata: extras && extras.metadata ? extras.metadata : metadata })
        },
        { metadata }
      )
    } catch (error) {
      finish(error)
    }
  })
}

/** Finds sub-content anywhere in the tree, upgrades it, then looks inside what it became. */
async function upgradeSubContent(value: unknown, source: UpgradeSource, timeoutMs: number, depth: number): Promise<boolean> {
  if (depth > MAX_DEPTH || !value || typeof value !== 'object') return false

  let changed = false
  if (Array.isArray(value)) {
    for (const item of value) {
      if (await upgradeSubContent(item, source, timeoutMs, depth + 1)) changed = true
    }
    return changed
  }

  const node = value as Record<string, unknown>
  const named = parseLibrary(node.library)
  if (named && node.params && typeof node.params === 'object') {
    const machineName = named.machineName
    const wanted = { major: named.major, minor: named.minor }
    const served = await source.served(machineName, wanted)
    if (served && isUpgrade(wanted, served)) {
      const steps = await source.steps(machineName, served)
      if (steps) {
        const upgraded = await runSteps(steps, wanted, served, node.params, node.metadata, timeoutMs)
        node.params = upgraded.params
        if (upgraded.metadata !== undefined) node.metadata = upgraded.metadata
      }
      node.library = libraryString(machineName, served)
      changed = true
    }
    if (await upgradeSubContent(node.params, source, timeoutMs, depth + 1)) changed = true
    return changed
  }

  for (const child of Object.values(node)) {
    if (await upgradeSubContent(child, source, timeoutMs, depth + 1)) changed = true
  }
  return changed
}

