#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { parseArgs } from 'node:util'
import { EmbedError, buildSite } from '../lib/build.mjs'

const USAGE = `Usage: h5p-embed [folder] [options]

Writes the H5P embed page as a static site, ready to deploy to a player domain of your own.
The folder defaults to ./h5p-player.

Options:
  --packages <origins>   play packages, and fetch library bundles, only from these origins
                         (comma or space separated; this site's own is always allowed). Add
                         https://api.h5p.org to allow libraries=hub, and any host a package
                         URL redirects to. Default: any https host.
  --ancestors <origins>  only these sites may frame the page (frame-ancestors, sent as a header).
                         Default: any site.
  --default-libraries <sources>
                         the libraries= value for addresses that name none, so a snippet without
                         it still plays an export with no libraries: pack, hub, URLs, as the
                         parameter. Default: none, such exports are refused unless the address asks
  --no-libraries         leave out the 9.5 MB library pack that libraries=pack names
  --force                write into a folder that is not empty, replacing only this tool's files
  -h, --help             show this
  -v, --version          print the version`

let args
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      packages: { type: 'string', multiple: true },
      ancestors: { type: 'string', multiple: true },
      'default-libraries': { type: 'string' },
      'no-libraries': { type: 'boolean' },
      force: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' }
    }
  })
} catch (error) {
  console.error(`h5p-embed: ${error instanceof Error ? error.message : error}\n\n${USAGE}`)
  process.exit(2)
}

const { values, positionals } = args
if (values.help) {
  console.log(USAGE)
  process.exit(0)
}
if (values.version) {
  console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version)
  process.exit(0)
}
if (positionals.length > 1) {
  console.error(`h5p-embed: one folder at most, got ${positionals.length}\n\n${USAGE}`)
  process.exit(2)
}

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

try {
  const site = await buildSite({
    out: positionals[0] ?? 'h5p-player',
    libraries: !values['no-libraries'],
    packages: values.packages ?? null,
    ancestors: values.ancestors ?? null,
    defaultLibraries: values['default-libraries'] ?? null,
    force: values.force ?? false
  })
  const below = relative(process.cwd(), site.out)
  const folder = below === '' ? '.' : below.startsWith('..') ? site.out : below
  const parts = [`the player ${site.version}`, 'the H5P runtime', site.libraries ? 'the library pack' : null].filter(Boolean)
  console.log(`Wrote ${folder}/ (${megabytes(site.size)}): the embed page, ${parts.join(', ')}.`)
  console.log(`Packages from: ${site.packages ? `this site, ${site.packages.join(', ')}` : 'any https host'}.`)
  console.log(`Framed by: ${site.ancestors ? site.ancestors.join(', ') : 'any site'}.`)
  console.log(`Libraries for exports without them: ${site.defaultLibraries ?? 'only when the address asks'}.`)
  console.log(`
Deploy the folder to a domain that holds nothing else — a separate registrable domain, not a
subdomain of your site — then embed a package:

  <iframe src="https://<player domain>/?src=<package url>" allow="fullscreen"
          style="width: 100%; border: 0"></iframe>
  <script src="https://<player domain>/resizer.js"></script>

_headers (Netlify, Cloudflare Pages) and vercel.json (Vercel) carry the policy and the caching.
Other hosts, GitHub Pages among them, get the policy from the page itself${site.ancestors ? ', without --ancestors,\nwhich only a header can carry' : ''}.`)
} catch (error) {
  if (error instanceof EmbedError) {
    console.error(`h5p-embed: ${error.message}`)
    process.exit(1)
  }
  throw error
}
