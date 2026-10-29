#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { basename, dirname, join, resolve } from 'node:path'
import { openBrowser, previewPackage } from '../lib/preview.mjs'
import { VerifyError, summarize, verifyPackage } from '../lib/verify.mjs'

const HELP = `Usage: h5p-verify <package.h5p> [options]

Plays the package in a headless browser through h5p-offline-player and reports whether it
works. Exit code 0: it plays (warnings possible). 1: it does not. 2: could not run.

With --preview it checks nothing: it opens the package in the real player in your browser,
served from this computer, until its tab is closed. Exit code 0 when the preview ends, 2 when
it could not start.

Options:
  --preview              open the package in your browser instead of checking it; it takes
                         --untrusted, --libraries, --no-refresh-libraries and
                         --no-downgrade-libraries
  --no-open              with --preview, print the address instead of opening a browser
  --untrusted            play it as a site plays a package it did not make: none of its own
                         code runs, its libraries come only from --libraries (pack by
                         default), and its content is checked against their semantics. What
                         the check removed is reported as warnings
  --libraries <sources>  where libraries come from, tried in order: pack (the published
                         library pack), a bundle's URL, a bundle on disk, or a copy of the
                         pack's parts/ folder, which keeps the check offline. With the
                         pack, a library the package carries plays at the pack's newer
                         version, as on a site with the pack
  --no-refresh-libraries play the libraries the package carries even where the pack has newer
  --no-downgrade-libraries
                         refuse content made for a newer minor version of a library than any
                         source has, instead of playing it at the newest older one with a
                         warning
  --out <dir>            where report.json and screenshot.png go
                         (default: <package>.verify/ beside the package)
  --browser <path>       a Chromium-based browser; Chrome, Edge or Playwright's found otherwise
  --ready <seconds>      time allowed to reach ready (default 60)
  --settle <seconds>     time watched after ready for late errors (default 3)
  --json                 print the report as JSON instead of the summary
  -q, --quiet            only the verdict line
  -h, --help
`

let args
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      preview: { type: 'boolean' },
      'no-open': { type: 'boolean' },
      libraries: { type: 'string' },
      untrusted: { type: 'boolean' },
      'no-refresh-libraries': { type: 'boolean' },
      'no-downgrade-libraries': { type: 'boolean' },
      out: { type: 'string' },
      browser: { type: 'string' },
      ready: { type: 'string' },
      settle: { type: 'string' },
      json: { type: 'boolean' },
      quiet: { type: 'boolean', short: 'q' },
      help: { type: 'boolean', short: 'h' }
    }
  })
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  console.error(HELP)
  process.exit(2)
}

const [file] = args.positionals
if (args.values.help || !file) {
  console.log(HELP)
  process.exit(args.values.help ? 0 : 2)
}

if (args.values['no-open'] && !args.values.preview) {
  console.error('--no-open goes with --preview')
  process.exit(2)
}

if (args.values.preview) {
  // What only the check reads is refused rather than ignored, so a mistaken call says so.
  const unsupported = ['out', 'browser', 'ready', 'settle', 'json', 'quiet'].filter((name) => args.values[name] !== undefined)
  if (unsupported.length) {
    console.error(`--preview does not take ${unsupported.map((name) => `--${name}`).join(', ')}`)
    process.exit(2)
  }
  let preview
  try {
    preview = await previewPackage({
      file,
      libraries: args.values.libraries,
      untrusted: args.values.untrusted,
      refreshLibraries: !args.values['no-refresh-libraries'],
      downgradeLibraries: !args.values['no-downgrade-libraries']
    })
  } catch (error) {
    console.error(error instanceof VerifyError ? error.message : error)
    process.exit(2)
  }
  // Listened to before anything is printed, so that a Ctrl+C as soon as the address shows finds the
  // listener, and for as long as the process runs, not once: through npx one Ctrl+C arrives twice,
  // from the terminal to the whole process group and from npm passing it on, and a second signal
  // with no listener left took Node's default and killed the process before its last line (#79).
  // Ending the preview again does nothing.
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => preview.close())
  const address = `${preview.url}/`
  console.log(`Previewing ${basename(file)} at ${address}`)
  if (args.values['no-open'] || !(await openBrowser(address))) console.log('Open that address in a browser.')
  console.log('The package stays on this computer. The preview ends when its tab is closed, or with Ctrl+C.')
  const ended = await preview.closed
  console.log(ended === 'unopened' ? 'No tab opened the preview in time; it ended.' : 'The preview ended.')
  process.exit(0)
}

const seconds = (value, fallback) => {
  if (value === undefined) return fallback
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) {
    console.error(`Not a number of seconds: ${value}`)
    process.exit(2)
  }
  return number * 1000
}

const out = args.values.out ?? join(dirname(resolve(file)), `${basename(file, '.h5p')}.verify`)

try {
  const report = await verifyPackage({
    file,
    libraries: args.values.libraries,
    untrusted: args.values.untrusted,
    refreshLibraries: !args.values['no-refresh-libraries'],
    downgradeLibraries: !args.values['no-downgrade-libraries'],
    out,
    browser: args.values.browser,
    readyTimeout: seconds(args.values.ready, 60_000),
    settle: seconds(args.values.settle, 3_000)
  })
  if (args.values.json) console.log(JSON.stringify(report, null, 2))
  else if (args.values.quiet) console.log(summarize(report).split('\n')[0])
  else console.log(summarize(report))
  process.exit(report.verdict === 'pass' ? 0 : 1)
} catch (error) {
  console.error(error instanceof VerifyError ? error.message : error)
  process.exit(2)
}
