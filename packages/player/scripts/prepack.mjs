import { copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * Puts the repository's README and LICENSE into the package just before it is packed. npm takes
 * both from the package's own folder, and the README is the repository's landing page as well,
 * so it lives at the root and is copied here rather than kept twice. The copies are ignored by
 * git. The README's one relative link, `LICENSE`, resolves in both places.
 */

const packageDir = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(packageDir, '..', '..')

for (const name of ['README.md', 'LICENSE']) {
  await copyFile(resolve(repositoryRoot, name), resolve(packageDir, name))
}

console.log('[prepack] README.md and LICENSE copied from the repository root')
