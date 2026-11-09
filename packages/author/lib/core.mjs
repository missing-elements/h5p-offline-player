/**
 * @missing-elements/h5p-author/core: what the package does that needs neither Node nor a page, for
 * a tool that runs beside a build in either: the generator, the libraries loaded as a build loads
 * them from any source of them, the check of saved content, and the rules for text. The package's
 * entry for Node (`.`) and the one for a page (`./browser`) carry all of it, each with its own
 * `buildPackage` and `openPack`.
 */

export { checkContent } from './check.mjs'
export { ContentGenerator, librariesIn, libraryString } from './generator.mjs'
export { missingForInstall } from './install.mjs'
export { loadLibraries, packageLibraries } from './libraries.mjs'
export { GENERATED_END, GENERATED_START } from './schema.mjs'
export { SourceError } from './source-error.mjs'
export { allowedTags, editorWidget, markupText, plainText, takesMarkup } from './text.mjs'

/**
 * @typedef {import('./build.mjs').Source} Source
 * @typedef {import('./check.mjs').CheckedContent} CheckedContent
 * @typedef {import('./generator.mjs').GeneratorOptions} GeneratorOptions
 * @typedef {import('./generator.mjs').PackEntry} PackEntry
 * @typedef {import('./libraries.mjs').LibraryRecord} LibraryRecord
 * @typedef {import('./libraries.mjs').LibrarySource} LibrarySource
 * @typedef {import('./libraries.mjs').LoadedLibraries} LoadedLibraries
 * @typedef {import('./libraries.mjs').PackageFiles} PackageFiles
 * @typedef {import('./translate.mjs').TranslationReport} TranslationReport
 * @typedef {import('./pack.mjs').IndexEntry} IndexEntry
 * @typedef {import('./pack.mjs').PartLibrary} PartLibrary
 */
