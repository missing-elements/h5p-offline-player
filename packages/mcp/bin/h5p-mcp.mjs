#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

// Standard output is the protocol's: anything a library prints there would break a message.
console.log = console.error
console.info = console.error

const HELP = `Usage: h5p-mcp [--allow <folder>]... [--no-open]

H5P Author MCP by Missing Elements: an MCP server over standard input and output that builds
.h5p packages, checks that they play, and opens them in the browser. An app such as Claude
Desktop starts it; it does nothing on its own.

Options:
  --allow <folder>  a folder builds may read files from and write packages to; repeat it for
                    more. Without it: the folders the app gives, else Desktop, Documents and
                    Downloads
  --no-open         answer a preview with its address instead of opening the browser
  --version
  -h, --help
`

let values
try {
  ;({ values } = parseArgs({
    options: {
      allow: { type: 'string', multiple: true },
      'no-open': { type: 'boolean' },
      version: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    }
  }))
} catch (error) {
  console.error(`h5p-mcp: ${error instanceof Error ? error.message : error}\n\n${HELP}`)
  process.exit(2)
}
if (values.help) {
  process.stdout.write(HELP)
  process.exit(0)
}
if (values.version) {
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  process.stdout.write(`@missing-elements/h5p-mcp ${version}\n`)
  process.exit(0)
}

// Loaded only now, so that --help and --version answer without loading the build and the pack.
const { createServer } = await import('../lib/server.mjs')
const { server, close } = await createServer({ allow: values.allow, open: !values['no-open'] })
// The app ends the server by closing its input; a preview still open would keep it alive.
const stop = () => {
  close()
  process.exit(0)
}
process.stdin.on('end', stop)
process.stdin.on('close', stop)
await server.connect(new StdioServerTransport())
