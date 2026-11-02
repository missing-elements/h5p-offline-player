import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BlobReader, TextWriter, ZipReader, type FileEntry } from '@zip.js/zip.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildPackage, checkContent, loadLibraries, openPack, packageLibraries, type LibrarySource, type PackageFiles } from '../lib/author.mjs'
import { png } from './helpers/media'

// The demo's packages: five carry their libraries, `formulas.h5p` is an export without them.
const demo = resolve(import.meta.dirname, '../../../apps/demo/demo/content')
const META = { title: 'Saved', language: 'en', license: 'CC BY', authors: [{ name: 'Ann Author', role: 'Author' }] }
let pack: Awaited<ReturnType<typeof openPack>>
let dir: string
let count = 0
beforeAll(async () => {
  pack = await openPack()
  dir = await mkdtemp(join(tmpdir(), 'h5p-author-check-'))
})
afterAll(async () => {
  await pack?.close()
  if (dir) await rm(dir, { recursive: true, force: true })
})

/** A package's files as an editing tool reads them, through zip.js. */
async function openPackage(path: string) {
  const reader = new ZipReader(new BlobReader(new Blob([await readFile(path)])))
  const entries = new Map((await reader.getEntries()).filter((entry) => !entry.directory).map((entry) => [entry.filename, entry as FileEntry]))
  const files: PackageFiles = { names: entries.keys(), read: (name) => entries.get(name)!.getData(new TextWriter()) }
  return { files, close: () => reader.close() }
}

/**
 * A saved package's content checked as a tool that edits it checks what it writes: the content type
 * and language its `h5p.json` names, against its own libraries and the pack's for what it does not
 * carry.
 */
async function checkPackage(path: string, edit = (params: any) => params) {
  const { files, close } = await openPackage(path)
  try {
    const manifest = JSON.parse(await files.read('h5p.json'))
    const params = edit(JSON.parse(await files.read('content/content.json')))
    const main = manifest.preloadedDependencies.find((dependency: { machineName: string }) => dependency.machineName === manifest.mainLibrary)
    const content = { type: `${main.machineName} ${main.majorVersion}.${main.minorVersion}`, language: manifest.language, params }
    const libraries = await loadLibraries(await packageLibraries(files, pack), content)
    return { saved: params, libraries, ...checkContent(libraries, content) }
  } finally {
    await close()
  }
}

async function built(type: string, params: unknown) {
  await writeFile(join(dir, 'river.png'), png(480, 270))
  const output = join(dir, `saved-${++count}.h5p`)
  await buildPackage({ ...META, type, params }, output, { base: dir })
  return output
}

describe('checkContent', () => {
  it('takes what a build wrote as it is: nothing reported, nothing changed', async () => {
    const output = await built('H5P.Column', {
      content: [
        { content: { library: 'H5P.Image', params: { file: { path: 'river.png', copyright: { license: 'CC BY', author: 'Ann' } }, alt: 'A river' }, metadata: { title: 'River' } } },
        { content: { library: 'H5P.SingleChoiceSet', params: { choices: [{ question: 'Which flows?', answers: ['A river', 'A rock'] }] } } },
        { content: { library: 'H5P.Blanks', params: { questions: ['Rivers flow *down*hill.'] } } }
      ]
    })
    const { saved, params, problems, notes } = await checkPackage(output)
    expect([problems, notes]).toEqual([[], []])
    expect(params).toEqual(saved)
    // The editor gives a group that is sub-content an id of its own, as a library's.
    expect(saved.content[1].content.params.choices[0].subContentId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('reports what an edit broke by path, and keeps each part\'s id', async () => {
    const output = await built('H5P.Column', { content: [{ content: { library: 'H5P.MultiChoice', params: { question: 'Which flows?', answers: [{ text: 'A river', correct: true }, { text: 'A rock' }] } } }] })
    const { saved, params, problems } = await checkPackage(output, (params) => {
      const question = params.content[0].content
      question.params.answers = [{ text: '<p>A river</p>', correct: 'yes' }]
      question.params.behaviour.typo = true
      params.content.push({ content: { library: 'H5P.AdvancedText', params: { text: '<script>alert(1)</script>' } } })
      return params
    })
    expect(problems.map(({ path }) => path)).toEqual([
      'params.content[0].content.params.answers[0].correct',
      'params.content[0].content.params.behaviour.typo',
      'params.content[1].content.params.text'
    ])
    expect(problems[0].message).toBe('expected true or false')
    expect(problems[2].message).toMatch(/^has <script>, which this field does not take/)
    expect(params.content[0].content.subContentId).toBe(saved.content[0].content.subContentId)
    // New sub-content an edit adds gets an id, and its content type's title.
    expect(params.content[1].content.subContentId).toMatch(/^[0-9a-f-]{36}$/)
    expect(params.content[1].content.metadata.title).toBe('Text')
  })

  it('notes, rather than refuses, a field only the older minor the content names has', async () => {
    // A Question Set saved with 1.20, checked against the pack's 1.21, whose upgrade step moves the
    // background into `override`.
    const libraries = await loadLibraries(pack, { type: 'H5P.QuestionSet 1.20', language: 'en', params: {} })
    const params = { questions: [], backgroundImage: { path: 'images/sky.png', mime: 'image/png' } }
    const older = checkContent(libraries, { type: 'H5P.QuestionSet 1.20', params })
    expect(older.problems.filter(({ path }) => path === 'params.backgroundImage')).toEqual([])
    expect(older.notes).toContainEqual({ path: 'params.backgroundImage', message: 'is not a field of H5P.QuestionSet 1.21; the content names 1.20, which the player upgrades to 1.21 as it plays, and that may move it' })
    expect(older.params.backgroundImage).toEqual(params.backgroundImage)
    const current = checkContent(libraries, { type: 'H5P.QuestionSet 1.21', params })
    expect(current.problems).toContainEqual(expect.objectContaining({ path: 'params.backgroundImage' }))
  })

  it('refuses content checked against another content type\'s libraries', async () => {
    const libraries = await loadLibraries(pack, { type: 'H5P.Blanks', language: 'en', params: {} })
    expect(checkContent(libraries, { type: 'H5P.DragText 1.10', params: {} }).problems).toEqual([
      { path: 'type', message: `is H5P.DragText 1.10, and the libraries were loaded for ${libraries.main.library.machineName} ${libraries.main.library.majorVersion}.${libraries.main.library.minorVersion}` }
    ])
  })

  it('checks a Game Map\'s stages as the map stores them, and joins them both ways', async () => {
    const output = await built('H5P.GameMap', {
      gamemapSteps: {
        backgroundImageSettings: { backgroundImage: { path: 'river.png' } },
        gamemap: {
          elements: [
            { label: 'Harbour', canBeStartStage: true, neighbors: ['Market'], contentsList: [{ contentType: { library: 'H5P.TrueFalse', params: { question: 'Rivers flow downhill.' } } }] },
            { label: 'Market', contentsList: [{ contentType: { library: 'H5P.TrueFalse', params: { question: 'Seas are salty.' } } }] },
            { label: 'Bridge', contentsList: [{ contentType: { library: 'H5P.TrueFalse', params: { question: 'Lakes are still.' } } }] }
          ]
        }
      }
    })
    const untouched = await checkPackage(output)
    expect([untouched.problems, untouched.notes]).toEqual([[], [{ path: 'params.gamemapSteps.gamemap.elements[2]', message: 'is joined to no other stage' }]])
    // An edit that joins the bridge one way, moves the harbour off the map and names a stage there is not.
    const edited = await checkPackage(output, (params) => {
      const [harbour, , bridge] = params.gamemapSteps.gamemap.elements
      bridge.neighbors = ['0', '7']
      harbour.telemetry.x = '150'
      return params
    })
    const elements = edited.params.gamemapSteps.gamemap.elements
    expect(elements[0].neighbors).toEqual(['1', '2'])
    expect(edited.problems.map(({ path }) => path)).toEqual(['params.gamemapSteps.gamemap.elements[0].telemetry.x', 'params.gamemapSteps.gamemap.elements[2].neighbors[1]'])
  })
})

describe('packageLibraries', () => {
  /** A package of the files given, by name. */
  const files = (contents: Record<string, unknown>): PackageFiles => ({
    names: Object.keys(contents),
    read: async (name) => JSON.stringify(contents[name])
  })

  it('serves a package\'s own libraries where it carries a major, the pack\'s for the rest', async () => {
    const trueFalse = { machineName: 'H5P.TrueFalse', majorVersion: 1, minorVersion: 7, patchVersion: 3, title: 'True/False Question', runnable: 1 }
    const source: LibrarySource = await packageLibraries(files({
      'h5p.json': {},
      'H5P.TrueFalse-1.7/library.json': trueFalse,
      'H5P.TrueFalse-1.7/semantics.json': [{ name: 'question', type: 'text', widget: 'html' }],
      'H5P.TrueFalse-1.7/language/de.json': { semantics: [{ label: 'Frage' }] },
      // A folder whose library.json names another library is not one of its own, as the player has it.
      'H5P.Blanks-1.14/library.json': trueFalse
    }), pack)
    expect(source.newest('H5P.TrueFalse', 1)).toMatchObject({ folder: 'H5P.TrueFalse-1.7', minorVersion: 7 })
    expect(source.libraries.filter(({ machineName }) => machineName === 'H5P.TrueFalse')).toHaveLength(1)
    const own = await source.open(source.newest('H5P.TrueFalse', 1)!)
    expect(own).toEqual({ folder: 'H5P.TrueFalse-1.7', library: trueFalse, semantics: [{ name: 'question', type: 'text', widget: 'html' }], translations: ['de'] })
    expect(await source.translation(own, 'de')).toEqual([{ label: 'Frage' }])
    const blanks = source.newest('H5P.Blanks', 1)!
    expect(blanks.folder).toBe(pack.newest('H5P.Blanks', 1)!.folder)
    expect((await source.open(blanks)).semantics).not.toBeNull()
  })

  it.each(['quiz', 'video', 'how-it-works', 'glossary'])('checks the demo\'s %s.h5p against its own libraries: nothing reported', async (name) => {
    const { libraries, problems, notes } = await checkPackage(join(demo, `${name}.h5p`))
    const { files, close } = await openPackage(join(demo, `${name}.h5p`))
    try {
      expect([...files.names]).toContain(`${libraries.main.folder}/library.json`)
    } finally {
      await close()
    }
    expect([problems, notes]).toEqual([[], []])
  })

  it('checks the demo\'s export without its libraries against the pack: nothing reported', async () => {
    const { libraries, problems, notes } = await checkPackage(join(demo, 'formulas.h5p'))
    expect(libraries.main.folder).toBe(pack.newest('H5P.QuestionSet', 1)!.folder)
    expect([problems, notes]).toEqual([[], []])
  })

  it('reports the markup the demo\'s markup.h5p holds to show what the content check removes', async () => {
    const { problems } = await checkPackage(join(demo, 'markup.h5p'))
    const said = problems.map(({ message }) => message)
    expect(said).toContain('has the style "position:fixed" on <div>, which this field does not allow')
    expect(said).toContainEqual(expect.stringMatching(/^has <form>, which this field does not take/))
  })
})
