import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

/**
 * Builds `dist/scorm-page.js`: the SCORM page's script with everything it imports — the builder,
 * zip.js and the player's library rules — in one ES module, for the written site, which has no
 * bundler of its own and loads it as it loads `embed.js`. A host that bundles imports
 * `./scorm-page.js`, the source, instead. Run before the tests and before publishing; `buildSite`
 * refuses to write a site without it.
 */

const root = fileURLToPath(new URL('..', import.meta.url))

/**
 * The notices on the one shipped file with third-party code in it: ours, and zip.js's licence in
 * full, as the player's workers carry it, since its clause 2 asks for the notice, the conditions
 * and the disclaimer to accompany a binary. Read from the installed package, so that it follows
 * the version actually bundled.
 */
async function notices() {
  const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  const zipJs = resolve(root, 'node_modules', '@zip.js', 'zip.js')
  const zip = JSON.parse(await readFile(resolve(zipJs, 'package.json'), 'utf8')).version
  const licence = (await readFile(resolve(zipJs, 'LICENSE'), 'utf8')).trim()
  if (licence.includes('*/')) throw new Error('[build] the zip.js licence would end the comment early')
  return (
    `/*! @missing-elements/h5p-embed ${version}, the SCORM page. Copyright (c) 2026 missing-elements. MIT (https://github.com/missing-elements/h5p-offline-player/blob/main/LICENSE). ` +
    `Bundles the library rules of @missing-elements/h5p-offline-player (MIT) and zip.js ${zip} (https://github.com/gildas-lormeau/zip.js):\n\n${licence}\n*/`
  )
}

await build({
  entryPoints: [resolve(root, 'site', 'scorm-page.js')],
  outfile: resolve(root, 'dist', 'scorm-page.js'),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  banner: { js: await notices() }
})
