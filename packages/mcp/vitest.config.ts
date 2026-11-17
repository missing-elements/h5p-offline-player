import { defineConfig } from 'vitest/config'

// The server runs as its user's app runs it: the bundle, started over standard input and output.
// A build with its check plays the package in Chromium, which takes seconds.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000
  }
})
