/**
 * Whether an xAPI statement is the content's result, which the element raises as `finished`.
 * H5P's own rule, `H5P.xAPICompletedListener` in the core, which is what the CMS plugins record
 * through `setFinished`: a `completed` or an `answered` statement with no
 * `context.contextActivities.parent` — from the content itself, not from a part inside it. A
 * single question only ever says `answered`; a question set says `answered` for each question,
 * each with the set as its parent, and `completed` for itself. Up to runtime 0.2.1 the boot script
 * took any `completed`, parent or not, and never `answered`, so a single question never finished
 * and a quiz inside a Column finished before the Column did. A question checked again says
 * `answered` again, so this can hold for several statements of one load; the last is the result.
 */

const RESULT_VERBS = new Set(['http://adlnet.gov/expapi/verbs/completed', 'http://adlnet.gov/expapi/verbs/answered'])

interface StatementLike {
  verb?: { id?: unknown }
  context?: { contextActivities?: { parent?: unknown } }
}

export function isResult(statement: unknown): boolean {
  if (!statement || typeof statement !== 'object') return false
  const { verb, context } = statement as StatementLike
  // Truthiness, as the core's `getVerifiedStatementValue` check has it: an empty list still names
  // a parent.
  return typeof verb?.id === 'string' && RESULT_VERBS.has(verb.id) && !context?.contextActivities?.parent
}
