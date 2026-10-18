import { cp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DIST_DIR as RUNTIME_DIST, buildRuntime } from '../../runtime/scripts/build.mjs'

/**
 * Brings the runtime the frame needs to where dev and the tests serve it from, and stamps the
 * package version into the sources that carry it.
 *
 * The runtime is `@missing-elements/h5p-runtime`, a package of its own because it is GPL-3.0 and
 * this one is MIT; this script builds it and copies its `dist/` to `public/frame-assets/`, which
 * is the layout the element looks for beside itself when told nothing — the one `dist/` of a
 * published player has *not* got, by design: a host installs the runtime, serves it or copies it,
 * and the player's own package carries none of it. Nothing under `public/` is in git.
 *
 * It also writes `src/frame-fonts.ts`, the names of the text faces the runtime's stylesheet
 * declares: the frame document writes their `@font-face` rules against an `assets-base`, so the
 * element has to know the file names, and the list comes from the runtime's manifest so that the
 * two cannot drift apart within one checkout.
 */

const rootDir = resolve(import.meta.dirname, '..')

const exists = async (path) => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const packageJson = JSON.parse(await readFile(resolve(rootDir, 'package.json'), 'utf8'))

const manifest = await buildRuntime({ quiet: true })

const targetDir = resolve(rootDir, 'public', 'frame-assets')
await rm(targetDir, { recursive: true, force: true })
await cp(RUNTIME_DIST, targetDir, { recursive: true })

// Written only when it changes, like the version stamp below, so a sync leaves git clean.
const fontsModulePath = resolve(rootDir, 'src', 'frame-fonts.ts')
const fontsModule = `// Written by scripts/sync-h5p-assets.mjs from @missing-elements/h5p-runtime ${manifest.runtime}'s
// MANIFEST.json (the H5P core at ${manifest.core.commit.slice(0, 10)}). Do not edit; run \`pnpm sync:assets\` in packages/player.

/**
 * The text faces the runtime's stylesheet declares, in its order, by the file names under its
 * \`fonts/\`. The element resolves each against an \`assets-base\` or the default directory, and
 * the frame document declares the faces from the result; a host that imports the runtime package
 * hands over the resolved URLs instead, through the \`runtime\` property.
 */
export const FRAME_FONTS = [
${manifest.fonts
  .map((font) => `  { family: '${font.family}', style: '${font.style}', weight: '${font.weight}', file: '${font.file}' }`)
  .join(',\n')}
] as const
`
const currentFontsModule = (await exists(fontsModulePath)) ? await readFile(fontsModulePath, 'utf8') : ''
if (currentFontsModule !== fontsModule) await writeFile(fontsModulePath, fontsModule, 'utf8')

// The version travels in three places — the element, the worker and the `_ping` route — and a
// mismatch between a CDN element and a hand-copied worker is the failure this makes visible.
const constantsPath = resolve(rootDir, 'src', 'shared', 'constants.ts')
const constants = await readFile(constantsPath, 'utf8')
const major = Number(packageJson.version.split('.')[0])
// The library pack `libraries="pack"` names, pinned to the version in this checkout, so a given
// player release always plays against the same libraries. `prepublishOnly` refuses a version that
// is not on npm yet.
const librariesJson = JSON.parse(await readFile(resolve(rootDir, '..', 'libraries', 'package.json'), 'utf8'))
const stamped = constants
  .replace(/export const VERSION = '[^']*'/, `export const VERSION = '${packageJson.version}'`)
  .replace(/export const MAJOR_VERSION = \d+/, `export const MAJOR_VERSION = ${major}`)
  .replace(/export const LIBRARY_PACK_VERSION = '[^']*'/, `export const LIBRARY_PACK_VERSION = '${librariesJson.version}'`)

if (stamped !== constants) {
  await writeFile(constantsPath, stamped, 'utf8')
}

// The pinned pack's index, compiled into the Service Worker: which parts a package needs is
// decided without a request, and each part is checked against the hash written here, so the CDN
// cannot change the code a host runs. Written only when it changes, like the files above.
const packIndex = JSON.parse(await readFile(resolve(rootDir, '..', 'libraries', 'parts', 'index.json'), 'utf8'))
const packIndexPath = resolve(rootDir, 'src', 'shared', 'pack-index.ts')
const packIndexModule = `// Written by scripts/sync-h5p-assets.mjs from @missing-elements/h5p-libraries ${librariesJson.version}'s
// parts/index.json. Do not edit; run \`pnpm sync:assets\` in packages/player.
import type { PackLibrary } from './protocol'

/**
 * The index of the library pack this release pins, \`LIBRARY_PACK_VERSION\`: each library's
 * version and dependencies, and its part's size and SHA-256. The Service Worker plans from it for
 * \`libraries="pack"\`, and the parts are fetched from \`LIBRARY_PACK_BASE\`.
 */
export const PACK_INDEX: readonly PackLibrary[] = [
${packIndex.libraries.map((entry) => `  ${JSON.stringify(entry)}`).join(',\n')}
]
`
const currentPackIndex = (await exists(packIndexPath)) ? await readFile(packIndexPath, 'utf8') : ''
if (currentPackIndex !== packIndexModule) await writeFile(packIndexPath, packIndexModule, 'utf8')

console.log(
  `[sync-h5p] @missing-elements/h5p-runtime ${manifest.runtime} (the H5P core at ${manifest.core.commit.slice(0, 10)}, core API ${manifest.core.coreApi}) -> public/frame-assets`
)
