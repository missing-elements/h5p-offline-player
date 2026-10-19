import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Writes the embed page as a static site: one folder, deployable to any static host, that a site
 * frames from a player domain of its own. Everything comes from installed packages — the element
 * and its workers from the player's `dist/`, the H5P runtime from its own package as
 * `frame-assets/`, the library pack's parts from `@missing-elements/h5p-libraries` as
 * `libraries/` — so the versions are the ones this package was published with, and nothing is
 * fetched.
 */

export class EmbedError extends Error {}

const require = createRequire(import.meta.url)
// `fileURLToPath` rather than `import.meta.dirname`, which Node 20 has only from 20.11.
const SITE = fileURLToPath(new URL('../site', import.meta.url))

/** The page's own files, copied as they are; `index.html` is written, not copied. */
const PAGE_FILES = ['embed.js', 'embed.css', 'main.js', 'resizer.js']
/** The player's files, by the names the element looks for beside itself. */
const PLAYER_FILES = ['h5p-player.js', 'h5p-sw.js', 'h5p-jobs.js']

/** Where an installed package's file is, or a message that says which one is missing. */
function installed(specifier, hint) {
  try {
    return require.resolve(specifier)
  } catch {
    throw new EmbedError(`${specifier} is not installed or not built. ${hint}`)
  }
}

/**
 * An origin as the CSP and the page compare it: `https://host[:port]`, or plain http on a loopback
 * address for trying it locally. Anything with a path, a query or a trailing slash is refused
 * rather than trimmed, so a typo is not silently a different policy.
 */
export function parseOrigin(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new EmbedError(`Not an origin: ${value}. Write it as https://host.example`)
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new EmbedError(`Not an https origin: ${value}`)
  }
  if (url.origin !== value) throw new EmbedError(`Not an origin: ${value}. Write it as ${url.origin}, with no path or trailing slash`)
  return url.origin
}

/** Where the element's `libraries="pack"` fetches from when a site carries no copy of its own. */
const PACK_CDN_ORIGIN = 'https://cdn.jsdelivr.net'

/**
 * A `libraries` value for addresses that name none, checked against the site it goes into: the
 * tokens the page understands (`pack`, `none`, https URLs), and with a host list, nothing
 * the page would then refuse on every load. Returns the value normalised to single spaces.
 *
 * @param {string | null | undefined} value
 * @param {object} [site]
 * @param {string[] | null} [site.packages] the site's host list, as `parseOrigins` returns it
 * @param {boolean} [site.libraries] whether the site carries the pack
 */
export function parseDefaultLibraries(value, { packages = null, libraries = true } = {}) {
  if (value == null) return null
  const tokens = String(value).split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null
  if (tokens.includes('none')) {
    if (tokens.length > 1) throw new EmbedError('--default-libraries none stands alone.')
    return null
  }
  // An exact match on a parsed origin, not a substring of a URL. Without its own copy, `pack` is
  // the copy on jsDelivr that the element names.
  const cdnAllowed = !packages || packages.some((origin) => origin === PACK_CDN_ORIGIN)
  for (const token of tokens) {
    if (token === 'pack') {
      if (!libraries && !cdnAllowed) {
        throw new EmbedError(`--default-libraries names pack, but the site has no pack (--no-libraries) and --packages does not list ${PACK_CDN_ORIGIN}.`)
      }
    } else {
      let url
      try {
        url = new URL(token)
      } catch {
        throw new EmbedError(`--default-libraries: not pack, none or a URL: ${token}`)
      }
      if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
        throw new EmbedError(`--default-libraries: not an https URL: ${token}`)
      }
      if (packages && !packages.includes(url.origin)) throw new EmbedError(`--default-libraries names ${url.origin}, which --packages does not list.`)
    }
  }
  return tokens.join(' ')
}

/** Origins given as a list, or as one string separated by commas or whitespace. */
export function parseOrigins(values) {
  if (values == null) return null
  const list = (Array.isArray(values) ? values : [values]).flatMap((value) => String(value).split(/[\s,]+/)).filter(Boolean)
  return [...new Set(list.map(parseOrigin))]
}

/**
 * The page's policy. `connect-src` is where the element and its workers may fetch packages and
 * library bundles from: any https host by default, which is what a player for links needs, or
 * exactly the hosts given. `frame-ancestors` goes only into a header — a `<meta>` policy ignores
 * it — and names who may frame the page; without it any site may.
 */
/**
 * @param {object} [options]
 * @param {string[] | null} [options.packages]
 * @param {string[] | null} [options.ancestors]
 * @param {boolean} [options.meta] for the page's `<meta>`, which cannot carry `frame-ancestors`
 */
export function contentSecurityPolicy({ packages = null, ancestors = null, meta = false } = {}) {
  const directives = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${["'self'", ...(packages ?? ['https:'])].join(' ')}`,
    "worker-src 'self' blob:",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ]
  if (ancestors && !meta) directives.push(`frame-ancestors ${ancestors.join(' ')}`)
  return directives.join('; ')
}

/** Header rules, one set for every host format: the policy everywhere, and the caching that matters. */
function headerRules(csp) {
  const revalidate = 'public, max-age=3600, stale-while-revalidate=86400'
  // Asked again on every load, a 304 when nothing changed. The runtime and the pack keep their
  // file names from one version to the next, and the worker's version decides which files it
  // needs: kept for an hour, the runtime of the version before ran under the new worker after an
  // update, and every play failed until the hour was out (0.10 to 1.0, measured, #49); a part
  // kept from the pack before fails its hash against the new index.
  const current = 'no-cache'
  return [
    {
      path: '/*',
      headers: {
        'Content-Security-Policy': csp,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin'
      }
    },
    // The worker is checked on every load, so an update reaches learners on their next visit.
    { path: '/h5p-sw.js', headers: { 'Cache-Control': 'no-cache' } },
    { path: '/frame-assets/*', headers: { 'Cache-Control': current } },
    { path: '/resizer.js', headers: { 'Cache-Control': revalidate } },
    { path: '/libraries/*', headers: { 'Cache-Control': current } }
  ]
}

/** Netlify's and Cloudflare Pages' `_headers`. */
function netlifyHeaders(rules) {
  return rules.map(({ path, headers }) => `${path}\n${Object.entries(headers).map(([key, value]) => `  ${key}: ${value}`).join('\n')}`).join('\n') + '\n'
}

/** Vercel's `vercel.json`, for deploying the folder as a project of its own. */
function vercelConfig(rules) {
  const source = (path) => (path === '/*' ? '/(.*)' : path.replace(/\*$/, '(.*)'))
  return JSON.stringify(
    { headers: rules.map(({ path, headers }) => ({ source: source(path), headers: Object.entries(headers).map(([key, value]) => ({ key, value })) })) },
    null,
    2
  ) + '\n'
}

/*
 * The three server formats below are for a host of one's own — the European hosts a data
 * protection officer accepts have no `_headers` convention, and a university's Apache or an
 * nginx on a Hetzner box is where the embed page usually ends up. Each is written from the same
 * rules as the two files above, so they cannot disagree. Values are quoted with double quotes
 * in every format, which is safe because the policy carries only single quotes.
 */

/** The rule for every path, and the ones for a single path or prefix. */
function splitRules(rules) {
  const all = rules.find((rule) => rule.path === '/*')
  return { all, specific: rules.filter((rule) => rule !== all) }
}

/** Caddy's `Caddyfile`: a site block to run as it is, or to paste into one. */
function caddyfile(rules) {
  const { all, specific } = splitRules(rules)
  const lines = [
    '# Written by h5p-embed. Replace the domain and the root, then `caddy run` beside this file,',
    '# or paste the block into your Caddyfile. Caddy fetches the certificate itself.',
    'h5p-player.example.net {',
    '\troot * /srv/h5p-player',
    '\tfile_server',
    ...Object.entries(all.headers).map(([key, value]) => `\theader ${key} "${value}"`),
    ...specific.flatMap(({ path, headers }) => Object.entries(headers).map(([key, value]) => `\theader ${path} ${key} "${value}"`)),
    '}'
  ]
  return lines.join('\n') + '\n'
}

/**
 * nginx: a file to `include` inside the `server` block that serves the folder. nginx's
 * `add_header` in a `location` replaces every `add_header` inherited from the server level
 * rather than adding to it, so each location repeats the headers that apply everywhere.
 */
function nginxConf(rules) {
  const { all, specific } = splitRules(rules)
  const header = ([key, value]) => `add_header ${key} "${value}" always;`
  const matcher = (path) => (path.endsWith('/*') ? `^~ ${path.slice(0, -1)}` : `= ${path}`)
  const lines = [
    '# Written by h5p-embed. Include this file inside the server block that serves the folder:',
    '#   server { listen 443 ssl; server_name h5p-player.example.net; root /srv/h5p-player; include /srv/h5p-player/nginx.conf; }',
    '# A location repeats the headers set for every path: in nginx an add_header inside a location',
    '# replaces the inherited ones instead of adding to them.',
    ...Object.entries(all.headers).map(header),
    ...specific.map(
      ({ path, headers }) =>
        `location ${matcher(path)} {\n${[...Object.entries(all.headers), ...Object.entries(headers)].map((entry) => `\t${header(entry)}`).join('\n')}\n}`
    )
  ]
  return lines.join('\n') + '\n'
}

/** Apache's `.htaccess`, for a folder under a vhost that allows it. */
function htaccess(rules) {
  const { all, specific } = splitRules(rules)
  const header = ([key, value]) => `Header always set ${key} "${value}"`
  const block = ({ path, headers }) => {
    const body = Object.entries(headers).map((entry) => `\t${header(entry)}`).join('\n')
    // <Files> matches a name in any directory; a prefix needs the request URI, with no anchor at
    // the start, so that the site works under a path as well as at a root.
    return path.endsWith('/*')
      ? `<If "%{REQUEST_URI} =~ m#${path.slice(0, -1)}#">\n${body}\n</If>`
      : `<Files "${path.slice(1)}">\n${body}\n</Files>`
  }
  const lines = [
    '# Written by h5p-embed. Needs mod_headers, and AllowOverride FileInfo on the folder; or paste',
    '# the directives into the virtual host.',
    ...Object.entries(all.headers).map(header),
    ...specific.map(block)
  ]
  return lines.join('\n') + '\n'
}

function notice({ version, libraries }) {
  return `This folder is the H5P embed page, written by @missing-elements/h5p-embed.

  index.html, main.js, embed.js, embed.css, resizer.js, config.js
                    the embed page and the sizing script: MIT
  Caddyfile, nginx.conf, .htaccess, _headers, vercel.json
                    the same headers for five kinds of host; use the one yours reads
  h5p-player.js, h5p-sw.js, h5p-jobs.js
                    @missing-elements/h5p-offline-player ${version}: MIT. The two workers also
                    carry zip.js, BSD-3-Clause, its licence in each file's header.
  frame-assets/     @missing-elements/h5p-runtime, the H5P core runtime: GPL-3.0-only. Its
                    LICENSE.txt and NOTICE.txt say what it is and where its source is; keep them
                    with it.
${libraries ? `  libraries/        @missing-elements/h5p-libraries, the H5P hub's libraries, one archive per
                    library and index.json, each under its own licence, listed in libraries.txt.
                    The player downloads only the ones a package needs.
` : ''}
Serve it from a domain that holds nothing else, and frame it:

  <iframe src="https://<this domain>/?src=<package url>" allow="fullscreen; microphone; camera"
          style="width: 100%; border: 0"></iframe>
  <script src="https://<this domain>/resizer.js"></script>

https://github.com/missing-elements/h5p-offline-player/tree/main/packages/embed
`
}

/** Whether a directory exists and has anything in it. A path that is a file is an error. */
async function occupied(dir) {
  let info
  try {
    info = await stat(dir)
  } catch {
    return false
  }
  if (!info.isDirectory()) throw new EmbedError(`${dir} is a file, not a folder.`)
  return (await readdir(dir)).length > 0
}

/**
 * Writes the site into `out`. Refuses a folder that already has files in it unless `force`, and
 * even then only replaces the files it writes, so pointing it at the wrong folder costs nothing
 * that was not its own.
 *
 * @param {object} options
 * @param {string} options.out
 * @param {boolean} [options.libraries] include the library pack's parts, for `libraries=pack` (default true)
 * @param {string[] | string | null} [options.packages] the only origins packages may come from
 * @param {string[] | string | null} [options.ancestors] the only origins that may frame the page
 * @param {string | null} [options.defaultLibraries] the `libraries` value for addresses that name none
 * @param {boolean} [options.force]
 */
export async function buildSite({ out, libraries = true, packages = null, ancestors = null, defaultLibraries = null, force = false }) {
  if (!out) throw new EmbedError('No output folder given.')
  const target = resolve(out)
  const allowedPackages = parseOrigins(packages)
  const allowedAncestors = parseOrigins(ancestors)
  if (allowedPackages?.length === 0) throw new EmbedError('--packages names no origin.')
  if (allowedAncestors?.length === 0) throw new EmbedError('--ancestors names no origin.')
  const fallbackLibraries = parseDefaultLibraries(defaultLibraries, { packages: allowedPackages, libraries })
  // Checked with --force too: a path that is a file is refused either way.
  if ((await occupied(target)) && !force) {
    throw new EmbedError(`${out} is not empty. Choose an empty folder, or pass --force to replace the files this writes.`)
  }

  const player = dirname(installed('@missing-elements/h5p-offline-player/dist/h5p-player.js', 'Run `pnpm build` in the workspace, or reinstall this package.'))
  const runtime = dirname(installed('@missing-elements/h5p-runtime/dist/h5p.css', 'Run `pnpm build` in the workspace, or reinstall this package.'))
  const pack = libraries ? dirname(installed('@missing-elements/h5p-libraries/parts/index.json', 'Reinstall this package, or pass --no-libraries.')) : null
  const version = (await readFile(join(player, 'VERSION'), 'utf8').catch(() => 'unknown')).trim()

  await mkdir(target, { recursive: true })
  for (const name of PAGE_FILES) await cp(join(SITE, name), join(target, name))
  for (const name of PLAYER_FILES) await cp(join(player, name), join(target, name))
  await rm(join(target, 'frame-assets'), { recursive: true, force: true })
  await cp(runtime, join(target, 'frame-assets'), { recursive: true })
  // A site written before the pack was split carried it whole; that file is gone either way.
  await rm(join(target, 'libraries.h5p'), { force: true })
  await rm(join(target, 'libraries'), { recursive: true, force: true })
  if (pack) {
    await cp(pack, join(target, 'libraries'), { recursive: true })
    await cp(join(dirname(pack), 'libraries.txt'), join(target, 'libraries.txt'))
  } else {
    await rm(join(target, 'libraries.txt'), { force: true })
  }

  const html = await readFile(join(SITE, 'index.html'), 'utf8')
  await writeFile(join(target, 'index.html'), html.replace('%CSP%', contentSecurityPolicy({ packages: allowedPackages, meta: true })))
  await writeFile(
    join(target, 'config.js'),
    `// Written by h5p-embed: what main.js hands the page.\nexport default ${JSON.stringify({ libraries: Boolean(pack), packages: allowedPackages, defaultLibraries: fallbackLibraries })}\n`
  )

  const csp = contentSecurityPolicy({ packages: allowedPackages, ancestors: allowedAncestors })
  const rules = headerRules(csp)
  await writeFile(join(target, '_headers'), netlifyHeaders(rules))
  await writeFile(join(target, 'vercel.json'), vercelConfig(rules))
  await writeFile(join(target, 'Caddyfile'), caddyfile(rules))
  await writeFile(join(target, 'nginx.conf'), nginxConf(rules))
  await writeFile(join(target, '.htaccess'), htaccess(rules))
  await writeFile(join(target, 'NOTICE.txt'), notice({ version, libraries: Boolean(pack) }))

  return {
    out: target,
    version,
    csp,
    libraries: Boolean(pack),
    packages: allowedPackages,
    ancestors: allowedAncestors,
    defaultLibraries: fallbackLibraries,
    size: await sizeOf(target)
  }
}

/**
 * The folder's size in bytes, for the summary. Paths from a recursive `readdir` rather than
 * `Dirent.parentPath`, which Node 20 has only from 20.12.
 */
async function sizeOf(dir) {
  let total = 0
  for (const name of await readdir(dir, { recursive: true })) {
    const info = await stat(join(dir, name))
    if (info.isFile()) total += info.size
  }
  return total
}
