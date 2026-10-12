import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

/**
 * Builds `dist/`: the h5p-standalone runtime vendored from `node_modules`, the frame's boot
 * script compiled from `src/frame-boot.ts`, and the notices — everything the player loads inside
 * its frame, and nothing the player itself is made of. Then writes `index.js`, which names every
 * one of those files with a static `new URL` so that a bundler emits them.
 *
 * The runtime scripts' code is copied unmodified; each only gains a leading licence comment (see
 * below). The player synthesizes the document they run in; this package does not patch H5P.
 *
 * Every file in `dist/` stands alone, because `index.js` names each one with its own
 * `new URL('./dist/<file>', import.meta.url)` and a consumer's bundler emits each under a hashed
 * name of its own, wherever it likes. The core stylesheet reaches its fonts and images through
 * `../fonts/` and `../images/`, which break the moment the sheet moves, so it is rebuilt:
 *
 * - The icon fonts and the throbber, 30 kB between them, are inlined as data URLs — what
 *   pdfjs-viewer-element does with its `viewer.css`.
 * - Inter and Open Sans are not. Twelve faces of 55–120 kB each would make a 1.4 MB sheet that
 *   base64 leaves all but incompressible, fetched whole on a cold load for the one or two faces a
 *   page renders — and the runtime does not wait for the sheet, so the content came up unstyled
 *   until it had arrived. Their `@font-face` rules are taken out; the files are copied to
 *   `fonts/` under short names and listed in `MANIFEST.json`. The player's frame document declares
 *   the faces itself against the URLs it resolved, so the browser still fetches only the faces in
 *   use.
 *
 * That is the only change made to H5P's files, and it changes no rule the content sees.
 *
 * Beside them, `l10n.js` holds the core's interface strings in every language this package has,
 * from the committed `l10n/`, which `scripts/build-l10n.mjs` writes.
 *
 * `dist/` also gets a `LICENSE.txt` and a `NOTICE.txt`, written here rather than kept by hand so
 * that they always name the h5p-standalone version actually vendored — that tag is the
 * corresponding source — and so that they land beside the files they describe wherever `dist/`
 * is copied or served.
 */

const rootDir = resolve(import.meta.dirname, '..')

const fail = (message) => {
  throw new Error(`[h5p-runtime] ${message}`)
}

const exists = async (path) => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** The shape `fontFaceRules` in the player's `frame-document.ts` accepts — keep the two in step. */
const FAMILY = /^[A-Za-z][A-Za-z0-9 -]*$/
const STYLE = /^(normal|italic)$/
const WEIGHT = /^\d{3}$/

/** A language tag as the player's `shared/language.ts` accepts one — keep the two in step. */
const LANGUAGE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/

export const DIST_DIR = resolve(rootDir, 'dist')

/**
 * Builds `dist/` and `index.js`. Returns the manifest it wrote: the versions and the font list,
 * which the player's `sync:assets` reads to write its own copy of the font names.
 */
export async function buildRuntime({ quiet = false } = {}) {
  const packageJson = JSON.parse(await readFile(resolve(rootDir, 'package.json'), 'utf8'))
  const standaloneDir = resolve(rootDir, 'node_modules', 'h5p-standalone', 'dist')

  if (!(await exists(standaloneDir))) {
    fail('node_modules/h5p-standalone is missing. Run "pnpm install" at the repository root first.')
  }

  const standaloneVersion = JSON.parse(
    await readFile(resolve(rootDir, 'node_modules', 'h5p-standalone', 'package.json'), 'utf8')
  ).version

  await rm(DIST_DIR, { recursive: true, force: true })
  await mkdir(DIST_DIR, { recursive: true })

  // `main.bundle.js` walks the package's dependencies; `frame.bundle.js` is h5p.js, jQuery and the
  // core runtime. Each is given a `/*! … */` header naming its licences, because a consumer's
  // bundler emits each file on its own under a hashed name and none of the text files in this
  // directory travel with it — a user's build of the player's 0.1.5 shipped `frame.bundle-*.js`,
  // the GPL file, with no notice at all, and `main.bundle-*.js` pointing at a
  // `main.bundle.js.LICENSE.txt` that was never emitted. Bundlers keep a `/*!` comment in an asset
  // they emit as is, and webpack's Terser, which minifies emitted `.js` assets too, moves it into
  // a `.LICENSE.txt` it does ship. The pointer webpack left in `main.bundle.js` is replaced by the
  // notice it pointed at, so that file is not shipped. Nothing after the first line changes.
  const corresponding = `https://github.com/tunapanda/h5p-standalone/tree/v${standaloneVersion}`
  const headers = {
    'frame.bundle.js': `/*! H5P core runtime (h5p.js and its companions) from h5p/h5p-php-library, GPL-3.0-only (https://github.com/h5p/h5p-php-library). jQuery 3.5.1, MIT (https://jquery.org/license). h5p-standalone ${standaloneVersion}, MIT, Copyright (c) 2015 Tunapanda. Corresponding source: ${corresponding}. See NOTICE.md in @missing-elements/h5p-runtime. */`,
    'main.bundle.js': `/*! h5p-standalone ${standaloneVersion}, MIT, Copyright (c) 2015 Tunapanda (${corresponding}). See NOTICE.md in @missing-elements/h5p-runtime. */`
  }
  const WEBPACK_POINTER = '/*! For license information please see main.bundle.js.LICENSE.txt */\n'

  for (const [file, header] of Object.entries(headers)) {
    const source = resolve(standaloneDir, file)
    if (!(await exists(source))) fail(`Required runtime file missing: ${source}`)
    let code = await readFile(source, 'utf8')
    if (file === 'main.bundle.js') {
      if (!code.startsWith(WEBPACK_POINTER)) fail(`${source} no longer starts with webpack's licence pointer`)
      const pointed = (await readFile(resolve(standaloneDir, 'main.bundle.js.LICENSE.txt'), 'utf8')).trim()
      code = `${pointed}\n${code.slice(WEBPACK_POINTER.length)}`
    }
    await writeFile(resolve(DIST_DIR, file), `${header}\n${code}`, 'utf8')
  }

  // `styles/h5p.css` is the stylesheet the runtime loads; `h5p-fonts.css` beside it repeats its
  // `@font-face` rules for the editor and is never requested by a player.
  const stylesheet = resolve(standaloneDir, 'styles', 'h5p.css')
  if (!(await exists(stylesheet))) fail(`Required runtime file missing: ${stylesheet}`)

  // Rules are matched on the source text rather than parsed; `@font-face` bodies hold no braces.
  const FONT_FACE = /@font-face\s*\{([^}]*)\}/g
  const TEXT_FONT = /url\(['"]?\.\.\/fonts\/(inter|open-sans)\/([^'")]+\.woff2)['"]?\)/
  const descriptor = (body, name) => body.match(new RegExp(`${name}\\s*:\\s*['"]?([^;'"]+)['"]?\\s*;`))?.[1].trim()

  // A face that does not fit the shape the player's frame document accepts fails the build here,
  // where it is seen, rather than being dropped by the frame at runtime, where nothing would say
  // why the text fell back.
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

  await mkdir(resolve(DIST_DIR, 'fonts'), { recursive: true })
  for (const font of fonts) {
    if (!(await exists(font.source))) fail(`Required font missing: ${font.source}`)
    await cp(font.source, resolve(DIST_DIR, 'fonts', font.file))
  }

  await build({
    stdin: { contents: stripped, resolveDir: resolve(standaloneDir, 'styles'), loader: 'css', sourcefile: 'h5p.css' },
    outfile: resolve(DIST_DIR, 'h5p.css'),
    bundle: true,
    minify: true,
    logLevel: 'warning',
    // One IE7 hack (`*width`) in the core sheet; esbuild keeps it as written and says so.
    logOverride: { 'css-syntax-error': 'silent' },
    // A consumer's bundler emits this file as it is, so the comment survives and the licence stays
    // reachable even where LICENSE.txt and NOTICE.txt beside it do not travel.
    legalComments: 'none',
    banner: {
      css: `/*! H5P core stylesheet from h5p-standalone ${standaloneVersion}, GPL-3.0 (https://github.com/h5p/h5p-php-library). See NOTICE.txt beside this file or NOTICE.md in @missing-elements/h5p-runtime. */`
    },
    loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.gif': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' }
  })

  // The frame's boot script: a self-contained classic script the player's Service Worker names
  // with `<script nonce src>` in the document it synthesizes. It runs in the H5P document and
  // calls the core's API, which is why it is here and not in the player: everything the player
  // ships talks to this directory over HTTP and `postMessage` only.
  await build({
    entryPoints: [resolve(rootDir, 'src', 'frame-boot.ts')],
    outfile: resolve(DIST_DIR, 'frame-boot.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    banner: {
      js: `/*! @missing-elements/h5p-runtime ${packageJson.version}: the frame boot script. Copyright (c) 2026 missing-elements. GPL-3.0-only, see LICENSE.txt beside this file. Includes a port of H5PContentValidator from h5p/h5p-php-library (GPL-3.0) and of Drupal 7's filter_xss (GPL-2.0-or-later). */`
    }
  })

  // The fonts' licences, which sit in their own folders upstream.
  await cp(resolve(standaloneDir, 'fonts', 'inter', 'LICENSE.txt'), resolve(DIST_DIR, 'fonts', 'Inter-LICENSE.txt'))
  await cp(resolve(standaloneDir, 'fonts', 'open-sans', 'OFL.txt'), resolve(DIST_DIR, 'fonts', 'OpenSans-OFL.txt'))

  // The core's strings in other languages, from `l10n/` (`scripts/build-l10n.mjs`), all in one
  // classic script with the aliases beside them: the player's frame document names it before the
  // boot script when the element's language is not English, and the boot script picks the
  // language from it. One file, so that the player needs no list of languages and a language
  // added is a release of this package alone; the frame of a learner who is not reading English
  // fetches it once, about 50 kB compressed, and a cache keeps it. A script rather than JSON
  // because the frame's policy lets the runtime's origin run scripts and fetches nothing from it.
  // It carries its notice, like the runtime's other files, since a bundler emits it on its own.
  const l10n = JSON.parse(await readFile(resolve(rootDir, 'l10n', 'index.json'), 'utf8'))
  const languages = {}
  for (const tag of Object.keys(l10n.languages).sort()) {
    if (!LANGUAGE_TAG.test(tag)) fail(`l10n/index.json names a language "${tag}" that is not a language tag`)
    const { H5P } = JSON.parse(await readFile(resolve(rootDir, 'l10n', `${tag}.json`), 'utf8'))
    if (!H5P || typeof H5P !== 'object' || !Object.values(H5P).every((value) => typeof value === 'string')) {
      fail(`l10n/${tag}.json is not a set of strings`)
    }
    languages[tag] = H5P
  }
  const aliases = l10n.aliases ?? {}
  for (const [tag, target] of Object.entries(aliases)) {
    if (!LANGUAGE_TAG.test(tag) || !languages[target]) fail(`l10n/index.json takes ${tag} to ${target}, which is not a language it has`)
  }
  // The source and the date come from the generator; neither may close the comment early.
  const plain = (text) => String(text).replaceAll('*/', '')
  const l10nHeader = `/*! The H5P core's interface strings in ${Object.keys(languages).length} languages, from ${plain(l10n.source)}, taken ${plain(l10n.retrieved)}: GPL-3.0-or-later, by Moodle and its translators. Part of @missing-elements/h5p-runtime ${packageJson.version}, GPL-3.0-only; see NOTICE.txt in the runtime's directory. */`
  await writeFile(resolve(DIST_DIR, 'l10n.js'), `${l10nHeader}\nwindow.H5PRuntimeL10n=${JSON.stringify({ languages, aliases })};\n`, 'utf8')

  const manifest = {
    runtime: packageJson.version,
    h5pStandalone: standaloneVersion,
    fonts: fonts.map(({ family, style, weight, file }) => ({ family, style, weight, file }))
  }
  await writeFile(resolve(DIST_DIR, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  await cp(resolve(rootDir, 'LICENSE'), resolve(DIST_DIR, 'LICENSE.txt'))
  await writeFile(resolve(DIST_DIR, 'NOTICE.txt'), distNotice(standaloneVersion, packageJson.version), 'utf8')

  // `index.js`: one static `new URL` per file, the one shape Vite, Rollup and webpack 5 emit as an
  // asset and rewrite. Generated, because the font list comes from the sheet. Written only when
  // it changes, so a build leaves the tree as it found it.
  const indexPath = resolve(rootDir, 'index.js')
  const index = indexModule(packageJson.version, manifest.fonts)
  const currentIndex = (await exists(indexPath)) ? await readFile(indexPath, 'utf8') : ''
  if (currentIndex !== index) await writeFile(indexPath, index, 'utf8')

  if (!quiet) console.log(`[h5p-runtime] h5p-standalone v${standaloneVersion} and the boot script -> dist/`)
  return manifest
}

function indexModule(version, fonts) {
  const url = (file) => `unbundled(new URL(${JSON.stringify(`./dist/${file}`)}, import.meta.url).href)`
  return `// Written by scripts/build.mjs. Do not edit; run \`pnpm build\` in packages/runtime.
/*! @missing-elements/h5p-runtime ${version}. Copyright (c) 2026 missing-elements. GPL-3.0-only (LICENSE in this package). */

// Vite's dev server pre-bundles dependencies into \`node_modules/.vite/deps/\`, which rewrites
// these URLs to files that were never put there. The package's own copy is still served at its
// real path, so a URL that landed in the pre-bundle directory is pointed back at it. A Vite
// build, Rollup and webpack never produce such a URL.
const VITE_DEPS = '/node_modules/.vite/deps/'
const PACKAGE_DIST = '/node_modules/@missing-elements/h5p-runtime/dist/'

function unbundled(href) {
  const url = new URL(href)
  const at = url.pathname.indexOf(VITE_DEPS)
  if (at < 0) return href
  url.pathname = url.pathname.slice(0, at) + PACKAGE_DIST + url.pathname.slice(at + VITE_DEPS.length).replace(/^dist\\//, '')
  url.search = ''
  return url.href
}

/**
 * The runtime's files, resolved against this module, for \`<h5p-player>\`'s \`runtime\` property.
 * Each is a static \`new URL\`, so a bundler emits the file and rewrites the address.
 */
export const runtime = {
  version: ${JSON.stringify(version)},
  mainJs: ${url('main.bundle.js')},
  frameJs: ${url('frame.bundle.js')},
  frameCss: ${url('h5p.css')},
  bootJs: ${url('frame-boot.js')},
  fonts: [
${fonts
  .map(
    (font) =>
      `    { family: ${JSON.stringify(font.family)}, style: ${JSON.stringify(font.style)}, weight: ${JSON.stringify(font.weight)}, url: ${url(`fonts/${font.file}`)} }`
  )
  .join(',\n')}
  ],
  /** The core's strings in every language this package has; the frame loads it unless the element's language is English. */
  l10nJs: ${url('l10n.js')}
}
`
}

function distNotice(standalone, runtime) {
  return `@missing-elements/h5p-runtime ${runtime} -- third-party notice

These files are the H5P runtime that <h5p-player> loads inside its frame, and the script that
boots it there. The runtime was copied from h5p-standalone ${standalone}
(https://github.com/tunapanda/h5p-standalone, tag v${standalone}): the scripts' code unmodified,
each given a leading licence comment, the stylesheet rebuilt so that it stands alone, its icon
fonts and images inlined as data URLs, its Inter and Open Sans faces moved to fonts/ and listed
in MANIFEST.json for the player's frame document to declare. Keep this file and LICENSE.txt
beside them when you copy or serve the directory.

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
    named in its own leading comment.

frame-boot.js
  - The frame's boot script, from src/frame-boot.ts in this package. Copyright (c) 2026
    missing-elements, GNU General Public License v3.0 -- LICENSE.txt. It runs in the H5P
    document and calls the core's API, which is why it is part of this package and not of
    the MIT player. It includes a port of H5PContentValidator from h5p/h5p-php-library
    (GNU General Public License v3.0) and of the filter_xss functions of Drupal 7's
    includes/common.inc (Copyright Drupal contributors, GNU General Public License v2.0 or
    later), which check the content of a package played untrusted.

l10n.js
  - The core's interface strings in other languages, taken from Moodle's language packs
    (https://download.moodle.org/langpack/), where Moodle's translators keep them.
    Copyright Moodle and its translators, GNU General Public License v3.0 or later.
    l10n/index.json in this package's source names the pack each language came from and
    when they were taken.

Corresponding source for the GPL parts as built:
https://github.com/tunapanda/h5p-standalone/tree/v${standalone} (src/ and vendor/h5p/), and
https://github.com/missing-elements/h5p-offline-player/tree/main/packages/runtime.
h5p-standalone does not record which h5p-php-library revision vendor/h5p/ was taken from
(https://github.com/tunapanda/h5p-standalone/issues/188).
`
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await buildRuntime()
}
