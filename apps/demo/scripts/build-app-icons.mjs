import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

/**
 * Renders the installable app's icons into `app/icons/` from the site's logo, `demo/favicon.svg`,
 * which the tab and the bar's mark show too: the logo at 192 and 512 on a transparent ground; a
 * maskable 512, opaque, whose logo sits inside the safe zone, the circle in the centre 80%, since a
 * launcher may crop it to one; and a 180 for iOS, which ignores the manifest's icons for the home
 * screen and draws a screenshot of the page without one. Rasterized in Chromium for the same reason
 * as the social card — no image tooling in the repository. The output is committed; run this when
 * the logo changes.
 */

const rootDir = resolve(import.meta.dirname, '..')
const outDir = resolve(rootDir, 'app', 'icons')
const logo = await readFile(resolve(rootDir, 'demo', 'favicon.svg'), 'utf8')

/** `inset` is the share of the canvas left empty around the logo's square on each side; `ground` the colour under it. */
const page = (size, { inset, ground }) => `<!doctype html>
<html><head><meta charset="utf-8" /><style>
  html, body { margin: 0; width: ${size}px; height: ${size}px; background: ${ground ?? 'transparent'}; }
  svg { position: absolute; left: ${inset * size}px; top: ${inset * size}px; width: ${(1 - 2 * inset) * size}px; height: ${(1 - 2 * inset) * size}px; }
</style></head><body>${logo}</body></html>`

const icons = [
  // The logo as drawn, with the margin it has.
  { name: 'icon-192.png', size: 192, inset: 0 },
  { name: 'icon-512.png', size: 512, inset: 0 },
  // Full bleed: the launcher supplies the shape. At 70% of the canvas the logo's farthest point
  // from the centre stays inside the safe zone's circle.
  { name: 'icon-maskable-512.png', size: 512, inset: 0.15, ground: '#ffffff' },
  // `apple-touch-icon`: opaque and square, since iOS rounds the corners itself and draws any
  // transparent pixel black.
  { name: 'apple-touch-icon.png', size: 180, inset: 0.1, ground: '#ffffff' }
]

await mkdir(outDir, { recursive: true })
const browser = await chromium.launch()
for (const icon of icons) {
  const tab = await browser.newPage({ viewport: { width: icon.size, height: icon.size }, deviceScaleFactor: 1 })
  await tab.setContent(page(icon.size, icon))
  const png = await tab.screenshot({ type: 'png', omitBackground: !icon.ground })
  await writeFile(resolve(outDir, icon.name), png)
  console.log(`[app-icons] ${icon.name} ${(png.length / 1024).toFixed(1)} kB`)
  await tab.close()
}
await browser.close()
