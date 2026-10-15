import { readFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import type { Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'

/**
 * What the demo's browser tests start and wait on: the site's dev server, a second origin that
 * serves packages with CORS open, and the element's state. Each file once carried its own copy
 * of these, four of the dev server and two of the package host.
 */

export const rootDir = resolve(import.meta.dirname, '..')
export const QUIZ = resolve(rootDir, 'demo', 'content', 'quiz.h5p')
/** Needs a version of the fixture content type only it carries, which the pack has not got. */
export const OWN_CODE_ONLY = resolve(rootDir, '..', '..', 'packages', 'player', 'public', 'fixtures', 'untrusted-newer.h5p')

/** The site's dev server on `localhost`, on a free port. */
export async function startSite(): Promise<{ vite: ViteDevServer; origin: string }> {
  const vite = await createServer({ configFile: resolve(rootDir, 'vite.config.ts'), root: rootDir, server: { host: 'localhost', port: 0 }, logLevel: 'error' })
  await vite.listen()
  return { vite, origin: `http://localhost:${(vite.httpServer!.address() as AddressInfo).port}` }
}

/**
 * Another site: `127.0.0.1` to the site's `localhost`, serving `files` by path with CORS open,
 * so a package from it is a package from elsewhere to every page.
 */
export async function packageHost(
  files: Record<string, string> = { '/quiz.h5p': QUIZ, '/own-code-only.h5p': OWN_CODE_ONLY }
): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = createHttpServer((request, response) => {
    const file = files[new URL(request.url ?? '/', 'http://x').pathname]
    if (!file) return void response.writeHead(404).end()
    readFile(file).then(
      (body) => response.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': body.length, 'Access-Control-Allow-Origin': '*' }).end(body),
      // Answered, so that a file gone from disk fails the test with its reason and not by a timeout.
      (error: unknown) => response.writeHead(500).end(String(error))
    )
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((done) => server.close(() => done()))
  }
}

/** Resolves once the page's player is in one of `states`. */
export const playerIs = (page: Page, ...states: string[]) =>
  page.waitForFunction((states) => states.includes((document.querySelector('h5p-player') as HTMLElement & { state: string }).state), states, { timeout: 60_000 })
