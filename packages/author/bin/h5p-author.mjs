#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { buildPackage, schemaOf, SourceError } from '../lib/author.mjs'
import { packVersion } from '../lib/pack.mjs'

const USAGE = `Usage:
  h5p-author build <source.json> <output.h5p> [--libraries <parts folder>]
  h5p-author schema <machine name> [--markdown] [--all] [--libraries <parts folder>]

build   Makes a playable .h5p from a source: { "type", "title", "language", "license",
        "authors", "params" }, or a quiz in the h5p-author skill's quiz format. Writes only
        when the whole source is right, and never over an existing file.
schema  Prints a content type's fields as a source writes them: --markdown as a skill's
        type file carries them, --all with the interface texts.

The libraries come from the pack this release pins (@missing-elements/h5p-libraries);
--libraries names another copy's parts/ folder. Check every package with
npx @missing-elements/h5p-verify@latest before handing it over.`

/** @param {string[]} argv */
function parse(argv) {
  /** @type {string[]} */
  const positional = []
  /** @type {Record<string, string | true>} */
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--libraries') {
      const value = argv[++i]
      if (!value || value.startsWith('--')) throw new Error('--libraries needs a folder')
      flags.libraries = value
    } else if (arg.startsWith('--')) flags[arg.slice(2)] = true
    else positional.push(arg)
  }
  return { positional, flags }
}

try {
  const { positional, flags } = parse(process.argv.slice(2))
  const [command, ...rest] = positional
  if (flags.version) {
    const own = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version
    console.log(`@missing-elements/h5p-author ${own}, library pack ${await packVersion()}`)
  } else if (flags.help || !command) {
    console.log(USAGE)
    if (!command && !flags.help) process.exitCode = 1
  } else if (command === 'schema') {
    if (rest.length !== 1) throw new Error('schema takes one content type, such as H5P.Blanks')
    for (const flag of Object.keys(flags)) if (!['markdown', 'all', 'libraries'].includes(flag)) throw new Error(`schema does not take --${flag}`)
    console.log(await schemaOf(rest[0], { markdown: Boolean(flags.markdown), all: Boolean(flags.all), libraries: /** @type {string | undefined} */ (flags.libraries) }))
  } else if (command === 'build') {
    if (rest.length !== 2) throw new Error('build takes a source and an output: h5p-author build quiz.json quiz.h5p')
    for (const flag of Object.keys(flags)) if (flag !== 'libraries') throw new Error(`build does not take --${flag}`)
    const sourcePath = resolve(rest[0])
    let source
    try {
      source = JSON.parse(await readFile(sourcePath, 'utf8'))
    } catch (error) {
      throw new Error(`${rest[0]} is not a readable JSON file: ${error instanceof Error ? error.message : error}`)
    }
    const result = await buildPackage(source, rest[1], { base: dirname(sourcePath), libraries: /** @type {string | undefined} */ (flags.libraries) })
    const from = flags.libraries ? `the pack in ${flags.libraries}` : `the library pack ${await packVersion()}`
    console.log(`Built ${result.output}: ${result.manifest.mainLibrary}, ${result.libraries.length} libraries from ${from}${result.media.length ? `, ${result.media.length} media file${result.media.length === 1 ? '' : 's'}` : ''}.`)
    const language = String(result.manifest.language)
    if (!/^en(?:-|$)/i.test(language)) {
      for (const { library, translation, strings, english } of result.translations) {
        if (!translation) console.warn(`${library} has no translation for ${language}: its ${strings} interface texts are English.`)
        else if (!english.length) console.log(`${library}: interface texts from its translation language/${translation}.json.`)
        else {
          const list = english.map(({ field, text, dropped }) => `  ${field}: ${JSON.stringify(text)}${dropped ? ` (its translation drops ${dropped.join(' and ')})` : ''}`)
          console.warn(`${library}: interface texts from its translation language/${translation}.json; ${english.length} of ${strings} as in English, untranslated or the same word:\n${list.join('\n')}`)
        }
      }
    }
    for (const { path, message } of result.notes) console.warn(`Note: ${path} ${message}`)
    console.log('Not verified: run npx @missing-elements/h5p-verify@latest on it and look at its screenshot before handing it over.')
  } else {
    throw new Error(`unknown command "${command}"\n\n${USAGE}`)
  }
} catch (error) {
  if (error instanceof SourceError) {
    console.error(`h5p-author: ${error.message}`)
  } else {
    console.error(`h5p-author: ${error instanceof Error ? error.message : error}`)
    if (error instanceof Error && error.cause instanceof Error) console.error(error.cause.message)
  }
  process.exitCode = 1
}
