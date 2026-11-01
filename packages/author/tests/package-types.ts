// The package as a caller sees it, by its own name: through the `types` condition, so this checks the
// published declarations, not the source. `pnpm typecheck` writes them first.
import { buildPackage, ContentGenerator, GENERATED_START, schemaOf, SourceError, type BuildResult, type Source } from '@missing-elements/h5p-author'
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
