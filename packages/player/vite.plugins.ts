import { readFile, stat } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import type { Connect, Plugin } from 'vite'
import { build as esbuild } from 'esbuild'
import { FRAME_BOOT_ENTRY, FRAME_BOOT_VIRTUAL_ID, bundleFrameBoot, frameBootEsbuildPlugin } from './scripts/lib/frame-boot-plugin.mjs'

/**
 * The plugins both Vite configs share. `vite.config.ts` is the library build, the dev server and
 * the test runner; `vite.demo.config.ts` is the hosted demo. Two of the package's three
 * artefacts are not modules the host imports — the Service Worker is registered by URL and the
 * Jobs worker is spawned from a blob — so both are bundled here with esbuild, and dev, test,
 * build and demo all see the same self-contained scripts.
 */

const JOBS_VIRTUAL_ID = 'virtual:h5p-jobs-worker'
const RESOLVED_JOBS_VIRTUAL_ID = '\0virtual:h5p-jobs-worker'

const rootDir = import.meta.dirname
const SW_ENTRY = resolve(rootDir, 'src/sw/sw-entry.ts')
const JOBS_ENTRY = resolve(rootDir, 'src/jobs/jobs-worker.ts')

/** A standalone classic script: no imports, no `import.meta`, runnable from a blob or a URL. */
export async function bundleWorker(entry: string, minify: boolean): Promise<string> {
  const result = await esbuild({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify,
    legalComments: 'none',
    define: { 'import.meta.env.DEV': String(!minify) },
    plugins: [frameBootEsbuildPlugin(minify)]
  })

  return result.outputFiles[0].text
}

const RESOLVED_FRAME_BOOT_ID = `\0${FRAME_BOOT_VIRTUAL_ID}`

/**
 * Supplies the frame's boot script to `frame-document.ts` as a string when that module is loaded
 * through Vite — the unit tests — the same way esbuild supplies it to the worker bundles. Always
 * minified: what the tests see is what ships.
 */
export function frameBootPlugin(): Plugin {
  return {
    name: 'h5p-frame-boot',

    resolveId(id) {
      return id === FRAME_BOOT_VIRTUAL_ID ? RESOLVED_FRAME_BOOT_ID : null
    },

    async load(id) {
      if (id !== RESOLVED_FRAME_BOOT_ID) return null
      return `export default ${JSON.stringify(await bundleFrameBoot(true))};`
    },

    handleHotUpdate({ file, server }) {
      if (file !== FRAME_BOOT_ENTRY) return
      const virtualModule = server.moduleGraph.getModuleById(RESOLVED_FRAME_BOOT_ID)
      if (virtualModule) server.moduleGraph.invalidateModule(virtualModule)
    }
  }
}

/** Supplies the Jobs worker to the element as a string, for `new Worker(blob:)`. */
export function jobsWorkerPlugin(): Plugin {
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
      if (!file.startsWith(resolve(rootDir, 'src'))) return
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
export function devServiceWorkerPlugin(): Plugin {
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
 * Two stand-ins for hosts the tests cannot reach. `/no-range/` serves the demo content and the
 * test fixtures as a host that ignores `Range` would: status 200, whole body, no `Accept-Ranges`.
 * Vite's own static middleware honours Range, so without this the chunked adapter — the common
 * case in the wild, and the one that downloads before it can index — would never be exercised.
 * The same route exists on the hosted demo as `api/no-range.js`, for the demo content only.
 * `/compressing/` is a host that honours Range but compresses the archive; see below.
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

/** The demo content first, the test fixtures second: the pages use the former, the browser tests the latter, and the names do not collide. */
function archivePath(name: string): Promise<string> {
  const inDemo = resolve(rootDir, 'demo/content', name)
  return stat(inDemo).then(
    () => inDemo,
    () => resolve(rootDir, 'public/fixtures', name)
  )
}

function readArchive(name: string): Promise<Buffer> {
  return archivePath(name).then((path) => readFile(path))
}

/** The last path segment of a fixture route, or null for anything that is not a plain name. */
function fixtureName(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null
  const name = pathname.slice(prefix.length)
  return name.includes('/') || name.includes('..') ? null : name
}

function noRangeHandler(): Connect.NextHandleFunction {
  const prefix = '/no-range/'

  return (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const name = fixtureName(url.pathname, prefix)
    if (!name) return next()
    // `?throttle=<bytes per second>` paces the body, so a test can watch the player boot from
    // the forward index while the rest of the archive is still on its way.
    const throttle = Number(url.searchParams.get('throttle') ?? 0)

    readArchive(name).then(
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
  }
}

/**
 * Serves the demo content and the fixtures as GitHub Pages does: `Range` honoured, CORS open,
 * nothing exposed beyond the safelisted headers — and the archive gzipped on the way out for a
 * client that accepts it, ranges included. A ranged request against the gzipped copy is cut from
 * the gzipped bytes, and `Content-Length` and `Content-Range` then report that copy's length.
 * Browsers ask for `identity` on a ranged request and for gzip on a plain one, so the same
 * archive has two lengths depending on which request asked, and `Content-Encoding` is not
 * readable cross-origin to tell them apart. That is why the probe never takes a size from a
 * plain `GET`; see `source.ts`. The gzipped copies are kept per file, since a fixture is
 * compressed once and asked for many times.
 */
function compressingHostHandler(): Connect.NextHandleFunction {
  const prefix = '/compressing/'
  const gzipped = new Map<string, Buffer>()

  const representation = async (name: string, gzip: boolean): Promise<Buffer> => {
    const path = await archivePath(name)
    const body = await readFile(path)
    if (!gzip) return body
    const key = `${path}@${(await stat(path)).mtimeMs}`
    let copy = gzipped.get(key)
    if (!copy) {
      copy = gzipSync(body)
      gzipped.set(key, copy)
    }
    return copy
  }

  return (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const name = fixtureName(url.pathname, prefix)
    if (!name) return next()

    const gzip = /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')
    representation(name, gzip).then(
      (body) => {
        res.setHeader('content-type', 'application/octet-stream')
        res.setHeader('cache-control', 'no-store')
        res.setHeader('accept-ranges', 'bytes')
        res.setHeader('access-control-allow-origin', '*')
        res.setHeader('vary', 'Accept-Encoding')
        if (gzip) res.setHeader('content-encoding', 'gzip')

        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '')
        if (!range) {
          res.setHeader('content-length', String(body.length))
          res.statusCode = 200
          return res.end(body)
        }
        const start = Number(range[1])
        const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1
        if (start >= body.length) {
          res.setHeader('content-range', `bytes */${body.length}`)
          res.statusCode = 416
          return res.end()
        }
        const piece = body.subarray(start, end + 1)
        res.setHeader('content-length', String(piece.length))
        res.setHeader('content-range', `bytes ${start}-${end}/${body.length}`)
        res.statusCode = 206
        res.end(piece)
      },
      () => {
        res.statusCode = 404
        res.end('no such fixture')
      }
    )
  }
}

/**
 * A host with an outage switch, for the tests that take the link away in the middle of a
 * transfer: `Range` honoured, CORS open, the body paced at `?rate=<bytes per second>` so that a
 * transfer is still under way when the outage begins. `/stalling/__outage?ms=<n>&mode=<m>` starts
 * one. In `silent` mode every response in flight stops writing and every new request waits,
 * headers included, until it is over — a link that has gone quiet. In `reset` mode the responses
 * in flight are destroyed and new requests are answered `503` — a host that is down. Either
 * way nothing is lost that a later request cannot ask for again.
 */
function stallingHostHandler(): Connect.NextHandleFunction {
  const prefix = '/stalling/'
  const inFlight = new Set<ServerResponse>()
  let outageUntil = 0
  let outageMode: 'silent' | 'reset' = 'silent'

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const inOutage = () => Date.now() < outageUntil
  const waitOut = async () => {
    while (inOutage()) await sleep(50)
  }
  const drained = (res: ServerResponse) =>
    new Promise<void>((resolve) => {
      const done = () => {
        res.off('drain', done)
        res.off('close', done)
        resolve()
      }
      res.once('drain', done)
      res.once('close', done)
    })

  const serve = async (req: Connect.IncomingMessage, res: ServerResponse, name: string, rate: number) => {
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('cache-control', 'no-store')
    if (inOutage() && outageMode === 'reset') {
      res.statusCode = 503
      return res.end('outage')
    }
    await waitOut()

    let body: Buffer
    try {
      body = await readArchive(name)
    } catch {
      res.statusCode = 404
      return res.end('no such fixture')
    }

    res.setHeader('content-type', 'application/octet-stream')
    res.setHeader('accept-ranges', 'bytes')
    let piece = body
    res.statusCode = 200
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '')
    if (range) {
      const start = Number(range[1])
      const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1
      if (start >= body.length) {
        res.setHeader('content-range', `bytes */${body.length}`)
        res.statusCode = 416
        return res.end()
      }
      piece = body.subarray(start, end + 1)
      res.setHeader('content-range', `bytes ${start}-${end}/${body.length}`)
      res.statusCode = 206
    }
    res.setHeader('content-length', String(piece.length))
    if (req.method === 'HEAD') return res.end()

    inFlight.add(res)
    try {
      const slice = 64 * 1024
      for (let at = 0; at < piece.length && !res.destroyed; at += slice) {
        if (inOutage()) {
          if (outageMode === 'reset') {
            res.destroy()
            break
          }
          await waitOut()
        }
        const chunk = piece.subarray(at, Math.min(at + slice, piece.length))
        if (!res.write(chunk)) await drained(res)
        if (rate > 0) await sleep((chunk.length / rate) * 1000)
      }
      if (!res.destroyed) res.end()
    } finally {
      inFlight.delete(res)
    }
  }

  return (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === `${prefix}__outage`) {
      outageUntil = Date.now() + Number(url.searchParams.get('ms') ?? 0)
      outageMode = url.searchParams.get('mode') === 'reset' ? 'reset' : 'silent'
      if (outageMode === 'reset') for (const pending of inFlight) pending.destroy()
      res.setHeader('cache-control', 'no-store')
      res.statusCode = 204
      return res.end()
    }
    const name = fixtureName(url.pathname, prefix)
    if (!name) return next()
    void serve(req, res, name, Number(url.searchParams.get('rate') ?? 0))
  }
}

export function noRangeFixturesPlugin(): Plugin {
  return {
    name: 'h5p-no-range-fixtures',
    configureServer(server) {
      server.middlewares.use(noRangeHandler())
      server.middlewares.use(compressingHostHandler())
      server.middlewares.use(stallingHostHandler())
    },
    // `vite preview` of the demo build as well, so the built site can be checked end to end
    // before it is deployed — the deployment gets the route from `vercel.json` instead.
    configurePreviewServer(server) {
      server.middlewares.use(noRangeHandler())
      server.middlewares.use(compressingHostHandler())
      server.middlewares.use(stallingHostHandler())
    }
  }
}

/**
 * Replaces `%SITE_URL%` in the pages. Canonical links and social-card URLs have to be absolute,
 * and the origin is only known where the site is built — Vercel's production URL, or localhost.
 * It runs before Vite's own `%ENV%` pass, which would otherwise warn about a name it does not
 * know.
 */
export function siteUrlPlugin(siteUrl: string): Plugin {
  const origin = siteUrl.replace(/\/$/, '')
  return {
    name: 'h5p-site-url',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replaceAll('%SITE_URL%', origin)
    }
  }
}
