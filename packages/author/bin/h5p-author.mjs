#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { buildPackage, schemaOf, SourceError, writeBundle, writeBundles } from '../lib/author.mjs'
import { packVersion } from '../lib/node.mjs'

const USAGE = `Usage:
  h5p-author build <source.json> <output.h5p> [--libraries <parts folder>]
  h5p-author schema <machine name> [--markdown] [--all] [--libraries <parts folder>]
  h5p-author bundle <machine name> <output.zip> [--libraries <parts folder>]
  h5p-author bundle --all <folder> [--libraries <parts folder>]

build   Makes a playable .h5p from a source: { "type", "title", "language", "license",
        "authors", "params" }, or a quiz in the h5p-author skill's quiz format. Writes only
        when the whole source is right, and never over an existing file.
schema  Prints a content type's fields as a source writes them: --markdown as a skill's
        type file carries them, --all with the interface texts.
bundle  Writes the libraries a build of one content type reads, as a zip of a parts/
        folder for build --libraries parts, where the pack cannot be installed; --all,
        one per content type, named by it.

-h, --help      show this
-v, --version   print this package's version and the pack's

The libraries come from the pack this release pins (@missing-elements/h5p-libraries);
--libraries names another copy's parts/ folder. Check every package with
npx @missing-elements/h5p-verify@latest before handing it over.`

/** A size in kilobytes below a megabyte, in megabytes above. @param {number} bytes */
const sized = (bytes) => (bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} kB` : `${(bytes / 1_000_000).toFixed(1)} MB`)

/**
 * The command line as the verifier's and embed's read theirs: `--libraries dir` or
 * `--libraries=dir`, and `-h`, `-v`. Which flags a command takes is checked after.
 * @param {string[]} argv
 */
function parse(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      libraries: { type: 'string' },
      markdown: { type: 'boolean' },
      all: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' }
    }
  })
  /** @type {Record<string, string | true>} */
  const flags = {}
  for (const [name, value] of Object.entries(values)) if (value !== undefined && value !== false) flags[name] = value
  return { positional: positionals, flags }
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
    const install = result.install.length ? `, ${result.install.length} more for installing on an H5P site` : ''
    console.log(`Built ${result.output}: ${result.manifest.mainLibrary}, ${result.libraries.length} libraries from ${from}${install}${result.media.length ? `, ${result.media.length} media file${result.media.length === 1 ? '' : 's'}` : ''}.`)
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
  } else if (command === 'bundle') {
    for (const flag of Object.keys(flags)) if (flag !== 'all' && flag !== 'libraries') throw new Error(`bundle does not take --${flag}`)
    const libraries = /** @type {string | undefined} */ (flags.libraries)
    const from = libraries ? `the pack in ${libraries}` : `the library pack ${await packVersion()}`
    if (flags.all) {
      if (rest.length !== 1) throw new Error('bundle --all takes the folder to write them in: h5p-author bundle --all bundles')
      const results = await writeBundles(rest[0], { libraries })
      for (const { type, parts, size } of results) console.log(`${type}: ${parts.length} parts, ${sized(size)}`)
      const total = results.reduce((sum, { size }) => sum + size, 0)
      console.log(`Bundled ${results.length} content types in ${resolve(rest[0])} from ${from}, ${sized(total)} in all.`)
    } else {
      if (rest.length !== 2) throw new Error('bundle takes a content type and an output: h5p-author bundle H5P.QuestionSet H5P.QuestionSet.zip')
      const { output, type, parts, size } = await writeBundle(rest[0], rest[1], { libraries })
      console.log(`Bundled ${type} in ${output}: ${parts.length} parts from ${from}, ${sized(size)}. Unzip it beside a source and build with --libraries parts.`)
    }
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
