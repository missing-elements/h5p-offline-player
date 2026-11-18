import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * Puts the repository's README and LICENSE into the package just before it is packed. npm takes
 * both from the package's own folder, and the README is the repository's landing page as well,
 * so it lives at the root and is copied here rather than kept twice. The copies are ignored by
 * git. The README's one relative link, `LICENSE`, resolves in both places. The root README is
 * titled for the repository, the toolkit; on npm the page is this package's, so the copy takes
 * the package's name as its title instead.
 */

const packageDir = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(packageDir, '..', '..')

await copyFile(resolve(repositoryRoot, 'LICENSE'), resolve(packageDir, 'LICENSE'))

const { name } = /** @type {{ name: string }} */ (JSON.parse(await readFile(resolve(packageDir, 'package.json'), 'utf8')))
const readme = await readFile(resolve(repositoryRoot, 'README.md'), 'utf8')
// The title line up to its end, newline or not, so what follows it is copied as it is.
const title = /^# [^\n]*/
if (!title.test(readme)) throw new Error('README.md does not start with a "# " title')
await writeFile(resolve(packageDir, 'README.md'), readme.replace(title, `# ${name}`))

console.log(`[prepack] LICENSE copied, and README.md titled ${name}`)
