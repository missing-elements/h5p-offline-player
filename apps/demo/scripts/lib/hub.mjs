/**
 * The H5P hub as the build scripts read it: the host, the cache under the OS temp directory, and
 * a download that keeps a copy there. `build-demo-content.mjs` and `build-libraries.mjs` both
 * fetch bundles from it, and each kept its own copy of this until 2026-10-15.
 */
import { createWriteStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/**
 * The hub's current host, which moved here in 2026. A Node fetch needs no CORS headers, which is
 * why the build reads it and the element never does: `libraries="pack"` is the pack this
 * repository builds from it with `pnpm libraries`.
 */
export const HUB = 'https://hub-api.h5p.org/v1/content-types/'

/** Where downloads are kept between runs; `--refresh` on either script fetches again. */
export const cacheDir = join(tmpdir(), 'h5p-hub-cache')

/** @param {string} path */
export const exists = (path) => stat(path).then(() => true, () => false)

/**
 * A file, kept under `name` in the cache. With `refresh`, fetched again; with `optional`, `null`
 * when its host says there is no such file — the old hub host said 404, and S3 behind the new one
 * says 403 for a missing key.
 * @param {string} url
 * @param {string} name
 * @param {{ refresh?: boolean, optional?: boolean, log?: string }} [options]
 */
export async function download(url, name, { refresh = false, optional = false, log = '[hub]' } = {}) {
  await mkdir(cacheDir, { recursive: true })
  const path = join(cacheDir, name)
  if (!refresh && (await exists(path))) return path
  console.log(`${log} fetching ${url}`)
  const response = await fetch(url)
  if (optional && (response.status === 404 || response.status === 403)) return null
  if (!response.ok || !response.body) throw new Error(`${url} returned ${response.status}`)
  await pipeline(Readable.fromWeb(/** @type {any} */ (response.body)), createWriteStream(path))
  return path
}

/**
 * The hub's bundle for a content type, cached; with `optional`, `null` when the hub no longer has it.
 * @param {string} machineName
 * @param {{ refresh?: boolean, optional?: boolean, log?: string }} [options]
 */
export const hubBundle = (machineName, options) => download(`${HUB}${encodeURIComponent(machineName)}`, `${machineName}.h5p`, options)
