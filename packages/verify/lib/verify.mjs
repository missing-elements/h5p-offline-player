import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

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
 * @property {string} [libraries] `pack`, or the URL of a bundle, for a package without library folders
 * @property {string} [out] where `report.json` and `screenshot.png` go; nothing is written without it
 * @property {string} [browser] a Chromium-based browser executable; found automatically otherwise
 * @property {number} [readyTimeout] ms allowed to reach `ready`; default 60 000
 * @property {number} [settle] ms watched after `ready` for late errors; default 3 000
 */

/**
 * @param {VerifyOptions} options
 */
export async function verifyPackage(options) {
  const file = resolve(options.file)
  const size = (await stat(file).catch(() => null))?.size
  if (size === undefined) throw new VerifyError(`No such file: ${file}`)
  const readyTimeout = options.readyTimeout ?? 60_000
  const settle = options.settle ?? 3_000

  const server = await serve(await playerDist())
  const browser = await launch(options.browser)
  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 } })
    // Runs in every document, the frame included: a CSP violation fires an event in the document
    // it happens in, and nothing else reports it.
    await context.addInitScript(() => {
      const list = []
      Object.defineProperty(window, '__csp', { value: list })
      document.addEventListener('securitypolicyviolation', (event) => {
        list.push({ directive: event.violatedDirective, blocked: event.blockedURI })
      })
    })
    const page = await context.newPage()

    const consoleErrors = []
    const failedRequests = []
    page.on('console', (message) => {
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

    const query = options.libraries ? `?libraries=${encodeURIComponent(options.libraries)}` : ''
    await page.goto(`${server.url}/${query}`)
    await page.setInputFiles('#file', file)

    let timedOut = false
    await page
      .waitForFunction(() => window.__verify.states.some((s) => s.state === 'ready' || s.state === 'error'), null, { timeout: readyTimeout })
      .catch(() => {
        timedOut = true
      })
    if (!timedOut) await page.waitForTimeout(settle)

    const collected = await page.evaluate(() => {
      const player = document.querySelector('h5p-player')
      return { ...window.__verify, state: player.state, revision: player.revision }
    })
    const frame = page.frames().find((candidate) => candidate.url().includes('/h5p/frame/'))
    const rendered = frame
      ? await frame
          .evaluate(() => {
            const root = document.querySelector('#h5p-root')
            const rect = root?.getBoundingClientRect()
            return {
              height: rect ? Math.round(rect.height) : 0,
              elements: root ? root.querySelectorAll('*').length : 0,
              text: (root?.innerText ?? '').trim().length,
              instances: window.H5P?.instances?.length ?? null
            }
          })
          .catch(() => null)
      : null
    const csp = frame ? await frame.evaluate(() => window.__csp ?? []).catch(() => []) : []

    let screenshot = null
    if (options.out && collected.state === 'ready') {
      await mkdir(options.out, { recursive: true })
      screenshot = join(options.out, 'screenshot.png')
      await page.locator('h5p-player').screenshot({ path: screenshot })
    }

    const ready = collected.states.find((s) => s.state === 'ready')
    const report = {
      tool: `h5p-verify ${version}`,
      file,
      size,
      libraries: options.libraries ?? null,
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
      console: consoleErrors.filter((text) => !collected.errors.some((error) => text.includes(error.message))).slice(0, 20),
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

/** The distinct messages, each with how often it occurred: `… (×4)`. */
function dedupe(messages) {
  const counts = new Map()
  for (const message of messages) counts.set(message, (counts.get(message) ?? 0) + 1)
  return [...counts].map(([message, count]) => (count > 1 ? `${message} (×${count})` : message))
}

/**
 * The player's `dist/` and the runtime's, from the installed packages; the workspace needs both
 * built first. The runtime is a package of its own (`@missing-elements/h5p-runtime`, GPL) and is
 * served at `/frame-assets/`, which is where the element looks beside its own script.
 */
async function playerDist() {
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

/** A static server for the player, the runtime and the test page, on a free localhost port. */
function serve({ dist, runtime }) {
  const page = join(here, 'page.html')
  const ASSETS = '/frame-assets/'
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
    const safe = (root, rest) => join(root, normalize(rest).replace(/^(\.\.[/\\])+/, ''))
    const target = path === '/' ? page : path.startsWith(ASSETS) ? safe(runtime, path.slice(ASSETS.length)) : safe(dist, path)
    if (target !== page && !target.startsWith(dist) && !target.startsWith(runtime)) {
      response.writeHead(403).end()
      return
    }
    try {
      const body = await readFile(target)
      response.writeHead(200, {
        'Content-Type': MIME[extname(target)] ?? 'application/octet-stream',
        'Content-Length': body.length,
        'Cache-Control': 'no-store'
      })
      response.end(body)
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found')
    }
  })
  return new Promise((resolveServer) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {import('node:net').AddressInfo} */ (server.address())
      resolveServer({ url: `http://127.0.0.1:${port}`, close: () => server.close() })
    })
  })
}

/**
 * A Chromium: the one named, else Chrome or Edge installed on the machine, else Playwright's
 * own. Chrome and Edge first because they are usually there and cost no download.
 */
async function launch(executablePath) {
  const attempts = executablePath
    ? [{ executablePath }]
    : [{ channel: 'chrome' }, { channel: 'msedge' }, {}]
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

/** A one-line, human-readable account of a report, for the command and for logs. */
export function summarize(report) {
  const name = basename(report.file)
  const took = report.readyMs !== null ? `ready in ${(report.readyMs / 1000).toFixed(2)} s` : `state ${report.state}`
  const lines = [`${report.verdict}  ${name}  ${took}${report.revision ? `  revision ${report.revision.slice(0, 23)}…` : ''}`]
  for (const reason of report.reasons) lines.push(`  ${reason}`)
  const missing = report.errors.find((error) => error.missingLibraries)?.missingLibraries
  if (missing) {
    lines.push(`  fix: add the library folders (${missing.folders.join(', ')}), or --libraries pack if the destination site supplies libraries`)
  }
  for (const warning of report.warnings) lines.push(`  warning: ${warning}`)
  if (report.screenshot) lines.push(`  screenshot: ${report.screenshot}`)
  return lines.join('\n')
}
