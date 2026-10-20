/**
 * The languages the runtime has H5P's own strings in — the fullscreen button, Rights of use,
 * Reuse, Embed, the licence names, the "content has changed" dialog — for the language select on
 * the player page and in the app. Read from the runtime's own index, so a language its weekly
 * refresh adds appears here with no change. English is the core's own and not in the index. What
 * a select sets is the element's `lang`; which strings a tag gets is the runtime's to decide.
 */

import { aliases, languages } from '../../../packages/runtime/l10n/index.json'

/**
 * A tag's name in its own language, capitalised as a list of languages shows it; `null` where the
 * browser has none. A browser without a language's data names it in its own language instead —
 * Chromium, asked in German for Albanian's own name, answered "Albanisch" — so a name is taken
 * only from data for the language itself.
 */
function ownName(tag) {
  try {
    const names = new Intl.DisplayNames([tag], { type: 'language', fallback: 'none' })
    if (names.resolvedOptions().locale.split('-')[0] !== tag.split('-')[0]) return null
    const name = names.of(tag)
    return name ? name[0].toLocaleUpperCase(tag) + name.slice(1) : null
  } catch {
    return null
  }
}

/**
 * Each language as `{ tag, label }`, the label its own name and the English one ("Deutsch —
 * German"), in the order of their own names, which is where a speaker looks for theirs.
 */
export const LANGUAGES = [['en', 'English'], ...Object.entries(languages).map(([tag, { name }]) => [tag, name.replace(/^(.+) - (.+)$/, '$1 ($2)')])]
  .map(([tag, english]) => {
    const own = ownName(tag)
    const label = own && own.toLowerCase() !== english.toLowerCase() ? `${own} — ${english}` : english
    return { tag, label, order: own ?? english }
  })
  .sort((a, b) => a.order.localeCompare(b.order, 'en', { sensitivity: 'base' }))
  .map(({ tag, label }) => ({ tag, label }))

/** Whether the select offers `tag`, written as the runtime's index writes it. */
export const offered = (tag) => LANGUAGES.some((language) => language.tag === tag)

/** Fills `select` with the languages, `selected` chosen. */
export function fillLanguages(select, selected) {
  select.replaceChildren(...LANGUAGES.map(({ tag, label }) => new Option(label, tag, false, tag === selected)))
  select.value = selected
}

/**
 * The first of `preferred`, the browser's languages with the most wanted first, that the runtime
 * has: by its own aliases, and by dropping subtags from the end, as its lookup does; English when
 * it has none of them. Only what the select starts on: the runtime looks the tag up itself.
 */
export function preferredLanguage(preferred) {
  const tags = new Map(LANGUAGES.map(({ tag }) => [tag.toLowerCase(), tag]))
  const aliased = new Map(Object.entries(aliases).map(([alias, tag]) => [alias.toLowerCase(), tag]))
  for (const wanted of preferred) {
    const subtags = String(wanted).replaceAll('_', '-').toLowerCase().split('-')
    for (let length = subtags.length; length > 0; length--) {
      const tag = subtags.slice(0, length).join('-')
      const found = tags.get(tag) ?? aliased.get(tag)
      if (found) return found
    }
  }
  return 'en'
}
