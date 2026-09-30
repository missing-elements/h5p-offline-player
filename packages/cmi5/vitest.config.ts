import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@xapi/cmi5': resolve(import.meta.dirname, 'tests/xapi-cmi5-stub.ts') }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
})
