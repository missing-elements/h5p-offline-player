/// <reference types="vitest/config" />
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { playwright } from '@vitest/browser-playwright'
import { devServiceWorkerPlugin, jobsWorkerPlugin, noRangeFixturesPlugin, siteUrlPlugin } from './vite.plugins'

/**
 * The library build, the dev server and the test runner. The plugins live in `vite.plugins.ts`
 * because the hosted demo (`vite.demo.config.ts`) needs the same ones.
 */

export default defineConfig({
  plugins: [jobsWorkerPlugin(), devServiceWorkerPlugin(), noRangeFixturesPlugin(), siteUrlPlugin('http://localhost:5173')],

  build: {
    target: 'es2022',
    lib: {
      name: 'H5PPlayerElement',
      entry: resolve(import.meta.dirname, 'src/h5p-offline-player.ts'),
      fileName: () => 'h5p-player.js',
      formats: ['es']
    },
    rollupOptions: {
      output: { assetFileNames: '[name][extname]' }
    },
    copyPublicDir: false,
    emptyOutDir: true
  },

  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts']
        }
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['tests/browser/**/*.test.ts'],
          browser: browserProject()
        }
      },
      {
        // A browser of its own: the storage-quota override these tests apply is per browser
        // profile, and would otherwise land on whatever other test file happened to be running.
        extends: true,
        test: {
          name: 'browser-quota',
          include: ['tests/browser-quota/**/*.test.ts'],
          browser: browserProject()
        }
      }
    ]
  }
})

function browserProject() {
  return {
    enabled: true,
    // From Vitest 4 on, a provider is a package rather than a name.
    provider: playwright(),
    headless: true,
    // Chromium only: the paths this exercises — Service Worker registration on a nested scope,
    // Range responses synthesized by a worker — are where browsers differ most, and a second
    // engine belongs in CI rather than in the default run.
    instances: [{ browser: 'chromium' as const }]
  }
}
