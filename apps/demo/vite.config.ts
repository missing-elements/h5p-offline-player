import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import {
  PLAYER_FIXTURES,
  devServiceWorkerPlugin,
  jobsWorkerPlugin,
  noRangeFixturesPlugin
} from '../../packages/player/vite.plugins'
import { bundleHostWorker } from '../../packages/player/scripts/lib/worker-bundle.mjs'

/**
 * The demo app: the dev server for the whole repository, and the hosted demo — the player page
 * and the examples under `demo/`, built as a static site into `dist-demo/`. The element is
 * emitted unhashed at `/h5p-player.js`, and `scripts/build-demo.mjs` puts `h5p-sw.js` and
 * `frame-assets/` beside it, so the site root has exactly the layout of the package's `dist/` —
 * the element finds its worker and its assets with no attribute set, the same way it does in a
 * consuming app that serves `dist/` statically.
 *
 * The element is compiled from the player's source, not taken from its `dist/`: the pages import
 * `@missing-elements/h5p-offline-player` and the alias below points the name at the source, with
 * the player's own plugins supplying the Jobs worker and, in dev, the Service Worker.
 */

const rootDir = import.meta.dirname
const repositoryRoot = resolve(rootDir, '..', '..')
const playerDir = resolve(repositoryRoot, 'packages', 'player')
const ELEMENT = resolve(playerDir, 'src', 'h5p-offline-player.ts')

/** The production headers, so `vite preview` enforces the same CSP the deployment will. */
type HeaderRule = { source: string; headers: Array<{ key: string; value: string }> }
const vercel = JSON.parse(readFileSync(resolve(repositoryRoot, 'vercel.json'), 'utf8')) as { headers: HeaderRule[] }
const siteHeaders = Object.fromEntries(
  (vercel.headers.find((rule) => rule.source === '/(.*)')?.headers ?? []).map((header) => [header.key, header.value])
)

/**
 * Replaces `%SITE_URL%` in the pages. Canonical links and social-card URLs have to be absolute,
 * and the origin is only known where the site is built — Vercel's production URL, or localhost.
 * It runs before Vite's own `%ENV%` pass, which would otherwise warn about a name it does not
 * know.
 */
function siteUrlPlugin(siteUrl: string): Plugin {
  const origin = siteUrl.replace(/\/$/, '')
  return {
    name: 'h5p-site-url',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replaceAll('%SITE_URL%', origin)
    }
  }
}

/**
 * Serves the installable app's worker, `app/sw.js`, in dev: bundled on each request with the
 * player's handlers built from source, and an empty precache, so dev always goes to the server.
 * The build writes the real one — see `scripts/build-demo.mjs`. Registered as a middleware ahead
 * of Vite's own, which would otherwise serve the file as an ES module, imports unresolved.
 */
function appWorkerPlugin(): Plugin {
  const entry = resolve(rootDir, 'app', 'sw.js')
  return {
    name: 'h5p-app-worker',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/app/sw.js') return next()
        bundleHostWorker(entry, { dev: true, define: { __APP_PRECACHE__: JSON.stringify({ version: 'dev', urls: [] }) } }).then(
          (source) => {
            res.setHeader('content-type', 'text/javascript; charset=utf-8')
            res.setHeader('cache-control', 'no-store')
            res.end(source)
          },
          (error: unknown) => {
            res.statusCode = 500
            res.end(`// Failed to bundle the app worker\n// ${String(error)}`)
          }
        )
      })
    }
  }
}

export default defineConfig(({ command }) => ({
  // `SITE_URL` is set by `scripts/build-demo.mjs`; alone, this config builds for a local preview.
  plugins: [
    jobsWorkerPlugin(),
    devServiceWorkerPlugin(),
    appWorkerPlugin(),
    // The demo content first, then the player's fixtures: the pages use the former, and the
    // latter stay reachable for trying a fixture against the dev server.
    noRangeFixturesPlugin([resolve(rootDir, 'demo', 'content'), PLAYER_FIXTURES]),
    siteUrlPlugin(process.env.SITE_URL ?? (command === 'serve' ? 'http://localhost:5173' : 'http://localhost:4173'))
  ],

  resolve: {
    alias: [{ find: /^@missing-elements\/h5p-offline-player$/, replacement: ELEMENT }]
  },

  // In dev, the player's generated `public/`: the vendored runtime at `/frame-assets/`, where the
  // element looks for it in dev, and the fixtures at `/fixtures/`. Not in a build: that folder
  // also holds whatever real packages were dropped in to try, and the build script copies the
  // frame assets by name.
  publicDir: command === 'serve' ? resolve(playerDir, 'public') : false,

  build: {
    target: 'es2022',
    outDir: 'dist-demo',
    emptyOutDir: true,
    // Read by `scripts/build-demo.mjs` for the app's precache list — the files the app page
    // pulls in, whatever their hashes — and deleted there, so it is not deployed.
    manifest: true,
    rollupOptions: {
      input: {
        'h5p-player': ELEMENT,
        index: resolve(rootDir, 'index.html'),
        embed: resolve(rootDir, 'embed.html'),
        demo: resolve(rootDir, 'demo/index.html'),
        setup: resolve(rootDir, 'demo/setup.html'),
        normalize: resolve(rootDir, 'demo/normalize.html'),
        xapi: resolve(rootDir, 'demo/xapi.html'),
        'local-file': resolve(rootDir, 'demo/local-file.html'),
        'demo-embed': resolve(rootDir, 'demo/embed.html'),
        'two-players': resolve(rootDir, 'demo/two-players.html'),
        app: resolve(rootDir, 'app/index.html')
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
}))
