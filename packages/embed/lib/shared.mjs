/**
 * What every entry of the package shares and no Node import: the error the command and the
 * functions throw, and the player's files by name. `build.mjs` re-exports the error, so a caller
 * of `@missing-elements/h5p-embed` finds it where it did; the SCORM builder that runs in a page
 * takes both from here, since `build.mjs` imports `node:fs`.
 */

export class EmbedError extends Error {}

/**
 * The player's files, by the names the element looks for beside itself.
 * @internal
 */
export const PLAYER_FILES = ['h5p-player.js', 'h5p-sw.js', 'h5p-jobs.js']
