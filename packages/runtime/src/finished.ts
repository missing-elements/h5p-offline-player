/**
 * Whether an xAPI statement is the content's result, which the element raises as `finished`: a
 * `completed` or an `answered` statement from the content itself, not from a part inside it. A
 * single question only ever says `answered`; a question set says `answered` for each question,
 * each with the set as its parent, and `completed` for itself. Up to runtime 0.2.1 the boot script
 * took any `completed`, parent or not, and never `answered`, so a single question never finished
 * and a quiz inside a Column finished before the Column did. A question checked again says
 * `answered` again, so this can hold for several statements of one load; the last is the result.
 *
 * H5P's own rule, `H5P.xAPICompletedListener` in the core, which the CMS plugins record through
 * `setFinished`, tells a part by `context.contextActivities.parent` alone. Some content types
 * create their parts without one: Interactive Book 1.15 its chapters (`{ parent: self }`, the
 * window in that scope), Game Map 1.5 its exercises, Virtual Tour 0.5 its interactions. So a part's
 * statement is also told by what the core writes on every statement from sub-content and never on
 * the content's own: the `h5p-subContentId` extension on its object. Measured on 2026-10-14,
 * every statement with a parent across the library pack carries it as well. Up to runtime 0.2.2
 * the parent alone decided, and a book's chapter or a map's exercise finished the content.
 */

const RESULT_VERBS = new Set(['http://adlnet.gov/expapi/verbs/completed', 'http://adlnet.gov/expapi/verbs/answered'])

/** The core's mark on a statement from sub-content, written by `XAPIEvent.setObject`. */
export const SUB_CONTENT_EXTENSION = 'http://h5p.org/x-api/h5p-subContentId'

interface StatementLike {
  verb?: { id?: unknown }
  object?: { definition?: { extensions?: Record<string, unknown> } }
  context?: { contextActivities?: { parent?: unknown } }
}

export function isResult(statement: unknown): boolean {
  if (!statement || typeof statement !== 'object') return false
  const { verb, object, context } = statement as StatementLike
  // Truthiness, as the core's `getVerifiedStatementValue` check has it: an empty list still names
  // a parent.
  if (context?.contextActivities?.parent) return false
  if (object?.definition?.extensions?.[SUB_CONTENT_EXTENSION]) return false
  return typeof verb?.id === 'string' && RESULT_VERBS.has(verb.id)
}
