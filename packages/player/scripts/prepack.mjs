import { copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * Puts the repository's LICENSE into the package just before it is packed: npm takes it from the
 * package's own folder, and it lives at the root, so it is copied here rather than kept twice. The
 * copy is ignored by git. The README is the package's own, `README.md` beside this folder: the
 * root one is the toolkit's front page, and npm shows this package's.
 */

const packageDir = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(packageDir, '..', '..')

await copyFile(resolve(repositoryRoot, 'LICENSE'), resolve(packageDir, 'LICENSE'))

console.log('[prepack] LICENSE copied from the repository root')
