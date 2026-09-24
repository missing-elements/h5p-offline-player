import { resolve } from 'node:path'
import { build } from 'esbuild'
import { frameBootEsbuildPlugin } from './frame-boot-plugin.mjs'

/**
 * The two worker artefacts, built the same way for the package (`build-workers.mjs`) and for the
 * hosted demo (`build-demo.mjs`).
 */

const rootDir = resolve(import.meta.dirname, '..', '..')

const shared = {
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  define: { 'import.meta.env.DEV': 'false' },
  plugins: [frameBootEsbuildPlugin(true)]
}

/** `h5p-sw.js`: a self-contained classic script, because a Service Worker is registered by URL. */
export function buildServiceWorker(outfile) {
  return build({ ...shared, entryPoints: [resolve(rootDir, 'src/sw/sw-entry.ts')], outfile, format: 'iife' })
}

/** `h5p-sw-mount.js`: the same handlers as an ES module, for hosts that mount them into their own worker. */
export function buildMountModule(outfile) {
  return build({ ...shared, entryPoints: [resolve(rootDir, 'src/sw/mount.ts')], outfile, format: 'esm' })
}
