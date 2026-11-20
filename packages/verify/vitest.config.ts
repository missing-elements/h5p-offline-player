import { defineConfig } from 'vitest/config'

// The package's limit, and no test's own (design/testing.md, #255): every test here that plays a
// package starts a browser, 9 to 18 s on a CI runner, so one written without a number of its own
// would fail on vitest's 5 s there. A test names its own only to ask for more, as the three that
// play a package several ways do, or where the time is what it tests.
export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 120_000
  }
})
