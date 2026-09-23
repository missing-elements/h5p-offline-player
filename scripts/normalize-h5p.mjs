#!/usr/bin/env node
/**
 * Rewrites a `.h5p` so that it streams well: media stored rather than deflated, mp4 indexes at
 * the front, libraries before content and content media last. Run it once, by whoever
 * publishes the package. See `scripts/lib/normalize.mjs` for what each step is for.
 *
 *   node scripts/normalize-h5p.mjs course.h5p
 *   node scripts/normalize-h5p.mjs https://example.org/course.h5p -o course.h5p
 *   node scripts/normalize-h5p.mjs course.h5p --dry-run
 */
import { createWriteStream } from 'node:fs'
import { mkdtemp, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { parseArgs } from 'node:util'
import { formatBytes } from './lib/format.mjs'
import { normalizeArchive } from './lib/normalize.mjs'

const HELP = `Usage: node scripts/normalize-h5p.mjs <package.h5p | https://…/package.h5p> [options]

Rewrites an H5P package so that it streams well through the player. The content is not
changed; only the zip container is:

  - media (video, audio, images, fonts, pdf) is stored rather than deflated, so a Range
    request can reach any byte of it directly
  - an mp4 whose index (moov) sits at the end is remuxed so the index comes first; the
    video then starts after a few hundred kilobytes instead of after the last byte
  - entries are ordered h5p.json, library folders, content, with content media last, so a
    host that ignores Range still boots the player before the media has arrived
  - scripts, styles and JSON an exporter left stored are deflated; everything else is
    copied byte for byte

Options:
  -o, --output <file>   where to write; default <name>.normalized.h5p beside the input,
                        or in the current directory for a URL
  -n, --dry-run         inspect and report, write nothing
  -q, --quiet           only the summary
  -h, --help
`

const { values, positionals } = parseArgs({
  options: {
    output: { type: 'string', short: 'o' },
    'dry-run': { type: 'boolean', short: 'n', default: false },
    quiet: { type: 'boolean', short: 'q', default: false },
    help: { type: 'boolean', short: 'h', default: false }
  },
  allowPositionals: true
})

if (values.help) {
  process.stdout.write(HELP)
  process.exit(0)
}
if (positionals.length !== 1) {
  process.stderr.write(HELP)
  process.exit(2)
}

async function main() {
  const [given] = positionals
  const dryRun = values['dry-run']
  const quiet = values.quiet

  /** @type {string | null} */
  let downloadDir = null
  /** @type {string | null} */
  let partial = null

  try {
    let input = given
    let displayName = given
    if (/^https?:\/\//i.test(given)) {
      downloadDir = await mkdtemp(join(tmpdir(), 'h5p-normalize-download-'))
      displayName = basename(new URL(given).pathname) || 'package.h5p'
      input = join(downloadDir, displayName)
      await download(given, input)
    }

    const output = dryRun
      ? undefined
      : resolve(values.output ?? join(downloadDir ? process.cwd() : dirname(input), normalizedName(displayName)))
    if (output && resolve(input) === output) {
      throw new Error('The output would overwrite the input; pass --output')
    }
    if (output) partial = `${output}.part`

    const bytesIn = (await stat(input)).size
    process.stdout.write(
      dryRun ? `${displayName}  (dry run, nothing written)\n` : `${displayName} → ${basename(/** @type {string} */ (output))}\n`
    )

    const report = await normalizeArchive({
      input,
      output: partial ?? undefined,
      onEntry: (result) => {
        if (quiet || result.target !== 'store') return
        process.stdout.write(`  ${result.name.padEnd(48)} ${formatBytes(result.size).padStart(9)}   ${describe(result)}\n`)
      }
    })

    if (partial && output) await rename(partial, output)
    partial = null

    printSummary(report, bytesIn)
    if (downloadDir) await rm(downloadDir, { recursive: true, force: true })
    process.exit(0)
  } catch (error) {
    if (partial) await rm(partial, { force: true })
    if (downloadDir) await rm(downloadDir, { recursive: true, force: true })
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}

/** @param {string} url @param {string} path */
async function download(url, path) {
  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`${url} returned ${response.status}`)
  process.stdout.write(`downloading ${url}\n`)
  await pipeline(Readable.fromWeb(/** @type {any} */ (response.body)), createWriteStream(path))
}

/** @param {string} name */
function normalizedName(name) {
  return `${name.replace(/\.h5p$/i, '')}.normalized.h5p`
}

const METHOD_NAMES = { 0: 'stored', 8: 'deflated', 9: 'deflate64' }

/** @param {import('./lib/normalize.mjs').EntryResult} result */
function describe(result) {
  const from = METHOD_NAMES[result.from.method] ?? `method ${result.from.method}`
  const trailer = [result.detail, result.warning].filter(Boolean).join('; ')
  switch (result.action) {
    case 'faststart':
      return `${from} → stored, moov moved to front (${result.detail})`
    case 'store':
      return `${from} → stored${trailer ? ` (${trailer})` : ''}`
    case 'deflate':
      return `stored → deflated, ${formatBytes(result.from.compressedSize)} → ${formatBytes(result.to.compressedSize)}`
    default:
      return `${from}, unchanged${trailer ? ` (${trailer})` : ''}`
  }
}

/**
 * @param {import('./lib/normalize.mjs').Report} report
 * @param {number} bytesIn
 */
function printSummary(report, bytesIn) {
  const { entries, dropped, warnings } = report
  const lines = []

  const droppedCount = dropped.directories + dropped.rejected.length
  const droppedNote = droppedCount
    ? `  (dropped ${[
        dropped.directories && `${dropped.directories} director${dropped.directories === 1 ? 'y' : 'ies'}`,
        dropped.rejected.length && `${dropped.rejected.length} the player would refuse`
      ]
        .filter(Boolean)
        .join(', ')})`
    : ''
  lines.push(`entries   ${entries.length + droppedCount} → ${entries.length}${droppedNote}`)

  const sizeLine = report.bytesOut === null
    ? `payload   ${formatBytes(report.payloadIn)} → ${formatBytes(report.payloadOut)}`
    : `size      ${formatBytes(bytesIn)} → ${formatBytes(report.bytesOut)}`
  lines.push(sizeLine)

  const folders = new Set(
    entries.map((entry) => entry.name.slice(0, entry.name.indexOf('/'))).filter((folder) => folder && folder !== 'content')
  )
  const contentFiles = entries.filter((entry) => entry.name.startsWith('content/') && entry.target !== 'store').length
  const contentMedia = entries.filter((entry) => entry.name.startsWith('content/') && entry.target === 'store').length
  lines.push(
    `order     ${[
      entries.some((entry) => entry.name === 'h5p.json') && 'h5p.json',
      folders.size && `${folders.size} library folder${folders.size === 1 ? '' : 's'}`,
      contentFiles && `content (${contentFiles} file${contentFiles === 1 ? '' : 's'})`,
      contentMedia && `media (${contentMedia} file${contentMedia === 1 ? '' : 's'}) last`
    ]
      .filter(Boolean)
      .join(' · ')}`
  )

  const media = entries.filter((entry) => entry.target === 'store')
  const moved = media.filter((entry) => entry.action === 'faststart').length
  const stored = media.filter((entry) => entry.action === 'store').length
  if (media.length) {
    lines.push(
      `media     ${media.length} file${media.length === 1 ? '' : 's'}: ${[
        stored && `${stored} inflated to stored`,
        moved && `${moved} mp4 index${moved === 1 ? '' : 'es'} moved to front`,
        media.length - stored - moved && `${media.length - stored - moved} already as they should be`
      ]
        .filter(Boolean)
        .join(', ')}`
    )
  }

  const deflated = entries.filter((entry) => entry.action === 'deflate')
  if (deflated.length) {
    const before = deflated.reduce((sum, entry) => sum + entry.from.compressedSize, 0)
    const after = deflated.reduce((sum, entry) => sum + entry.to.compressedSize, 0)
    lines.push(`text      ${deflated.length} stored entr${deflated.length === 1 ? 'y' : 'ies'} deflated, ${formatBytes(before)} → ${formatBytes(after)}`)
  }

  const notes = [
    ...warnings,
    ...dropped.rejected.map((entry) => `dropped ${entry.name}: ${entry.reason}`),
    ...entries.filter((entry) => entry.warning).map((entry) => `${entry.name}: ${entry.warning}`)
  ]
  for (const [index, note] of notes.entries()) {
    lines.push(`${index === 0 ? 'notes    ' : '         '} ${note}`)
  }

  process.stdout.write(`\n${lines.map((line) => `  ${line}`).join('\n')}\n`)
}

await main()
