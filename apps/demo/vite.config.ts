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
import { codeBlocksPlugin } from './scripts/lib/code-blocks.mjs'
import { PAGES } from './scripts/lib/pages.mjs'
import { partialsPlugin } from './scripts/lib/partials.mjs'

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
// What the SCORM page's zip names as the player's version, since the pages build the element from source.
const PLAYER_VERSION: string = JSON.parse(readFileSync(resolve(playerDir, 'package.json'), 'utf8')).version
// The cmi5 wiring from its source too, so the demo needs no build of it either.
const CMI5 = resolve(repositoryRoot, 'packages', 'cmi5', 'src', 'index.ts')

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

/**
 * Serves the player's built element and Jobs worker at the site root in dev, for the SCORM page,
 * which puts them into the zip it builds and so needs the files a host deploys, not the modules
 * the pages run from source. They are the player's `dist/`, which `pnpm build` writes; before
 * that the page says so. The build emits `h5p-player.js` there itself and `scripts/build-demo.mjs`
 * writes `h5p-jobs.js` beside it.
 */
function playerDistPlugin(): Plugin {
  const dist = resolve(playerDir, 'dist')
  return {
    name: 'h5p-player-dist',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0]
        if (path !== '/h5p-player.js' && path !== '/h5p-jobs.js') return next()
        try {
          const source = readFileSync(resolve(dist, path.slice(1)))
          res.setHeader('content-type', 'text/javascript; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.end(source)
        } catch {
          res.statusCode = 404
          res.end(`// ${path} is not built: run pnpm build in the repository first.`)
        }
      })
    }
  }
}

/**
 * Serves `/resizer.js` in dev from the embed package, where the script lives; the build copies the
 * same file to the site root (`scripts/build-demo.mjs`).
 */
function resizerPlugin(): Plugin {
  const file = resolve(repositoryRoot, 'packages', 'embed', 'site', 'resizer.js')
  return {
    name: 'h5p-resizer',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/resizer.js') return next()
        res.setHeader('content-type', 'text/javascript; charset=utf-8')
        // Read on every request and never cached, so an edit shows on the next reload.
        res.setHeader('cache-control', 'no-store')
        res.end(readFileSync(file))
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
    resizerPlugin(),
    playerDistPlugin(),
    // The demo content first, then the player's fixtures: the pages use the former, and the
    // latter stay reachable for trying a fixture against the dev server.
    noRangeFixturesPlugin([resolve(rootDir, 'demo', 'content'), PLAYER_FIXTURES]),
    // The shared header and head first, so the passes after it see a whole page.
    partialsPlugin(resolve(rootDir, 'partials')),
    siteUrlPlugin(process.env.SITE_URL ?? (command === 'serve' ? 'http://localhost:5173' : 'http://localhost:4173')),
    // After the site URL, so a snippet shows the real address.
    codeBlocksPlugin()
  ],

  define: {
    __PLAYER_VERSION__: JSON.stringify(PLAYER_VERSION)
  },

  resolve: {
    // Not the player's `./plan`, which the SCORM page's builder imports. Taken from source, its
    // modules are the element's too, and the build split them into a chunk `h5p-player.js`
    // imports, while the page's zip carries that file alone. So the build makes the player's
    // `dist/h5p-plan.js` first (`build` in package.json), as `pnpm dev` does.
    alias: [
      { find: /^@missing-elements\/h5p-offline-player$/, replacement: ELEMENT },
      // The page's stylesheet the same way: player-page.css imports it by the package's name, and
      // here that is the source, so the demo needs no build of the player for it either.
      { find: /^@missing-elements\/h5p-offline-player\/page\.css$/, replacement: resolve(playerDir, 'page', 'page.css') },
      { find: /^@missing-elements\/h5p-cmi5$/, replacement: CMI5 }
    ]
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
        ...Object.fromEntries(PAGES.map((page) => [page.name, resolve(rootDir, page.file)]))
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
