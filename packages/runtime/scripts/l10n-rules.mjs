import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The rules `build-l10n.mjs` holds the translations to, kept apart so that `tests/l10n.test.ts`
 * holds the committed files to the same ones.
 */

/**
 * The core's interface strings in English, by key: the `l10n.H5P` defaults h5p-standalone puts
 * into `H5PIntegration`, which the frame lays a language's strings over. Read from the installed
 * bundle, so the keys are the ones the vendored core knows, and in its order.
 *
 * @returns {Record<string, string>}
 */
export function coreStrings() {
  const path = resolve(import.meta.dirname, '..', 'node_modules', 'h5p-standalone', 'dist', 'main.bundle.js')
  const bundle = readFileSync(path, 'utf8')
  const start = bundle.indexOf('l10n:{H5P:{')
  if (start < 0) throw new Error(`[h5p-runtime] ${path} no longer defines l10n.H5P where expected`)

  // The object literal, matched brace for brace; a brace inside a string does not count.
  let depth = 0
  let quote = ''
  let end = start + 'l10n:'.length
  for (; end < bundle.length; end++) {
    const char = bundle[end]
    if (quote) {
      if (char === '\\') end++
      else if (char === quote) quote = ''
    } else if (char === '"' || char === "'") quote = char
    else if (char === '{') depth++
    else if (char === '}' && --depth === 0) break
  }
  const literal = bundle.slice(start + 'l10n:'.length, end + 1)
  if (!/^\{H5P:\{[\s\S]*\}\}$/.test(literal)) throw new Error(`[h5p-runtime] could not read l10n.H5P from ${path}`)

  /** @type {{ H5P: Record<string, unknown> }} */
  const l10n = new Function(`return ${literal}`)()
  const strings = Object.fromEntries(Object.entries(l10n.H5P).filter(([, value]) => typeof value === 'string'))
  if (Object.keys(strings).length < 50) throw new Error(`[h5p-runtime] only ${Object.keys(strings).length} strings in l10n.H5P`)
  return /** @type {Record<string, string>} */ (strings)
}

/** The `:name` placeholders the core fills in, `:num` in "Retrying in :num....", in order. */
const placeholders = (/** @type {string} */ value) => (value.match(/:[A-Za-z]+/g) ?? []).sort().join(' ')

/**
 * Why a translation cannot stand in for the core's English string, or `null` when it can. The
 * core fills `:placeholders` in by name, so a translation that renamed or dropped one would show
 * it raw. Some strings are written into HTML and into attributes in double quotes, so markup and
 * a double quote are refused rather than escaped: none of the English strings has either.
 *
 * @param {string} english
 * @param {unknown} translated
 * @returns {string | null}
 */
export function translationProblem(english, translated) {
  if (typeof translated !== 'string' || !translated.trim()) return 'empty'
  if (/[<>"]/.test(translated)) return 'markup or a double quote'
  if (translated.includes('{$a')) return "a Moodle placeholder, {$a}"
  if (placeholders(translated) !== placeholders(english)) return `placeholders ${placeholders(translated) || 'none'}, not ${placeholders(english) || 'none'}`
  return null
}

/** Packs whose code does not say their language the way a tag does: Serbian's two scripts, and Valencian. */
const PACK_TAGS = /** @type {Record<string, string>} */ ({ sr_cr: 'sr-Cyrl', sr_lt: 'sr-Latn', ca_valencia: 'ca-valencia' })

/**
 * The language tag a Moodle language pack is written under, or `null` for a pack that is a
 * variant rather than a language — for the workplace, for children, for a university. A code of
 * letters alone is a language (`de`, `szl`). Any other `xx_yy` is the region `YY` only where the
 * pack's own `langconfig.php` places it there, by its locale (`pt_BR.UTF-8`) or its ISO code
 * (`es-mx`), because the code alone misleads: `fi_co` is Finnish for companies, not for
 * Colombia, and `no_gr` Norwegian for primary schools, not for Greece. The tag is then put in its
 * canonical form, the one a page declares: Moodle has `pan` and `hat` where pages say `pa` and `ht`.
 *
 * @param {string} code
 * @param {Record<string, string>} config the strings of the pack's `langconfig.php`
 * @returns {string | null}
 */
export function packTag(code, config) {
  const tag = codeTag(code, config)
  return tag && Intl.getCanonicalLocales(tag)[0]
}

/** `packTag` before the canonical form. @param {string} code @param {Record<string, string>} config */
function codeTag(code, config) {
  if (Object.hasOwn(PACK_TAGS, code)) return PACK_TAGS[code]
  if (/^[a-z]{2,3}$/.test(code)) return code
  const regional = /^([a-z]{2,3})_([a-z]{2})$/.exec(code)
  if (!regional) return null
  const [, language, region] = regional
  const locale = String(config.locale ?? '').toLowerCase().split(/[.@]/)[0]
  const iso = String(config.iso6391 ?? '').toLowerCase()
  return locale === `${language}_${region}` || iso === `${language}-${region}` ? `${language}-${region.toUpperCase()}` : null
}
