import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build as viteBuild } from 'vite'
import { buildServiceWorker } from './lib/worker-bundle.mjs'

/**
 * Builds the hosted demo into `dist-demo/`: the pages through `vite.demo.config.ts`, then the
 * Service Worker, the frame assets and the demo content placed where the pages and the element
 * expect them. Run `npm run sync:assets` first — `npm run build:demo` does — so that the
 * vendored runtime exists.
 */

const rootDir = resolve(import.meta.dirname, '..')
const publicDir = resolve(rootDir, 'public')
const outDir = resolve(rootDir, 'dist-demo')

// The origin the pages' absolute URLs use: given, or Vercel's production URL, or the preview.
const siteUrl = (
  process.env.SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:4173')
).replace(/\/$/, '')
process.env.SITE_URL = siteUrl

await viteBuild({ configFile: resolve(rootDir, 'vite.demo.config.ts') })

await buildServiceWorker(resolve(outDir, 'h5p-sw.js'))

await rm(resolve(outDir, 'frame-assets'), { recursive: true, force: true })
await cp(resolve(publicDir, 'frame-assets'), resolve(outDir, 'frame-assets'), { recursive: true })

// The demo content, and nothing from `public/fixtures/`: those are the test suite's stub
// archives, and they are not what a visitor should see.
const contentDir = resolve(rootDir, 'demo', 'content')
const packages = (await readdir(contentDir)).filter((name) => name.endsWith('.h5p'))
await mkdir(resolve(outDir, 'demo', 'content'), { recursive: true })
for (const name of packages) {
  await cp(resolve(contentDir, name), resolve(outDir, 'demo', 'content', name))
}

// What crawlers and link previews ask for. `/embed` is left out: it carries `noindex`.
await cp(resolve(rootDir, 'demo', 'og-image.png'), resolve(outDir, 'demo', 'og-image.png'))
const pages = ['/', '/demo/', '/demo/setup.html', '/demo/xapi.html', '/demo/local-file.html', '/demo/two-players.html', '/demo/embed.html']
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
