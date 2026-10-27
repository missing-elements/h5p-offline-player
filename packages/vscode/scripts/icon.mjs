import { readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

/**
 * Renders `icon.png`, the extension's icon on the Marketplace, on Open VSX and in VS Code, from the
 * project's logo, the demo site's `demo/favicon.svg`: one file for the site, the app and the
 * extension, so that none of them drifts. 256 px square on a transparent ground: the Marketplace
 * takes 128 at the least and 256 to draw it sharp on a high-density screen. Rasterized in Chromium,
 * as the demo's icons are, since the repository has no image tooling. The output is committed; run
 * this when the logo changes.
 */

const SIZE = 256

const svg = await readFile(new URL('../../../apps/demo/demo/favicon.svg', import.meta.url), 'utf8')
const browser = await chromium.launch()
try {
  const tab = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 })
  await tab.setContent(`<!doctype html>
<html><head><meta charset="utf-8" /><style>
  html, body { margin: 0; background: transparent; }
  svg { display: block; width: ${SIZE}px; height: ${SIZE}px; }
</style></head><body>${svg}</body></html>`)
  const png = await tab.screenshot({ type: 'png', omitBackground: true })
  await writeFile(new URL('../icon.png', import.meta.url), png)
  console.log(`icon.png: ${SIZE} px, ${(png.length / 1024).toFixed(1)} kB`)
} finally {
  await browser.close()
}
