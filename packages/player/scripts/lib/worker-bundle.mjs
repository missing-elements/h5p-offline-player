import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { frameBootEsbuildPlugin } from './frame-boot-plugin.mjs'

/**
 * The two worker artefacts, built the same way for the package (`build-workers.mjs`) and for the
 * hosted demo (`build-demo.mjs`).
 */

const rootDir = resolve(import.meta.dirname, '..', '..')

/**
 * Takes the one `import()` out of zip.js. It loads a codec module when `configure` names one,
 * which ours never does, and a Service Worker may not call `import()` in any case. Left in, it
 * is what makes a consumer's Vite dev server rewrite the served worker: Vite runs every `.js`
 * it serves through its import analysis, sees a dynamic import with a computed specifier and
 * prepends `import { injectQuery } from "/@vite/client"` — a syntax error in a classic worker,
 * so the registration failed there and nowhere else. With no `import(` in the file Vite adds
 * nothing but a newline.
 */
const noCodecImport = {
  name: 'no-codec-import',
  setup(build) {
    build.onLoad({ filter: /[\\/]@zip\.js[\\/]zip\.js[\\/]lib[\\/]core[\\/]codec-registry\.js$/ }, async (args) => {
      const source = await readFile(args.path, 'utf8')
      const pattern = /await import\([^)]*codecURI\)/
      if (!pattern.test(source)) throw new Error(`[no-codec-import] the codec import in ${args.path} has changed shape`)
      return {
        contents: source.replace(pattern, "await Promise.reject(new Error('codec modules are not loaded in the Service Worker'))"),
        loader: 'js'
      }
    })
  }
}

/**
 * zip.js's licence, as a `/*! … *\/` header on both workers. `legalComments: 'none'` strips the
 * notices scattered through the bundle, and NOTICE.md alone did not reach a consumer's build: a
 * bundler emits `h5p-sw.js` as a hashed asset and nothing from the package root goes with it, so
 * a user's build of 0.1.5 shipped zip.js with no notice at all. Its clause 2 asks for the notice,
 * the conditions and the disclaimer to accompany a binary, so the whole text goes in, read from
 * the installed package so that it follows the version actually bundled. A bundler keeps a `/*!`
 * comment in an asset it emits as is; a host bundling `h5p-sw-mount.js` into its own worker keeps
 * it too under esbuild's and Terser's defaults, which preserve `/*!` comments.
 */
async function zipJsNotice() {
  const zipJsDir = resolve(rootDir, 'node_modules', '@zip.js', 'zip.js')
  const { version } = JSON.parse(await readFile(resolve(zipJsDir, 'package.json'), 'utf8'))
  const licence = (await readFile(resolve(zipJsDir, 'LICENSE'), 'utf8')).trim()
  if (licence.includes('*/')) throw new Error('[zip-js-notice] the zip.js licence would end the comment early')
  return `/*! @missing-elements/h5p-offline-player Service Worker. Bundles zip.js ${version} (https://github.com/gildas-lormeau/zip.js):\n\n${licence}\n*/`
}

async function shared() {
  return {
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    banner: { js: await zipJsNotice() },
    define: { 'import.meta.env.DEV': 'false' },
    plugins: [frameBootEsbuildPlugin(true), noCodecImport]
  }
}

/** `h5p-sw.js`: a self-contained classic script, because a Service Worker is registered by URL. */
export async function buildServiceWorker(outfile) {
  return build({ ...(await shared()), entryPoints: [resolve(rootDir, 'src/sw/sw-entry.ts')], outfile, format: 'iife' })
}

/** `h5p-sw-mount.js`: the same handlers as an ES module, for hosts that mount them into their own worker. */
export async function buildMountModule(outfile) {
  return build({ ...(await shared()), entryPoints: [resolve(rootDir, 'src/sw/mount.ts')], outfile, format: 'esm' })
}

/**
 * Resolves `@missing-elements/h5p-offline-player/sw` to the mount's source, the way the demo's
 * Vite config resolves the element's name, so a worker in this repository imports the handlers
 * by the name a host uses and is still built from source.
 */
export const mountFromSource = {
  name: 'mount-from-source',
  setup(build) {
    build.onResolve({ filter: /^@missing-elements\/h5p-offline-player\/sw$/ }, () => ({ path: resolve(rootDir, 'src/sw/mount.ts') }))
  }
}

/**
 * A host's own Service Worker with the handlers mounted into it — the demo's installable app is
 * one — returned as text, for the demo build to write and its dev server to serve. Same
 * settings, notice and plugins as ours; `define` carries what the host's code needs filled in,
 * and `dev` leaves it readable and turns the player's dev paths on.
 */
export async function bundleHostWorker(entry, { define = {}, dev = false } = {}) {
  const options = await shared()
  const result = await build({
    ...options,
    entryPoints: [entry],
    write: false,
    format: 'iife',
    minify: !dev,
    define: { ...options.define, 'import.meta.env.DEV': String(dev), ...define },
    plugins: [...options.plugins, mountFromSource]
  })
  return result.outputFiles[0].text
}
