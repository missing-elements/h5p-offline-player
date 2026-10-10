import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

/**
 * Renders the installable app's icons into `app/icons/`: the site's "H5P" mark at 192 and 512,
 * and a maskable 512 whose mark sits inside the safe zone, the centre 80%, since a launcher may
 * crop it to a circle, and a 180 for iOS, which ignores the manifest's icons for the home screen
 * and draws a screenshot of the page without one. Rasterized in Chromium for the same reason as the social card — no image
 * tooling in the repository. The output is committed; run this when the mark changes.
 */

const rootDir = resolve(import.meta.dirname, '..')
const outDir = resolve(rootDir, 'app', 'icons')

/** `inset` is the share of the canvas the tile leaves empty on each side. */
const page = (size, { inset, radius }) => `<!doctype html>
<html><head><meta charset="utf-8" /><style>
  html, body { margin: 0; width: ${size}px; height: ${size}px; background: ${inset ? '#2f6df6' : 'transparent'}; }
  .tile {
    position: absolute; inset: ${inset * size}px;
    display: grid; place-items: center;
    border-radius: ${radius * size}px; background: #2f6df6; color: #fff;
    font: 700 ${(1 - 2 * inset) * size * 0.38}px / 1 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: -0.02em;
  }
</style></head><body><div class="tile">H5P</div></body></html>`

const icons = [
  { name: 'icon-192.png', size: 192, inset: 0, radius: 0.22 },
  { name: 'icon-512.png', size: 512, inset: 0, radius: 0.22 },
  // Full bleed: the launcher supplies the shape. The mark stays within the centre 80%.
  { name: 'icon-maskable-512.png', size: 512, inset: 0.1, radius: 0 },
  // `apple-touch-icon`: opaque and square, since iOS rounds the corners itself and draws any
  // transparent pixel black.
  { name: 'apple-touch-icon.png', size: 180, inset: 0.08, radius: 0 }
]

await mkdir(outDir, { recursive: true })
const browser = await chromium.launch()
for (const icon of icons) {
  const tab = await browser.newPage({ viewport: { width: icon.size, height: icon.size }, deviceScaleFactor: 1 })
  await tab.setContent(page(icon.size, icon))
  const png = await tab.screenshot({ type: 'png', omitBackground: icon.inset === 0 })
  await writeFile(resolve(outDir, icon.name), png)
  console.log(`[app-icons] ${icon.name} ${(png.length / 1024).toFixed(1)} kB`)
  await tab.close()
}
await browser.close()
