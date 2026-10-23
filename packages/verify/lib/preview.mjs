import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { librarySources, packageFile, playerDist, serve } from './verify.mjs'

/** @import { IncomingMessage, ServerResponse } from 'node:http' */

/**
 * `--preview`: the package in the real player, in the person's own browser, served from this
 * computer. The check says whether a package starts; whether it is right — the answers, a
 * scenario's paths, what happens at a video's timestamps — a person judges by playing it, and
 * that is the same for every content type. The package is served as a static host with `Range`
 * serves it, so the libraries take a few requests and media the ranges the player asks for: a
 * large video starts at once, and nothing is read whole or extracted to disk. It runs until its
 * last tab has gone.
 */

const here = fileURLToPath(new URL('.', import.meta.url))

/**
 * The port a preview takes when it is free: every preview on one origin, so the browser keeps one
 * copy of the player's worker and caches rather than a new one for each run.
 */
const PORT = 4645
/** Where the page finds the package, under its own file name. */
const ARCHIVE_ROUTE = '/__package/'
/** The page's open connection, by which the preview knows a tab still shows it. */
const PRESENCE_ROUTE = '/__preview/events'
/** How often an open tab is written to, so that one the browser dropped without a word is noticed. */
const HEARTBEAT_MS = 15_000

/**
 * @typedef {object} PreviewOptions
 * @property {string} file the `.h5p` to show
 * @property {string} [libraries] where libraries come from, as for the check
 * @property {boolean} [untrusted] play it as a site that did not make it plays it
 * @property {boolean} [refreshLibraries] with the pack, play its newer versions of the libraries the
 *   package carries; default true
 * @property {number} [port] the port to take; default 4645, and any free one when that is taken
 * @property {number} [openWait] ms to wait for a tab before stopping; default ten minutes
 * @property {number} [closeGrace] ms the preview outlives its last tab, so that a reload does not end
 *   it; default 10 s
 * @property {(answer: { range: string | null, bytes: number }) => void} [onArchiveRequest] each answer
 *   for the package: the `Range` asked for, and how many bytes answered it
 */

/**
 * Serves the package and its page until the preview is stopped or stops by itself: `closed`
 * settles with `closed` once its last tab has gone, `unopened` when no tab came within `openWait`,
 * and `stopped` after `close()`.
 * @internal
 * @param {PreviewOptions} options
 * @returns {Promise<{ url: string, closed: Promise<'closed' | 'unopened' | 'stopped'>, close: () => void }>}
 */
export async function previewPackage(options) {
  const { path: file } = await packageFile(options.file)
  const sources = librarySources(options.libraries)
  const name = basename(file)
  const settings = {
    name,
    src: ARCHIVE_ROUTE + encodeURIComponent(name),
    libraries: sources.attribute,
    packBase: sources.packBase,
    refreshLibraries: options.refreshLibraries !== false,
    untrusted: options.untrusted === true
  }
  // `<` as an escape, so that no file name can end the script block it is written into.
  const page = (await readFile(join(here, 'preview.html'), 'utf8')).replace('{{settings}}', () => JSON.stringify(settings).replaceAll('<', '\\u003c'))
  const openWait = options.openWait ?? 10 * 60_000
  const closeGrace = options.closeGrace ?? 10_000

  /** @type {Set<ServerResponse>} */
  const tabs = new Set()
  let seen = false
  let stopped = false
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer
  /** @type {(reason: 'closed' | 'unopened' | 'stopped') => void} */
  let settle = () => {}
  /** @type {Promise<'closed' | 'unopened' | 'stopped'>} */
  const closed = new Promise((resolveClosed) => {
    settle = resolveClosed
  })

  const server = await serve(
    await playerDist(),
    sources,
    async (path, request, response) => {
      if (path === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(page)
        return true
      }
      if (path === ARCHIVE_ROUTE + name) {
        await sendArchive(file, request, response, options.onArchiveRequest)
        return true
      }
      if (path === PRESENCE_ROUTE) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' })
        response.write(': open\n\n')
        tabs.add(response)
        watch()
        request.on('close', () => {
          tabs.delete(response)
          watch()
        })
        return true
      }
      return false
    },
    options.port ?? PORT
  )

  const heartbeat = setInterval(() => {
    for (const tab of tabs) tab.write(': still here\n\n')
  }, HEARTBEAT_MS)

  /** @param {'closed' | 'unopened' | 'stopped'} reason */
  function stop(reason) {
    if (stopped) return
    stopped = true
    clearTimeout(timer)
    clearInterval(heartbeat)
    for (const tab of tabs) tab.end()
    server.close()
    settle(reason)
  }

  // Waits for the first tab; once tabs have come and every one has gone, outlives them by the grace.
  function watch() {
    clearTimeout(timer)
    if (tabs.size > 0) seen = true
    else if (!stopped) timer = setTimeout(() => stop(seen ? 'closed' : 'unopened'), seen ? closeGrace : openWait)
  }

  watch()
  return { url: server.url, closed, close: () => stop('stopped') }
}

/**
 * The package as a static host with `Range` serves it: `206` with the bytes asked for, `200` whole
 * otherwise, streamed from disk. Its validator is the file's size and time, so the package written
 * again at the same path is a new package to the element rather than its old caches.
 * @param {string} file
 * @param {IncomingMessage} request
 * @param {ServerResponse} response
 * @param {PreviewOptions['onArchiveRequest']} report
 */
async function sendArchive(file, request, response, report) {
  const { size, mtimeMs } = await stat(file)
  const headers = {
    'Content-Type': 'application/zip',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    ETag: `"${size.toString(16)}-${Math.trunc(mtimeMs).toString(16)}"`,
    'Last-Modified': new Date(mtimeMs).toUTCString()
  }
  const asked = request.headers.range ?? null
  const range = byteRange(asked, size)
  if (range === false) {
    response.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` }).end()
    report?.({ range: asked, bytes: 0 })
    return
  }
  const { start, end } = range ?? { start: 0, end: size - 1 }
  const length = end - start + 1
  response.writeHead(range ? 206 : 200, {
    ...headers,
    'Content-Length': length,
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {})
  })
  const body = request.method !== 'HEAD' && length > 0
  report?.({ range: asked, bytes: body ? length : 0 })
  if (!body) {
    response.end()
    return
  }
  // A media element drops a range request whenever it seeks; the read ends with it.
  await pipeline(createReadStream(file, { start, end }), response).catch(() => {})
}

/**
 * The one range a `Range` header asks for, read as a static host reads it: `null` when it asks
 * for none, for one this does not parse, or for several, each answered with the whole file; `false`
 * when it starts past the end, which is a `416`.
 * @internal
 * @param {string | null} header
 * @param {number} size
 * @returns {{ start: number, end: number } | null | false}
 */
export function byteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '')
  if (!match || (!match[1] && !match[2])) return null
  if (!match[1]) {
    // The last n bytes.
    const suffix = Number(match[2])
    return suffix > 0 && size > 0 ? { start: Math.max(0, size - suffix), end: size - 1 } : false
  }
  const start = Number(match[1])
  // A last byte before the first is no range at all; one past the end is the end.
  if (match[2] && Number(match[2]) < start) return null
  if (start >= size) return false
  return { start, end: match[2] ? Math.min(Number(match[2]), size - 1) : size - 1 }
}

/**
 * Opens `url` in the default browser. False when no opener could be started, `xdg-open` missing on
 * a server for one; the command prints the address either way.
 * @internal
 * @param {string} url
 * @returns {Promise<boolean>}
 */
export function openBrowser(url) {
  const windows = process.platform === 'win32'
  /** @type {[string, string[]]} */
  const [command, args] = process.platform === 'darwin' ? ['open', [url]] : windows ? ['cmd', ['/c', 'start', '""', url]] : ['xdg-open', [url]]
  return new Promise((resolveOpened) => {
    const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true, windowsVerbatimArguments: windows })
    child.once('error', () => resolveOpened(false))
    child.once('spawn', () => {
      child.unref()
      resolveOpened(true)
    })
  })
}
