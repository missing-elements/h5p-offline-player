/**
 * @missing-elements/h5p-author: a playable .h5p of any content type in the H5P hub's library pack,
 * from a short JSON source. The source writes only what the defaults cannot know; everything else
 * comes from the libraries' own semantics and translations, and the libraries from the pack this
 * package pins, checked against its index.
 */

import { openPack } from './pack.mjs'
import { schemaLines, schemaMarkdown } from './schema.mjs'
import { LAYOUTS } from './types.mjs'

export { buildPackage, SourceError } from './build.mjs'
export { ContentGenerator, librariesIn, libraryString } from './generator.mjs'
export { GENERATED_END, GENERATED_START } from './schema.mjs'

/**
 * @typedef {import('./build.mjs').Source} Source
 * @typedef {import('./build.mjs').BuildResult} BuildResult
 * @typedef {import('./build.mjs').BuildOptions} BuildOptions
 * @typedef {import('./generator.mjs').GeneratorOptions} GeneratorOptions
 */

/**
 * A content type's fields as a source writes them, from the pack: one line each.
 * @param {string} machineName such as `H5P.Blanks`
 * @param {{ libraries?: string, markdown?: boolean, all?: boolean }} [options]
 *   `libraries`, a parts folder in place of the pinned pack; `markdown`, the section a type file
 *   carries, between its markers; `all`, the interface texts too
 * @returns {Promise<string>}
 */
export async function schemaOf(machineName, options = {}) {
  const pack = await openPack(options.libraries)
  try {
    const entry = pack.newest(machineName)
    if (!entry) {
      const runnable = []
      for (const each of pack.libraries) {
        const part = await pack.open(each)
        if (part.library.runnable) runnable.push(`${each.machineName} (${part.library.title})`)
      }
      throw new Error(`The library pack has no ${machineName}. Its content types: ${[...new Set(runnable)].sort().join(', ')}`)
    }
    const part = await pack.open(entry)
    if (!part.semantics) throw new Error(`${machineName} has no semantics: it is not a content type an author fills in`)
    /** @type {(name: string) => boolean} */
    const has = (name) => Boolean(pack.newest(name))
    const sets = LAYOUTS[machineName]?.sets ?? []
    if (options.markdown) return schemaMarkdown(part.library, part.semantics, { has, sets })
    const { lines, interfaceTexts } = schemaLines(part.semantics, { all: options.all, has, sets })
    const header = `${part.library.machineName} ${part.library.majorVersion}.${part.library.minorVersion}: ${part.library.title}`
    const footer = !options.all && interfaceTexts ? [`(${interfaceTexts} interface texts left out; --all lists them)`] : []
    return [header, ...lines, ...footer].join('\n')
  } finally {
    await pack.close()
  }
}
