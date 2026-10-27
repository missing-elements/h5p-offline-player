import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloadAndUnzipVSCode } from '@vscode/test-electron'
import { _electron as electron } from 'playwright-core'

/**
 * Renders `images/preview.png`, the screenshot on the extension's Marketplace and Open VSX page: the
 * demo's quiz playing in an editor tab, its first question answered and checked, with the Explorer
 * beside it. It drives the VS Code the suite downloads with Playwright, which takes the window from
 * inside, so nothing needs the screen or its recording permission. A fresh profile keeps the window
 * plain: the default theme, no other extension, no AI features. The output is committed, and the
 * listing loads it from `main`; run this (`pnpm --filter h5p-preview screenshot`, which builds
 * first) when the preview's look changes.
 */

const root = fileURLToPath(new URL('..', import.meta.url))
const content = fileURLToPath(new URL('../../../apps/demo/demo/content/', import.meta.url))
const WIDTH = 1200
const HEIGHT = 750
const ANSWER = 'In your browser, straight out of the zip'

const work = await mkdtemp(join(tmpdir(), 'h5p-preview-screenshot-'))
const folder = join(work, 'course')
await mkdir(folder)
for (const name of ['quiz.h5p', 'video.h5p', 'glossary.h5p']) await cp(join(content, name), join(folder, name))
await mkdir(join(work, 'user-data', 'User'), { recursive: true })
await writeFile(
  join(work, 'user-data', 'User', 'settings.json'),
  JSON.stringify({
    // The title bar macOS draws is not part of the page, and the one VS Code adds below it, which
    // names the window an Extension Development Host, is off: the picture starts at the tabs.
    'window.titleBarStyle': 'native',
    'window.customTitleBarVisibility': 'never',
    'workbench.secondarySideBar.defaultVisibility': 'hidden',
    'workbench.startupEditor': 'none',
    'workbench.editor.enablePreview': false,
    'workbench.tips.enabled': false,
    'workbench.enableExperiments': false,
    'chat.disableAIFeatures': true,
    'update.mode': 'none',
    'telemetry.telemetryLevel': 'off',
    'extensions.ignoreRecommendations': true,
    'git.enabled': false
  })
)

// A terminal inside VS Code passes on its own variables, and with them the editor starts as Node.
for (const key of Object.keys(process.env)) if (/^(VSCODE|ELECTRON)_/.test(key)) delete process.env[key]
const app = await electron.launch({
  executablePath: await downloadAndUnzipVSCode(process.env.VSCODE_TEST_VERSION ?? 'stable'),
  args: [
    folder,
    `--extensionDevelopmentPath=${root}`,
    // The quiz is opened from inside the extension host. Opened from the command line or the Explorer
    // before the extension's editor is registered, which a fresh profile does not wait for, the file
    // falls back to the text editor, which shows a zip as binary.
    `--extensionTestsPath=${join(root, 'scripts', 'screenshot-open.cjs')}`,
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
    `--user-data-dir=${join(work, 'user-data')}`,
    `--extensions-dir=${join(work, 'extensions')}`
  ]
})
// Multiple Choice shuffles its answers on every load: seeded in the preview's frames, and only there,
// the picture is the same from one run to the next.
await app.context().addInitScript(() => {
  // A frame's own global: the package's lib has no DOM.
  if (/** @type {any} */ (globalThis).location.hostname !== '127.0.0.1') return
  let seed = 1
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
})
try {
  const window = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }, [width, height]) => {
    for (const browserWindow of BrowserWindow.getAllWindows()) browserWindow.setContentSize(width, height)
  }, [WIDTH, HEIGHT])
  const quiz = await frameWith(app, '.questionset')
  await quiz.getByRole('button', { name: 'Start' }).click()
  await quiz.getByRole('radio', { name: ANSWER }).click()
  await quiz.getByRole('button', { name: /^Check/ }).click()
  await quiz.locator('.h5p-answer.h5p-correct').waitFor()
  // On the status bar's empty middle, out of the way of every hover style; the score bar's star
  // animates, and is taken at its end.
  await window.mouse.move(WIDTH / 2, HEIGHT - 11)
  await window.waitForTimeout(1500)
  await mkdir(join(root, 'images'), { recursive: true })
  const png = await window.screenshot({ path: join(root, 'images', 'preview.png'), animations: 'disabled' })
  console.log(`images/preview.png: ${(png.length / 1024).toFixed(1)} kB`)
} finally {
  await app.close()
  await rm(work, { recursive: true, force: true })
}

/**
 * The first frame, in any window, holding `selector`: the content sits three frames below the workbench.
 * @param {import('playwright-core').ElectronApplication} app
 * @param {string} selector
 */
async function frameWith(app, selector, timeout = 60_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    for (const frame of app.windows().flatMap((window) => window.frames())) {
      if (await frame.locator(selector).count().catch(() => 0)) return frame
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  const frames = app.windows().flatMap((window) => window.frames().map((frame) => frame.url() || '(blank)'))
  throw new Error(`No frame shows ${selector} after ${timeout / 1000} s. The frames: ${frames.join(', ')}`)
}
