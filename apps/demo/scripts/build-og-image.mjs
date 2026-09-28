import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

/**
 * Renders the social card, `demo/og-image.png`, 1200 by 630, from a small HTML page in Chromium.
 * Link previews want a raster image and the repository has no image tooling, so the browser the
 * tests already need does the rasterizing. The output is committed; run this when the card's
 * text or the brand colour changes.
 */

const rootDir = resolve(import.meta.dirname, '..')

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; width: 1200px; height: 630px; }
      body {
        box-sizing: border-box;
        display: flex; flex-direction: column; justify-content: space-between;
        padding: 72px 80px;
        font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
        color: #15171c;
        background: linear-gradient(135deg, #f6f8fa 0%, #ffffff 55%, #eef3ff 100%);
      }
      .brand { display: flex; align-items: center; gap: 20px; font-size: 34px; font-weight: 700; }
      .mark {
        width: 64px; height: 64px; border-radius: 16px; background: #2f6df6; color: #fff;
        display: grid; place-items: center; font-size: 26px; font-weight: 800;
      }
      h1 { margin: 0; font-size: 66px; line-height: 1.08; letter-spacing: -1.5px; max-width: 1000px; }
      p { margin: 26px 0 0; font-size: 30px; line-height: 1.4; color: #5b6370; max-width: 980px; }
      code { font-family: ui-monospace, Menlo, monospace; background: #eef1f5; padding: 2px 12px; border-radius: 8px; color: #15171c; }
      .foot { display: flex; justify-content: space-between; font-size: 26px; color: #5b6370; }
    </style>
  </head>
  <body>
    <div class="brand"><div class="mark">H5</div>h5p-offline-player</div>
    <div>
      <h1>Play H5P packages in the browser.<br />No server, no unpacking.</h1>
      <p>A web component that reads a <code>.h5p</code> in place and serves it to the H5P runtime with a Service Worker.</p>
    </div>
    <div class="foot"><span>github.com/missing-elements/h5p-offline-player</span><span>MIT</span></div>
  </body>
</html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
await page.setContent(html)
const png = await page.screenshot({ type: 'png' })
await browser.close()

const target = resolve(rootDir, 'demo', 'og-image.png')
await writeFile(target, png)
console.log(`[og-image] ${(png.length / 1024).toFixed(1)} kB -> demo/og-image.png`)
