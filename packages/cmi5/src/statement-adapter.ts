import type { LaunchData, LaunchParameters, Statement } from './index.js'

export type StatementAdaptation =
  | { statement: Statement }
  | { reason: string }

/**
 * Makes a statement cmi5 allows: the launch actor, registration and context template take
 * precedence, while the player-provided revision and platform remain in its context.
 */
export function allowedStatement(statement: Statement, launch: LaunchParameters, data: Pick<LaunchData, 'contextTemplate'>): Statement {
  const template = data.contextTemplate ?? {}
  const own = statement.context ?? {}
  return {
    ...statement,
    id: typeof statement.id === 'string' && UUID.test(statement.id) ? statement.id : crypto.randomUUID(),
    actor: launch.actor,
    timestamp: utcTimestamp(statement.timestamp),
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
 * Adapts only the Activity statements the player has stamped with its build provenance. Other
 * statements cannot make the build that produced them auditable, so cmi5 reports and drops them.
 */
export function adaptPlayerStatement(statement: Statement, launch: LaunchParameters, data: Pick<LaunchData, 'contextTemplate'>): StatementAdaptation {
  const object = statement?.object
  const objectType = object && typeof object === 'object' ? (object as { objectType?: unknown }).objectType : undefined
  if (!object || typeof object !== 'object' || (objectType !== undefined && objectType !== 'Activity')) {
    return { reason: 'the player statement does not describe an Activity' }
  }
  const context = statement.context
  if (!context || typeof context.revision !== 'string' || !context.revision) {
    return { reason: 'the player statement has no context.revision' }
  }
  if (typeof context.platform !== 'string' || !context.platform) {
    return { reason: 'the player statement has no context.platform' }
  }
  return { statement: allowedStatement(statement, launch, data) }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function utcTimestamp(value: unknown): string {
  const time = typeof value === 'string' ? Date.parse(value) : NaN
  return new Date(Number.isNaN(time) ? Date.now() : time).toISOString()
}

function mergeActivities(template: Record<string, unknown[]> = {}, own: Record<string, unknown[]> = {}) {
  const merged: Record<string, unknown[]> = {}
  for (const key of ['parent', 'grouping', 'category', 'other']) {
    const list = [...(template[key] ?? []), ...(own[key] ?? [])]
    if (list.length) merged[key] = list
  }
  return merged
}