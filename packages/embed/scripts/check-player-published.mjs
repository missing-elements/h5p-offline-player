/**
 * Refuses to publish the embed package while the player it pins is not on npm, or is there without
 * `./plan`, which the SCORM writer imports. The dependency is `workspace:*` since #109, published
 * as the exact version packages/player has, because `./plan` is not covered by
 * docs/compatibility.md: a release made before the player's would not install, and one pinned to a
 * player published before `./plan` existed would install and fail on its first import.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const { version } = JSON.parse(await readFile(resolve(import.meta.dirname, '..', '..', 'player', 'package.json'), 'utf8'))
const response = await fetch(`https://registry.npmjs.org/@missing-elements%2fh5p-offline-player/${version}`)
if (!response.ok) {
  console.error(`[player] @missing-elements/h5p-offline-player@${version} is not on npm (${response.status}). Publish it from packages/player first: the embed package pins it, for its ./plan.`)
  process.exit(1)
}
if (!(await response.json()).exports?.['./plan']) {
  console.error(`[player] @missing-elements/h5p-offline-player@${version} on npm does not export ./plan, which the SCORM writer imports: bump the player's version, publish it, and publish the embed package against that.`)
  process.exit(1)
}
console.log(`[player] @missing-elements/h5p-offline-player@${version} is published, and exports ./plan`)
