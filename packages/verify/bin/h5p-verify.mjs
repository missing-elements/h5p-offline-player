#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { basename, dirname, join, resolve } from 'node:path'
import { VerifyError, summarize, verifyPackage } from '../lib/verify.mjs'

const HELP = `Usage: h5p-verify <package.h5p> [options]

Plays the package in a headless browser through h5p-offline-player and reports whether it
works. Exit code 0: it plays (warnings possible). 1: it does not. 2: could not run.

Options:
  --libraries hub|<url>  supply libraries for a package exported without its own
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
      libraries: { type: 'string' },
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
