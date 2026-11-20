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
 * hand it is 0: a 404 means the dependency was not published, and the check says so at once.
 *
 * `node ../../scripts/published.mjs`, in a package's `prepublishOnly`, checks every dependency the
 * package names by `workspace:`, at the version the workspace has.
 */

/** How often a check asks again while it waits. */
const POLL = 30_000

/**
 * How long one request may take. Node's fetch has no limit of its own beyond undici's five minutes
 * for the headers, and one request to npm hung that long while this was being written.
 */
const REQUEST = 30_000

/** @typedef {{ ok: boolean, status: number | string, json(): Promise<any>, body?: { cancel(): Promise<void> } | null }} Served */

/**
 * The response for `url` once it is not a 404, a server error or a failed request, or the last
 * one when the wait runs out.
 * @param {string} url
 * @param {string} label what is waited for, as the messages name it
 * @param {{ minutes?: number, poll?: number, timeout?: number, fetch?: (url: string, init: { signal: AbortSignal }) => Promise<Served> }} [options]
 *   `minutes`, by default `H5P_PUBLISH_WAIT`, else 0; `timeout`, a request's, by default 30 s
 * @returns {Promise<Served>}
 */
export async function served(url, label, options = {}) {
  const minutes = options.minutes ?? (Number(process.env.H5P_PUBLISH_WAIT) || 0)
  const poll = options.poll ?? POLL
  const get = options.fetch ?? fetch
  const started = Date.now()
  const deadline = started + minutes * 60_000
  for (let attempt = 0; ; attempt++) {
    /** @type {Served} */
    const response = await get(url, { signal: AbortSignal.timeout(options.timeout ?? REQUEST) }).catch((error) => ({
      ok: false,
      status: String(error?.cause?.code ?? (error?.name === 'TimeoutError' ? 'no answer in time' : error?.message) ?? error),
      json: async () => undefined
    }))
    const retry = !response.ok && (typeof response.status !== 'number' || response.status === 404 || response.status >= 500)
    if (!retry || Date.now() + poll > deadline) return response
    await response.body?.cancel().catch(() => {})
    if (attempt % 10 === 0) {
      const waited = Math.round((Date.now() - started) / 60_000)
      console.log(`[published] ${label}: ${response.status}${waited ? ` after ${waited} min` : ''}; waiting up to ${minutes} min for npm to serve it`)
    }
    await new Promise((done) => setTimeout(done, poll))
  }
}

/**
 * The dependencies the package in `folder` names by `workspace:` (in `dependencies`,
 * `optionalDependencies` and `peerDependencies`, not `devDependencies`, which nobody installing it
 * gets), each at the version the workspace has, and whether npm serves it.
 * @param {string} folder a package's folder, beside the others under packages/
 * @param {Parameters<typeof served>[2]} [options]
 * @returns {Promise<{ name: string, version: string, status: number | string, ok: boolean }[]>}
 */
export async function dependenciesServed(folder, options) {
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
  const results = []
  for (const name of named) {
    const version = versions.get(name)
    if (!version) throw new Error(`${name} is named by workspace: in ${join(folder, 'package.json')}, but no package beside it has that name`)
    const response = await served(`https://registry.npmjs.org/${name.replace('/', '%2f')}/${version}`, `${name}@${version}`, options)
    // Only the status is read: the body is let go, so its connection does not keep the process up.
    await response.body?.cancel().catch(() => {})
    results.push({ name, version, status: response.status, ok: response.ok })
  }
  return results
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const folder = process.cwd()
  const results = await dependenciesServed(folder)
  const missing = results.filter((result) => !result.ok)
  for (const { name, version } of results.filter((result) => result.ok)) console.log(`[published] ${name}@${version} is on npm`)
  if (missing.length) {
    for (const { name, version, status } of missing) {
      console.error(`[published] ${name}@${version} is not on npm (${status}). Publish it first: ${JSON.parse(await readFile(join(folder, 'package.json'), 'utf8')).name} depends on it, at that version.`)
    }
    process.exit(1)
  }
}
