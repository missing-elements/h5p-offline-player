// The package as a caller sees it, by its own name: through the `types` condition, so this checks the
// published declarations, not the source. `pnpm typecheck` writes them first.
import {
  allowedTags, buildPackage, ContentGenerator, GENERATED_START, loadLibraries, markupText, openPack, plainText, schemaOf, SourceError,
  type BuildResult, type LibrarySource, type Source
} from '@missing-elements/h5p-author'
// @ts-expect-error The source reader is internal: a helper the tests import from its module.
import { readSource } from '@missing-elements/h5p-author'

const source: Source = { type: 'H5P.TrueFalse', title: 'T', language: 'en', license: 'U', authors: [{ name: 'A', role: 'Author' }], params: {} }
export async function check(): Promise<[BuildResult, string, string]> {
  const built = await buildPackage(source, 'out.h5p', { libraries: 'parts', base: '.' })
  try {
    await buildPackage({}, 'bad.h5p')
  } catch (error) {
    if (error instanceof SourceError) error.problems.map(({ path, message }) => `${path}: ${message}`)
  }
  const generator = new ContentGenerator(new Map(), { lenient: true, id: (count) => String(count) })
  generator.problems.length = 0
  void readSource
  return [built, await schemaOf('H5P.Blanks', { markdown: true }), GENERATED_START]
}

/** A tool beside the build: the libraries as the build loads them, and its rules for text. */
export async function beside(): Promise<string> {
  const pack = await openPack('parts')
  try {
    const libraries: LibrarySource = pack
    const { entries, main } = await loadLibraries(libraries, { type: 'H5P.Blanks', language: 'de', params: {} })
    const content = new ContentGenerator(entries).generate(main, {})
    const part = await pack.open(pack.libraries[0])
    // @ts-expect-error A part's file stays inside the pack.
    void part.file
    // @ts-expect-error So does the pack's way to it, which only the build uses.
    void pack.archiveOf
    const field = (main.semantics ?? [])[0]
    const notes: string[] = []
    return [markupText('<p>Rivers</p>', field, (message) => notes.push(message)), plainText('Rivers', (message) => notes.push(message)), [...(allowedTags(field) ?? [])].join(' '), JSON.stringify(content)].join('\n')
  } finally {
    await pack.close()
  }
}
