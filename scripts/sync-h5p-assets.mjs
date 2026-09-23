import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * Vendors the h5p-standalone runtime into `public/frame-assets/`, where the dev server and the
 * browser tests serve it from, and stamps the package version into `src/shared/constants.ts` so
 * the element and the Service Worker can tell each other apart at runtime.
 *
 * The runtime files are copied unmodified. The player synthesizes the document they run in; it
 * does not patch H5P itself.
 */

const rootDir = resolve(import.meta.dirname, '..')

const fail = (message) => {
  console.error(`[sync-h5p] ${message}`)
  process.exit(1)
}

const exists = async (path) => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const packageJson = JSON.parse(await readFile(resolve(rootDir, 'package.json'), 'utf8'))
const standaloneDir = resolve(rootDir, 'node_modules', 'h5p-standalone', 'dist')

if (!(await exists(standaloneDir))) {
  fail('node_modules/h5p-standalone is missing. Run "npm install" first.')
}

const standaloneVersion = JSON.parse(
  await readFile(resolve(rootDir, 'node_modules', 'h5p-standalone', 'package.json'), 'utf8')
).version

const targetDir = resolve(rootDir, 'public', 'frame-assets')
await rm(targetDir, { recursive: true, force: true })
await mkdir(targetDir, { recursive: true })

// `main.bundle.js` walks the package's dependencies; `frame.bundle.js` is h5p.js, jQuery and the
// core runtime; the rest is what the core stylesheet references.
const files = ['main.bundle.js', 'frame.bundle.js']
const directories = ['styles', 'fonts', 'images']

for (const file of files) {
  const source = resolve(standaloneDir, file)
  if (!(await exists(source))) fail(`Required runtime file missing: ${source}`)
  await cp(source, resolve(targetDir, file))
}

for (const directory of directories) {
  const source = resolve(standaloneDir, directory)
  if (!(await exists(source))) fail(`Required runtime directory missing: ${source}`)
  await cp(source, resolve(targetDir, directory), { recursive: true, force: true })
}

await writeFile(
  resolve(targetDir, 'MANIFEST.json'),
  `${JSON.stringify({ h5pStandalone: standaloneVersion, player: packageJson.version }, null, 2)}\n`,
  'utf8'
)

// The version travels in three places — the element, the worker and the `_ping` route — and a
// mismatch between a CDN element and a hand-copied worker is the failure this makes visible.
const constantsPath = resolve(rootDir, 'src', 'shared', 'constants.ts')
const constants = await readFile(constantsPath, 'utf8')
const major = Number(packageJson.version.split('.')[0])
const stamped = constants
  .replace(/export const VERSION = '[^']*'/, `export const VERSION = '${packageJson.version}'`)
  .replace(/export const MAJOR_VERSION = \d+/, `export const MAJOR_VERSION = ${major}`)

if (stamped !== constants) {
  await writeFile(constantsPath, stamped, 'utf8')
}

console.log(
  `[sync-h5p] frame assets for h5p-standalone v${standaloneVersion} -> public/frame-assets`
)
