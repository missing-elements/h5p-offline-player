import { createHash } from 'node:crypto'
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { build as viteBuild } from 'vite'
import { buildServiceWorker, bundleHostWorker } from '../../../packages/player/scripts/lib/worker-bundle.mjs'

/**
 * Builds the hosted demo into `dist-demo/`: the pages through `vite.config.ts`, then the Service
 * Worker, the frame assets and the demo content placed where the pages and the element expect
 * them. The player's `sync:assets` has to have run first — `pnpm build:demo` runs it — so that
 * the vendored runtime exists in `packages/player/public/`.
 */

const rootDir = resolve(import.meta.dirname, '..')
const publicDir = resolve(rootDir, '..', '..', 'packages', 'player', 'public')
const outDir = resolve(rootDir, 'dist-demo')

// The origin the pages' absolute URLs use: given, or Vercel's production URL, or the preview.
const siteUrl = (
  process.env.SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:4173')
).replace(/\/$/, '')
process.env.SITE_URL = siteUrl

await viteBuild({ configFile: resolve(rootDir, 'vite.config.ts') })

await buildServiceWorker(resolve(outDir, 'h5p-sw.js'))

await rm(resolve(outDir, 'frame-assets'), { recursive: true, force: true })
await cp(resolve(publicDir, 'frame-assets'), resolve(outDir, 'frame-assets'), { recursive: true })

// The demo content, and nothing from the player's `public/fixtures/`: those are the test suite's stub
// archives, and they are not what a visitor should see.
const contentDir = resolve(rootDir, 'demo', 'content')
const packages = (await readdir(contentDir)).filter((name) => name.endsWith('.h5p'))
await mkdir(resolve(outDir, 'demo', 'content'), { recursive: true })
for (const name of packages) {
  await cp(resolve(contentDir, name), resolve(outDir, 'demo', 'content', name))
}

// The installable app, `/app/`. Its manifest and icons are copied as they are: the page links the
// manifest with `vite-ignore`, and the manifest names its icons relative to itself.
await cp(resolve(rootDir, 'app', 'manifest.webmanifest'), resolve(outDir, 'app', 'manifest.webmanifest'))
await cp(resolve(rootDir, 'app', 'icons'), resolve(outDir, 'app', 'icons'), { recursive: true })
// The library pack the app attaches to packages without their own, and its licence notice;
// both precached below with the rest of `app/`. Built by `pnpm demo:libraries`.
for (const name of ['libraries.h5p', 'libraries.txt']) {
  await cp(resolve(rootDir, 'app', name), resolve(outDir, 'app', name))
}

/**
 * What the app needs to start with no network: the page, everything it pulls in — read from
 * Vite's manifest, so the hashed names are the real ones, and from the page itself for the
 * links Vite rewrote but does not list — the runtime and fonts under `frame-assets/`, and the
 * manifest and icons. The version is a hash over all of it, so the worker's bytes change, and
 * the browser installs it again, exactly when something it caches has.
 */
async function appPrecache() {
  const manifestPath = resolve(outDir, '.vite', 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  await rm(resolve(outDir, '.vite'), { recursive: true, force: true })

  const files = new Set()
  const walk = (key) => {
    const chunk = manifest[key]
    if (!chunk || files.has(chunk.file)) return
    files.add(chunk.file)
    for (const name of [...(chunk.css ?? []), ...(chunk.assets ?? [])]) files.add(name)
    for (const next of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])]) walk(next)
  }
  walk('app/index.html')

  const page = await readFile(resolve(outDir, 'app', 'index.html'), 'utf8')
  // Only what the page loads — its stylesheets, icon and scripts — not where its links lead.
  for (const [, url] of page.matchAll(/<(?:link|script)\b[^>]*?\b(?:src|href)="\/([^"]+)"/g)) files.add(url)

  const under = async (dir) => (await readdir(resolve(outDir, dir), { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => relative(outDir, resolve(entry.parentPath, entry.name)).split(sep).join('/'))
  for (const name of [...(await under('frame-assets')), ...(await under('app'))]) files.add(name)

  // The page is cached under its directory URL, the one the app is opened at.
  files.delete('app/index.html')
  const paths = ['app/index.html', ...[...files].sort()]
  const hash = createHash('sha256')
  for (const path of paths) hash.update(path).update(await readFile(resolve(outDir, path)))
  return { version: hash.digest('hex').slice(0, 12), urls: ['/app/', ...[...files].sort().map((name) => `/${name}`)] }
}

const precache = await appPrecache()
await writeFile(
  resolve(outDir, 'app', 'sw.js'),
  await bundleHostWorker(resolve(rootDir, 'app', 'sw.js'), { define: { __APP_PRECACHE__: JSON.stringify(precache) } })
)

// What crawlers and link previews ask for. `/embed` is left out: it carries `noindex`.
await cp(resolve(rootDir, 'demo', 'og-image.png'), resolve(outDir, 'demo', 'og-image.png'))
const pages = ['/', '/app/', '/demo/', '/demo/setup.html', '/demo/normalize.html', '/demo/xapi.html', '/demo/local-file.html', '/demo/two-players.html', '/demo/embed.html']
const today = new Date().toISOString().slice(0, 10)
await writeFile(
  resolve(outDir, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
    .map((page) => `  <url><loc>${siteUrl}${page}</loc><lastmod>${today}</lastmod></url>`)
    .join('\n')}\n</urlset>\n`
)
await writeFile(resolve(outDir, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`)

const sizeOf = async (name) => `${name} ${((await readFile(resolve(outDir, name))).length / 1024).toFixed(1)} kB`
console.log(`[build-demo] ${await sizeOf('h5p-player.js')}, ${await sizeOf('h5p-sw.js')}, ${packages.length} content packages, frame assets -> dist-demo/ (site URL ${siteUrl})`)
console.log(`[build-demo] ${await sizeOf('app/sw.js')}, precaching ${precache.urls.length} files, version ${precache.version}`)
