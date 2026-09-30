import { defineConfig } from 'vitest/config'

// Its own file, not a `test` block in `vite.config.ts`: the tests start the demo's dev server
// themselves and drive it with a browser, so the test runner's Vite instance needs none of the
// demo's plugins.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000
  }
})
