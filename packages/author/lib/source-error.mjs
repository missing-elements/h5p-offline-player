/**
 * The error every step of a build throws for what a source got wrong, in a module of its own with
 * no Node import, so that the steps that need no Node import of their own can throw it.
 */

/**
 * @typedef {{ path: string, message: string }} Problem
 */

/** A source's problems, all of them, each named by its path. */
export class SourceError extends Error {
  /** @param {Problem[]} problems */
  constructor(problems) {
    super(`The source has ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n${problems.map(({ path, message }) => `  ${path}: ${message}`).join('\n')}`)
    this.name = 'SourceError'
    this.problems = problems
  }
}
