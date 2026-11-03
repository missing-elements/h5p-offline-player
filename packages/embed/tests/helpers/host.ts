import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize } from 'node:path'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.h5p': 'application/zip'
}

export type Host = { origin: string; close: () => Promise<void> }

/**
 * A static host for `root`, as GitHub Pages serves a written site: the type and nothing else,
 * CORS open so a package on it can be read from another origin. `extra` answers a path with a page
 * of the test's own.
 */
export async function host(root: string, hostname: string, extra?: (path: string) => string | null): Promise<Host> {
  const server: Server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname)
    const page = extra?.(path)
    if (page != null) {
      response.writeHead(200, { 'Content-Type': MIME['.html'] }).end(page)
      return
    }
    const file = join(root, normalize(path.endsWith('/') ? `${path}index.html` : path).replace(/^(\.\.[/\\])+/, ''))
    try {
      const body = await readFile(file)
      response.writeHead(200, {
        'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
        'Content-Length': body.length,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      })
      response.end(body)
    } catch {
      response.writeHead(404).end()
    }
  })
  await new Promise<void>((done) => server.listen(0, hostname, done))
  const { port } = server.address() as AddressInfo
  return { origin: `http://${hostname}:${port}`, close: () => new Promise((done) => server.close(() => done())) }
}
