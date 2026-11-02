/**
 * Refuses to publish the embed package while what it imports from two packages of this repository is
 * not on npm: the player's `./plan`, which the SCORM writer plans with, and the normalizer's
 * `./crc32`, which it writes the stored entries' CRC with. The player is pinned exactly, `workspace:*`
 * since #109, because `./plan` is not covered by docs/compatibility.md: a release made before the
 * player's would not install, and one pinned to a player published before `./plan` existed would
 * install and fail on its first import. The normalizer is `workspace:^`, published as a range from
 * the version packages/normalize has, so that version has to be on npm with `./crc32` (#108).
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * @param {string} folder the package's folder under packages/
 * @param {string} name
 * @param {string} subpath the export the embed package imports
 * @param {string} why what imports it
 */
async function published(folder, name, subpath, why) {
  const { version } = JSON.parse(await readFile(resolve(import.meta.dirname, '..', '..', folder, 'package.json'), 'utf8'))
  const response = await fetch(`https://registry.npmjs.org/${name.replaceAll('/', '%2f')}/${version}`)
  if (!response.ok) {
    console.error(`[${folder}] ${name}@${version} is not on npm (${response.status}). Publish it from packages/${folder} first: the embed package depends on it, for its ${subpath}.`)
    process.exit(1)
  }
  if (!(await response.json()).exports?.[subpath]) {
    console.error(`[${folder}] ${name}@${version} on npm does not export ${subpath}, which ${why} imports: bump its version, publish it, and publish the embed package against that.`)
    process.exit(1)
  }
  console.log(`[${folder}] ${name}@${version} is published, and exports ${subpath}`)
}

await published('player', '@missing-elements/h5p-offline-player', './plan', 'the SCORM writer')
await published('normalize', '@missing-elements/h5p-normalize', './crc32', 'the SCORM writer')
