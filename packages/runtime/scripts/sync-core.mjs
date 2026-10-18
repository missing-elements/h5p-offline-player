import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, posix, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Vendors the H5P core from h5p/h5p-php-library at a commit, into `vendor/h5p-core/`, which is
 * committed: `pnpm core:sync master` moves it to upstream's newest commit, `pnpm core:sync <sha>`
 * to that one, and `pnpm core:sync` alone fetches the commit already recorded again, which leaves
 * the tree as it was unless something upstream was rewritten.
 *
 * What is taken, and in what order, is upstream's own word rather than a list kept here: the
 * scripts and stylesheets a player loads are `H5PCore::$scripts` and `H5PCore::$styles` in
 * `h5p.classes.php` at that commit, the fonts and images are the ones those stylesheets reference,
 * and the core's English strings are the player's part of `H5PCore::getLocalization()`, which
 * `scripts/build.mjs` gives the frame as its defaults and `scripts/build-l10n.mjs` translates.
 * The commit, its date and those lists go into `SOURCE.json`, which the build reads.
 *
 * Until 2026-10-18 the core came through h5p-standalone, which copies it about once a year and
 * records no revision; issue #37.
 */

const REPOSITORY = 'h5p/h5p-php-library'
const rootDir = resolve(import.meta.dirname, '..')
export const CORE_DIR = resolve(rootDir, 'vendor', 'h5p-core')

/**
 * `getLocalization()` lists the player's strings and then, from `mainTitle` on, the strings of the
 * hub's sharing wizard, which only an editor shows. The player's are taken: the keys a frame's
 * `H5PIntegration.l10n.H5P` has always had, and the ones Moodle's packs translate.
 */
const FIRST_EDITOR_STRING = 'mainTitle'

const fail = (message) => {
  throw new Error(`[h5p-core] ${message}`)
}

/** GitHub's API, with a token when the environment has one: sixty requests an hour without. */
async function api(path) {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'h5p-offline-player core sync' }
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/${path}`, { headers })
  if (!response.ok) fail(`GitHub answered ${response.status} for ${path}`)
  return response.json()
}

async function raw(commit, path) {
  const response = await fetch(`https://raw.githubusercontent.com/${REPOSITORY}/${commit}/${path}`)
  if (!response.ok) fail(`${path} at ${commit}: ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

/** A PHP string literal's value: single quotes take `\'` and `\\`, double quotes a few more. */
function phpString(literal) {
  const quote = literal[0]
  const body = literal.slice(1, -1)
  if (quote === "'") return body.replace(/\\(['\\])/g, '$1')
  return body.replace(/\\(["\\$])/g, '$1').replace(/\\n/g, '\n').replace(/\\t/g, '\t')
}

const STRING = String.raw`'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"`

/** The entries of `public static $<name> = array(…);` in `h5p.classes.php`, in order. */
export function staticList(source, name) {
  const match = new RegExp(String.raw`public static \$${name} = array\(([\s\S]*?)\);`).exec(source)
  if (!match) fail(`h5p.classes.php no longer declares H5PCore::$${name}`)
  return [...match[1].matchAll(new RegExp(STRING, 'g'))].map(([literal]) => phpString(literal))
}

/** `H5PCore::$coreApi`, as `major.minor`. */
export function coreApi(source) {
  const match = /public static \$coreApi = array\(\s*'majorVersion' => (\d+),\s*'minorVersion' => (\d+)/.exec(source)
  if (!match) fail('h5p.classes.php no longer declares H5PCore::$coreApi')
  return `${match[1]}.${match[2]}`
}

/** The player's English strings from `getLocalization()`, by key, in upstream's order. */
export function playerStrings(source) {
  const start = source.indexOf('public function getLocalization()')
  if (start < 0) fail('h5p.classes.php no longer has getLocalization()')
  const strings = {}
  const entry = new RegExp(String.raw`'([A-Za-z0-9]+)' => (?:\$this->h5pF->t\((${STRING})\)|array\()`, 'g')
  entry.lastIndex = start
  for (let match; (match = entry.exec(source)); ) {
    if (match[1] === FIRST_EDITOR_STRING) return strings
    // A nested array is the sharing wizard's too; the player has none.
    if (match[2] === undefined) fail(`getLocalization() has a nested array before ${FIRST_EDITOR_STRING}: ${match[1]}`)
    strings[match[1]] = phpString(match[2])
  }
  return fail(`getLocalization() no longer has "${FIRST_EDITOR_STRING}", where the player's strings end`)
}

/** The relative URLs a stylesheet reaches, `../fonts/…` and `../images/…`, without query or fragment. */
function stylesheetAssets(css) {
  return [...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)]
    .map(([, url]) => url.split(/[?#]/)[0])
    .filter((url) => !/^(?:[a-z]+:|\/|#)/i.test(url))
}

export async function syncCore(ref) {
  const recorded = await readFile(resolve(CORE_DIR, 'SOURCE.json'), 'utf8').then(JSON.parse, () => null)
  const wanted = ref ?? recorded?.commit
  if (!wanted) fail('No commit recorded yet: name one, as in "pnpm core:sync master"')

  const { sha: commit, commit: details } = await api(`commits/${encodeURIComponent(wanted)}`)
  const classes = new TextDecoder().decode(await raw(commit, 'h5p.classes.php'))
  const scripts = staticList(classes, 'scripts')
  const styles = staticList(classes, 'styles')
  const strings = playerStrings(classes)

  for (const path of scripts) if (!/^js\/[\w.-]+\.js$/.test(path)) fail(`H5PCore::$scripts names ${path}, not a script in js/`)
  for (const path of styles) if (!/^styles\/[\w.-]+\.css$/.test(path)) fail(`H5PCore::$styles names ${path}, not a stylesheet in styles/`)
  if (!scripts.includes('js/jquery.js') || !scripts.includes('js/h5p.js')) fail('H5PCore::$scripts no longer names jquery.js and h5p.js')
  if (Object.keys(strings).length < 60 || !strings.fullscreen) fail(`only ${Object.keys(strings).length} strings before ${FIRST_EDITOR_STRING}`)

  const files = new Map()
  for (const path of [...scripts, ...styles]) files.set(path, await raw(commit, path))

  // The fonts and images the stylesheets reach, and the licence beside each font family's files.
  const { tree } = await api(`git/trees/${commit}?recursive=1`)
  const inTree = new Set(tree.filter((node) => node.type === 'blob').map((node) => node.path))
  const assets = new Set()
  for (const path of styles) {
    for (const url of stylesheetAssets(new TextDecoder().decode(files.get(path)))) {
      const asset = posix.normalize(posix.join(posix.dirname(path), url))
      if (!/^(fonts|images)\//.test(asset) || !inTree.has(asset)) fail(`${path} reaches ${url}, which is not a font or an image at ${commit}`)
      assets.add(asset)
    }
  }
  const fontFolders = new Set([...assets].filter((path) => /^fonts\/[^/]+\//.test(path)).map(posix.dirname))
  for (const path of inTree) {
    if (fontFolders.has(posix.dirname(path)) && /^(LICENSE|OFL)[^/]*$/i.test(posix.basename(path))) assets.add(path)
  }
  for (const path of [...assets].sort()) files.set(path, await raw(commit, path))

  await rm(CORE_DIR, { recursive: true, force: true })
  for (const [path, bytes] of files) {
    await mkdir(dirname(resolve(CORE_DIR, path)), { recursive: true })
    await writeFile(resolve(CORE_DIR, path), bytes)
  }
  await writeFile(resolve(CORE_DIR, 'strings.json'), `${JSON.stringify(strings, null, 2)}\n`)
  const source = {
    repository: `https://github.com/${REPOSITORY}`,
    commit,
    date: details.committer.date,
    coreApi: coreApi(classes),
    scripts,
    styles
  }
  await writeFile(resolve(CORE_DIR, 'SOURCE.json'), `${JSON.stringify(source, null, 2)}\n`)

  const moved = recorded && recorded.commit !== commit ? ` (was ${recorded.commit.slice(0, 10)})` : ''
  console.log(`[h5p-core] ${REPOSITORY} at ${commit.slice(0, 10)}${moved}, ${source.date}, core API ${source.coreApi}: ${scripts.length} scripts, ${styles.length} stylesheets, ${assets.size} fonts and images, ${Object.keys(strings).length} strings -> vendor/h5p-core/`)
  return source
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await syncCore(process.argv[2])
}
