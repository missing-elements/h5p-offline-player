import { cp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * Moves the vendored runtime into `dist/frame-assets/`, where the element names each file with
 * its own `new URL('./frame-assets/<file>', import.meta.url)`. Hosts whose bundler does not
 * follow that pattern serve `dist/` statically and point `assets-base` at it instead.
 */

const rootDir = resolve(import.meta.dirname, '..')
const source = resolve(rootDir, 'public', 'frame-assets')
const target = resolve(rootDir, 'dist', 'frame-assets')

await rm(target, { recursive: true, force: true })
await cp(source, target, { recursive: true })

console.log('[copy-frame-assets] public/frame-assets -> dist/frame-assets')
