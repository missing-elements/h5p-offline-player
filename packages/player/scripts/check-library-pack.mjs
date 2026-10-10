/**
 * Refuses to publish a player whose `libraries="pack"` names a library pack that is not on npm.
 * The version is stamped from packages/libraries, which the weekly refresh bumps on a branch; a
 * player released after merging that branch but before publishing the pack would send every
 * stripped export to a 404.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const constants = await readFile(resolve(import.meta.dirname, '..', 'src', 'shared', 'constants.ts'), 'utf8')
const version = /export const LIBRARY_PACK_VERSION = '([^']+)'/.exec(constants)?.[1]
if (!version) {
  console.error('[library-pack] LIBRARY_PACK_VERSION not found in src/shared/constants.ts')
  process.exit(1)
}

const response = await fetch(`https://registry.npmjs.org/@missing-elements%2fh5p-libraries/${version}`)
if (!response.ok) {
  console.error(
    `[library-pack] @missing-elements/h5p-libraries@${version} is not on npm (${response.status}). ` +
      'Publish it from packages/libraries first: libraries="pack" names it.'
  )
  process.exit(1)
}
console.log(`[library-pack] @missing-elements/h5p-libraries@${version} is published`)
