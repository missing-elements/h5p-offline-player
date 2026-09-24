import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * Vendors the h5p-standalone runtime into `public/frame-assets/`, where the dev server and the
 * browser tests serve it from, and stamps the package version into `src/shared/constants.ts` so
 * the element and the Service Worker can tell each other apart at runtime.
 *
 * The runtime files are copied unmodified. The player synthesizes the document they run in; it
 * does not patch H5P itself.
 *
 * The directory also gets a `LICENSE.txt` and a `NOTICE.txt`, because what it holds is not under
 * this package's MIT licence: `frame.bundle.js`, the core stylesheet and the icon fonts are H5P
 * core, which is GPL-3.0 (see NOTICE.md at the root). They are written here rather than kept by
 * hand so that they always name the h5p-standalone version actually vendored — that tag is the
 * corresponding source — and so that they land in `dist/frame-assets/` and on the demo site with
 * the files they describe.
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
// core runtime; the rest is what the core stylesheet references. The third file is webpack's
// notice for what it left out of `main.bundle.js`.
const files = ['main.bundle.js', 'frame.bundle.js', 'main.bundle.js.LICENSE.txt']
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

await cp(resolve(rootDir, 'licenses', 'GPL-3.0.txt'), resolve(targetDir, 'LICENSE.txt'))
await writeFile(resolve(targetDir, 'NOTICE.txt'), frameAssetsNotice(standaloneVersion, packageJson.version), 'utf8')

function frameAssetsNotice(standalone, player) {
  return `H5P frame assets -- third-party notice

These files are the H5P runtime that <h5p-player> loads inside its frame. They were copied
unmodified from h5p-standalone ${standalone} (https://github.com/tunapanda/h5p-standalone,
tag v${standalone}) by @missing-elements/h5p-offline-player ${player}. They are NOT covered by
that package's MIT licence. Keep this file and LICENSE.txt beside them when you copy or serve
the directory.

frame.bundle.js
  - H5P core: h5p.js, h5p-event-dispatcher.js, h5p-x-api.js, h5p-x-api-event.js,
    h5p-content-type.js, h5p-confirmation-dialog.js, request-queue.js, h5p-action-bar.js,
    h5p-tooltip.js, from https://github.com/h5p/h5p-php-library (vendor/h5p/js/ in
    h5p-standalone). GNU General Public License v3.0 -- LICENSE.txt in this directory.
  - jQuery 3.5.1. MIT, Copyright JS Foundation and other contributors, https://jquery.org/license
  - h5p-standalone's own frame code. MIT, Copyright (c) 2015 Tunapanda.

styles/, fonts/h5p-core-30.woff2, fonts/h5p-hub-publish.*, fonts/h5p-theme.woff2, images/
  - H5P core, same origin. GNU General Public License v3.0 -- LICENSE.txt.

fonts/inter/      Inter, SIL Open Font License 1.1 -- fonts/inter/LICENSE.txt
fonts/open-sans/  Open Sans, SIL Open Font License 1.1 -- fonts/open-sans/OFL.txt

main.bundle.js
  - h5p-standalone. MIT, Copyright (c) 2015 Tunapanda. Includes regenerator-runtime (MIT),
    see main.bundle.js.LICENSE.txt.

Corresponding source for the GPL parts as built:
https://github.com/tunapanda/h5p-standalone/tree/v${standalone} (src/ and vendor/h5p/).
h5p-standalone does not record which h5p-php-library revision vendor/h5p/ was taken from
(https://github.com/tunapanda/h5p-standalone/issues/188).
`
}

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
