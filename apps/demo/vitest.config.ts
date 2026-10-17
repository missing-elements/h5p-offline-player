import { defineConfig } from 'vitest/config'

// Its own file, not a `test` block in `vite.config.ts`: the installable app's tests start the
// demo's dev server themselves and drive it with a browser, and the sweep's generator runs in
// Node, so the test runner's Vite instance needs none of the demo's plugins. The demo's other
// pages have no tests, by the owner's rule of 2026-10-17: the demo is not tested, the app is.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000
  }
})
