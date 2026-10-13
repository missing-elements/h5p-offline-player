/// <reference types="vitest/config" />
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { playwright } from '@vitest/browser-playwright'
import { devServiceWorkerPlugin, jobsWorkerPlugin, noRangeFixturesPlugin } from './vite.plugins'

/**
 * The library build and the test runner. The plugins live in `vite.plugins.ts` because the demo
 * app (`apps/demo/vite.config.ts`), which is the dev server, needs the same ones.
 */

export default defineConfig({
  plugins: [jobsWorkerPlugin(), devServiceWorkerPlugin(), noRangeFixturesPlugin()],

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
          browser: browserProject(engine())
        }
      },
      {
        // A browser of its own, one file at a time: these tests emulate a browser condition
        // through CDP — a storage cap, a slow link — and the emulation is per browser profile,
        // so it would otherwise land on whatever other test file happened to be running.
        extends: true,
        test: {
          name: 'browser-emulated',
          include: ['tests/browser-emulated/**/*.test.ts'],
          fileParallelism: false,
          browser: browserProject('chromium')
        }
      }
    ]
  }
})

type Engine = 'chromium' | 'firefox' | 'webkit'

/**
 * The engine the suite runs in: Chromium, or the one `H5P_TEST_BROWSER` names, which CI sets to
 * each of the three in turn. The paths this exercises, Service Worker registration on a nested
 * scope and Range responses synthesized by a worker, are where engines differ most. One engine
 * per run, not a list: the dev server's switches — a host's outage, the worker version it serves —
 * are shared, and two engines running one file at once flip them under each other. Firefox and
 * WebKit need `playwright install firefox webkit` first. The emulated project stays on Chromium:
 * it drives the browser through CDP, which only Chromium speaks.
 */
function engine(): Engine {
  const name = process.env.H5P_TEST_BROWSER?.trim() || 'chromium'
  if (name !== 'chromium' && name !== 'firefox' && name !== 'webkit') throw new Error(`H5P_TEST_BROWSER: unknown browser "${name}"`)
  return name
}

function browserProject(browser: Engine) {
  return {
    enabled: true,
    // From Vitest 4 on, a provider is a package rather than a name.
    provider: playwright(),
    headless: true,
    instances: [{ browser }]
  }
}
