import { defineConfig } from 'vitest/config'

// The browser tests serve a written site and drive it with Chromium, so they get room.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000
  }
})
