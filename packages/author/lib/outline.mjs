/**
 * A built content as plain text, for a review before a package is handed over: the words a
 * learner reads, in order, one line each, indented by where they sit, with a ✓ before an answer
 * the content marks correct. Generic over every content type: it reads no type's shape, only the
 * text in `content.json`, and leaves out what is not for reading (library names, ids, sizes,
 * colours, behaviour settings and interface texts).
 */

/** Keys whose values are machine data or settings, not words a learner reads. */
const SKIPPED = new Set([
  'library', 'subContentId', 'metadata', 'mime', 'path', 'copyright', 'behaviour', 'behavior', 'l10n', 'UI',
  'visuals', 'displayOptions', 'overallFeedback', 'x', 'y', 'width', 'height', 'duration', 'contentId', 'a11y',
  'extraAttributes', 'backgroundOpacity', 'fillColor', 'color', 'alt', 'correct'
])

/** Interface texts a library fills in: confirm dialogs and button labels. */
const INTERFACE = /^confirm|Label$/

/** Keys whose text is the thing itself, so a line needs no label. */
const UNLABELLED = new Set(['text', 'question', 'title', 'questions', 'statement', 'description'])

/** A value that is a colour or a measure, not words. */
const NOT_WORDS = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|[\d.]+(px|em|%)?)$/i

/** @param {string} html */
const plain = (html) => html
  .replace(/<\s*br\s*\/?>|<\/(p|div|li|h[1-6])>/gi, ' ')
  .replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim()

/**
 * @param {unknown} content a built package's `content.json`, as `buildPackage` returns it
 * @param {{ limit?: number }} [options] `limit`, the most lines written (default 400); the rest are counted
 * @returns {string}
 */
export function outlineOf(content, { limit = 400 } = {}) {
  /** @type {string[]} */
  const lines = []
  let more = 0
  /** @param {number} depth @param {string} text */
  const emit = (depth, text) => {
    if (lines.length >= limit) more += 1
    else lines.push(`${'  '.repeat(depth)}${text}`)
  }
  /** @param {unknown} value @param {number} depth @param {string} [label] */
  const walk = (value, depth, label) => {
    if (typeof value === 'string') {
      const text = plain(value)
      if (text && !NOT_WORDS.test(text)) emit(depth, label && !UNLABELLED.has(label) ? `${label}: ${text}` : text)
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1, label)
    } else if (value && typeof value === 'object') {
      const record = /** @type {Record<string, unknown>} */ (value)
      const mark = record.correct === true
      let first = true
      for (const [key, inner] of Object.entries(record)) {
        if (SKIPPED.has(key) || INTERFACE.test(key) || key === 'tipsAndFeedback') continue
        const before = lines.length + more
        if (typeof inner === 'string' && mark && first) {
          const text = plain(inner)
          if (text && !NOT_WORDS.test(text)) emit(depth, `✓ ${text}`)
        } else walk(inner, depth, key)
        if (lines.length + more > before) first = false
      }
    }
  }
  walk(content, 0)
  if (more) lines.push(`… ${more} more line${more === 1 ? '' : 's'}`)
  return lines.join('\n')
}
