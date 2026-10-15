import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { coreStrings, packTag, translationProblem } from '../scripts/l10n-rules.mjs'
import { LANGUAGE_TAG, coreTranslations, matchLanguage } from '../src/l10n'

/**
 * The committed translations in `l10n/`, held to what `scripts/build-l10n.mjs` promises, so that a
 * hand edit, a weekly refresh or a core whose strings changed under them is caught here rather
 * than in a frame; and the boot script's choice of language for a tag.
 */

const dir = resolve(import.meta.dirname, '..', 'l10n')
const english = coreStrings()
const index = JSON.parse(readFileSync(resolve(dir, 'index.json'), 'utf8')) as {
  strings: number
  languages: Record<string, { name: string; moodle: string; strings: number; english?: string[] }>
  aliases: Record<string, string>
}
const tags = readdirSync(dir)
  .filter((file) => file.endsWith('.json') && file !== 'index.json')
  .map((file) => file.slice(0, -'.json'.length))

const read = (tag: string) => JSON.parse(readFileSync(resolve(dir, `${tag}.json`), 'utf8')) as { H5P: Record<string, unknown> }


describe('the core strings', () => {
  it('are read from the installed h5p-standalone, keys and English alike', () => {
    expect(Object.keys(english)).toHaveLength(index.strings)
    expect(english.fullscreen).toBe('Fullscreen')
    expect(english.offlineDialogRetryMessage).toBe('Retrying in :num....')
  })
})

describe('the translations', () => {
  it('are listed, every one of them and nothing else', () => {
    expect(Object.keys(index.languages).sort()).toEqual([...tags].sort())
  })

  it('are named by tags the player accepts, in the canonical form a page declares, and none of them English', () => {
    for (const tag of tags) {
      expect(tag).toMatch(LANGUAGE_TAG)
      expect(Intl.getCanonicalLocales(tag)[0]).toBe(tag)
      expect(tag.split('-')[0]).not.toBe('en')
    }
  })

  it.each(tags)('%s holds strings the core has, each fit to stand in for its English', (tag) => {
    const { H5P } = read(tag)
    for (const [key, value] of Object.entries(H5P)) {
      expect(english, `${tag}: ${key}`).toHaveProperty(key)
      expect(translationProblem(english[key], value), `${tag}: ${key}`).toBeNull()
    }
    const count = Object.keys(H5P).length
    expect(count).toBe(index.languages[tag].strings)
    expect(count).toBeGreaterThanOrEqual((Object.keys(english).length * 2) / 3)
    // What falls back to English is said, so the index tells a reader which strings those are.
    expect((index.languages[tag].english ?? []).length).toBe(Object.keys(english).length - count)
  })

  it('have aliases that lead to a language written here, and never stand in for one', () => {
    const written = new Set(tags.map((tag) => tag.toLowerCase()))
    for (const [tag, target] of Object.entries(index.aliases)) {
      expect(tag).toMatch(LANGUAGE_TAG)
      expect(written.has(tag.toLowerCase()), tag).toBe(false)
      expect(tags, `${tag} -> ${target}`).toContain(target)
    }
  })
})

describe('packTag', () => {
  it.each([
    ['de', {}, 'de'],
    ['szl', {}, 'szl'],
    ['sr_cr', {}, 'sr-Cyrl'],
    ['sr_lt', {}, 'sr-Latn'],
    ['ca_valencia', {}, 'ca-valencia'],
    ['pt_br', { locale: 'pt_BR.UTF-8' }, 'pt-BR'],
    ['es_mx', { locale: 'es_ES.UTF-8', iso6391: 'es-mx' }, 'es-MX'],
    ['de_ch', { locale: 'de_CH.UTF-8' }, 'de-CH'],
    ['pan', {}, 'pa'],
    ['hat', {}, 'ht']
  ])('writes the pack %s as %s', (code, config, tag) => {
    expect(packTag(code, config)).toBe(tag)
  })

  it.each([
    ['fi_co', { iso6391: 'fi' }, 'Finnish for companies, not for Colombia'],
    ['no_gr', { locale: 'nb_NO.UTF-8' }, 'Norwegian for primary schools, not for Greece'],
    ['ca_wp', { locale: 'ca_ES.UTF-8' }, 'for the workplace'],
    ['de_kids', { locale: 'de_DE.UTF-8' }, 'for children'],
    ['zh_cn_wp', {}, 'a variant of a regional pack'],
    ['pt_br_uni', {}, 'a variant of a regional pack']
  ])('leaves out %s: %s', (code, config, _why) => {
    expect(packTag(code, config)).toBeNull()
  })
})

describe('matchLanguage', () => {
  const available = ['de', 'es', 'es-MX', 'no', 'pt', 'pt-BR', 'sr-Cyrl', 'sr-Latn', 'zh-CN', 'zh-TW', 'he', 'id']
  const aliases = { nb: 'no', nn: 'no', iw: 'he', in: 'id', zh: 'zh-CN', 'zh-Hans': 'zh-CN', 'zh-SG': 'zh-CN', 'zh-Hant': 'zh-TW', 'zh-HK': 'zh-TW', sr: 'sr-Cyrl' }

  it.each([
    ['de', 'de'],
    ['DE', 'de'],
    ['de-AT', 'de'],
    ['de-CH-1996', 'de'],
    ['pt-BR', 'pt-BR'],
    ['pt-br', 'pt-BR'],
    ['pt-PT', 'pt'],
    ['es-MX', 'es-MX'],
    ['es-419', 'es'],
    ['zh', 'zh-CN'],
    ['zh-Hans-CN', 'zh-CN'],
    ['zh-SG', 'zh-CN'],
    ['zh-Hant', 'zh-TW'],
    ['zh-HK', 'zh-TW'],
    ['sr', 'sr-Cyrl'],
    ['sr-RS', 'sr-Cyrl'],
    ['sr-Latn-RS', 'sr-Latn'],
    ['no', 'no'],
    ['nb-NO', 'no'],
    ['nn', 'no'],
    ['iw', 'he'],
    ['in', 'id'],
    ['de-x-formal', 'de']
  ])('gives %s the strings of %s', (tag, expected) => {
    expect(matchLanguage(tag, available, aliases)).toBe(expected)
  })

  it.each([['en'], ['en-GB'], ['th'], [''], ['de_DE'], ['de-'], ['<script>'], ['x-klingon'], [undefined]])('gives %j nothing: English, or no tag', (tag) => {
    expect(matchLanguage(tag, available, aliases)).toBeUndefined()
  })

  it('takes a language of its own over an alias', () => {
    expect(matchLanguage('nn', [...available, 'nn'], aliases)).toBe('nn')
  })

  it('finds the committed languages under the tags learners send', () => {
    const languages = Object.keys(index.languages)
    expect(matchLanguage('de-AT', languages, index.aliases)).toBe('de')
    expect(matchLanguage('de-CH', languages, index.aliases)).toBe('de-CH')
    expect(matchLanguage('pt-BR', languages, index.aliases)).toBe('pt-BR')
    expect(matchLanguage('zh-Hant-TW', languages, index.aliases)).toBe('zh-TW')
    expect(matchLanguage('nb-NO', languages, index.aliases)).toBe('no')
    expect(matchLanguage('ca-ES-valencia', languages, index.aliases)).toBe('ca-valencia')
    expect(matchLanguage('en-US', languages, index.aliases)).toBeUndefined()
  })
})

describe('coreTranslations', () => {
  const table = { languages: { de: { fullscreen: 'Vollbild', close: 42 }, no: { fullscreen: 'Fullskjerm' } }, aliases: { nb: 'no' } }

  it('gives the frame its language’s strings, and only the strings', () => {
    expect(coreTranslations(table, 'de-AT')).toEqual({ H5P: { fullscreen: 'Vollbild' } })
    expect(coreTranslations(table, 'nb')).toEqual({ H5P: { fullscreen: 'Fullskjerm' } })
  })

  it.each([
    ['no table, as in an English frame', undefined, 'de'],
    ['a language the table lacks', table, 'th'],
    ['English', table, 'en'],
    ['a table of another shape', { de: { fullscreen: 'Vollbild' } }, 'de']
  ])('gives nothing for %s', (_case, given, tag) => {
    expect(coreTranslations(given, tag)).toBeUndefined()
  })
})

describe('translationProblem', () => {
  it('accepts a translation that keeps the placeholders', () => {
    expect(translationProblem('Retrying in :num....', 'Neuer Versuch in :num ...')).toBeNull()
  })

  it.each([
    ['a placeholder translated away', 'Retrying in :num....', 'Neuer Versuch in :anzahl ...', /placeholders/],
    ['a placeholder dropped', 'Retrying in :num....', 'Neuer Versuch ...', /placeholders/],
    ['markup', 'Close', '<b>Schließen</b>', /markup/],
    ['a double quote', 'Close', 'Schließen "jetzt"', /double quote/],
    ["Moodle's own placeholder", 'Close', 'Schließen {$a}', /Moodle placeholder/],
    ['nothing', 'Close', ' ', /empty/]
  ])('refuses %s', (_case, source, translated, problem) => {
    expect(translationProblem(source, translated)).toMatch(problem)
  })
})
