/**
 * A library named another way than by its machine name. A source written with no skill beside it
 * names a content type as it is spoken of, "interactive-book", "Question Set", "dialogcards", and
 * the build said the pack has no such type, a round for each guess (#174). What can only mean one
 * library is taken to mean it, and the problem says the name to write: the same letters and digits
 * in any case, with or without `H5P.` before them and a version after. A library's title is not
 * tried: the pack's index has none, and reading them would open every part.
 */

/**
 * The keys a library is named under in place of `library`, or of a source's `type`: `type` and
 * `contentType` for sub-content, as a chat with no skill beside it writes them, and `contentType`
 * and `library` for a source's own. No other: in the sources the tests stored, every name found
 * under another key was a text that reads like one, a card's answer "table", a title "Text".
 */
export const NAMING_KEYS = ['type', 'contentType', 'library']

/** The longest text taken for a name: a sentence that happens to hold one is not it. */
const LONGEST = 64

/**
 * A name as written, and the version after it: `major.minor`, or `major.minor.patch` as a
 * library's own version is written. Found without a regular expression that can backtrack, since
 * what is written is any text.
 * @param {string} text
 * @returns {{ name: string, version?: number[] }}
 */
function split(text) {
  const trimmed = text.trim()
  let at = trimmed.length
  while (at > 0 && !/\s/.test(trimmed[at - 1])) at--
  const version = /^\d+\.\d+(?:\.\d+)?$/.test(trimmed.slice(at)) && at > 0 ? trimmed.slice(at).split('.').map(Number) : undefined
  return version ? { name: trimmed.slice(0, at).trim(), version } : { name: trimmed }
}

/**
 * A name's letters and digits, lower case, without `H5P.` before them or a version after. A
 * number with no point after it is no version: "Question Set 2" is not Question Set.
 * @param {string} text
 */
const letters = (text) => split(text).name.toLowerCase().replace(/^h5p(?![a-z0-9])[\s._-]*/, '').replace(/[^a-z0-9]/g, '')

/**
 * The machine name that was written, of the names given: the name itself, alone or with a major
 * and minor after it, as sub-content names its library, or the one name of the same letters.
 * `exact` is false for one written loosely, which a version of three parts is too, since what
 * reads a library's name takes two. `major` and `minor` are those written with an exact name.
 * @param {unknown} written
 * @param {Iterable<string>} names machine names
 * @returns {{ machineName: string, exact: boolean, major?: number, minor?: number } | null}
 */
export function machineNameOf(written, names) {
  if (typeof written !== 'string' || written.length > LONGEST || !written.trim()) return null
  const all = [...new Set(names)]
  const { name, version } = split(written)
  if (all.includes(name) && (!version || version.length === 2)) return { machineName: name, exact: true, ...(version ? { major: version[0], minor: version[1] } : {}) }
  const key = letters(written)
  if (!key) return null
  const same = all.filter((each) => letters(each) === key)
  return same.length === 1 ? { machineName: same[0], exact: false } : null
}

/**
 * The names nearest to what was written, for a problem to offer: those its letters are part of,
 * "book", and those its letters end with, "fill-in-the-blanks". Not one they begin with: the
 * "image" of "image choice" is no lead to it. At most five.
 * @param {unknown} written
 * @param {Iterable<string>} names machine names
 * @returns {string[]}
 */
export function nearestNames(written, names) {
  const key = typeof written === 'string' && written.length <= LONGEST ? letters(written) : ''
  if (key.length < 3) return []
  return [...new Set(names)].filter((name) => {
    const own = letters(name)
    return own.length >= 3 && (own.includes(key) || key.endsWith(own))
  }).slice(0, 5)
}

/**
 * The key under which an object names a library where `library` would: of `NAMING_KEYS`, the one
 * whose text names a library of those given. None where two do. `library` is the text to write,
 * with the major and minor that were written.
 * @param {Record<string, unknown>} given
 * @param {Iterable<string>} names machine names
 * @returns {{ key: string, machineName: string, major?: number, library: string } | null}
 */
export function namingKey(given, names) {
  const all = [...new Set(names)]
  /** @type {{ key: string, machineName: string, major?: number, library: string }[]} */
  const found = []
  for (const key of NAMING_KEYS) {
    const named = Object.hasOwn(given, key) ? machineNameOf(given[key], all) : null
    if (!named) continue
    const { machineName, major, minor } = named
    found.push({ key, machineName, ...(major === undefined ? {} : { major }), library: major === undefined ? machineName : `${machineName} ${major}.${minor}` })
  }
  return found.length === 1 ? found[0] : null
}
