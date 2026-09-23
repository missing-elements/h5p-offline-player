/// <reference types="vitest/config" />
import { readFile } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { build as esbuild } from 'esbuild'
import { playwright } from '@vitest/browser-playwright'

/**
 * Two of this package's three artefacts are not modules the host imports: the Service Worker is
 * registered by URL and the Jobs worker is spawned from a blob. Both are bundled here with
 * esbuild so that dev, test and build all see the same self-contained scripts.
 */

const JOBS_VIRTUAL_ID = 'virtual:h5p-jobs-worker'
const RESOLVED_JOBS_VIRTUAL_ID = '\0virtual:h5p-jobs-worker'

const SW_ENTRY = resolve(import.meta.dirname, 'src/sw/sw-entry.ts')
const JOBS_ENTRY = resolve(import.meta.dirname, 'src/jobs/jobs-worker.ts')

/** A standalone classic script: no imports, no `import.meta`, runnable from a blob or a URL. */
async function bundleWorker(entry: string, minify: boolean): Promise<string> {
  const result = await esbuild({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify,
    legalComments: 'none',
    define: { 'import.meta.env.DEV': String(!minify) }
  })

  return result.outputFiles[0].text
}

/** Supplies the Jobs worker to the element as a string, for `new Worker(blob:)`. */
function jobsWorkerPlugin(): Plugin {
  return {
    name: 'h5p-jobs-worker',

    resolveId(id) {
      return id === JOBS_VIRTUAL_ID ? RESOLVED_JOBS_VIRTUAL_ID : null
    },

    async load(id) {
      if (id !== RESOLVED_JOBS_VIRTUAL_ID) return null
      const source = await bundleWorker(JOBS_ENTRY, this.environment?.mode === 'build')
      return `export default ${JSON.stringify(source)};`
    },

    // esbuild bundles this worker behind Vite's back, so Vite has no idea which files it is made
    // of. Without this, editing anything the worker imports leaves the old bundle in the module
    // cache and the page keeps running code that no longer exists on disk.
    handleHotUpdate({ file, server }) {
      if (!file.startsWith(resolve(import.meta.dirname, 'src'))) return
      const virtualModule = server.moduleGraph.getModuleById(RESOLVED_JOBS_VIRTUAL_ID)
      if (virtualModule) server.moduleGraph.invalidateModule(virtualModule)
    }
  }
}

/**
 * Serves the Service Worker during dev and tests. In a built package `dist/h5p-sw.js` sits next
 * to the element and `new URL('./h5p-sw.js', import.meta.url)` finds it; in dev that same URL
 * points at `/src/h5p-sw.js`, which is this.
 */
function devServiceWorkerPlugin(): Plugin {
  return {
    name: 'h5p-dev-service-worker',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0]
        if (!url?.endsWith('/h5p-sw.js')) return next()

        void bundleWorker(SW_ENTRY, false).then(
          (source) => {
            res.setHeader('content-type', 'text/javascript; charset=utf-8')
            // The registration already asks for an `h5p/` sub-scope under this file's directory,
            // which needs no extra permission, but the header costs nothing and helps a host that
            // places the file somewhere unexpected.
            res.setHeader('service-worker-allowed', '/')
            res.setHeader('cache-control', 'no-store')
            res.end(source)
          },
          (error: unknown) => {
            res.statusCode = 500
            res.end(`// Failed to bundle the H5P service worker\n// ${String(error)}`)
          }
        )
      })
    }
  }
}

/**
 * Serves the test fixtures as a host that ignores `Range` would: status 200, whole body, no
 * `Accept-Ranges`. Vite's own static middleware honours Range, so without this the chunked
 * adapter — the common case in the wild, and the one that downloads before it can index — would
 * never be exercised.
 */
async function sendThrottled(res: ServerResponse, body: Buffer, bytesPerSecond: number): Promise<void> {
  const slice = 64 * 1024
  for (let at = 0; at < body.length; at += slice) {
    const piece = body.subarray(at, Math.min(at + slice, body.length))
    if (!res.write(piece)) await new Promise((resolve) => res.once('drain', resolve))
    await new Promise((resolve) => setTimeout(resolve, (piece.length / bytesPerSecond) * 1000))
  }
  res.end()
}

function noRangeFixturesPlugin(): Plugin {
  const prefix = '/no-range/'

  return {
    name: 'h5p-no-range-fixtures',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (!url.pathname.startsWith(prefix)) return next()

        const name = url.pathname.slice(prefix.length)
        if (name.includes('/') || name.includes('..')) {
          res.statusCode = 400
          return res.end('bad fixture name')
        }
        // `?throttle=<bytes per second>` paces the body, so a test can watch the player boot from
        // the forward index while the rest of the archive is still on its way.
        const throttle = Number(url.searchParams.get('throttle') ?? 0)

        readFile(resolve(import.meta.dirname, 'public/fixtures', name)).then(
          (body) => {
            res.setHeader('content-type', 'application/zip')
            res.setHeader('content-length', String(body.length))
            res.setHeader('cache-control', 'no-store')
            // Deliberately no `accept-ranges`, and the `range` header on the request is ignored.
            res.statusCode = 200
            if (throttle > 0) void sendThrottled(res, body, throttle)
            else res.end(body)
          },
          () => {
            res.statusCode = 404
            res.end('no such fixture')
          }
        )
      })
    }
  }
}

export default defineConfig({
  plugins: [jobsWorkerPlugin(), devServiceWorkerPlugin(), noRangeFixturesPlugin()],

  build: {
    target: 'es2022',
    lib: {
      name: 'H5PPlayerElement',
      entry: resolve(import.meta.dirname, 'src/h5p-offline-player.ts'),
      fileName: () => 'h5p-player.js',
      formats: ['es']
    },
    rollupOptions: {
      output: { assetFileNames: '[name][extname]' }
    },
    copyPublicDir: false,
    emptyOutDir: true
  },

  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts']
        }
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['tests/browser/**/*.test.ts'],
          browser: {
            enabled: true,
            // From Vitest 4 on, a provider is a package rather than a name.
            provider: playwright(),
            headless: true,
            // Chromium only: the paths this exercises — Service Worker registration on a nested
            // scope, Range responses synthesized by a worker — are where browsers differ most,
            // and a second engine belongs in CI rather than in the default run.
            instances: [{ browser: 'chromium' }]
          }
        }
      }
    ]
  }
})
