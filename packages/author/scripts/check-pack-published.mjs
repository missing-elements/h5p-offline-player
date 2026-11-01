/**
 * Refuses to publish the author package while the library pack it pins is not on npm, or is there
 * with another index than this checkout's. The dependency is `workspace:*`, which pnpm publishes
 * as the exact version packages/libraries has: after the weekly refresh bumps it, a release made
 * before the pack is published would not install, and one built against other parts would check
 * them against an index npm does not serve.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const libraries = resolve(import.meta.dirname, '..', '..', 'libraries')
const { version } = JSON.parse(await readFile(resolve(libraries, 'package.json'), 'utf8'))

const response = await fetch(`https://registry.npmjs.org/@missing-elements%2fh5p-libraries/${version}`)
if (!response.ok) {
  console.error(`[library-pack] @missing-elements/h5p-libraries@${version} is not on npm (${response.status}). Publish it from packages/libraries first: the author package pins it.`)
  process.exit(1)
}
const index = await fetch(`https://cdn.jsdelivr.net/npm/@missing-elements/h5p-libraries@${version}/parts/index.json`)
const local = await readFile(resolve(libraries, 'parts', 'index.json'), 'utf8')
const same = index.ok && JSON.stringify((await index.json()).libraries) === JSON.stringify(JSON.parse(local).libraries)
if (!same) {
  console.error(`[library-pack] @missing-elements/h5p-libraries@${version} on npm has another parts/index.json than this checkout: publish the pack from this checkout, under a new version.`)
  process.exit(1)
}
console.log(`[library-pack] @missing-elements/h5p-libraries@${version} is published, with this checkout's index`)
