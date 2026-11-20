/**
 * A source's own fields, declared once: the outer shape of what a build takes. `sourceOf` holds
 * each field to it and says its message where the field was written, it is the `Source` type, and
 * an app is shown it as the shape of a source before one is written (#230).
 *
 * In zod/mini, since a build runs in a page too, where zod's chained API weighs four times as
 * much. Its messages are the build's problems, each with what to write.
 */
import * as z from 'zod/mini'
import { CC_VERSIONS, LICENSES, ROLES } from './metadata.mjs'

/** @internal */
export const TYPE = 'expected a content type\'s machine name, such as "H5P.Blanks"'
const TITLE = 'expected the activity\'s title'
const LANGUAGE = 'expected a BCP 47 language tag, such as "en" or "de-AT"'
const NAME = 'expected the author\'s name'
const AUTHORS = 'name at least one author: [{ "name": "…", "role": "Author" }]'
const ADDRESS = 'expected the address the content comes from'
const YEAR = 'expected a year'
const BUILT_WITH = 'is written by a build, the content type and its version then, as "H5P.Blanks 1.14": leave it out'

/** @param {string} text */
const written = (text) => text.trim() !== ''

/** @param {string} tag */
const isTag = (tag) => {
  try {
    Intl.getCanonicalLocales(tag)
    return true
  } catch {
    return false
  }
}

/** An author, in a role H5P names. One written as a name alone, as a chat writes one, is said with the object to write. */
const author = z.strictObject({
  name: z.string({ error: NAME }).check(z.refine(written, { error: NAME })),
  role: z.enum(ROLES, { error: `use one of ${ROLES.join(', ')}` })
}, {
  error: (issue) => {
    if (issue.code === 'unrecognized_keys') return 'is not part of an author; write name and role'
    return typeof issue.input === 'string'
      ? `expected an author: write { "name": ${JSON.stringify(issue.input)}, "role": "Author" }`
      : 'expected an author, { "name": "…", "role": "Author" }'
  }
})

/** A source's fields, in the order they are listed, each with what it takes. */
const fields = {
  type: z.string({ error: TYPE }).check(z.refine(written, { error: TYPE }), z.describe('The content type\'s machine name, as "H5P.MultiChoice"')),
  title: z.string({ error: TITLE }).check(z.refine(written, { error: TITLE }), z.maxLength(255, { error: 'takes at most 255 characters' })),
  language: z.string({ error: LANGUAGE }).check(z.refine(isTag, { error: LANGUAGE }), z.describe('A BCP 47 tag, as "en"')),
  license: z.enum(LICENSES, { error: `use one of ${LICENSES.map((each) => JSON.stringify(each)).join(', ')}; "U" when it is not known` }),
  licenseVersion: z.optional(z.enum(CC_VERSIONS, { error: `use one of ${CC_VERSIONS.join(', ')}` }).check(z.describe('For a CC BY licence only'))),
  authors: z.array(author, { error: AUTHORS }).check(z.minLength(1, { error: AUTHORS })),
  source: z.optional(z.string({ error: ADDRESS }).check(z.regex(/^https?:\/\/\S+$/i, { error: ADDRESS }))),
  yearFrom: z.optional(z.int({ error: YEAR })),
  yearTo: z.optional(z.int({ error: YEAR })),
  params: z.optional(z.record(z.string(), z.unknown(), { error: 'expected an object of the content type\'s fields' })
    .check(z.describe('The content type\'s fields that differ from their defaults'))),
  builtWith: z.optional(z.string({ error: BUILT_WITH }).check(z.regex(/^\S+ \d+\.\d+$/, { error: BUILT_WITH }),
    z.describe('Written by a build, never by hand: the content type and its version when the source was last built')))
}

/** @internal What is said of a key that is no field of a source: those one writes, so not what a build writes in it. */
export const NO_FIELD = `is not a field of a source; the fields are ${Object.keys(fields).filter((name) => name !== 'builtWith').join(', ')}`
/** @internal What is said of a source that is no object. */
export const NO_SOURCE = 'expected an object: { "type", "title", "language", "license", "authors", "params" }'

/**
 * What a source says of itself, and its content's fields in `params`, and nothing else, as a build
 * refuses any other field. What a field cannot say alone stays in `sourceOf`: a content type named
 * loosely, a licence written with its version, a version for a licence that takes none, and fields
 * written in the wrong place.
 */
export const sourceSchema = z.strictObject(fields, {
  error: (issue) => (issue.code === 'unrecognized_keys' ? NO_FIELD : NO_SOURCE)
})

/**
 * Holds a value written for one of `sourceSchema`'s fields to it, and says each problem at the path
 * it was written at, one a path, as a build says one thing of a field.
 * @param {z.ZodMiniType} schema one of `sourceSchema.shape`
 * @param {unknown} value as written
 * @param {string} path where it was written
 * @param {(path: string, message: string) => void} report
 * @returns {boolean} whether it holds
 * @internal
 */
export function holds(schema, value, path, report) {
  const result = schema.safeParse(value)
  if (result.success) return true
  const said = new Set()
  for (const issue of result.error.issues) {
    // Keys that are no part of an object are one issue: a problem each, at its own path.
    const places = issue.code === 'unrecognized_keys' ? issue.keys.map((key) => [...issue.path, key]) : [issue.path]
    for (const place of places) {
      const at = path + place.map((key) => (typeof key === 'number' ? `[${key}]` : `.${String(key)}`)).join('')
      if (said.has(at)) continue
      said.add(at)
      report(at, issue.message)
    }
  }
  return false
}

/** @internal An author as `sourceSchema` takes one, for keeping those that are right. */
export const authorHolds = (/** @type {unknown} */ value) => author.safeParse(value).success
