import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

/**
 * Builds the extension: `dist/extension.cjs`, one CommonJS file with the verifier's preview server
 * in it, and `assets/` — the player's files, the runtime and the library pack's parts, from the
 * installed packages as the embed builder takes them, so that the versions are this checkout's.
 * `vsce package --no-dependencies` then ships those two folders and no node_modules.
 */

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)

const player = dirname(require.resolve('@missing-elements/h5p-offline-player'))
const runtime = join(dirname(require.resolve('@missing-elements/h5p-runtime/package.json')), 'dist')
const pack = dirname(require.resolve('@missing-elements/h5p-libraries/parts/index.json'))
const licences = require.resolve('@missing-elements/h5p-libraries/libraries.txt')
const verify = join(root, '..', 'verify', 'lib')

/** The player's files, by the names the element looks for beside itself. */
const PLAYER_FILES = ['h5p-player.js', 'h5p-sw.js', 'h5p-jobs.js']

for (const [what, file] of [
  ['the player', join(player, 'h5p-sw.js')],
  ['the runtime', join(runtime, 'frame-boot.js')]
]) {
  if (!existsSync(file)) {
    console.error(`${what} is not built: ${file} is missing. Run \`pnpm build\` at the workspace root first.`)
    process.exit(1)
  }
}

/**
 * The preview must not load the check: Playwright is the check's, and the extension carries no
 * node_modules to find it in.
 * @type {import('esbuild').Plugin}
 */
const noPlaywright = {
  name: 'no-playwright',
  setup(context) {
    context.onResolve({ filter: /^playwright-core$/ }, (args) => ({
      errors: [{ text: `${args.importer} imports playwright-core, which only the check needs` }]
    }))
  }
}

await rm(join(root, 'dist'), { recursive: true, force: true })
await rm(join(root, 'assets'), { recursive: true, force: true })

await build({
  entryPoints: [join(root, 'src', 'extension.mjs')],
  outfile: join(root, 'dist', 'extension.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  // VS Code 1.90's extension host runs Node 18.
  target: 'node18',
  external: ['vscode'],
  // The verifier's modules find their files beside themselves by `import.meta.url`, which a
  // CommonJS bundle has not got: it is the bundle's own address, and its files go beside it.
  define: { 'import.meta.url': 'importMetaUrl' },
  banner: { js: "const importMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
  plugins: [noPlaywright],
  legalComments: 'inline',
  logLevel: 'warning'
})
// Open in Browser runs the command's preview, which reads its page beside its module.
await cp(join(verify, 'preview.html'), join(root, 'dist', 'preview.html'))

await mkdir(join(root, 'assets', 'player'), { recursive: true })
for (const name of PLAYER_FILES) await cp(join(player, name), join(root, 'assets', 'player', name))
await cp(runtime, join(root, 'assets', 'runtime'), { recursive: true })
await cp(pack, join(root, 'assets', 'libraries'), { recursive: true })
await cp(licences, join(root, 'assets', 'libraries.txt'))

/** @param {string} name */
const versionOf = async (name) => JSON.parse(await readFile(require.resolve(`${name}/package.json`), 'utf8')).version
const versions = {
  // The player exports no package.json; its dist/ says its version, as the embed builder reads it.
  player: (await readFile(join(player, 'VERSION'), 'utf8')).trim(),
  runtime: await versionOf('@missing-elements/h5p-runtime'),
  libraries: await versionOf('@missing-elements/h5p-libraries')
}
await writeFile(
  join(root, 'NOTICE.txt'),
  `H5P Preview by Missing Elements carries other people's work beside its own.

  dist/extension.cjs  the extension, with the preview server of @missing-elements/h5p-verify
                      bundled: MIT.
  assets/player/      @missing-elements/h5p-offline-player ${versions.player}: MIT. The Service
                      Worker, h5p-sw.js, also carries zip.js, BSD-3-Clause, its licence in its
                      header.
  assets/runtime/     @missing-elements/h5p-runtime ${versions.runtime}, the H5P core runtime:
                      GPL-3.0-only. Its LICENSE.txt and NOTICE.txt say what it is and where
                      its source is.
  assets/libraries/   @missing-elements/h5p-libraries ${versions.libraries}, the H5P hub's libraries,
                      one archive per library, each under its own licence, listed in
                      assets/libraries.txt. The player reads only the ones a package needs.

H5P is a trademark of H5P Group. This extension is made by Missing Elements and is not
affiliated with or endorsed by H5P Group.

https://github.com/missing-elements/h5p-offline-player/tree/main/packages/vscode
`
)

/** @param {string} path */
async function size(path) {
  const info = await stat(path)
  if (!info.isDirectory()) return info.size
  let total = 0
  for (const entry of await readdir(path)) total += await size(join(path, entry))
  return total
}
const megabytes = (/** @type {number} */ bytes) => `${(bytes / 1048576).toFixed(1)} MB`
console.log(`built dist/ (${megabytes(await size(join(root, 'dist')))}) and assets/ (${megabytes(await size(join(root, 'assets')))})`)
// Read so that a broken bundle fails here rather than in VS Code.
if (!(await readFile(join(root, 'dist', 'extension.cjs'), 'utf8')).includes('missingElements.h5pPreview')) {
  console.error('dist/extension.cjs does not register the editor')
  process.exit(1)
}
