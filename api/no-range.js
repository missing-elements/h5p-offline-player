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

  const origin = deploymentOrigin(request)
  /** @type {Record<string, string>} */
  const headers = {}
  // A preview deployment behind Vercel's deployment protection answers an anonymous fetch with
  // its login page; the bypass secret, when the project has one, gets the file instead. Only
  // ever to Vercel's own deployment hosts, whatever the origin turned out to be.
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  if (secret && new URL(origin).hostname.endsWith('.vercel.app')) {
    headers['x-vercel-protection-bypass'] = secret
  }

  const upstream = await fetch(`${origin}/demo/content/${name}`, { headers })
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

/**
 * Where this deployment's static files are, from Vercel's environment rather than from the
 * request: the production domain for production, the deployment's own URL for a preview. The
 * request's `Host` is the fallback for `vercel dev`, which sets neither and runs on localhost.
 *
 * @param {import('node:http').IncomingMessage} request
 */
function deploymentOrigin(request) {
  const { VERCEL_ENV, VERCEL_PROJECT_PRODUCTION_URL, VERCEL_URL } = process.env
  if (VERCEL_ENV === 'production' && VERCEL_PROJECT_PRODUCTION_URL) return `https://${VERCEL_PROJECT_PRODUCTION_URL}`
  if (VERCEL_URL) return `https://${VERCEL_URL}`
  return `http://${String(request.headers.host ?? 'localhost')}`
}
