import { defineConfig } from 'vitest/config'

// The agent skills' scripts, tested from a project of the kind their user runs them in: this one
// installs what the skills tell a user to install, and the scripts resolve their dependencies from
// it. A project of its own since 2026-10-23, out of the demo, which is not tested but for its
// installable app (the owner's rule of 2026-10-17). The tests run in Node and drive Chromium
// themselves, so the runner needs no plugins.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000
  }
})
