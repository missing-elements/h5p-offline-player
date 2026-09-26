import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'

/**
 * Vendors the h5p-standalone runtime into `public/frame-assets/`, where the dev server and the
 * browser tests serve it from, and stamps the package version into `src/shared/constants.ts` so
 * the element and the Service Worker can tell each other apart at runtime.
 *
 * The runtime scripts are copied unmodified. The player synthesizes the document they run in; it
 * does not patch H5P itself.
 *
 * Every file in the directory stands alone, because the element names each one with its own
 * `new URL('./frame-assets/<file>', import.meta.url)` and a consumer's bundler emits each under a
 * hashed name of its own, wherever it likes. The core stylesheet reaches its fonts and images
 * through `../fonts/` and `../images/`, which break the moment the sheet moves, so it is rebuilt:
 *
 * - The icon fonts and the throbber, 30 kB between them, are inlined as data URLs — what
 *   pdfjs-viewer-element does with its `viewer.css`.
 * - Inter and Open Sans are not. Twelve faces of 55–120 kB each would make a 1.4 MB sheet that
 *   base64 leaves all but incompressible, fetched whole on a cold load for the one or two faces a
 *   page renders — and the runtime does not wait for the sheet, so the content came up unstyled
 *   until it had arrived. Their `@font-face` rules are taken out; the files are copied to
 *   `fonts/` under short names, and `src/frame-fonts.ts` is written with one static `new URL` per
 *   file. The element hands the resolved URLs to the frame document, which declares the faces
 *   itself, so the browser still fetches only the faces in use.
 *
 * That is the only change made to H5P's files, and it changes no rule the content sees.
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
// core runtime. The third file is webpack's notice for what it left out of `main.bundle.js`.
const files = ['main.bundle.js', 'frame.bundle.js', 'main.bundle.js.LICENSE.txt']

for (const file of files) {
  const source = resolve(standaloneDir, file)
  if (!(await exists(source))) fail(`Required runtime file missing: ${source}`)
  await cp(source, resolve(targetDir, file))
}

// `styles/h5p.css` is the stylesheet the runtime loads; `h5p-fonts.css` beside it repeats its
// `@font-face` rules for the editor and is never requested by a player.
const stylesheet = resolve(standaloneDir, 'styles', 'h5p.css')
if (!(await exists(stylesheet))) fail(`Required runtime file missing: ${stylesheet}`)

// Rules are matched on the source text rather than parsed; `@font-face` bodies hold no braces.
const FONT_FACE = /@font-face\s*\{([^}]*)\}/g
const TEXT_FONT = /url\(['"]?\.\.\/fonts\/(inter|open-sans)\/([^'")]+\.woff2)['"]?\)/
const descriptor = (body, name) => body.match(new RegExp(`${name}\\s*:\\s*['"]?([^;'"]+)['"]?\\s*;`))?.[1].trim()

// The same shape `fontFaceRules` in src/sw/frame-document.ts accepts — keep the two in step. A
// face that does not fit fails the sync here, where it is seen, rather than being dropped by the
// frame at runtime, where nothing would say why the text fell back.
const FAMILY = /^[A-Za-z][A-Za-z0-9 -]*$/
const STYLE = /^(normal|italic)$/
const WEIGHT = /^\d{3}$/

const source = await readFile(stylesheet, 'utf8')
const fonts = []
const stripped = source.replace(FONT_FACE, (rule, body) => {
  const url = body.match(TEXT_FONT)
  if (!url) return rule
  const family = descriptor(body, 'font-family')
  const style = descriptor(body, 'font-style') ?? 'normal'
  const weight = descriptor(body, 'font-weight') ?? '400'
  if (!family || !FAMILY.test(family) || !STYLE.test(style) || !WEIGHT.test(weight)) {
    fail(`Unexpected @font-face in ${stylesheet}: ${rule}`)
  }
  // One file per face: a second rule for the same face — a `unicode-range` split, say — would
  // overwrite the first under this name, so it is refused until the naming accounts for it.
  const file = `${url[1]}-${weight}${style === 'italic' ? '-italic' : ''}.woff2`
  if (fonts.some((font) => font.file === file)) fail(`Two @font-face rules map to ${file} in ${stylesheet}: ${rule}`)
  fonts.push({ family, style, weight, file, source: resolve(standaloneDir, 'fonts', url[1], url[2]) })
  return ''
})
if (fonts.length === 0) fail(`No Inter or Open Sans @font-face found in ${stylesheet}`)

await mkdir(resolve(targetDir, 'fonts'), { recursive: true })
for (const font of fonts) {
  if (!(await exists(font.source))) fail(`Required font missing: ${font.source}`)
  await cp(font.source, resolve(targetDir, 'fonts', font.file))
}

await build({
  stdin: { contents: stripped, resolveDir: resolve(standaloneDir, 'styles'), loader: 'css', sourcefile: 'h5p.css' },
  outfile: resolve(targetDir, 'h5p.css'),
  bundle: true,
  minify: true,
  logLevel: 'warning',
  // One IE7 hack (`*width`) in the core sheet; esbuild keeps it as written and says so.
  logOverride: { 'css-syntax-error': 'silent' },
  // A consumer's bundler emits this file as it is, so the comment survives and the licence stays
  // reachable even where LICENSE.txt and NOTICE.txt beside it do not travel.
  legalComments: 'none',
  banner: {
    css: `/*! H5P core stylesheet from h5p-standalone ${standaloneVersion}, GPL-3.0 (https://github.com/h5p/h5p-php-library). See NOTICE.txt beside this file or NOTICE.md in @missing-elements/h5p-offline-player. */`
  },
  loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.gif': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' }
})

// Written only when it changes, like the version stamp below, so a sync leaves git clean.
const fontsModulePath = resolve(rootDir, 'src', 'frame-fonts.ts')
const fontsModule = `// Written by scripts/sync-h5p-assets.mjs from the @font-face rules in h5p-standalone
// ${standaloneVersion}'s styles/h5p.css. Do not edit; run \`npm run sync:assets\`.

/**
 * The text faces the core stylesheet declares, in its order. \`file\` is the name under
 * \`frame-assets/fonts/\`, for an \`assets-base\`; \`packaged\` is the file as it sits beside the
 * built element, one static \`new URL\` per face so that a consumer's bundler emits each and
 * rewrites its URL.
 */
export const FRAME_FONTS = [
${fonts
  .map(
    (font) => `  {
    family: '${font.family}',
    style: '${font.style}',
    weight: '${font.weight}',
    file: '${font.file}',
    packaged: new URL(/* @vite-ignore */ './frame-assets/fonts/${font.file}', import.meta.url).href
  }`
  )
  .join(',\n')}
] as const
`
const currentFontsModule = (await exists(fontsModulePath)) ? await readFile(fontsModulePath, 'utf8') : ''
if (currentFontsModule !== fontsModule) await writeFile(fontsModulePath, fontsModule, 'utf8')

// The fonts' licences, which sit in their own folders upstream.
await cp(resolve(standaloneDir, 'fonts', 'inter', 'LICENSE.txt'), resolve(targetDir, 'fonts', 'Inter-LICENSE.txt'))
await cp(resolve(standaloneDir, 'fonts', 'open-sans', 'OFL.txt'), resolve(targetDir, 'fonts', 'OpenSans-OFL.txt'))

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
from h5p-standalone ${standalone} (https://github.com/tunapanda/h5p-standalone,
tag v${standalone}) by @missing-elements/h5p-offline-player ${player}: the scripts unmodified,
the stylesheet rebuilt so that it stands alone: its icon fonts and images inlined as data URLs,
its Inter and Open Sans faces moved to fonts/ and declared by the frame document instead. They are NOT covered by
that package's MIT licence. Keep this file and LICENSE.txt beside them when you copy or serve
the directory.

frame.bundle.js
  - H5P core: h5p.js, h5p-event-dispatcher.js, h5p-x-api.js, h5p-x-api-event.js,
    h5p-content-type.js, h5p-confirmation-dialog.js, request-queue.js, h5p-action-bar.js,
    h5p-tooltip.js, from https://github.com/h5p/h5p-php-library (vendor/h5p/js/ in
    h5p-standalone). GNU General Public License v3.0 -- LICENSE.txt in this directory.
  - jQuery 3.5.1. MIT, Copyright JS Foundation and other contributors, https://jquery.org/license
  - h5p-standalone's own frame code. MIT, Copyright (c) 2015 Tunapanda.

h5p.css
  - H5P core styles/h5p.css, with the h5p-core-30, h5p-hub-publish and h5p-theme icon fonts and
    images/throbber.gif inlined. Same origin, GNU General Public License v3.0 -- LICENSE.txt.

fonts/inter-*     Inter, SIL Open Font License 1.1 -- fonts/Inter-LICENSE.txt
fonts/open-sans-* Open Sans, SIL Open Font License 1.1 -- fonts/OpenSans-OFL.txt

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
