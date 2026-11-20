import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Whether npm, and jsDelivr behind it, serve the versions a package of this repository is about to
 * be published against (#253). npm takes a version in, then processes it before it serves it: in
 * release 1.7.0 (2026-11-19) that took 1 to 4 minutes for most packages and 14 for the 31 MB
 * library pack, and a package published in that time names a version nobody can install yet.
 * `publish.yml` publishes a release in dependency order in one run and sets `H5P_PUBLISH_WAIT`, in
 * minutes: there a 404 means the version is still being processed, and the check waits for it. By
 * hand it is 0: a 404 means npm does not serve it, not published or still being processed, and the
 * check says so at once.
 *
 * `node ../../scripts/published.mjs`, in a package's `prepublishOnly`, checks every package of this
 * repository it names by `workspace:` outside `devDependencies`, at the version the workspace has.
 */

/** How often a check asks again while it waits. */
const POLL = 30_000

/**
 * How long one request may take, its body included. Node's fetch has no limit of its own beyond
 * undici's five minutes for the headers, and one request to npm hung that long while this was
 * being written.
 */
const REQUEST = 30_000

/** @typedef {{ ok: boolean, status: number, json(): Promise<any>, body?: { cancel(): Promise<void> } | null }} Answer what a request gives */
/** @typedef {{ ok: boolean, status: number | string, json(): Promise<any> }} Served a response, its body read */

/**
 * When the checks that begin now stop waiting. A script takes it once for all its checks, so it
 * waits `H5P_PUBLISH_WAIT` minutes at most however many versions it asks for.
 * @param {number} [minutes] by default `H5P_PUBLISH_WAIT`, else 0
 */
export const waitUntil = (minutes = Number(process.env.H5P_PUBLISH_WAIT) || 0) => Date.now() + minutes * 60_000

/**
 * The response for `url`, its JSON body read, once it is not a 404, a server error or a request
 * that failed, timed out or could not be read, or the last one when the wait runs out.
 * @param {string} url
 * @param {string} label what is waited for, as the messages name it
 * @param {{ until?: number, minutes?: number, poll?: number, timeout?: number, fetch?: (url: string, init: { signal: AbortSignal }) => Promise<Answer> }} [options]
 *   `until`, when the wait runs out, by default `waitUntil(minutes)`; `timeout`, a request's, by default 30 s
 * @returns {Promise<Served>}
 */
export async function served(url, label, options = {}) {
  const poll = options.poll ?? POLL
  const get = options.fetch ?? fetch
  const started = Date.now()
  const deadline = options.until ?? waitUntil(options.minutes)
  for (let attempt = 0; ; attempt++) {
    const response = await get(url, { signal: AbortSignal.timeout(options.timeout ?? REQUEST) }).then(read).catch(failed)
    const retry = !response.ok && (typeof response.status !== 'number' || response.status === 404 || response.status >= 500)
    if (!retry || Date.now() + poll > deadline) return response
    if (attempt % 10 === 0) {
      const waited = Math.round((Date.now() - started) / 60_000)
      const left = Math.ceil((deadline - Date.now()) / 60_000)
      console.log(`[published] ${label}: ${response.status}${waited ? ` after ${waited} min` : ''}; waiting up to ${left} min more for it to be served`)
    }
    await new Promise((done) => setTimeout(done, poll))
  }
}

/**
 * A success with its body read as JSON, so a body that fails, stalls past the request's limit or
 * is not JSON is a failed request, asked again; any other answer with its body let go, so its
 * connection does not keep the process up.
 * @param {Answer} response
 * @returns {Promise<Served>}
 */
async function read(response) {
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    return { ok: false, status: response.status, json: async () => undefined }
  }
  const data = await response.json()
  return { ok: true, status: response.status, json: async () => data }
}

/**
 * A request that failed, timed out or could not be read, as a response whose status says why.
 * @param {any} error
 * @returns {Served}
 */
const failed = (error) => ({
  ok: false,
  status: String(error?.cause?.code ?? (error?.name === 'TimeoutError' ? 'no answer in time' : error?.message) ?? error),
  json: async () => undefined
})

/** @param {string} what @param {number | string} status */
const unchecked = (what, status) =>
  `[published] ${what} could not be checked (${status}), which says nothing about whether it is there: run the publish again.`

/**
 * Stops a check whose request failed with anything but a 404, the one answer that says a version
 * is not served: after a server error, a refusal, or a request that failed, timed out or could not
 * be read, the check says it could not tell, rather than to publish what may be there.
 * @param {Served} response
 * @param {string} what what was asked for, as the message names it
 */
export function stopUnlessAnswered(response, what) {
  if (response.ok || response.status === 404) return
  console.error(unchecked(what, response.status))
  process.exit(1)
}

/**
 * The dependencies the package in `folder` names by `workspace:` (in `dependencies`,
 * `optionalDependencies` and `peerDependencies`, not `devDependencies`, which nobody installing it
 * gets), each at the version the workspace has, and whether npm serves it. They share one wait.
 * @param {string} folder a package's folder, beside the others under packages/
 * @param {Parameters<typeof served>[2]} [options]
 * @returns {Promise<{ name: string, version: string, status: number | string, ok: boolean }[]>}
 */
export async function dependenciesServed(folder, options = {}) {
  const manifest = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8'))
  const named = Object.entries({ ...manifest.peerDependencies, ...manifest.optionalDependencies, ...manifest.dependencies })
    .filter(([, range]) => String(range).startsWith('workspace:'))
    .map(([name]) => name)
  if (!named.length) return []
  /** @type {Map<string, string>} */
  const versions = new Map()
  const packages = resolve(folder, '..')
  for (const entry of await readdir(packages, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const other = await readFile(join(packages, entry.name, 'package.json'), 'utf8').then(JSON.parse, () => null)
    if (other?.name) versions.set(other.name, other.version)
  }
  const until = options.until ?? waitUntil(options.minutes)
  const results = []
  for (const name of named) {
    const version = versions.get(name)
    if (!version) throw new Error(`${name} is named by workspace: in ${join(folder, 'package.json')}, but no package beside it has that name`)
    const response = await served(`https://registry.npmjs.org/${name.replaceAll('/', '%2f')}/${version}`, `${name}@${version}`, { ...options, until })
    results.push({ name, version, status: response.status, ok: response.ok })
  }
  return results
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const folder = process.cwd()
  const { name: dependent } = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8'))
  const results = await dependenciesServed(folder)
  for (const { name, version, status, ok } of results) {
    if (ok) console.log(`[published] ${name}@${version} is on npm`)
    else if (status === 404) console.error(`[published] ${name}@${version} is not on npm (404). Publish it first: ${dependent} depends on it, at that version.`)
    else console.error(unchecked(`${name}@${version} on npm`, status))
  }
  if (results.some((result) => !result.ok)) process.exit(1)
}
