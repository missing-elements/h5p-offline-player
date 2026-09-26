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

const shared = {
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  define: { 'import.meta.env.DEV': 'false' },
  plugins: [frameBootEsbuildPlugin(true), noCodecImport]
}

/** `h5p-sw.js`: a self-contained classic script, because a Service Worker is registered by URL. */
export function buildServiceWorker(outfile) {
  return build({ ...shared, entryPoints: [resolve(rootDir, 'src/sw/sw-entry.ts')], outfile, format: 'iife' })
}

/** `h5p-sw-mount.js`: the same handlers as an ES module, for hosts that mount them into their own worker. */
export function buildMountModule(outfile) {
  return build({ ...shared, entryPoints: [resolve(rootDir, 'src/sw/mount.ts')], outfile, format: 'esm' })
}
