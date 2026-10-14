import { existsSync, openAsBlob } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, normalize, resolve } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { BlobReader, BlobWriter, TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter, configure } from '@zip.js/zip.js'
import { chromium } from 'playwright'
import { ContentGenerator, MEDIA, libraryString, librariesIn, mediaIn } from './lib/sweep-content.mjs'

/**
 * Plays every content type in the library pack and reports what each one does: whether it boots,
 * played `untrusted` and trusted, and what it sends when worked through. Built on 2026-10-14; the
 * hub serves no example content, so each package is made here.
 *
 * Each content type's content is generated from its own `semantics.json` (`lib/sweep-content.mjs`),
 * and `sweep/<machineName>.json`, where one exists, adds what generation cannot give — a drop
 * zone, words that cross — and the element's attributes for it (`attributes`). The packages are
 * content-only, as h5p.com and h5p.org export, so the pack supplies every library: this is the
 * pack's own test as much as the player's. Run it with the player built (`pnpm build`):
 *
 *   pnpm sweep                        every content type, both modes
 *   pnpm sweep --only H5P.Blanks      one or more, comma-separated
 *   pnpm sweep --modes trusted        untrusted, trusted or both
 *   pnpm sweep --out <dir>            where packages, screenshots and the report go
 *   pnpm sweep --headed               watch it
 *   pnpm sweep --semantics H5P.Blanks a content type's fields, as a tree, for writing its file
 *
 * It fails when a content type does not reach `ready` or throws while booting. What a content
 * type sends once there — the walk presses what a learner would — is reported, not judged: that
 * depends on the library's own buttons and timing, which a first cut checked and found too
 * unsteady on a slow runner to gate anything on.
 */

configure({ useWebWorkers: false })

const rootDir = resolve(import.meta.dirname, '..')
const repoDir = resolve(rootDir, '..', '..')
const overridesDir = join(rootDir, 'sweep')
const playerDist = join(repoDir, 'packages', 'player', 'dist')
const runtimeDist = join(repoDir, 'packages', 'runtime', 'dist')

const args = parseArgs(process.argv.slice(2))
const packPath = resolve(args.pack ?? join(repoDir, 'packages', 'libraries', 'libraries.h5p'))
const outDir = resolve(args.out ?? join(tmpdir(), 'h5p-sweep'))
const modes = (args.modes ?? 'untrusted,trusted').split(',').map((mode) => mode.trim())
const only = args.only ? new Set(args.only.split(',').map((name) => name.trim())) : null
const parallel = Number(args.parallel ?? 4)
const READY_TIMEOUT = 60_000
const SETTLE = 1_500

for (const mode of modes) if (mode !== 'untrusted' && mode !== 'trusted') fail(`--modes: unknown mode "${mode}"`)

const pack = await readPack(packPath)
const generator = new ContentGenerator(pack)
if (args.semantics) {
  const entry = generator.find(args.semantics)
  if (!entry) fail(`--semantics: no ${args.semantics} in the pack`)
  console.log(`${entry.folder}\n${semanticsTree(entry.semantics ?? [])}`)
  process.exit(0)
}
if (!existsSync(join(playerDist, 'h5p-sw.js')) || !existsSync(join(runtimeDist, 'frame-boot.js'))) {
  fail('The player is not built: run `pnpm build` first.')
}
const media = await sampleMedia()
const overrides = await readOverrides()

// Every runnable library the pack has, the newest major of each: what a content-only export can name.
const contentTypes = [...new Set([...pack.values()].filter(({ library }) => library.runnable).map(({ library }) => library.machineName))]
  .map((machineName) => generator.find(machineName))
  .filter((entry) => entry && (!only || only.has(entry.library.machineName)))
  .sort((a, b) => a.library.machineName.localeCompare(b.library.machineName))
if (only) for (const name of only) if (!contentTypes.some(({ library }) => library.machineName === name)) fail(`--only: no runnable ${name} in the pack`)
for (const name of overrides.keys()) if (!contentTypes.some(({ library }) => library.machineName === name) && !only) console.warn(`[sweep] sweep/${name}.json names no runnable library in the pack`)

await rm(outDir, { recursive: true, force: true })
await mkdir(join(outDir, 'packages'), { recursive: true })
await mkdir(join(outDir, 'screenshots'), { recursive: true })

/** @type {{ entry: any, override: any, file: string, libraries: string[] }[]} */
const packages = []
for (const entry of contentTypes) {
  const override = overrides.get(entry.library.machineName) ?? {}
  const params = generator.generate(entry, override.params)
  const file = join(outDir, 'packages', `${entry.library.machineName}.h5p`)
  await writeFile(file, await buildPackage(entry.library, params))
  packages.push({ entry, override, file, libraries: [...librariesIn(params)].sort() })
}
console.log(`[sweep] ${packages.length} content types from ${packPath}, ${modes.join(' and ')}, into ${outDir}`)

const server = await serve()
const browser = await launch()
const results = []
try {
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } })
  await context.addInitScript(() => {
    const list = []
    Object.defineProperty(window, '__csp', { value: list })
    document.addEventListener('securitypolicyviolation', (event) => list.push(`${event.blockedURI} (${event.violatedDirective})`))
  })
  // The pack is downloaded once into this context, and every later play attaches it from there.
  const jobs = packages.flatMap((item) => modes.map((mode) => ({ ...item, mode })))
  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++]
      const result = await play(context, job)
      results.push(result)
      console.log(line(result))
    }
  }
  // The first play alone, so the pack lands in the cache before the others ask for it.
  if (jobs.length > 0) {
    const first = jobs[next++]
    const result = await play(context, first)
    results.push(result)
    console.log(line(result))
  }
  await Promise.all(Array.from({ length: Math.max(1, parallel) }, worker))
} finally {
  await browser.close()
  server.close()
}

results.sort((a, b) => a.machineName.localeCompare(b.machineName) || a.mode.localeCompare(b.mode))
await writeFile(join(outDir, 'report.json'), `${JSON.stringify(results, null, 2)}\n`)
await writeFile(join(outDir, 'report.md'), markdownReport(results))
const failed = results.filter((result) => result.problems.length > 0)
console.log(`\n[sweep] ${results.length - failed.length} of ${results.length} plays passed; report: ${join(outDir, 'report.md')}`)
process.exit(failed.length > 0 ? 1 : 0)

/**
 * One play: the package handed to the element as a picked file, against the pack, then worked
 * through and watched.
 */
async function play(context, { entry, override, file, mode }) {
  const { machineName } = entry.library
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const result = {
    machineName,
    version: libraryString(entry.library).split(' ')[1],
    title: entry.library.title,
    mode,
    state: null,
    readyMs: null,
    errors: [],
    statements: [],
    finished: [],
    steps: [],
    buttons: [],
    csp: [],
    problems: [],
    warnings: []
  }
  try {
    const query = new URLSearchParams({ libraries: `${server.url}/libraries.h5p`, attributes: JSON.stringify(override.attributes ?? {}) })
    if (mode === 'untrusted') query.set('untrusted', '')
    await page.goto(`${server.url}/?${query}`)
    await page.setInputFiles('#file', file)
    const settled = await page
      .waitForFunction(() => ['ready', 'error'].includes(document.querySelector('h5p-player').state), null, { timeout: READY_TIMEOUT })
      .then(() => true, () => false)
    result.state = await page.evaluate(() => document.querySelector('h5p-player').state)
    if (!settled) result.problems.push(`did not reach ready within ${READY_TIMEOUT / 1000} s (state ${result.state})`)

    if (result.state === 'ready') {
      await page.waitForTimeout(SETTLE)
      const frame = page.frames().find((candidate) => candidate.url().includes('/h5p/frame/'))
      if (frame) result.steps = await walk(page, frame)
      await page.waitForTimeout(SETTLE)
      result.csp = frame ? await frame.evaluate(() => window.__csp ?? []).catch(() => []) : []
      // What is left to press: where a content type's file would take the steps further.
      result.buttons = frame
        ? await frame
            .evaluate(() =>
              [...document.querySelectorAll('button, [role="button"]')]
                .filter((element) => element.getClientRects().length > 0)
                .map((element) => `${element.className}`.trim().split(/\s+/).slice(0, 2).join('.') + `«${(element.textContent || element.getAttribute('aria-label') || '').trim().slice(0, 24)}»`)
            )
            .catch(() => [])
        : []
      await page.locator('h5p-player').screenshot({ path: join(outDir, 'screenshots', `${machineName}-${mode}.png`) }).catch(() => {})
    }

    const recorded = await page.evaluate(() => window.__sweep)
    result.readyMs = recorded.readyMs
    result.errors = recorded.errors
    result.statements = recorded.statements
    result.finished = recorded.finished
  } catch (error) {
    result.problems.push(`the driver failed: ${error instanceof Error ? error.message.split('\n')[0] : error}`)
  } finally {
    await page.close()
  }

  const booting = result.errors.filter((error) => !error.afterReady)
  if (result.state === 'error' || booting.length > 0) {
    result.problems.push(...dedupe(booting.map((error) => `${error.code}: ${error.message}`)))
    if (booting.length === 0) result.problems.push('state is error')
  }
  for (const message of dedupe(result.errors.filter((error) => error.afterReady).map((error) => error.message))) result.warnings.push(`runtime error after ready: ${message}`)
  for (const blocked of new Set(result.csp)) result.warnings.push(`blocked by the frame's CSP: ${blocked}`)
  for (const message of dedupe(pageErrors)) result.warnings.push(`page error: ${message}`)

  return result
}

/**
 * The generic walk: answer what one click answers, then press the first of check, submit,
 * finish or show results, next — until nothing of the kind is left, or 25 presses.
 */
async function walk(page, frame) {
  const done = []

  for (let index = 0; index < 25; index++) {
    const action = await frame.evaluate(() => {
      const visible = (element) =>
        element && element.getClientRects().length > 0 && !element.disabled && element.getAttribute('aria-disabled') !== 'true' && getComputedStyle(element).visibility !== 'hidden'
      // By class or by what it says: the libraries name their buttons in three generations of
      // classes (`h5p-question-check-answer`, `h5p-theme-check`, `joubel-…`), and some by text only.
      const label = (element) => `${element.className} ${element.getAttribute('aria-label') ?? ''} ${element.textContent ?? ''}`.toLowerCase()
      const kinds = [/\bcheck\b|check-answer|theme-check/, /submit/, /finish|show-results|show results|show-score|get results/, /\bnext\b|-next\b|next-/]
      // A button pressed three times has done what it does: a summary's submit stays on screen.
      const buttons = [...document.querySelectorAll('button, [role="button"]')].filter((element) => visible(element) && Number(element.dataset.sweepPressed ?? 0) < 3)
      for (const kind of kinds) {
        const press = buttons.find((element) => kind.test(label(element)) && !/checkbox|retry|try again|previous|prev\b|restart/.test(label(element)))
        if (!press) continue
        if (kind === kinds[0] || kind === kinds[1]) {
          const answer = [...document.querySelectorAll('.h5p-answer, .h5p-true-false-answer, .h5p-alternative-container, input[type="radio"], input[type="checkbox"]')].find(visible)
          answer?.click()
        }
        press.dataset.sweepPressed = String(Number(press.dataset.sweepPressed ?? 0) + 1)
        press.click()
        const said = (press.textContent || press.getAttribute('aria-label') || press.className).trim().replace(/\s+/g, ' ')
        return `press «${said.slice(0, 30)}»`
      }
      return null
    })
    if (!action) break
    done.push(action)
    await page.waitForTimeout(600)
  }
  return done
}

/**
 * Chrome if it is installed, else Playwright's Chromium: the video is H.264, which Playwright's own
 * build cannot decode, and Interactive Video plays it.
 */
async function launch() {
  for (const channel of ['chrome', undefined]) {
    try {
      return await chromium.launch({ headless: !args.headed, ...(channel ? { channel } : {}) })
    } catch (error) {
      if (!channel) throw error
    }
  }
}

/** The page the plays happen in: one element, a hidden file input, and a record of its events. */
function pageHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>h5p sweep</title>
<script type="module" src="/h5p-player.js"></script>
<style>body { margin: 0; padding: 16px; background: #fff } h5p-player { display: block; width: 1024px; min-height: 240px }</style>
</head>
<body>
<input type="file" id="file" hidden>
<h5p-player></h5p-player>
<script>
  const record = (window.__sweep = { started: null, readyMs: null, errors: [], statements: [], finished: [] })
  const player = document.querySelector('h5p-player')
  const query = new URLSearchParams(location.search)
  if (query.has('untrusted')) player.setAttribute('untrusted', '')
  player.setAttribute('libraries', query.get('libraries'))
  for (const [name, value] of Object.entries(JSON.parse(query.get('attributes') || '{}'))) player.setAttribute(name, value)
  const describe = (statement) => ({
    verb: (statement?.verb?.id ?? '').split('/').pop(),
    parent: Boolean(statement?.context?.contextActivities?.parent),
    sub: Boolean(statement?.object?.definition?.extensions?.['http://h5p.org/x-api/h5p-subContentId']),
    score: statement?.result?.score ? [statement.result.score.raw, statement.result.score.max] : null,
    object: statement?.object?.definition?.name?.['en-US'] ?? null,
    at: Math.round(performance.now() - record.started)
  })
  player.addEventListener('statechange', (event) => {
    if (event.detail.state === 'ready' && record.readyMs === null) record.readyMs = Math.round(performance.now() - record.started)
  })
  player.addEventListener('error', (event) => {
    record.errors.push({ code: event.detail.code, message: event.detail.message, afterReady: player.state === 'ready' })
  })
  player.addEventListener('xapi', (event) => record.statements.push(describe(event.detail.statement)))
  player.addEventListener('finished', (event) => record.finished.push(describe(event.detail.statement)))
  document.querySelector('#file').addEventListener('change', (event) => {
    record.started = performance.now()
    player.file = event.target.files[0]
  })
</script>
</body>
</html>`
}

/** A static server for the page, the player, the runtime and the pack, on a free port. */
function serve() {
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.h5p': 'application/zip' }
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
    if (path === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(pageHtml())
      return
    }
    const within = (root, rest) => {
      const target = join(root, normalize(rest))
      return target.startsWith(root) ? target : null
    }
    const target =
      path === '/libraries.h5p' ? packPath : path.startsWith('/frame-assets/') ? within(runtimeDist, path.slice('/frame-assets/'.length)) : within(playerDist, path.slice(1))
    const body = target ? await readFile(target).catch(() => null) : null
    if (!body) {
      response.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found')
      return
    }
    response.writeHead(200, { 'Content-Type': types[extname(target)] ?? 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': 'no-store' }).end(body)
  })
  return new Promise((resolveServer) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {import('node:net').AddressInfo} */ (server.address())
      resolveServer({ url: `http://127.0.0.1:${port}`, close: () => server.close() })
    })
  })
}

/** Every library folder in the pack, with its `library.json` and `semantics.json`. */
async function readPack(path) {
  const reader = new ZipReader(new BlobReader(await openAsBlob(path)))
  const found = new Map()
  for (const entry of await reader.getEntries()) {
    const match = /^([^/]+)\/(library|semantics)\.json$/.exec(entry.filename)
    if (!match) continue
    const json = JSON.parse(new TextDecoder().decode(await entry.getData(new Uint8ArrayWriter())))
    const item = found.get(match[1]) ?? { folder: match[1], library: null, semantics: null }
    item[match[2]] = json
    found.set(match[1], item)
  }
  await reader.close()
  return new Map([...found].filter(([, item]) => item.library))
}

/** `sweep/<machineName>.json`, by machine name. */
async function readOverrides() {
  const found = new Map()
  for (const name of await readdir(overridesDir).catch(() => [])) {
    if (!name.endsWith('.json')) continue
    found.set(name.slice(0, -'.json'.length), JSON.parse(await readFile(join(overridesDir, name), 'utf8')))
  }
  return found
}

/** A content-only package, as h5p.com and h5p.org export: `h5p.json` naming the main library, and `content/`. */
async function buildPackage(library, params) {
  const writer = new ZipWriter(new BlobWriter('application/zip'), { lastModDate: new Date(Date.UTC(2000, 0, 1)), extendedTimestamp: false })
  const manifest = {
    title: `${library.title} (sweep)`,
    language: 'en',
    mainLibrary: library.machineName,
    embedTypes: ['div'],
    license: 'U',
    preloadedDependencies: [{ machineName: library.machineName, majorVersion: String(library.majorVersion), minorVersion: String(library.minorVersion) }]
  }
  await writer.add('h5p.json', new TextReader(JSON.stringify(manifest)))
  await writer.add('content/content.json', new TextReader(JSON.stringify(params)))
  for (const kind of mediaIn(params)) await writer.add(`content/${MEDIA[kind].path}`, new Uint8ArrayReader(media[kind]), { level: 0 })
  return new Uint8Array(await (await writer.close()).arrayBuffer())
}

/**
 * The files generated content points at: a grey image of the size its parameters state, a second
 * of silence, the demo's ten seconds of Big Buck Bunny (CC BY 3.0, Blender Foundation), and a
 * line of text.
 */
async function sampleMedia() {
  const video = new ZipReader(new BlobReader(await openAsBlob(join(rootDir, 'demo', 'content', 'video.h5p'))))
  const clip = (await video.getEntries()).find((entry) => entry.filename.endsWith('.mp4'))
  const mp4 = await clip.getData(new Uint8ArrayWriter())
  await video.close()
  return { image: png(MEDIA.image.width, MEDIA.image.height), audio: silence(1), video: mp4, file: new TextEncoder().encode('Sample\n') }
}

/** A grey PNG. */
function png(width, height) {
  const row = new Uint8Array(1 + width * 3).fill(0xc8)
  row[0] = 0
  const raw = new Uint8Array(row.length * height)
  for (let y = 0; y < height; y++) raw.set(row, y * row.length)
  const chunk = (type, data) => {
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    out.set(new TextEncoder().encode(type), 4)
    out.set(data, 8)
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
    return out
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header.set([8, 2, 0, 0, 0], 8)
  const parts = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]
  return Buffer.concat(parts)
}

/** A WAV of silence, 8 kHz mono, 16-bit. */
function silence(seconds) {
  const samples = 8000 * seconds
  const out = Buffer.alloc(44 + samples * 2)
  out.write('RIFF', 0)
  out.writeUInt32LE(36 + samples * 2, 4)
  out.write('WAVEfmt ', 8)
  out.writeUInt32LE(16, 16)
  out.writeUInt16LE(1, 20)
  out.writeUInt16LE(1, 22)
  out.writeUInt32LE(8000, 24)
  out.writeUInt32LE(16000, 28)
  out.writeUInt16LE(2, 32)
  out.writeUInt16LE(16, 34)
  out.write('data', 36)
  out.writeUInt32LE(samples * 2, 40)
  return out
}

/**
 * A content type's fields, one a line: name, type and widget, optional, default, minimum, and the
 * options of a library or select field. The strings a content type shows (`l10n` and the like)
 * are folded to one line.
 */
function semanticsTree(fields, depth = 0) {
  const folded = new Set(['l10n', 'i10n', 'a11y', 'texts', 'UI', 'localize'])
  const lines = []
  for (const field of fields) {
    const indent = '  '.repeat(depth)
    if (folded.has(field.name) && field.type === 'group') {
      lines.push(`${indent}${field.name}: group of ${field.fields?.length ?? 0} strings`)
      continue
    }
    const options = field.type === 'library' ? field.options?.join(' | ') : field.type === 'select' ? field.options?.map((option) => option.value).join(' | ') : ''
    const bits = [
      field.type + (field.widget ? `:${field.widget}` : ''),
      field.optional ? 'optional' : '',
      field.default !== undefined ? `default ${JSON.stringify(field.default).slice(0, 40)}` : '',
      field.min !== undefined ? `min ${field.min}` : '',
      options ? `[${options}]` : ''
    ].filter(Boolean)
    lines.push(`${indent}${field.name ?? '(item)'}: ${bits.join(', ')}`)
    if (field.fields) lines.push(semanticsTree(field.fields, depth + 1))
    if (field.field) lines.push(semanticsTree([field.field], depth + 1))
  }
  return lines.filter(Boolean).join('\n')
}

function describeFinished({ verb, score }) {
  return score ? `${verb} ${score[0]}/${score[1]}` : verb
}

/** One line per play, for the log. */
function line(result) {
  const verdict = result.problems.length > 0 ? 'FAIL' : 'ok  '
  const finished = result.finished.length > 0 ? `finished ${result.finished.map(describeFinished).join(', ')}` : 'no finished'
  const tail = result.problems.length > 0 ? `  — ${result.problems.join('; ')}` : ''
  return `${verdict} ${result.machineName} ${result.version} ${result.mode.padEnd(9)} ${finished}${tail}`
}

/** The report as a table, a row per content type, and the problems and warnings under it. */
function markdownReport(results) {
  const byType = new Map()
  for (const result of results) byType.set(result.machineName, [...(byType.get(result.machineName) ?? []), result])
  const cell = (result) => {
    if (!result) return '—'
    if (result.state !== 'ready') return `**fails** (${result.state})`
    return result.problems.length > 0 ? `**fails**` : `ready, ${(result.readyMs / 1000).toFixed(1)} s`
  }
  const rows = [...byType].map(([machineName, plays]) => {
    const played = plays.find((play) => play.state === 'ready') ?? plays[0]
    const verbs = [...new Set(played.statements.map(({ verb, parent, sub }) => (parent || sub ? `${verb}*` : verb)))].join(', ') || '—'
    const finished = played.finished.map(describeFinished).join(', ') || '—'
    const byMode = (mode) => cell(plays.find((play) => play.mode === mode))
    return `| ${machineName} ${played.version} | ${byMode('untrusted')} | ${byMode('trusted')} | ${verbs} | ${finished} |`
  })
  const notes = results
    .filter((result) => result.problems.length > 0 || result.warnings.length > 0)
    .map((result) => [`### ${result.machineName}, ${result.mode}`, ...result.problems.map((text) => `- **${text}**`), ...result.warnings.map((text) => `- ${text}`)].join('\n'))
  return [
    '# Content type sweep',
    '',
    `${results.filter((result) => result.problems.length === 0).length} of ${results.length} plays passed. Each content type's package is generated from its semantics and \`apps/demo/sweep/\`, played as a content-only export against the pack, and worked through by the generic walk. The statements are what it reached, not a judgement; a verb with \`*\` came from a part of the content (a statement with a parent, or one H5P marks as sub-content's).`,
    '',
    '| Content type | Untrusted | Trusted | Statements | `finished` |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    ...(notes.length > 0 ? ['## Problems and warnings', '', ...notes, ''] : [])
  ].join('\n')
}

function dedupe(messages) {
  const counts = new Map()
  for (const message of messages) counts.set(message, (counts.get(message) ?? 0) + 1)
  return [...counts].map(([message, count]) => (count > 1 ? `${message} (×${count})` : message))
}

function parseArgs(argv) {
  const out = {}
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index]
    if (!name.startsWith('--')) fail(`unexpected argument "${name}"`)
    const key = name.slice(2)
    if (key === 'headed') out.headed = true
    else if (!['only', 'modes', 'out', 'pack', 'parallel', 'semantics'].includes(key)) fail(`unknown option ${name}`)
    else out[key] = argv[++index]
  }
  return out
}

function fail(message) {
  console.error(`[sweep] ${message}`)
  process.exit(2)
}
