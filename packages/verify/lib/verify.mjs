import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { existsSync, statSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, errors as playwrightErrors } from 'playwright-core'

/** @import { H5PPlayerElement, PlayerErrorDetail, PlayerState, RefreshedLibrary } from '@missing-elements/h5p-offline-player' */
/** @import { IncomingMessage, ServerResponse } from 'node:http' */

/**
 * Plays a package the way a learner would — the real element, the real Service Worker, a real
 * browser — and reports what happened. The package is handed to the element as a picked file,
 * the same path the installable app uses, so nothing here needs `Range` support or a network.
 *
 * What the report can say: the package indexed (or which libraries it lacks), the runtime
 * booted, nothing threw before `ready`, the content drew something, and what the frame asked
 * for that was not there. What it cannot say: whether the content is any good.
 */

const require = createRequire(import.meta.url)
const here = fileURLToPath(new URL('.', import.meta.url))
const { version } = require('../package.json')

/** How many console error lines the report keeps: enough to read, not a runaway log. */
const CONSOLE_LINES_KEPT = 20
/** How much of a revision the one-line summary shows: `sha256:` and sixteen hex characters. */
const REVISION_SHOWN = 23
/** How many of the content check's changes become warnings; `report.json` keeps them all. */
const CHANGES_SHOWN = 20
/** How the runtime's boot script begins the notes it writes to the frame's console after the content check. */
const CHECK_NOTES = "<h5p-player>: the content was checked against its libraries' semantics"
/** The header the Service Worker wants before it hands an untrusted package's `content.json` over as written. */
const CONTENT_CHECK_HEADER = 'X-H5P-Content-Check'

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

/**
 * @typedef {object} VerifyOptions
 * @property {string} file the `.h5p` to play
 * @property {string} [libraries] where libraries come from, tried in order: `pack`, a bundle's URL, a
 *   bundle on disk, or a copy of the library pack's `parts/` folder on disk, which plays as `pack`;
 *   the verifier serves what is on disk itself. Several separated by spaces
 * @property {boolean} [untrusted] play the package `untrusted`, as a site that did not make it plays it
 * @property {boolean} [refreshLibraries] with the pack, play its newer versions of the libraries the
 *   package carries, as the element does unless told otherwise; default true
 * @property {string} [out] where `report.json` and `screenshot.png` go; nothing is written without it
 * @property {string} [browser] a Chromium-based browser executable; found automatically otherwise
 * @property {number} [readyTimeout] ms allowed to reach `ready`; default 60 000
 * @property {number} [settle] ms watched after `ready` for late errors; default 3 000
 */

/**
 * What `verifyPackage` found, as `report.json` holds it. Fields may be added in a minor release,
 * none taken away or changed (docs/compatibility.md).
 * @typedef {object} VerifyReport
 * @property {string} tool `h5p-verify` and its version
 * @property {string} file the package, as an absolute path
 * @property {number} size its size in bytes
 * @property {string | null} libraries the libraries asked for; `pack` when played untrusted and none were named
 * @property {boolean} untrusted whether the element played it untrusted, read back from it
 * @property {RefreshedLibrary[]} refreshed the libraries the package carries that played at the pack's newer version
 * @property {'pass' | 'fail'} verdict
 * @property {string[]} reasons why it failed; empty on a pass
 * @property {string[]} warnings what is worth reading either way
 * @property {PlayerState} state the element's state when the check ended
 * @property {number | null} readyMs from handing the file over to `ready`, in ms
 * @property {string | null} revision the build, as the element stamps it on every statement
 * @property {ReportedError[]} errors every error the element reported
 * @property {RenderedContent | null} rendered what the content drew; `null` when the frame could not be measured
 * @property {(string | null)[]} xapi the verbs of the statements the content sent, each once
 * @property {BlockedLoad[]} csp what the frame's policy blocked
 * @property {FailedRequest[]} failedRequests requests to the player's own server that failed
 * @property {string[]} console console errors not already among `errors`, the first twenty
 * @property {ContentCheck | null} contentCheck played untrusted: what the content check changed
 * @property {string | null} screenshot where `screenshot.png` was written, with `out` and a package that reached `ready`
 */

/**
 * An `error` event of the element.
 * @typedef {object} ReportedError
 * @property {PlayerErrorDetail['code']} code
 * @property {string} message
 * @property {PlayerErrorDetail['missingLibraries'] | null} missingLibraries
 * @property {boolean} afterReady whether the content was up: an error then leaves it running
 */

/**
 * @typedef {object} RenderedContent
 * @property {number} height of the content, in CSS pixels
 * @property {number} elements in the content's root
 * @property {number} text characters of text in it
 * @property {number | null} instances the H5P instances the runtime made
 */

/**
 * @typedef {object} BlockedLoad
 * @property {string} directive the frame's CSP directive that refused it
 * @property {string} blocked what it refused
 */

/**
 * @typedef {object} FailedRequest
 * @property {string} url the path asked for
 * @property {number} [status] the HTTP status, for an answer of 400 or more
 * @property {string} [error] the browser's reason, for a request that got no answer
 */

/**
 * @typedef {object} ContentCheck
 * @property {string[]} notes what the runtime's content check wrote that it changed
 * @property {ContentChange[] | null} changes the content as played against the package's own; `null` when they could not be compared
 */

/**
 * @typedef {object} ContentChange
 * @property {string} path the field, as a JSON path; empty for the content as a whole
 * @property {string} change what happened to it
 */

/**
 * @param {VerifyOptions} options
 * @returns {Promise<VerifyReport>}
 */
export async function verifyPackage(options) {
  /**
   * What `page.html` keeps of the element's events, read back from the page.
   * @typedef {{ started: number | null, states: { state: PlayerState, at: number }[], errors: (ReportedError & { at: number })[], xapi: (string | null)[] }} PageReport
   * @typedef {Window & typeof globalThis & { __verify: PageReport, __csp?: BlockedLoad[], H5P?: { instances?: unknown[] }, H5PIntegration?: { contents?: Record<string, { jsonContent?: unknown }> } }} PageWindow
   */
  const { path: file, size } = await packageFile(options.file)
  const readyTimeout = options.readyTimeout ?? 60_000
  const settle = options.settle ?? 3_000
  const untrusted = options.untrusted === true
  const sources = librarySources(options.libraries)

  const server = await serve(await playerDist(), sources, async (path, _request, response) => {
    if (path !== '/') return false
    await sendFile(join(here, 'page.html'), response)
    return true
  })
  const browser = await launch(options.browser)
  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 } })
    // Runs in every document, the frame included: a CSP violation fires an event in the document
    // it happens in, and nothing else reports it.
    await context.addInitScript(() => {
      /** @type {BlockedLoad[]} */
      const list = []
      Object.defineProperty(window, '__csp', { value: list })
      document.addEventListener('securitypolicyviolation', (event) => {
        list.push({ directive: event.violatedDirective, blocked: event.blockedURI })
      })
    })
    const page = await context.newPage()

    /** @type {string[]} */
    const consoleErrors = []
    /** @type {FailedRequest[]} */
    const failedRequests = []
    /** @type {string[]} */
    const checkNotes = []
    page.on('console', (message) => {
      // The content check's own account of what it changed, one note to a line.
      if (message.type() === 'warning' && message.text().startsWith(CHECK_NOTES)) checkNotes.push(...message.text().split('\n- ').slice(1))
      // A failed load is on the response listener, with the probe 404s filtered out; the
      // console's copy of it names no URL and would only repeat it.
      if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) consoleErrors.push(message.text())
    })
    page.on('response', (response) => {
      const url = response.url()
      // The runtime probes `library.json` under the versioned and the unversioned folder name and
      // takes whichever answers; one of the two is always a 404, and it is load-bearing.
      if (response.status() >= 400 && url.startsWith(server.url) && !url.endsWith('/library.json')) {
        failedRequests.push({ url: url.slice(server.url.length), status: response.status() })
      }
    })
    page.on('requestfailed', (request) => {
      const url = request.url()
      const error = request.failure()?.errorText ?? 'failed'
      // An abort is the requester's own doing — a media element drops a range request every
      // time it seeks — and says nothing about the package.
      if (url.startsWith(server.url) && error !== 'net::ERR_ABORTED') failedRequests.push({ url: url.slice(server.url.length), error })
    })

    const query = new URLSearchParams()
    if (sources.attribute) query.set('libraries', sources.attribute)
    if (sources.packBase) query.set('pack-base', sources.packBase)
    if (options.refreshLibraries === false) query.set('refresh-libraries', 'off')
    if (untrusted) query.set('untrusted', '')
    await page.goto(`${server.url}/${query.size ? `?${query}` : ''}`)
    await page.setInputFiles('#file', file)

    let timedOut = false
    await page
      .waitForFunction(() => /** @type {PageWindow} */ (window).__verify.states.some((s) => s.state === 'ready' || s.state === 'error'), null, { timeout: readyTimeout })
      .catch((error) => {
        // Only the time running out says something about the package. A browser that crashed
        // or a page that went away is the check failing to run, and is reported as that.
        if (!(error instanceof playwrightErrors.TimeoutError)) {
          throw new VerifyError(`The browser stopped before the package could be judged: ${error instanceof Error ? error.message : String(error)}`)
        }
        timedOut = true
      })
    if (!timedOut) await page.waitForTimeout(settle)

    const collected = await page.evaluate(() => {
      const player = /** @type {H5PPlayerElement} */ (document.querySelector('h5p-player'))
      return {
        .../** @type {PageWindow} */ (window).__verify,
        state: player.state,
        revision: player.revision,
        untrusted: player.untrusted === true,
        libraryBundle: player.libraryBundle
      }
    })
    const frame = page.frames().find((candidate) => candidate.url().includes('/h5p/frame/'))
    const rendered = frame
      ? await frame
          .evaluate(() => {
            const root = /** @type {HTMLElement | null} */ (document.querySelector('#h5p-root'))
            const rect = root?.getBoundingClientRect()
            return {
              height: rect ? Math.round(rect.height) : 0,
              elements: root ? root.querySelectorAll('*').length : 0,
              text: (root?.innerText ?? '').trim().length,
              instances: /** @type {PageWindow} */ (window).H5P?.instances?.length ?? null
            }
          })
          // A frame that has navigated away, or was never reachable, has nothing to measure:
          // the verdict rules read that as nothing drawn.
          .catch(() => null)
      : null
    /** @type {BlockedLoad[]} */
    const csp = frame ? await frame.evaluate(() => /** @type {PageWindow} */ (window).__csp ?? []).catch(() => []) : []
    // Untrusted, the package's `content.json` beside what the runtime was handed: the Service
    // Worker gives the file as written to a request that names the check, and the boot script
    // leaves the checked parameters in `H5PIntegration`.
    const played =
      collected.untrusted && frame && collected.state === 'ready'
        ? await frame
            .evaluate(async (header) => {
              const config = JSON.parse(document.getElementById('h5p-boot-config')?.textContent ?? 'null')
              const content = Object.values(/** @type {PageWindow} */ (window).H5PIntegration?.contents ?? {})[0]
              if (!config?.h5pJsonPath || typeof content?.jsonContent !== 'string') return null
              const response = await fetch(`${config.h5pJsonPath}/content/content.json`, { headers: { [header]: 'semantics' } })
              return response.ok ? { written: await response.text(), checked: content.jsonContent } : null
            }, CONTENT_CHECK_HEADER)
            .catch(() => null)
        : null

    let screenshot = null
    if (options.out && collected.state === 'ready') {
      await mkdir(options.out, { recursive: true })
      screenshot = join(options.out, 'screenshot.png')
      await page.locator('h5p-player').screenshot({ path: screenshot })
    }

    const ready = collected.states.find((s) => s.state === 'ready')
    /** @type {VerifyReport} */
    const report = {
      tool: `h5p-verify ${version}`,
      file,
      size,
      // Untrusted, the element takes the pack when nothing else is named.
      libraries: options.libraries ?? (untrusted ? 'pack' : null),
      // As the element played it, read back, not as asked.
      untrusted: collected.untrusted,
      // The libraries the package carries that played at the pack's newer version: what a site
      // with the pack shows, and a sign the export is older than the pack.
      refreshed: collected.libraryBundle?.refreshed ?? [],
      verdict: 'pass',
      reasons: [],
      warnings: [],
      state: collected.state,
      readyMs: ready && collected.started !== null ? Math.round(ready.at - collected.started) : null,
      revision: collected.revision ?? null,
      errors: collected.errors.map(({ at, ...error }) => error),
      rendered,
      xapi: [...new Set(collected.xapi)],
      csp,
      failedRequests,
      console: consoleErrors.filter((text) => !collected.errors.some((error) => text.includes(error.message))).slice(0, CONSOLE_LINES_KEPT),
      contentCheck: collected.untrusted
        ? { notes: checkNotes, changes: played ? contentChanges(JSON.parse(played.written), JSON.parse(played.checked)) : null }
        : null,
      screenshot
    }

    if (timedOut) {
      report.verdict = 'fail'
      report.reasons.push(`did not reach ready within ${readyTimeout / 1000} s; last state: ${collected.state}`)
    } else if (collected.state !== 'ready') {
      report.verdict = 'fail'
      for (const error of report.errors.filter((e) => !e.afterReady)) report.reasons.push(`${error.code}: ${error.message}`)
      if (report.reasons.length === 0) report.reasons.push(`state is ${collected.state}`)
    } else if (!rendered || rendered.height < 1 || rendered.elements === 0) {
      report.verdict = 'fail'
      report.reasons.push('the content started but drew nothing: the frame is empty')
    }
    // An uncaught error while the runtime boots is a defect in the package even when the content
    // comes up around it — a library listed that is not a runtime library, a script that reaches
    // for something absent — and the part that threw is missing from what was drawn. One after
    // `ready` is the content running, and content types throw non-fatal exceptions routinely.
    const booting = report.errors.filter((e) => e.code === 'runtime' && !e.afterReady)
    if (report.verdict === 'pass' && booting.length > 0) {
      report.verdict = 'fail'
      report.reasons.push(`${booting.length} uncaught error${booting.length === 1 ? '' : 's'} while booting: ${dedupe(booting.map((e) => e.message)).join('; ')}`)
    }
    for (const message of dedupe(report.errors.filter((e) => e.afterReady).map((e) => e.message))) report.warnings.push(`runtime error after ready: ${message}`)
    for (const { url, status, error } of failedRequests) report.warnings.push(`request failed: ${url} (${status ?? error})`)
    for (const { directive, blocked } of csp) report.warnings.push(`blocked by the frame's CSP: ${blocked} (${directive})`)
    for (const text of report.console) report.warnings.push(`console error: ${text.slice(0, 200)}`)
    // What the content lost is not a failure: it plays, as it would on the site. It is what a
    // publisher reads before handing the package over.
    if (report.contentCheck && report.state === 'ready') {
      const { notes, changes } = report.contentCheck
      for (const note of notes) report.warnings.push(`content check: ${note}`)
      if (changes === null) report.warnings.push('content check: the content as played could not be compared with the package\'s own')
      else {
        for (const { path, change } of changes.slice(0, CHANGES_SHOWN)) report.warnings.push(`content check: ${path || '(the content)'}: ${change}`)
        if (changes.length > CHANGES_SHOWN) report.warnings.push(`content check: ${changes.length - CHANGES_SHOWN} more changes in report.json`)
      }
    }

    if (options.out) {
      await mkdir(options.out, { recursive: true })
      await writeFile(join(options.out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    }
    return report
  } finally {
    await browser.close()
    server.close()
  }
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
 * What the content as played lost against the package's own `content.json`, field by field, by
 * JSON path: markup removed from a text (tags, attributes and style properties by name), fields
 * removed, list items removed, values changed. A removed empty value is left out: the check drops
 * empty lists and groups as upstream does, and nothing reads them.
 *
 * Measured, not told: the runtime's own notes cover only part of what the check does, and none
 * of the markup it strips. The content upgrade runs first and can move fields too, when the
 * libraries served are newer than the ones the content was written for; a change that is not
 * markup may be its.
 * @internal
 * @param {unknown} written
 * @param {unknown} played
 * @returns {ContentChange[]}
 */
export function contentChanges(written, played) {
  /** @type {ContentChange[]} */
  const changes = []
  /**
   * @param {unknown} value
   * @returns {value is Record<string, unknown>}
   */
  const isContainer = (value) => value !== null && typeof value === 'object'
  /** @param {unknown} value */
  const isEmpty = (value) => value === '' || (isContainer(value) && Object.keys(value).length === 0)
  /** @param {unknown} value */
  const show = (value) => {
    const text = JSON.stringify(value) ?? String(value)
    return text.length > 40 ? `${text.slice(0, 40)}…` : text
  }
  /**
   * @param {unknown} a
   * @param {unknown} b
   * @param {string} path
   */
  const walk = (a, b, path) => {
    if (a === b) return
    if (typeof a === 'string' && typeof b === 'string') {
      // A text that lost no markup shows both values, unless it is markup, whose rewrite (an
      // entity escaped, a URL dropped) would not fit on a line.
      changes.push({ path, change: lostMarkup(a, b) ?? (/[<>]/.test(a) ? 'text rewritten' : `${show(a)} became ${show(b)}`) })
      return
    }
    if (isContainer(a) && isContainer(b) && Array.isArray(a) === Array.isArray(b)) {
      if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) {
        // Items cannot be paired once one is gone, so the list is reported whole.
        const gone = a.length - b.length
        changes.push({ path, change: gone > 0 ? `${gone} of ${a.length} items removed` : `${-gone} items added` })
        return
      }
      for (const key of Object.keys(a)) {
        const next = Array.isArray(a) ? `${path}[${key}]` : path ? `${path}.${key}` : key
        // Own keys only: `in` finds `constructor` and `toString` on every object (#58).
        if (!Object.hasOwn(b, key)) {
          if (!isEmpty(a[key])) changes.push({ path: next, change: 'removed' })
        } else walk(a[key], b[key], next)
      }
      for (const key of Object.keys(b)) {
        if (!Object.hasOwn(a, key)) changes.push({ path: Array.isArray(b) ? `${path}[${key}]` : path ? `${path}.${key}` : key, change: 'added' })
      }
      return
    }
    changes.push({ path, change: `${show(a)} became ${show(b)}` })
  }
  walk(written, played, '')
  return changes
}

/**
 * The markup a text lost, by name: `<form>, <input> ×2; attributes: action, type ×2; style: position`.
 * `null` when it lost none, and the text changed otherwise, an entity escaped or a URL dropped.
 * @param {string} before
 * @param {string} after
 */
function lostMarkup(before, after) {
  /**
   * @param {string[]} names
   * @returns {Map<string, number>}
   */
  const counted = (names) => names.reduce((map, name) => map.set(name, (map.get(name) ?? 0) + 1), new Map())
  /** @param {string} tag */
  const tagName = (tag) => /^<([a-z][a-z0-9]*)/i.exec(tag)?.[1].toLowerCase() ?? ''
  /** @param {string} html */
  const tags = (html) => counted([...html.matchAll(/<([a-z][a-z0-9]*)\b/gi)].map((match) => match[1].toLowerCase()))
  // Attributes and styles are counted on the kinds of tag that are still there, so a tag removed
  // whole is reported once, as a tag, and not again through everything it carried.
  const kept = tags(after)
  /** @param {string} html */
  const openings = (html) => openingTags(html).filter((tag) => kept.has(tagName(tag)))
  /** @param {string} html */
  const attributes = (html) =>
    counted(openings(html).flatMap((tag) => [...tag.slice(1).matchAll(/\s([a-z][a-z0-9:-]*)\s*=/gi)].map((match) => match[1].toLowerCase())))
  /** @param {string} html */
  const styles = (html) =>
    counted(
      openings(html).flatMap((tag) =>
        [...tag.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)].flatMap((match) =>
          match[1].split(';').map((rule) => rule.split(':')[0].trim().toLowerCase()).filter(Boolean)
        )
      )
    )
  /**
   * Each name `before` has more of than `after`, with how many more.
   * @param {Map<string, number>} before
   * @param {Map<string, number>} after
   * @returns {[string, number][]}
   */
  const lost = (before, after) =>
    [...before].flatMap(([name, count]) => (count > (after.get(name) ?? 0) ? [[name, count - (after.get(name) ?? 0)]] : []))
  /**
   * @param {[string, number][]} pairs
   * @param {(name: string) => string} [shown]
   */
  const listed = (pairs, shown = (name) => name) => pairs.map(([name, gone]) => (gone > 1 ? `${shown(name)} ×${gone}` : shown(name))).join(', ')
  /** @type {string[]} */
  const parts = []
  const tagsLost = lost(tags(before), tags(after))
  if (tagsLost.length) parts.push(`markup removed: ${listed(tagsLost, (name) => `<${name}>`)}`)
  const attributesLost = lost(attributes(before), attributes(after))
  if (attributesLost.length) parts.push(`attributes removed: ${listed(attributesLost)}`)
  const stylesLost = lost(styles(before), styles(after))
  if (stylesLost.length) parts.push(`style removed: ${listed(stylesLost)}`)
  return parts.length ? parts.join('; ') : null
}

/**
 * Every `<` followed by a letter, up to the next `>`: what `/<[a-z][^>]*>/gi` matches, found in
 * one pass. The expression tries each `<` against the whole rest of the string, so a package
 * whose text runs `<a<a<a…` with no `>` took time quadratic in its length; here, once no `>`
 * follows one `<`, none follows any later one, and the scan stops.
 * @param {string} html
 */
function openingTags(html) {
  /** @type {string[]} */
  const found = []
  for (let start = html.indexOf('<'); start !== -1; start = html.indexOf('<', start + 1)) {
    if (!/[a-z]/i.test(html[start + 1] ?? '')) continue
    const end = html.indexOf('>', start)
    if (end === -1) break
    found.push(html.slice(start, end + 1))
    start = end
  }
  return found
}

/**
 * The distinct messages, each with how often it occurred: `… (×4)`.
 * @param {string[]} messages
 */
function dedupe(messages) {
  /** @type {Map<string, number>} */
  const counts = new Map()
  for (const message of messages) counts.set(message, (counts.get(message) ?? 0) + 1)
  return [...counts].map(([message, count]) => (count > 1 ? `${message} (×${count})` : message))
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
 * @param {string} target
 * @param {ServerResponse} response
 */
async function sendFile(target, response) {
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

/**
 * A Chromium: the one named, else Chrome or Edge installed on the machine, else Playwright's
 * own. Chrome and Edge first because they are usually there and cost no download.
 * @internal
 * @param {string | undefined} executablePath
 */
export async function launch(executablePath) {
  /** @type {import('playwright-core').LaunchOptions[]} */
  const attempts = executablePath
    ? [{ executablePath }]
    : [{ channel: 'chrome' }, { channel: 'msedge' }, {}]
  /** @type {string[]} */
  const failures = []
  for (const attempt of attempts) {
    try {
      return await chromium.launch({ headless: true, ...attempt })
    } catch (error) {
      failures.push(error instanceof Error ? error.message.split('\n')[0] : String(error))
    }
  }
  throw new VerifyError(
    'No browser could be started. Install Google Chrome or Microsoft Edge, run `npx playwright install chromium`, ' +
      `or pass --browser <path>.\n  ${failures.join('\n  ')}`
  )
}

/**
 * A one-line, human-readable account of a report, for the command and for logs.
 * @param {VerifyReport} report
 * @returns {string}
 */
export function summarize(report) {
  const name = basename(report.file)
  const took = report.readyMs !== null ? `ready in ${(report.readyMs / 1000).toFixed(2)} s` : `state ${report.state}`
  const lines = [`${report.verdict}  ${name}  ${took}${report.revision ? `  revision ${report.revision.slice(0, REVISION_SHOWN)}…` : ''}`]
  for (const reason of report.reasons) lines.push(`  ${reason}`)
  const missing = report.errors.find((error) => error.missingLibraries)?.missingLibraries
  if (missing?.carried && report.untrusted) {
    lines.push(
      `  fix: the package carries ${missing.folders.join(', ')} itself, but played untrusted its libraries come only from ` +
        `${report.libraries}, which lacks them: export it against the versions there, or the site has to play it trusted`
    )
  } else if (missing) {
    lines.push(`  fix: add the library folders (${missing.folders.join(', ')}), or --libraries pack if the destination site supplies libraries`)
  }
  if (report.refreshed?.length) {
    lines.push(`  refreshed from the pack: ${report.refreshed.map(({ library, from, to }) => `${library} ${from} → ${to}`).join(', ')}`)
  }
  for (const warning of report.warnings) lines.push(`  warning: ${warning}`)
  if (report.screenshot) lines.push(`  screenshot: ${report.screenshot}`)
  return lines.join('\n')
}
