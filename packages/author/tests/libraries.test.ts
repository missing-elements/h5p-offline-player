import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadLibraries, openPack, SourceError, type LibrarySource } from '../lib/author.mjs'

type Field = { name: string, type: string, optional?: boolean, default?: unknown, fields?: Field[], field?: Field }

let pack: Awaited<ReturnType<typeof openPack>>
beforeAll(async () => { pack = await openPack() })
afterAll(async () => { await pack?.close() })

/** A field of a library's semantics by its path of names, `visuals.poster`. */
function fieldAt(semantics: Field[] | null, path: string): Field | undefined {
  let fields: Field[] | undefined = semantics ?? undefined
  let found: Field | undefined
  for (const name of path.split('.')) {
    found = fields?.find((field) => field.name === name)
    fields = found?.fields ?? found?.field?.fields
  }
  return found
}

/** The entry of the map for a machine name. */
const entryOf = (entries: Map<string, { library: { machineName: string }, semantics: unknown }>, machineName: string) =>
  [...entries.values()].find((entry) => entry.library.machineName === machineName)

describe('loadLibraries', () => {
  // Interactive Video with a question written by name alone, in a Column beside a video: what the
  // parameters name, what a library field gives as its default, and a layout's patch, all at once.
  const content = {
    type: 'H5P.Column',
    language: 'de',
    params: {
      content: [
        { content: { library: 'H5P.InteractiveVideo', params: { interactiveVideo: { assets: { interactions: [{ action: { library: 'H5P.MultiChoice', params: {} } }] } } } } },
        { content: { library: 'H5P.Video 1.6', params: {} } }
      ]
    }
  }

  it('loads the content type, what its parameters name and what a library field gives as its default', async () => {
    const { entries, main, translations } = await loadLibraries(pack, content)
    expect(main.library.machineName).toBe('H5P.Column')
    expect(main.semantics).not.toBeNull()
    // Named in the parameters, with a version and without one.
    for (const name of ['H5P.InteractiveVideo', 'H5P.MultiChoice', 'H5P.Video']) expect(entryOf(entries, name)?.semantics, name).not.toBeNull()
    // Interactive Video's summary task, which nobody wrote: its default names H5P.Summary.
    expect(entryOf(entries, 'H5P.Summary')?.semantics).not.toBeNull()
    // Every other library of the pack is there too, without its semantics.
    expect(entryOf(entries, 'H5P.GameMap')).toMatchObject({ semantics: null })
    expect(entries.size).toBe(pack.libraries.length)
    // Each runnable library's interface texts, from its own German translation.
    expect(translations.find((report) => report.library.startsWith('H5P.InteractiveVideo '))?.translation).toBe('de')
  })

  it('loads the only library a field takes, named or not, and reports its translation only where it is named (#172)', async () => {
    // A book's chapters written without their H5P.Column: its semantics are what reads them as its
    // parameters, and nothing is said of its translation, which the content does not use yet.
    const unnamed = await loadLibraries(pack, { type: 'H5P.InteractiveBook', language: 'de', params: { chapters: [{ content: [] }] } })
    expect(entryOf(unnamed.entries, 'H5P.Column')?.semantics).not.toBeNull()
    expect(unnamed.translations.map((report) => report.library.split(' ')[0])).toEqual(['H5P.InteractiveBook'])
    // Named, it is reported where it was before: after the content type, in the order named.
    const named = await loadLibraries(pack, { type: 'H5P.InteractiveBook', language: 'de', params: { chapters: [{ library: 'H5P.Column', params: { content: [{ content: { library: 'H5P.TrueFalse', params: {} } }] } }] } })
    expect(named.translations.map((report) => report.library.split(' ')[0])).toEqual(['H5P.InteractiveBook', 'H5P.Column', 'H5P.TrueFalse'])
    // A field that takes several is left alone: Column's own content loads nothing it does not name.
    expect(entryOf(named.entries, 'H5P.MultiChoice')).toMatchObject({ semantics: null })
    // An option written `{ name }`, as semantics may write one and the generator reads it, counts too.
    const book = pack.newest('H5P.InteractiveBook')!
    const source: LibrarySource = {
      libraries: pack.libraries,
      newest: (machineName, major) => pack.newest(machineName, major),
      open: async (entry) => {
        const part = await pack.open(pack.libraries.find(({ folder }) => folder === entry.folder)!)
        if (entry.folder !== book.folder) return part
        // A chapter is a group of one field, the page's library field.
        const semantics = (part.semantics as Field[]).map((field) => field.name !== 'chapters' ? field : {
          ...field,
          field: { ...field.field!, fields: field.field!.fields!.map((page) => ({ ...page, options: (page as Field & { options: string[] }).options.map((name) => ({ name })) })) }
        })
        return { ...part, semantics }
      },
      translation: (part, name) => pack.translation(part, name)
    }
    const objects = await loadLibraries(source, { type: 'H5P.InteractiveBook', language: 'en', params: {} })
    expect(entryOf(objects.entries, 'H5P.Column')?.semantics).not.toBeNull()
  })

  it('marks the fields a layout sets optional, and leaves the pack\'s own semantics as they are', async () => {
    const { entries } = await loadLibraries(pack, content)
    expect(fieldAt(entryOf(entries, 'H5P.Video')!.semantics as Field[], 'visuals.poster')?.optional).toBe(true)
    const part = await pack.open(pack.newest('H5P.Video')!)
    expect(fieldAt(part.semantics, 'visuals.poster')?.optional ?? false).toBe(false)
  })

  it('takes any source with the pack\'s members, such as one over a package\'s own folders', async () => {
    const opened: string[] = []
    const source: LibrarySource = {
      libraries: pack.libraries,
      newest: (machineName, major) => pack.newest(machineName, major),
      open: (entry) => {
        opened.push(entry.folder)
        return pack.open(pack.libraries.find(({ folder }) => folder === entry.folder)!)
      },
      translation: (part, name) => pack.translation(part, name)
    }
    const fromSource = await loadLibraries(source, content)
    const fromPack = await loadLibraries(pack, content)
    expect(fromSource.entries).toEqual(fromPack.entries)
    expect(opened).toContain(fromPack.main.folder)
  })

  it('refuses a content type the pack does not have, as a problem of the source', async () => {
    const error = await loadLibraries(pack, { type: 'H5P.Nothing', language: 'en' }).then(() => null, (error: unknown) => error)
    expect(error).toBeInstanceOf(SourceError)
    expect((error as SourceError).problems).toEqual([{ path: 'type', message: 'the library pack has no content type H5P.Nothing' }])
  })
})

describe('openPack', () => {
  it('opens a part to what a reader needs, keeping its file and zip.js\'s reader to itself', async () => {
    const part = await pack.open(pack.newest('H5P.Blanks')!)
    expect(Object.keys(part).sort()).toEqual(['folder', 'index', 'library', 'semantics', 'translations'])
    expect(part.translations).toContain('de')
    expect(await pack.translation(part, 'de')).toBeInstanceOf(Array)
    expect(await pack.translation(part, 'xx')).toBeUndefined()
  })
})
