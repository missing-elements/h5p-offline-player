// dist/h5p-mcp.mjs: the command with the MCP SDK and zod bundled into it, so that `npx` installs
// the author package and the verifier and not the SDK's HTTP servers (Express, Hono and the rest),
// which a server over standard input never loads. dist/NOTICE.txt holds the licences of what is
// bundled.
import { build } from 'esbuild'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { existsSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
const dist = join(root, 'dist')
await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })

const { metafile } = await build({
  entryPoints: [join(root, 'bin', 'h5p-mcp.mjs')],
  outfile: join(dist, 'h5p-mcp.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // The author package and the verifier are dependencies, installed beside it.
  external: ['@missing-elements/*'],
  // A CommonJS module bundled into an ES module calls `require`, which an ES module lacks.
  banner: { js: "import { createRequire as __h5pMcpRequire } from 'node:module';\nconst require = __h5pMcpRequire(import.meta.url);" },
  legalComments: 'none',
  metafile: true,
  logLevel: 'warning'
})

/** @type {Map<string, { name: string, version: string, license: string, text: string }>} */
const bundled = new Map()
for (const input of Object.keys(metafile.inputs)) {
  if (!input.includes('node_modules')) continue
  let folder = dirname(resolve(root, input))
  while (!existsSync(join(folder, 'package.json')) || !JSON.parse(await readFile(join(folder, 'package.json'), 'utf8')).name) folder = dirname(folder)
  if (bundled.has(folder)) continue
  const { name, version, license } = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8'))
  const licenceFile = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license'].map((file) => join(folder, file)).find((path) => existsSync(path))
  bundled.set(folder, { name, version, license, text: licenceFile ? (await readFile(licenceFile, 'utf8')).trim() : '' })
}
const packages = [...bundled.values()].sort((a, b) => a.name.localeCompare(b.name))
await writeFile(join(dist, 'NOTICE.txt'), [
  'dist/h5p-mcp.mjs carries these packages, bundled, each under its own licence:',
  '',
  ...packages.map(({ name, version, license }) => `  ${name} ${version}: ${license}`),
  '',
  ...packages.flatMap(({ name, version, text }) => [`--- ${name} ${version}`, '', text || '(no licence file in the package)', ''])
].join('\n'))
console.log(`dist/h5p-mcp.mjs, with ${packages.map(({ name }) => name).join(', ')} bundled`)
