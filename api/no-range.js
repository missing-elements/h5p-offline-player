import { Readable } from 'node:stream'

/**
 * A host that ignores `Range`, for the hosted demo. Vercel's own static files honour Range,
 * which is the easy path; the common case in the wild — a plain file host that answers `200`
 * with the whole body — is what this stands in for. It reads the fixture back from the
 * deployment's static files and returns it in one piece: no `Accept-Ranges`, and the request's
 * `Range` header ignored. `vercel.json` rewrites `/no-range/<name>` here; dev and preview have
 * the same route in `vite.plugins.ts`. It serves the demo content only: the test fixtures do not
 * ship with the site.
 */

export const config = { supportsResponseStreaming: true }

/**
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 */
export default async function handler(request, response) {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const name = url.searchParams.get('name') ?? ''
  if (!/^[\w.-]+\.h5p$/.test(name)) {
    response.statusCode = 400
    response.end('bad fixture name')
    return
  }

  const protocol = String(request.headers['x-forwarded-proto'] ?? 'https').split(',')[0]
  const host = String(request.headers['x-forwarded-host'] ?? request.headers.host).split(',')[0]
  /** @type {Record<string, string>} */
  const headers = {}
  // A preview deployment behind Vercel's deployment protection answers an anonymous fetch with
  // its login page; the bypass secret, when the project has one, gets the file instead.
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  }

  const upstream = await fetch(`${protocol}://${host}/demo/content/${name}`, { headers })
  if (!upstream.ok || !upstream.body) {
    response.statusCode = 404
    response.end('no such fixture')
    return
  }

  response.statusCode = 200
  response.setHeader('content-type', 'application/zip')
  response.setHeader('cache-control', 'no-store')
  // `fetch` has already undone any transfer encoding, so the upstream length only holds when
  // there was none.
  const length = upstream.headers.get('content-length')
  if (length && !upstream.headers.get('content-encoding')) response.setHeader('content-length', length)

  Readable.fromWeb(/** @type {any} */ (upstream.body)).pipe(response)
}
