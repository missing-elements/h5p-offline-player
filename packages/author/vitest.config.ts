import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { verifyPackage } from '@missing-elements/h5p-verify'
import { playwright } from '@vitest/browser-playwright'
import { configDefaults, defineConfig } from 'vitest/config'
import type { BrowserCommand } from 'vitest/node'

// The pack the build pins, which the verifier plays an untrusted package against, as a site with it does.
const parts = resolve(import.meta.dirname, '../libraries/parts')

/**
 * A package the page's build wrote in Chromium, handed to Node as base64 and played by the verifier
 * untrusted, as a site that did not make it plays it: the report's verdict, what it warns of, and
 * what the content check changed.
 */
const playUntrusted: BrowserCommand<[name: string, base64: string]> = async (_context, name, base64) => {
  const dir = await mkdtemp(join(tmpdir(), 'h5p-author-page-'))
  try {
    const file = join(dir, name)
    await writeFile(file, Buffer.from(base64, 'base64'))
    const { verdict, reasons, warnings, errors, state, untrusted, contentCheck } = await verifyPackage({ file, untrusted: true, libraries: parts, settle: 500 })
    return { verdict, reasons, warnings, errors, state, untrusted, contentCheck }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: [...configDefaults.exclude, 'tests/browser/**']
        }
      },
      {
        // Served from its own folder, so that each part's URL, a `new URL` beside the pack's index,
        // is a file there rather than in Vite's bundle of dependencies.
        optimizeDeps: { exclude: ['@missing-elements/h5p-libraries'] },
        test: {
          name: 'browser',
          include: ['tests/browser/**/*.test.ts'],
          testTimeout: 180_000,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
            commands: { playUntrusted }
          }
        }
      }
    ]
  }
})
