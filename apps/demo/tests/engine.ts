import { chromium, firefox, webkit, type BrowserType } from 'playwright'

/**
 * The browser the demo's tests drive: Chromium, or the engine `H5P_TEST_BROWSER` names, as the
 * player's browser suite picks its own. One engine per run; CI's `engines` job runs each.
 */
export type Engine = 'chromium' | 'firefox' | 'webkit'

export const engine: Engine = (() => {
  const name = process.env.H5P_TEST_BROWSER?.trim() || 'chromium'
  if (name !== 'chromium' && name !== 'firefox' && name !== 'webkit') throw new Error(`H5P_TEST_BROWSER: unknown browser "${name}"`)
  return name
})()

export const browserType: BrowserType = { chromium, firefox, webkit }[engine]
