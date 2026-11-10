/**
 * A library named another way than by its machine name. A source written with no skill beside it
 * names a content type as it is spoken of, "interactive-book", "Question Set", "dialogcards", and
 * the build said the pack has no such type, a round for each guess (#174). What can only mean one
 * library is taken to mean it, and the problem says the name to write: the same letters and digits
 * in any case, with or without `H5P.` before them and a version after. A library's title is not
 * tried: the pack's index has none, and reading them would open every part.
 */

/**
 * A name's letters and digits, lower case, without `H5P.` before them or a version after.
 * @param {string} text
 */
const letters = (text) => text.toLowerCase().replace(/\s+\d+(?:\.\d+)*\s*$/, '').replace(/^\s*h5p(?![a-z0-9])[\s._-]*/, '').replace(/[^a-z0-9]/g, '')

/**
 * The machine name that was written, of the names given: the name itself, with a version or
 * without, or the one name of the same letters. `exact` is false for one written loosely.
 * @param {unknown} written
 * @param {Iterable<string>} names machine names
 * @returns {{ machineName: string, exact: boolean } | null}
 */
export function machineNameOf(written, names) {
  if (typeof written !== 'string' || !written.trim()) return null
  const all = [...new Set(names)]
  const match = /^\s*(\S+?)(?:\s+\d+\.\d+(?:\.\d+)?)?\s*$/.exec(written)
  if (match && all.includes(match[1])) return { machineName: match[1], exact: true }
  const key = letters(written)
  if (!key) return null
  const same = all.filter((name) => letters(name) === key)
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
  const key = typeof written === 'string' ? letters(written) : ''
  if (key.length < 3) return []
  return [...new Set(names)].filter((name) => {
    const own = letters(name)
    return own.length >= 3 && (own.includes(key) || key.endsWith(own))
  }).slice(0, 5)
}

/**
 * The key under which an object names a library where `library` would, as `contentType` or `type`
 * does in a source written with no skill beside it: its one text that names a library of those
 * given. None where two keys do.
 * @param {Record<string, unknown>} given
 * @param {Iterable<string>} names machine names
 * @returns {{ key: string, machineName: string } | null}
 */
export function namingKey(given, names) {
  const all = [...new Set(names)]
  /** @type {{ key: string, machineName: string }[]} */
  const found = []
  for (const [key, value] of Object.entries(given)) {
    // A name is short: a sentence that happens to hold one is not it.
    if (typeof value !== 'string' || value.length > 64) continue
    const named = machineNameOf(value, all)
    if (named) found.push({ key, machineName: named.machineName })
  }
  return found.length === 1 ? found[0] : null
}
