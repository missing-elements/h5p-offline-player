import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { jobsWorkerPlugin, noRangeFixturesPlugin, siteUrlPlugin } from './vite.plugins'

/**
 * The hosted demo: the player page and the examples under `demo/`, built as a static site into
 * `dist-demo/`. The element is emitted unhashed at `/h5p-player.js`, and `scripts/build-demo.mjs`
 * puts `h5p-sw.js` and `frame-assets/` beside it, so the site root has exactly the layout of the
 * package's `dist/` — the element finds its worker and its assets with no attribute set, the
 * same way it does in a consuming app that serves `dist/` statically.
 */

const rootDir = import.meta.dirname
const ELEMENT = resolve(rootDir, 'src/h5p-offline-player.ts')

/** The production headers, so `vite preview` enforces the same CSP the deployment will. */
type HeaderRule = { source: string; headers: Array<{ key: string; value: string }> }
const vercel = JSON.parse(readFileSync(resolve(rootDir, 'vercel.json'), 'utf8')) as { headers: HeaderRule[] }
const siteHeaders = Object.fromEntries(
  (vercel.headers.find((rule) => rule.source === '/(.*)')?.headers ?? []).map((header) => [header.key, header.value])
)

export default defineConfig({
  // `SITE_URL` is set by `scripts/build-demo.mjs`; alone, this config builds for a local preview.
  plugins: [jobsWorkerPlugin(), noRangeFixturesPlugin(), siteUrlPlugin(process.env.SITE_URL ?? 'http://localhost:4173')],

  // Not `public/` wholesale: it also holds whatever real packages were dropped in to try against
  // the dev server. The build script copies the frame assets and the generated fixtures by name.
  publicDir: false,

  build: {
    target: 'es2022',
    outDir: 'dist-demo',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'h5p-player': ELEMENT,
        index: resolve(rootDir, 'index.html'),
        embed: resolve(rootDir, 'embed.html'),
        demo: resolve(rootDir, 'demo/index.html'),
        setup: resolve(rootDir, 'demo/setup.html'),
        xapi: resolve(rootDir, 'demo/xapi.html'),
        'local-file': resolve(rootDir, 'demo/local-file.html'),
        'demo-embed': resolve(rootDir, 'demo/embed.html'),
        'two-players': resolve(rootDir, 'demo/two-players.html')
      },
      output: {
        entryFileNames: (chunk) => (chunk.facadeModuleId === ELEMENT ? 'h5p-player.js' : 'assets/[name]-[hash].js'),
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  },

  preview: {
    headers: siteHeaders
  }
})
