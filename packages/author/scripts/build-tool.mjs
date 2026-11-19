import { execFileSync } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

/**
 * The command line as one file, `h5p-author.mjs`, and `h5p-author-LICENSES.txt`, every package
 * bundled into it with its licence, since MIT and BSD-3-Clause ask their notices to travel with
 * copies (#247). Route 3 of the skill runs the file with nothing installed, from an unzipped bundle,
 * and the organisation's site serves it as this package ships it, so the npm package, and its
 * provenance, cover the bytes a chat runs. Everything it imports is bundled in by Vite, with copies
 * of the two package.json files it reads its versions from where neither is beside it
 * (h5p-toolkit#198). It takes `--libraries`: the pinned pack is not with it.
 *
 * `pnpm build:tool` builds the player's plan, which it imports, first; `prepack` runs that.
 * `node scripts/build-tool.mjs [folder]` writes the two files in `folder`, by default `dist/`.
 */
const root = resolve(import.meta.dirname, '..')
const folder = resolve(process.argv[2] ?? join(root, 'dist'))
const TOOL = 'h5p-author.mjs'
const LICENSES = 'h5p-author-LICENSES.txt'

for (const file of [TOOL, LICENSES]) await rm(join(folder, file), { force: true })
await build({
  configFile: false,
  root,
  logLevel: 'warn',
  publicDir: false,
  build: {
    ssr: join(root, 'bin', TOOL),
    outDir: folder,
    emptyOutDir: false,
    copyPublicDir: false,
    minify: false,
    license: { fileName: LICENSES },
    reportCompressedSize: false,
    rolldownOptions: { output: { entryFileNames: TOOL, format: 'es', codeSplitting: false } }
  },
  ssr: { noExternal: true, target: 'node' }
})

// The tool says its own versions, as a model checking it first asks: this package's and its pack's.
const version = async (/** @type {string} */ path) => JSON.parse(await readFile(path, 'utf8')).version
const pack = fileURLToPath(import.meta.resolve('@missing-elements/h5p-libraries/package.json'))
const expected = `@missing-elements/h5p-author ${await version(join(root, 'package.json'))}, library pack ${await version(pack)}`
const printed = execFileSync(process.execPath, [join(folder, TOOL), '--version'], { encoding: 'utf8' }).trim()
if (printed !== expected) throw new Error(`${TOOL} --version printed "${printed}", not "${expected}"`)
console.log(`Built ${join(folder, TOOL)}: ${printed}`)
