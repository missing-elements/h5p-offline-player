import { resolve } from 'node:path'
import { build } from 'esbuild'

/**
 * The frame's boot script as a string. `frame-document.ts` inlines it in the document the
 * Service Worker synthesizes, under the per-response nonce, and imports it as
 * `virtual:h5p-frame-boot` — resolved here for esbuild, which builds both workers, and by the
 * matching Vite plugin in `vite.plugins.ts` for the unit tests. Built the way the Jobs worker is:
 * a self-contained classic script, minified for what ships and readable in dev.
 */

const rootDir = resolve(import.meta.dirname, '..', '..')

export const FRAME_BOOT_VIRTUAL_ID = 'virtual:h5p-frame-boot'
export const FRAME_BOOT_ENTRY = resolve(rootDir, 'src/sw/frame-boot.ts')

export async function bundleFrameBoot(minify = true) {
  const result = await build({
    entryPoints: [FRAME_BOOT_ENTRY],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify,
    legalComments: 'none'
  })
  return result.outputFiles[0].text.trim()
}

/** For esbuild: the worker bundles import the boot script through the virtual id. */
export function frameBootEsbuildPlugin(minify = true) {
  return {
    name: 'h5p-frame-boot',
    setup(builder) {
      builder.onResolve({ filter: /^virtual:h5p-frame-boot$/ }, (args) => ({
        path: args.path,
        namespace: 'h5p-frame-boot'
      }))
      builder.onLoad({ filter: /.*/, namespace: 'h5p-frame-boot' }, async () => ({
        contents: `export default ${JSON.stringify(await bundleFrameBoot(minify))};`,
        loader: 'js'
      }))
    }
  }
}
