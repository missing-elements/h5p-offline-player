/**
 * The element's language, as far as the player has anything to do with it: a tag, read off the
 * element's `lang` — its own, or the one it inherits from the page, as any element's language is
 * — and written by the worker as the frame document's. Which of the core's strings a tag gets is
 * the runtime's business; the player only knows English needs none of them.
 */

/**
 * A language tag, as far as the player reads one: a primary subtag of letters and any number of
 * further subtags of letters and digits. The runtime holds its tags to the same shape. The value
 * reaches the frame through IndexedDB, so the worker checks it again.
 */
export const LANGUAGE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/

/** A declared language as a tag, `de_DE`, a common way to write `de-DE`, as that; `undefined` for anything else. */
export function languageTag(declared: string | undefined): string | undefined {
  const tag = declared?.trim().replaceAll('_', '-')
  return tag && LANGUAGE_TAG.test(tag) ? tag : undefined
}

/** English, the core's own language, which needs none of the runtime's translations. */
export function isEnglish(tag: string): boolean {
  return tag.split('-')[0].toLowerCase() === 'en'
}
