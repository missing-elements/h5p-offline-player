#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { basename, extname, relative } from 'node:path'
import { parseArgs } from 'node:util'
import { EmbedError, buildSite } from '../lib/build.mjs'
import { buildScorm } from '../lib/scorm.mjs'

const USAGE = `Usage: h5p-embed [folder] [options]
       h5p-embed --scorm <package.h5p> [zip] [--force]

Writes the H5P embed page as a static site, ready to deploy to a player domain of your own.
The folder defaults to ./h5p-player.

With --scorm, writes a SCORM 1.2 package of one .h5p instead, for an LMS to play and grade: the
player, the package and the libraries it does not carry, from the library pack, in one zip. The
zip defaults to ./<package>.scorm.zip.

Options:
  --scorm <package.h5p>  write a SCORM package of this .h5p rather than the site
  --packages <origins>   play packages, and fetch library bundles, only from these origins
                         (comma or space separated; this site's own is always allowed). Add
                         any host a package URL redirects to, and https://cdn.jsdelivr.net for
                         libraries=pack on a site built with --no-libraries. Default: any https host.
  --ancestors <origins>  only these sites may frame the page (frame-ancestors, sent as a header).
                         Default: any site.
  --default-libraries <sources>
                         the libraries= value for addresses that name none, so a snippet without
                         it still plays an export with no libraries: pack or URLs, as the
                         parameter. Default: none, such exports are refused unless the address asks
  --no-libraries         leave out the 13.7 MB library pack; libraries=pack then fetches it from jsDelivr
  --force                write into a folder that is not empty, replacing only this tool's files;
                         with --scorm, replace the zip
  -h, --help             show this
  -v, --version          print the version`

let args
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      scorm: { type: 'string' },
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
  console.error(`h5p-embed: one ${values.scorm !== undefined ? 'zip' : 'folder'} at most, got ${positionals.length}\n\n${USAGE}`)
  process.exit(2)
}

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

/** Where a written file or folder is, said from here when it is below here. */
const shown = (path) => {
  const below = relative(process.cwd(), path)
  return below === '' ? '.' : below.startsWith('..') ? path : below
}

// `--scorm=` with no package still means a SCORM package, refused for naming none.
if (values.scorm !== undefined) {
  // The site's options shape a site; a SCORM package has no hosts, framers or library sources.
  const siteOnly = ['packages', 'ancestors', 'default-libraries', 'no-libraries'].filter((name) => values[name] !== undefined)
  if (siteOnly.length > 0) {
    console.error(`h5p-embed: ${siteOnly.map((name) => `--${name}`).join(', ')} not with --scorm, which writes a package, not a site\n\n${USAGE}`)
    process.exit(2)
  }
  try {
    const zip = await buildScorm({
      h5p: values.scorm,
      out: positionals[0] ?? `${basename(values.scorm, extname(values.scorm))}.scorm.zip`,
      force: values.force ?? false
    })
    const count = zip.libraries.length
    const supplied = count > 0 ? `, the H5P runtime and ${count} ${count === 1 ? 'library' : 'libraries'} from the library pack, which it does not carry` : ' and the H5P runtime'
    console.log(`Wrote ${shown(zip.out)} (${megabytes(zip.size)}): "${zip.title}" as a SCORM 1.2 package,
with the player ${zip.version}${supplied}.

Add it to a course as a SCORM package. The LMS gets the content's score and whether it passed,
when the content reports them, and the time spent; the learner's place is kept between sessions.
The LMS must be served over https, as the player's Service Worker needs.`)
  } catch (error) {
    if (error instanceof EmbedError) {
      console.error(`h5p-embed: ${error.message}`)
      process.exit(1)
    }
    throw error
  }
  process.exit(0)
}

try {
  const site = await buildSite({
    out: positionals[0] ?? 'h5p-player',
    libraries: !values['no-libraries'],
    packages: values.packages ?? null,
    ancestors: values.ancestors ?? null,
    defaultLibraries: values['default-libraries'] ?? null,
    force: values.force ?? false
  })
  const folder = shown(site.out)
  const parts = [`the player ${site.version}`, 'the H5P runtime', site.libraries ? 'the library pack' : null].filter(Boolean)
  console.log(`Wrote ${folder}/ (${megabytes(site.size)}): the embed page, ${parts.join(', ')}.`)
  console.log(`Packages from: ${site.packages ? `this site, ${site.packages.join(', ')}` : 'any https host'}.`)
  console.log(`Framed by: ${site.ancestors ? site.ancestors.join(', ') : 'any site'}.`)
  console.log(`Libraries for exports without them: ${site.defaultLibraries ?? 'only when the address asks'}.`)
  console.log(`
Deploy the folder to a domain that holds nothing else — a separate registrable domain, not a
subdomain of your site — then embed a package:

  <iframe src="https://<player domain>/?src=<package url>" allow="fullscreen; microphone; camera"
          style="width: 100%; border: 0"></iframe>
  <script src="https://<player domain>/resizer.js"></script>

The page carries its policy; the headers beside it are written for five kinds of host:
Caddyfile, nginx.conf and .htaccess for a server of your own, _headers for Netlify and
Cloudflare Pages, vercel.json for Vercel. Object storage and GitHub Pages serve the page's own
policy and no headers${site.ancestors ? ' — there --ancestors has no effect, since only a header\ncan carry it' : ''}.`)
} catch (error) {
  if (error instanceof EmbedError) {
    console.error(`h5p-embed: ${error.message}`)
    process.exit(1)
  }
  throw error
}
