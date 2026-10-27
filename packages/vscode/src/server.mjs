import { createHash } from 'node:crypto'
import { sendArchive } from '../../verify/lib/preview.mjs'
import { librarySources, serve } from '../../verify/lib/serve.mjs'
import { viewPage } from './page.mjs'

/**
 * The window's preview server: the player, the runtime and the library pack the extension
 * carries, a page for each package open in a preview, and the package itself as a static host with
 * `Range` serves it. It is the verifier's server (`serve`, `sendArchive`), from this checkout and
 * bundled, because a webview's own origin cannot register a Service Worker — the spec takes
 * `http` and `https` script URLs only — while a page it frames from 127.0.0.1 can.
 */

/**
 * The ports the server tries, in order, before any free one. Each is an origin, and VS Code keeps
 * the player's worker and caches for each origin it has framed, so the address has to be the same
 * from one session to the next: the first window takes 4646, a second the next free one, and so
 * on, where any free port would be a new origin each time a window's server starts. Not the
 * command's 4645, which Open in Browser's preview takes.
 */
export const PORTS = Array.from({ length: 10 }, (_, index) => 4646 + index)

/** A package's id on the server, its page `/view/<id>` and its archive `/__package/<id>/<name>`. */
const ID = /^[0-9a-f]{16}$/

/**
 * The id a package is served under: a hash of its URI, so that the same file has the same address
 * — and the element its caches — from one session to the next, and a changed file is a new
 * package to it by its validator, the file's size and time.
 * @param {string} key the package's URI
 */
export function packageId(key) {
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}

/**
 * A language tag as the element takes it, for a package that names none; anything else is none.
 * @param {string | null | undefined} value
 */
export function languageTag(value) {
  return value && /^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/i.test(value) ? value : null
}

/**
 * @typedef {object} PreviewServer
 * @property {string} url `http://127.0.0.1:<port>`, no trailing slash
 * @property {(file: string, name: string, key: string) => string} add serves `file` under the id of `key`
 *   and returns the id; the same key again counts one more preview of it
 * @property {(id: string) => void} remove one preview fewer; the package stops being served with its last
 * @property {() => void} close
 */

/**
 * @param {object} options
 * @param {{ dist: string, runtime: string }} options.roots the player's files and the runtime's
 * @param {string} options.packDir the library pack's parts, served as the pack
 * @param {number | number[]} [options.port] the port, or the ports in order, before any free one;
 *   0 for any free one at once
 * @param {() => boolean} [options.restricted] whether the workspace is in Restricted Mode, asked at
 *   each page: while it is, every page plays untrusted, whatever its address says
 * @returns {Promise<PreviewServer>}
 */
export async function startServer({ roots, packDir, port = PORTS, restricted = () => false }) {
  const sources = librarySources(packDir)
  /** @type {Map<string, { file: string, name: string, previews: number }>} */
  const packages = new Map()

  const server = await serve(
    roots,
    sources,
    async (path, request, response) => {
      const view = /^\/view\/([^/]+)$/.exec(path)
      if (view) {
        const entry = ID.test(view[1]) ? packages.get(view[1]) : undefined
        if (!entry) {
          response.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found')
          return true
        }
        const query = new URL(request.url ?? '/', 'http://localhost').searchParams
        const page = viewPage({
          name: entry.name,
          src: `/__package/${view[1]}/${encodeURIComponent(entry.name)}`,
          packBase: sources.packBase,
          // Restricted Mode is the server's to keep, not the address's: an untrusted package's
          // content keeps its links, and one to its own page without the flag, clicked, would
          // otherwise play it trusted. The tab's switch in a trusted workspace is the address's.
          untrusted: restricted() || query.get('untrusted') === '1',
          newest: query.get('newest') !== '0',
          lang: languageTag(query.get('lang'))
        })
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(page)
        return true
      }
      const archive = /^\/__package\/([^/]+)\/([^/]+)$/.exec(path)
      if (archive) {
        const entry = ID.test(archive[1]) ? packages.get(archive[1]) : undefined
        if (!entry || entry.name !== archive[2]) {
          response.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found')
          return true
        }
        await sendArchive(entry.file, request, response)
        return true
      }
      return false
    },
    port
  )

  return {
    url: server.url,
    add(file, name, key) {
      const id = packageId(key)
      const entry = packages.get(id)
      // A file copied again for a remote workspace has a new path under the same key.
      if (entry) Object.assign(entry, { file, name, previews: entry.previews + 1 })
      else packages.set(id, { file, name, previews: 1 })
      return id
    },
    remove(id) {
      const entry = packages.get(id)
      if (entry && --entry.previews === 0) packages.delete(id)
    },
    close: server.close
  }
}
