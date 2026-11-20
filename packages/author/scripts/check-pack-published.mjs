/**
 * Refuses to publish the author package while what it pins is not on npm. Both pins are
 * `workspace:*`, which pnpm publishes as the exact version the workspace has. The library pack:
 * after the weekly refresh bumps it, a release made before the pack is published would not
 * install, and one built against other parts would check them against an index npm does not
 * serve. The player, whose `./plan` the build imports: a release made before the player's would
 * not install either, and one pinned to a player published before `./plan` existed would install
 * and fail on its first import, so the version on npm has to export it. And the normalizer, a
 * range from the version packages/normalize has, whose `./crc32` the page's build imports (#108):
 * that version has to be on npm with it, or a page's build fails on its first import. The page's
 * build also imports `faststartPlan` from its `./mp4` (#218), which npm's record of a version does
 * not list, so the version itself is held to the first that has it.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { served, stopUnlessAnswered, waitUntil } from '../../../scripts/published.mjs'

const packages = resolve(import.meta.dirname, '..', '..')
/** @param {string} directory */
const versionOf = async (directory) => JSON.parse(await readFile(resolve(packages, directory, 'package.json'), 'utf8')).version

// One wait for all four, in CI, where each was published moments before in the same run (#253).
const until = waitUntil()

const version = await versionOf('libraries')
const response = await served(`https://registry.npmjs.org/@missing-elements%2fh5p-libraries/${version}`, `@missing-elements/h5p-libraries@${version}`, { until })
stopUnlessAnswered(response, `@missing-elements/h5p-libraries@${version} on npm`)
if (!response.ok) {
  console.error(`[library-pack] @missing-elements/h5p-libraries@${version} is not on npm (${response.status}). Publish it from packages/libraries first: the author package pins it.`)
  process.exit(1)
}
const index = await served(`https://cdn.jsdelivr.net/npm/@missing-elements/h5p-libraries@${version}/parts/index.json`, `h5p-libraries@${version}/parts/index.json on jsDelivr`, { until })
stopUnlessAnswered(index, `h5p-libraries@${version}/parts/index.json on jsDelivr`)
const local = await readFile(resolve(packages, 'libraries', 'parts', 'index.json'), 'utf8')
const same = index.ok && JSON.stringify((await index.json()).libraries) === JSON.stringify(JSON.parse(local).libraries)
if (!same) {
  console.error(
    `[library-pack] @missing-elements/h5p-libraries@${version} on jsDelivr ${index.ok ? 'has another parts/index.json than' : 'has no parts/index.json, unlike'} this checkout: ` +
      'publish the pack from this checkout, under a new version.'
  )
  process.exit(1)
}
console.log(`[library-pack] @missing-elements/h5p-libraries@${version} is published, with this checkout's index`)

const player = await versionOf('player')
const published = await served(`https://registry.npmjs.org/@missing-elements%2fh5p-offline-player/${player}`, `@missing-elements/h5p-offline-player@${player}`, { until })
stopUnlessAnswered(published, `@missing-elements/h5p-offline-player@${player} on npm`)
if (!published.ok) {
  console.error(`[player] @missing-elements/h5p-offline-player@${player} is not on npm (${published.status}). Publish it from packages/player first: the author package pins it, for its ./plan.`)
  process.exit(1)
}
if (!(await published.json()).exports?.['./plan']) {
  console.error(`[player] @missing-elements/h5p-offline-player@${player} on npm does not export ./plan, which the build imports: bump the player's version, publish it, and publish the author package against that.`)
  process.exit(1)
}
console.log(`[player] @missing-elements/h5p-offline-player@${player} is published, and exports ./plan`)

const normalize = await versionOf('normalize')
// The first with `faststartPlan` in `./mp4`. The range published is from packages/normalize's
// version, so one below this would let the author install beside a normalizer without it.
const NORMALIZER_FLOOR = [1, 5, 0]
const [major, minor, patch] = normalize.split('.').map(Number)
if (major === NORMALIZER_FLOOR[0] && (minor < NORMALIZER_FLOOR[1] || (minor === NORMALIZER_FLOOR[1] && patch < NORMALIZER_FLOOR[2]))) {
  console.error(`[normalize] packages/normalize is ${normalize}, and the page's build imports faststartPlan from its ./mp4, new in ${NORMALIZER_FLOOR.join('.')}: bump the normalizer to that, publish it, and publish the author package against it.`)
  process.exit(1)
}
const normalizer = await served(`https://registry.npmjs.org/@missing-elements%2fh5p-normalize/${normalize}`, `@missing-elements/h5p-normalize@${normalize}`, { until })
stopUnlessAnswered(normalizer, `@missing-elements/h5p-normalize@${normalize} on npm`)
if (!normalizer.ok) {
  console.error(`[normalize] @missing-elements/h5p-normalize@${normalize} is not on npm (${normalizer.status}). Publish it from packages/normalize first: the author package depends on it, for its ./crc32.`)
  process.exit(1)
}
if (!(await normalizer.json()).exports?.['./crc32']) {
  console.error(`[normalize] @missing-elements/h5p-normalize@${normalize} on npm does not export ./crc32, which the page's build imports: bump the normalizer's version, publish it, and publish the author package against that.`)
  process.exit(1)
}
console.log(`[normalize] @missing-elements/h5p-normalize@${normalize} is published, and exports ./crc32`)
