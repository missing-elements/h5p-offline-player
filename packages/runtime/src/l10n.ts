/**
 * Which of this package's translations of the core's strings a frame gets. `dist/l10n.js` leaves
 * every language on `window.H5PRuntimeL10n`, with the aliases `scripts/build-l10n.mjs` derived;
 * the boot script picks one for the frame document's `lang`, which the player's worker writes
 * from the element's language. The player knows no list of languages: what is here, and which
 * tag gets which, is this package's alone, so a language added is a release of this package only.
 */

/**
 * A language tag, as the player's `shared/language.ts` accepts one — keep the two in step, and
 * `scripts/build.mjs`'s copy, which cannot import this file.
 */
export const LANGUAGE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/

/**
 * The language for a declared tag, by the lookup of RFC 4647: the tag as given, then with its
 * last subtag taken off, and so on — `de-AT` gets `de`, `pt-BR` its own — each tried as written
 * and through the aliases, case aside. `undefined` for a tag that is not one, and for a language
 * with no strings here, English among them, which is the core's own.
 */
export function matchLanguage(tag: string | undefined, languages: readonly string[], aliases: Record<string, string> = {}): string | undefined {
  if (!tag || !LANGUAGE_TAG.test(tag)) return undefined
  const byName = new Map(languages.map((each) => [each.toLowerCase(), each]))
  const alias = new Map(
    Object.entries(aliases)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([from, to]) => [from.toLowerCase(), to.toLowerCase()])
  )

  let subtags = tag.toLowerCase().split('-')
  while (subtags.length) {
    const candidate = subtags.join('-')
    const found = byName.get(candidate) ?? byName.get(alias.get(candidate) ?? '')
    if (found) return found
    subtags = subtags.slice(0, -1)
    // A single letter opens an extension or a private use part; it goes with what followed it.
    if (subtags.length && subtags[subtags.length - 1].length === 1) subtags = subtags.slice(0, -1)
  }
  return undefined
}

/**
 * h5p-standalone's `translations` for a frame whose language is `tag`, from the table
 * `dist/l10n.js` left: the matched language's strings, and nothing that is not a string. `undefined`
 * without a table — an English frame loads none — or without a language for the tag in it.
 */
export function coreTranslations(table: unknown, tag: string | undefined): { H5P: Record<string, string> } | undefined {
  if (!table || typeof table !== 'object') return undefined
  const { languages, aliases } = table as { languages?: unknown; aliases?: unknown }
  if (!languages || typeof languages !== 'object') return undefined
  const match = matchLanguage(tag, Object.keys(languages), aliases && typeof aliases === 'object' ? (aliases as Record<string, string>) : {})
  const strings = match === undefined ? undefined : (languages as Record<string, unknown>)[match]
  if (!strings || typeof strings !== 'object') return undefined

  const H5P: Record<string, string> = {}
  for (const [key, value] of Object.entries(strings)) {
    if (typeof value === 'string') H5P[key] = value
  }
  return { H5P }
}
