import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildMountModule, buildServiceWorker } from './lib/worker-bundle.mjs'

/**
 * Builds the two artefacts Vite's library build cannot produce.
 *
 * `dist/h5p-sw.js` is a self-contained classic script, because a Service Worker is registered by
 * URL and has to run on a site with no build step at all. `dist/h5p-sw-mount.js` is the same
 * handlers as an ES module, for hosts that enforce a single worker per origin and mount ours
 * into theirs.
 */

const rootDir = resolve(import.meta.dirname, '..')
const distDir = resolve(rootDir, 'dist')

await buildServiceWorker(resolve(distDir, 'h5p-sw.js'))
await buildMountModule(resolve(distDir, 'h5p-sw-mount.js'))

const sizeOf = async (name) => {
  const contents = await readFile(resolve(distDir, name))
  return `${name} ${(contents.length / 1024).toFixed(1)} kB`
}

// A manifest the troubleshooting guide can point at: "does your h5p-sw.js match your element?"
const packageJson = JSON.parse(await readFile(resolve(rootDir, 'package.json'), 'utf8'))
await writeFile(
  resolve(distDir, 'VERSION'),
  `${packageJson.version}\n`,
  'utf8'
)

console.log(`[build-workers] ${await sizeOf('h5p-sw.js')}, ${await sizeOf('h5p-sw-mount.js')}`)
