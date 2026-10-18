/**
 * Refuses to publish a player whose `libraries="pack"` names a library pack that is not on npm,
 * or one published with another index than this checkout's. The version is stamped from
 * packages/libraries, which the weekly refresh bumps on a branch; a player released after merging
 * that branch but before publishing the pack would send every stripped export to a 404. And the
 * worker carries this checkout's `parts/index.json` (`PACK_INDEX`) and refuses a part whose hash
 * it does not name, so a pack published from other bytes would be refused part by part.
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

// From jsDelivr, where `pack` fetches the parts from.
const index = await fetch(`https://cdn.jsdelivr.net/npm/@missing-elements/h5p-libraries@${version}/parts/index.json`)
const local = await readFile(resolve(import.meta.dirname, '..', '..', 'libraries', 'parts', 'index.json'), 'utf8')
const same = index.ok && JSON.stringify((await index.json()).libraries) === JSON.stringify(JSON.parse(local).libraries)
if (!same) {
  console.error(
    `[library-pack] @missing-elements/h5p-libraries@${version} on jsDelivr ${index.ok ? 'has another parts/index.json than' : 'has no parts/index.json, unlike'} ` +
      "this checkout. The worker checks every part against this checkout's index: publish the pack from this checkout, under a new version."
  )
  process.exit(1)
}
console.log(`[library-pack] @missing-elements/h5p-libraries@${version} is published, with this checkout's index`)
