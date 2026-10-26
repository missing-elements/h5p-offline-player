import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { existsSync, statSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve } from 'node:path'

/** @import { IncomingMessage, ServerResponse } from 'node:http' */

/**
 * What the check and the preview share: the package on disk, the library sources, and the server
 * on localhost for the player, the runtime and the pack. None of it loads Playwright, which only
 * the check needs, so that the preview starts without it and a host that bundles the preview
 * server — the VS Code extension, packages/vscode — carries none of it.
 */

const require = createRequire(import.meta.url)

/** @type {Record<string, string>} */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
}

export class VerifyError extends Error {}

/**
 * The package's absolute path and size. A missing file, a folder, or a file that cannot be read
 * says which, before anything starts.
 * @internal
 * @param {string} file
 * @returns {Promise<{ path: string, size: number }>}
 */
export async function packageFile(file) {
  const path = resolve(file)
  let found
  try {
    found = await stat(path)
  } catch (error) {
    // Only a missing file is "no such file"; a file that cannot be read says why.
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    throw new VerifyError(code === 'ENOENT' ? `No such file: ${path}` : `Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!found.isFile()) throw new VerifyError(`Not a file: ${path}`)
  return { path, size: found.size }
}

/** Where the verifier serves a copy of the pack named on disk, which the element's `pack-base` names. */
const PACK_ROUTE = '/__pack/'

/**
 * `libraries` as the element reads it, with each bundle on disk given a route on the verifier's
 * own server, and a folder on disk — a copy of the pack's `parts/` — served as the pack, which
 * `packBase` then names: `pack` and URLs pass as they are. A path that names nothing is an error
 * before anything starts.
 * @internal
 * @param {string | undefined} value
 */
export function librarySources(value) {
  /** @type {Map<string, string>} */
  const files = new Map()
  /** @type {string | null} */
  let packDir = null
  if (!value) return { attribute: null, files, packDir, packBase: null }
  const tokens = value.split(/\s+/).filter(Boolean).map((token) => {
    if (token === 'pack' || /^https?:\/\//i.test(token)) return token
    const path = resolve(token)
    if (!existsSync(path)) throw new VerifyError(`No such library bundle: ${path}`)
    if (statSync(path).isDirectory()) {
      if (!existsSync(join(path, 'index.json'))) throw new VerifyError(`${path} is a folder, and not a copy of the library pack: it has no index.json`)
      if (packDir && packDir !== path) throw new VerifyError(`--libraries names two copies of the library pack: ${packDir} and ${path}`)
      packDir = path
      return 'pack'
    }
    const route = `/__libraries/${files.size}.h5p`
    files.set(route, path)
    return route
  })
  return { attribute: [...new Set(tokens)].join(' '), files, packDir, packBase: packDir ? PACK_ROUTE : null }
}

/**
 * The player's `dist/` and the runtime's, from the installed packages; the workspace needs both
 * built first. The runtime is a package of its own (`@missing-elements/h5p-runtime`, GPL) and is
 * served at `/frame-assets/`, which is where the element looks beside its own script.
 * @internal
 */
export async function playerDist() {
  const element = require.resolve('@missing-elements/h5p-offline-player')
  const dist = dirname(element)
  if (!existsSync(join(dist, 'h5p-sw.js'))) {
    throw new VerifyError(`The player is not built at ${dist} — run \`pnpm build\` in the workspace, or reinstall the package`)
  }
  const runtime = join(dirname(require.resolve('@missing-elements/h5p-runtime/package.json')), 'dist')
  if (!existsSync(join(runtime, 'h5p.css')) || !existsSync(join(runtime, 'frame-boot.js'))) {
    throw new VerifyError(`The H5P runtime is not built at ${runtime} — run \`pnpm build\` in the workspace, or reinstall @missing-elements/h5p-runtime`)
  }
  return { dist, runtime }
}

/**
 * A server on localhost for the player, the runtime and any library bundle named on disk. `own`
 * answers first, for the paths its caller adds — the check's page; a preview's page, package and
 * presence — and says whether it did.
 * @internal
 * @param {{ dist: string, runtime: string }} roots
 * @param {{ files: Map<string, string>, packDir: string | null }} sources bundles on disk by route, and a
 *   copy of the pack's `parts/`, served under `PACK_ROUTE`
 * @param {(path: string, request: IncomingMessage, response: ServerResponse) => boolean | Promise<boolean>} own
 * @param {number} [port] the port to take; any free one when it is taken, or with 0
 * @returns {Promise<{ url: string, close: () => void }>}
 */
export function serve({ dist, runtime }, { files: bundles, packDir }, own, port = 0) {
  const ASSETS = '/frame-assets/'
  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
      if (await own(path, request, response)) return
      /**
       * @param {string} root
       * @param {string} rest
       */
      const safe = (root, rest) => join(root, normalize(rest).replace(/^(\.\.[/\\])+/, ''))
      const bundle = bundles.get(path)
      const inPack = packDir !== null && path.startsWith(PACK_ROUTE)
      const target =
        bundle ?? (inPack ? safe(packDir, path.slice(PACK_ROUTE.length)) : path.startsWith(ASSETS) ? safe(runtime, path.slice(ASSETS.length)) : safe(dist, path))
      if (!bundle && !target.startsWith(dist) && !target.startsWith(runtime) && !(inPack && target.startsWith(packDir))) {
        response.writeHead(403).end()
        return
      }
      await sendFile(target, response)
    } catch (error) {
      // A path that does not decode, or a file that went away mid-answer: the server goes on.
      if (!response.headersSent) response.writeHead(error instanceof URIError ? 400 : 500).end()
      else response.destroy()
    }
  })
  return new Promise((resolveServer, rejectServer) => {
    server.on('error', (error) => {
      // The port asked for is taken, by another preview or another program: any free one will do.
      if (/** @type {NodeJS.ErrnoException} */ (error).code === 'EADDRINUSE' && port !== 0) {
        port = 0
        server.listen(0, '127.0.0.1')
      } else rejectServer(error)
    })
    server.once('listening', () => {
      const { port: bound } = /** @type {import('node:net').AddressInfo} */ (server.address())
      resolveServer({
        url: `http://127.0.0.1:${bound}`,
        // A connection left open — a browser's keep-alive, a preview tab's presence — would hold it.
        close: () => {
          server.closeAllConnections()
          server.close()
        }
      })
    })
    server.listen(port, '127.0.0.1')
  })
}

/**
 * A file whole, with its type and no caching, or a 404.
 * @internal
 * @param {string} target
 * @param {ServerResponse} response
 */
export async function sendFile(target, response) {
  let body
  try {
    body = await readFile(target)
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found')
    return
  }
  response.writeHead(200, {
    'Content-Type': MIME[extname(target)] ?? 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  })
  response.end(body)
}
