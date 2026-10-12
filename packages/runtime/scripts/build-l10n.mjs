import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { HttpReader, TextWriter, ZipReader, configure } from '@zip.js/zip.js'
import { coreStrings, packTag, translationProblem } from './l10n-rules.mjs'

/**
 * Writes `l10n/`: the H5P core's interface strings — "Fullscreen", "Rights of use", the licence
 * names, the "this content has changed" dialog — in every language Moodle's translators have put
 * them into, one JSON file per language, which `build.mjs` gathers into `dist/l10n.js`. Run every
 * Monday by `.github/workflows/l10n.yml`, which opens a pull request when a translation changed,
 * or by hand (`pnpm l10n`); the result is committed, like the library pack, so that a build does
 * not depend on Moodle's servers.
 *
 * Why Moodle: the core's strings are not translated anywhere H5P publishes; every platform
 * translates them itself, through its own string system. Moodle's are the most complete, written
 * by its translators in AMOS, and GPL-3.0-or-later like this package. Moodle names each string by
 * an id of its own, and `core_h5p\framework::t()` maps the core's English message to that id;
 * that map is read from a pinned commit, the strings from the current language packs, read by
 * range so only `h5p.php` and `langconfig.php` come over the wire. Lumi's H5P-Nodejs-library has
 * the same strings under the core's keys, but machine-translated, which its own notes say no
 * native speaker has reviewed.
 *
 * Every pack Moodle lists is read, so a language whose translators reach the line is written
 * without anyone adding it. A translation that breaks a `:placeholder` or carries markup is left
 * out, and the core shows its English string there, as Moodle shows its English for a string a
 * pack lacks. A language with fewer than two thirds of the strings is not written, and neither is
 * a variant pack (`packTag`). A pack whose strings are all its parent's adds nothing: a region of
 * the parent's language is left to the frame's lookup, which takes `fr-CA` to `fr` anyway, and
 * another language becomes an alias of the parent's — Moodle shows Nynorsk, Greenlandic and
 * Lower Sorbian learners the Norwegian, Danish and German strings, and so does the frame.
 *
 * A run that loses several languages at once has met a change in Moodle's packs or map, or in
 * the core's strings, rather than translators' work, and stops before deleting their files;
 * `pnpm l10n --allow-loss` writes it anyway, once someone has looked.
 */

const rootDir = resolve(import.meta.dirname, '..')
const L10N_DIR = resolve(rootDir, 'l10n')
const INDEX_PATH = resolve(L10N_DIR, 'index.json')

const MOODLE_VERSION = '5.2'
const MOODLE_COMMIT = '244d94041df0b9193d99146bf3e235ba0534caa1'
const MAP_URL = `https://raw.githubusercontent.com/moodle/moodle/${MOODLE_COMMIT}/public/h5p/classes/framework.php`
const PACKS_URL = `https://packaging.moodle.org/langpack/${MOODLE_VERSION}/`
const packUrl = (code) => `${PACKS_URL}${code}.zip`

const MIN_SHARE = 2 / 3

/**
 * Tags that name a language the packs carry under another tag, which no pack's parent says: the
 * old codes for Hebrew and Indonesian, Chinese by script and by region, Serbian with no script,
 * whose official one is Cyrillic, and Valencian with its region, which the lookup would cut back
 * to Catalan. Each is kept while its target is written.
 */
const EQUIVALENT = {
  iw: 'he',
  in: 'id',
  zh: 'zh-CN',
  'zh-Hans': 'zh-CN',
  'zh-SG': 'zh-CN',
  'zh-Hant': 'zh-TW',
  'zh-HK': 'zh-TW',
  'zh-MO': 'zh-TW',
  sr: 'sr-Cyrl',
  'ca-ES-valencia': 'ca-valencia'
}

const fail = (message) => {
  throw new Error(`[h5p-l10n] ${message}`)
}

/** `$string['id'] = '…';` from a Moodle language file. Moodle writes them single-quoted. */
function moodleStrings(source) {
  const strings = {}
  for (const match of source.matchAll(/\$string\['([^']+)'\]\s*=\s*'((?:[^'\\]|\\.)*)'\s*;/g)) {
    strings[match[1]] = match[2].replace(/\\(['\\])/g, '$1')
  }
  return strings
}

/** The `'English message' => 'id'` pairs of `$translationsmap` in Moodle's `framework.php`. */
function translationsMap(php) {
  const start = php.indexOf('$translationsmap = [')
  const end = php.indexOf('];', start)
  if (start < 0 || end < 0) fail(`no $translationsmap in ${MAP_URL}`)
  const map = new Map()
  let key = ''
  let value = null
  let side = 'key'
  // Strings single- or double-quoted, joined with `.` across lines; comments skipped.
  const tokens = php.slice(start + '$translationsmap = ['.length, end).matchAll(
    /\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|(=>)|(,)/g
  )
  for (const [, single, double, arrow, comma] of tokens) {
    const text = single !== undefined ? single.replace(/\\(['\\])/g, '$1') : double?.replace(/\\(["\\$])/g, '$1')
    if (text !== undefined) {
      if (side === 'key') key += text
      else value = (value ?? '') + text
    } else if (arrow) side = 'value'
    else if (comma) {
      if (side === 'value' && value !== null) map.set(key, value)
      key = ''
      value = null
      side = 'key'
    }
  }
  if (side === 'value' && value !== null) map.set(key, value)
  return map
}

configure({ useWebWorkers: false })

/** A pack's `langconfig.php` and `h5p.php`, read by range: the zip's directory, then the two entries. */
async function readPack(code) {
  for (let attempt = 1; ; attempt++) {
    const reader = new ZipReader(new HttpReader(packUrl(code), { useRangeHeader: true, forceRangeRequests: true, preventHeadRequest: true }))
    try {
      const entries = await reader.getEntries()
      const read = async (name) => {
        const entry = entries.find((each) => each.filename === `${code}/${name}`)
        return entry ? moodleStrings(await entry.getData(new TextWriter())) : {}
      }
      return { config: await read('langconfig.php'), strings: await read('h5p.php') }
    } catch (error) {
      // A burst of requests is turned away now and then; a pack that keeps failing stops the run.
      if (attempt === 3) fail(`could not read ${packUrl(code)}: ${error}`)
      await new Promise((done) => setTimeout(done, 2000 * attempt))
    } finally {
      await reader.close()
    }
  }
}

const english = coreStrings()
const keys = Object.keys(english)

const mapResponse = await fetch(MAP_URL)
if (!mapResponse.ok) fail(`${MAP_URL} answered ${mapResponse.status}`)
const map = translationsMap(await mapResponse.text())
const idOf = {}
for (const key of keys) {
  const id = map.get(english[key])
  if (id) idOf[key] = id
  else console.warn(`[h5p-l10n] Moodle has no string for "${english[key]}" (${key}); it stays English`)
}
// One reworded string is news; most of them is a map or a core that changed shape.
if (Object.keys(idOf).length < keys.length * 0.9) {
  fail(`only ${Object.keys(idOf).length} of the core's ${keys.length} strings have a Moodle id in ${MAP_URL}`)
}

// Moodle's list of packs, a `code,md5,name` line each.
const listUrl = `${PACKS_URL}languages.md5`
const listResponse = await fetch(listUrl)
if (!listResponse.ok) fail(`${listUrl} answered ${listResponse.status}`)
const codes = (await listResponse.text())
  .split('\n')
  .map((line) => line.split(',')[0].trim())
  .filter((code) => /^[a-z]{2,3}(?:_[a-z0-9]+)*$/.test(code))
if (!codes.includes('en') || codes.length < 100) fail(`${listUrl} lists ${codes.length} packs, which is not Moodle's list`)

const packs = {}
let next = 0
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (next < codes.length) {
      const code = codes[next++]
      packs[code] = await readPack(code)
    }
  })
)

/** The pack a pack takes the strings it lacks from; Moodle's own English below them all is the core's. */
function parentOf(code) {
  const parent = packs[code].config.parentlanguage
  return parent && parent !== 'en' && packs[parent] ? parent : undefined
}

/** A pack's H5P strings with its parent's beneath them, as Moodle resolves a string. */
function packStrings(code, seen = new Set()) {
  if (seen.has(code)) fail(`language ${code} is its own parent`)
  seen.add(code)
  const parent = parentOf(code)
  return { ...(parent ? packStrings(parent, seen) : {}), ...packs[code].strings }
}

// Moodle's English adds the abbreviation to a licence's name — "Attribution (CC BY)" where the
// core says "Attribution" — and its translators followed. The core puts the version after the
// name, so a closing bracket is taken off again where Moodle's English has one and the core's
// not: whatever is in it, since one pack names the wrong licence there, and in either width of
// bracket, since the Chinese and Japanese packs write their own.
const moodleEnglish = packStrings('en')
const suffixOf = {}
for (const [key, id] of Object.entries(idOf)) {
  const theirs = moodleEnglish[id]
  if (typeof theirs === 'string' && theirs.startsWith(`${english[key]} (`) && theirs.endsWith(')')) {
    suffixOf[key] = /\s*[(（][^()（）]*[)）]\s*$/
  }
}

/** The core's strings in a pack, and the keys that stay English there: missing, or refused. */
function coreTranslation(code) {
  const strings = packStrings(code)
  const H5P = {}
  const missing = []
  const refused = []
  for (const key of keys) {
    let value = idOf[key] ? strings[idOf[key]] : undefined
    if (value === undefined) {
      missing.push(key)
      continue
    }
    if (suffixOf[key]) value = value.replace(suffixOf[key], '')
    const problem = translationProblem(english[key], value)
    if (problem) {
      refused.push({ key, problem })
      continue
    }
    H5P[key] = value
  }
  return { H5P, missing, refused }
}

const primary = (tag) => tag.split('-')[0].toLowerCase()
const written = {}
const writtenAs = {}
const likeParent = []
for (const code of codes) {
  const tag = packTag(code, packs[code].config)
  // A variant, or English, which is the core's own.
  if (!tag || primary(tag) === 'en') continue
  const translation = coreTranslation(code)
  if (Object.keys(translation.H5P).length < keys.length * MIN_SHARE) continue
  const parent = parentOf(code)
  if (parent && JSON.stringify(translation.H5P) === JSON.stringify(coreTranslation(parent).H5P)) {
    likeParent.push({ tag, parent })
    continue
  }
  if (written[tag]) fail(`${code} and ${written[tag].code} would both be written as ${tag}`)
  const config = packs[code].config
  written[tag] = { code, name: config.thislanguageint || config.thislanguage || code, ...translation }
  writtenAs[code] = tag
}

const aliases = {}
for (const { tag, parent } of likeParent) {
  if (writtenAs[parent] && primary(writtenAs[parent]) !== primary(tag)) aliases[tag] = writtenAs[parent]
}
for (const [tag, target] of Object.entries(EQUIVALENT)) {
  if (written[target] && !aliases[tag]) aliases[tag] = target
}
const isWritten = new Set(Object.keys(written).map((tag) => tag.toLowerCase()))
const sortedAliases = Object.fromEntries(
  Object.keys(aliases)
    .filter((tag) => !isWritten.has(tag.toLowerCase()))
    .sort()
    .map((tag) => [tag, aliases[tag]])
)

const previous = JSON.parse((await readFile(INDEX_PATH, 'utf8').catch(() => null)) ?? 'null')
const lost = Object.keys(previous?.languages ?? {}).filter((tag) => !written[tag])
if (lost.length > 3 && !process.argv.includes('--allow-loss')) {
  fail(`this run would drop ${lost.length} languages at once (${lost.join(', ')}); find out why, then run it with --allow-loss`)
}

await mkdir(L10N_DIR, { recursive: true })
let changed = false
const writeIfChanged = async (path, text) => {
  if ((await readFile(path, 'utf8').catch(() => null)) === text) return
  await writeFile(path, text, 'utf8')
  changed = true
}

const tags = Object.keys(written).sort()
for (const tag of tags) {
  await writeIfChanged(resolve(L10N_DIR, `${tag}.json`), `${JSON.stringify({ H5P: written[tag].H5P }, null, 2)}\n`)
}
// A language that fell below the line, or that Moodle no longer lists, takes its old file with it.
for (const file of await readdir(L10N_DIR)) {
  if (file.endsWith('.json') && file !== 'index.json' && !written[file.slice(0, -'.json'.length)]) {
    await rm(resolve(L10N_DIR, file))
    changed = true
  }
}

const index = {
  source: `Moodle ${MOODLE_VERSION} language packs, ${packUrl('<language>')}`,
  retrieved: '',
  map: MAP_URL,
  licence: 'GPL-3.0-or-later, by Moodle and its translators',
  strings: keys.length,
  languages: Object.fromEntries(
    tags.map((tag) => {
      const { code, name, H5P, missing, refused } = written[tag]
      const left = [...missing, ...refused.map(({ key }) => key)]
      return [tag, { name, moodle: code, strings: Object.keys(H5P).length, ...(left.length ? { english: left } : {}) }]
    })
  ),
  aliases: sortedAliases
}
// The date moves only when what it dates does, so a week in which no translation changed leaves
// the tree clean and the weekly workflow opens nothing.
const unchanged = !changed && previous && JSON.stringify({ ...previous, retrieved: '' }) === JSON.stringify(index)
index.retrieved = unchanged ? previous.retrieved : new Date().toISOString().slice(0, 10)
await writeIfChanged(INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`)

for (const tag of tags) {
  const { name, H5P, refused } = written[tag]
  const why = refused.map(({ key, problem }) => `${key} (${problem})`).join(', ')
  console.log(`${tag.padEnd(12)} ${String(Object.keys(H5P).length).padStart(2)}/${keys.length}  ${name}${why ? `  refused: ${why}` : ''}`)
}
console.log(`aliases: ${Object.entries(sortedAliases).map(([tag, target]) => `${tag} -> ${target}`).join(', ')}`)
console.log(`[h5p-l10n] ${tags.length} languages from ${codes.length} packs -> l10n/${changed ? '' : ', unchanged'}`)
