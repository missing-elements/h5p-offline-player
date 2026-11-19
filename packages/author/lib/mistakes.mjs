import { decodeEntities, stripTags } from './text.mjs'
import { blanksGaps } from './types.mjs'

/**
 * What builds and is almost surely a mistake (#241, item 4 of #219): no answer marked correct, two
 * answers alike, a text with no gap, a picture with no alt text where its field is optional. H5P
 * allows each, so each is a note and not a problem, and nothing about the content is judged: whether
 * an answer is right stays the person's. Run by `checkContent` on content as H5P stores it, so a
 * build says them, and so does a check of saved content.
 */

/** @typedef {(path: string, message: string) => void} Note */

/** @param {unknown} value @returns {value is Record<string, any>} */
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * A text as a learner reads it, to compare one with another: no tags or entities, and in one case
 * and spacing.
 * @param {unknown} value
 */
function plain(value) {
  return typeof value === 'string' ? decodeEntities(stripTags(value)).replace(/\s+/g, ' ').trim().toLocaleLowerCase() : ''
}

/**
 * Each item of a list that reads as an earlier one does.
 * @param {unknown} items
 * @param {(item: any) => unknown} textOf the text of an item
 * @param {string} at the list's path
 * @param {string} what what an item is to a learner, as "answer"
 * @param {Note} note
 */
function alike(items, textOf, at, what, note) {
  if (!Array.isArray(items)) return
  /** @type {Map<string, number>} */
  const first = new Map()
  items.forEach((item, i) => {
    const text = plain(textOf(item))
    if (!text) return
    const earlier = first.get(text)
    if (earlier === undefined) first.set(text, i)
    else note(`${at}[${i}]`, `reads as ${at.slice(at.lastIndexOf('.') + 1)}[${earlier}] does, so a learner sees the same ${what} twice`)
  })
}

/**
 * Whether a list marks no item correct, where it has items.
 * @param {unknown} items
 */
const noneCorrect = (items) => Array.isArray(items) && items.length > 0 && !items.some((item) => isObject(item) && item.correct === true)

/** A text with no gap, `*word*`, in it, as Drag the Words and Mark the Words find one. @param {unknown} text */
const gapless = (text) => typeof text === 'string' && !/\*[^*]+\*/.test(text)

/**
 * Pictures whose alt text is an optional field beside them, by content type: the group that holds
 * both, as a path in the type's parameters (`[]` for each item of a list), the picture's field, and
 * its alt text's. H5P.Image's alt text is required, so a build refuses one without it already.
 * @type {Record<string, [string, string, string][]>}
 * @internal
 */
export const ALT_TEXTS = {
  'H5P.BranchingScenario': [['branchingScenario.startScreen', 'startScreenImage', 'startScreenAltText']],
  'H5P.Dialogcards': [['dialogs[]', 'image', 'imageAltText']],
  'H5P.Flashcards': [['cards[]', 'image', 'imageAltText']],
  'H5P.ImageHotspots': [['', 'image', 'backgroundImageAltText']],
  'H5P.ImagePair': [['cards[]', 'match', 'matchAlt']],
  'H5P.MemoryGame': [['cards[]', 'match', 'matchAlt']],
  'H5P.QuestionSet': [['introPage', 'backgroundImage', 'backgroundImageAltText']],
  'H5P.SpeakTheWordsSet': [['introduction', 'introductionImage', 'introductionImageAltText']]
}

/**
 * The groups at a path in parameters, `[]` taking each item of a list, with their paths.
 * @param {unknown} value
 * @param {string} path
 * @param {string} at the value's own path
 * @returns {{ group: Record<string, any>, at: string }[]}
 */
function groupsAt(value, path, at) {
  if (!isObject(value)) return []
  if (!path) return [{ group: value, at }]
  const [head, ...rest] = path.split('.')
  const name = head.replace(/\[\]$/, '')
  const next = value[name]
  if (head.endsWith('[]')) return Array.isArray(next) ? next.flatMap((item, i) => groupsAt(item, rest.join('.'), `${at}.${name}[${i}]`)) : []
  return groupsAt(next, rest.join('.'), `${at}.${name}`)
}

/**
 * The checks of each content type, on its parameters as H5P stores them.
 * @type {Record<string, (params: Record<string, any>, path: string, note: Note) => void>}
 */
const CHECKS = {
  'H5P.MultiChoice'(params, path, note) {
    if (noneCorrect(params.answers)) note(`${path}.answers`, 'marks no answer correct, so no learner can score: set "correct": true on the right one')
    alike(params.answers, (answer) => answer?.text, `${path}.answers`, 'answer', note)
  },
  'H5P.MultiMediaChoice'(params, path, note) {
    if (noneCorrect(params.options)) note(`${path}.options`, 'marks no option correct, so no learner can score: set "correct": true on the right one')
  },
  'H5P.SingleChoiceSet'(params, path, note) {
    if (!Array.isArray(params.choices)) return
    params.choices.forEach((choice, i) => alike(choice?.answers, (answer) => answer, `${path}.choices[${i}].answers`, 'answer', note))
  },
  'H5P.Summary'(params, path, note) {
    if (!Array.isArray(params.summaries)) return
    params.summaries.forEach((set, i) => alike(set?.summary, (statement) => statement, `${path}.summaries[${i}].summary`, 'statement', note))
  },
  'H5P.Blanks'(params, path, note) {
    const texts = Array.isArray(params.questions) ? params.questions.filter((text) => typeof text === 'string') : []
    if (texts.length && texts.every((text) => !blanksGaps(text).length)) note(`${path}.questions`, 'has no gap, so a learner has nothing to fill in: put each answer between asterisks, as *Paris*')
  },
  'H5P.DragText'(params, path, note) {
    if (gapless(params.textField)) note(`${path}.textField`, 'has no gap, so a learner has no word to drag: put each word between asterisks, as *Paris*')
  },
  'H5P.MarkTheWords'(params, path, note) {
    if (gapless(params.textField)) note(`${path}.textField`, 'marks no word, so a learner has none to find: put each word to find between asterisks, as *Paris*')
  }
}

/**
 * What a content type's parameters hold that builds and is almost surely a mistake, noted.
 * @param {string} library its machine name
 * @param {unknown} params as H5P stores them
 * @param {string} path theirs
 * @param {Note} note
 * @internal
 */
export function noteMistakes(library, params, path, note) {
  if (!isObject(params)) return
  CHECKS[library]?.(params, path, note)
  for (const [group, picture, alt] of ALT_TEXTS[library] ?? []) {
    for (const { group: values, at } of groupsAt(params, group, path)) {
      const file = values[picture]
      if (!isObject(file) || typeof file.path !== 'string' || !file.path.trim() || plain(values[alt])) continue
      note(`${at}.${alt}`, `is not written, so a screen reader has nothing to say of the picture in ${picture}: write what it shows`)
    }
  }
}
