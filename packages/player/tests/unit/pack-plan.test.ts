import { describe, expect, it } from 'vitest'
import type { PackLibrary } from '../../src/shared/protocol'
import { planPack, type OwnLibrary, type PlanInput } from '../../src/sw/pack-plan'

/**
 * Which parts of the library pack a package needs: the newer versions of libraries it carries,
 * what it lacks, what a part needs in turn, and the addons its text calls for.
 */

type Dependency = [machineName: string, major: number, minor: number]
const dependencies = (list: Dependency[]) => list.map(([machineName, majorVersion, minorVersion]) => ({ machineName, majorVersion, minorVersion }))

function inPack(machineName: string, major: number, minor: number, patch: number, needs: Dependency[] = [], extra: Partial<PackLibrary> = {}) {
  const folder = `${machineName}-${major}.${minor}`
  return {
    folder,
    machineName,
    majorVersion: major,
    minorVersion: minor,
    patchVersion: patch,
    ...(needs.length ? { preloadedDependencies: dependencies(needs) } : {}),
    size: 1000,
    sha256: 'a'.repeat(64),
    url: `https://pack.example/${folder}.h5p`,
    ...extra
  }
}

function carried(machineName: string, major: number, minor: number, patch: number | null, needs: Dependency[] | null = []): OwnLibrary {
  return { folder: `${machineName}-${major}.${minor}`, machineName, major, minor, patch, dependencies: needs && dependencies(needs) }
}

const PACK = [
  inPack('H5P.QuestionSet', 1, 21, 2, [['H5P.Question', 1, 5], ['H5P.JoubelUI', 1, 3]]),
  inPack('H5P.MultiChoice', 1, 16, 9, [['H5P.Question', 1, 5]]),
  inPack('H5P.Question', 1, 5, 7, [['H5P.JoubelUI', 1, 3]]),
  inPack('H5P.JoubelUI', 1, 3, 20),
  inPack('H5P.Video', 1, 6, 80),
  inPack('H5P.DragText', 1, 10, 4, [['H5P.Question', 1, 5]]),
  inPack('H5P.Accordion', 1, 0, 26),
  inPack('H5P.MathDisplay', 1, 0, 50, [], { addTo: { content: { types: [{ text: { regex: '/\\\\\\(.+\\\\\\)/' } }] } } })
]

const plan = (input: Partial<PlanInput>) =>
  planPack({ own: [], provided: [], roots: [], params: undefined, pack: PACK, refresh: true, fill: true, ...input })
const folders = (result: ReturnType<typeof planPack>) => result?.parts.map(({ folder }) => folder).sort()

describe('refreshing what a package carries', () => {
  // A quiz exported before the pack's versions, the way a full export lists its libraries.
  const quiz = [
    carried('H5P.QuestionSet', 1, 20, 3, [['H5P.Question', 1, 4], ['H5P.JoubelUI', 1, 3]]),
    carried('H5P.Question', 1, 4, 1, [['H5P.JoubelUI', 1, 3]]),
    carried('H5P.JoubelUI', 1, 3, 20)
  ]
  const quizRoots = dependencies([['H5P.QuestionSet', 1, 20]])

  it('plays the pack version of each library where it is newer, and the package\'s own where it is not', () => {
    const result = plan({ own: quiz, roots: quizRoots })
    expect(folders(result)).toEqual(['H5P.Question-1.5', 'H5P.QuestionSet-1.21'])
    expect(result?.superseded.sort()).toEqual(['H5P.Question-1.4', 'H5P.QuestionSet-1.20'])
    expect(result?.refreshed).toEqual([
      { library: 'H5P.QuestionSet', from: '1.20.3', to: '1.21.2' },
      { library: 'H5P.Question', from: '1.4.1', to: '1.5.7' }
    ])
  })

  it('takes a newer patch of the same minor, whose folder has the same name', () => {
    const result = plan({ own: [carried('H5P.Video', 1, 6, 66)], roots: dependencies([['H5P.Video', 1, 6]]) })
    expect(result).toEqual({
      parts: [{ folder: 'H5P.Video-1.6', url: 'https://pack.example/H5P.Video-1.6.h5p', size: 1000, sha256: 'a'.repeat(64) }],
      superseded: ['H5P.Video-1.6'],
      refreshed: [{ library: 'H5P.Video', from: '1.6.66', to: '1.6.80' }]
    })
  })

  it('leaves a package that is as new as the pack, or newer, alone', () => {
    expect(plan({ own: [carried('H5P.Video', 1, 6, 80)], roots: dependencies([['H5P.Video', 1, 6]]) })).toBeNull()
    expect(plan({ own: [carried('H5P.Video', 1, 7, 0)], roots: dependencies([['H5P.Video', 1, 7]]) })).toBeNull()
    expect(plan({ own: [carried('H5P.Video', 1, 6, 90)], roots: dependencies([['H5P.Video', 1, 6]]) })).toBeNull()
  })

  it('never moves a library to another major', () => {
    expect(plan({ own: [carried('H5P.Video', 2, 0, 0)], roots: dependencies([['H5P.Video', 2, 0]]) })).toBeNull()
  })

  it('does nothing for what the package carries with refresh off', () => {
    expect(plan({ own: quiz, roots: quizRoots, refresh: false })).toBeNull()
  })

  it("does not refresh a library whose library.json was not read, nor follow what it needs", () => {
    // Over HTTP before the warm: the folder's name gives major and minor, and no patch.
    const unread = [carried('H5P.QuestionSet', 1, 20, null, null)]
    expect(plan({ own: unread, roots: quizRoots })).toBeNull()
  })

  it('takes an unversioned folder, unread, for the library at any version, and plans nothing over it', () => {
    // Older packages keep library folders without a version; before the warm their library.json
    // is not read, and the runtime falls back to the bare name, whatever version it asked for.
    const own: OwnLibrary[] = [{ folder: 'H5P.QuestionSet', machineName: 'H5P.QuestionSet', major: null, minor: null, patch: null, dependencies: null }]
    expect(plan({ own, roots: dependencies([['H5P.QuestionSet', 1, 20]]) })).toBeNull()
  })

  it('keeps a custom library the pack does not have, against the pack\'s newer shared ones', () => {
    const own = [carried('Custom.Quiz', 1, 0, 0, [['H5P.Question', 1, 4]]), carried('H5P.Question', 1, 4, 1, [['H5P.JoubelUI', 1, 3]]), carried('H5P.JoubelUI', 1, 3, 20)]
    const result = plan({ own, roots: dependencies([['Custom.Quiz', 1, 0]]) })
    expect(folders(result)).toEqual(['H5P.Question-1.5'])
    expect(result?.superseded).toEqual(['H5P.Question-1.4'])
  })

  it('keeps the package\'s own where a bundle listed before the pack has the library already', () => {
    // `libraries="/bundle.h5p pack"`: the bundle was attached for a gap and is consulted before
    // the pack's parts, so it would answer for the folder a refresh withheld (#58).
    const sameFolder = [{ folder: 'H5P.Video-1.6', machineName: 'H5P.Video', major: 1, minor: 6 }]
    expect(plan({ own: [carried('H5P.Video', 1, 6, 66)], provided: sameFolder, roots: dependencies([['H5P.Video', 1, 6]]) })).toBeNull()

    // At a minor between the package's and the pack's, the first a request for the package's
    // resolves to: the part would download and never answer.
    const between = [{ folder: 'H5P.Question-1.5', machineName: 'H5P.Question', major: 1, minor: 5 }]
    const own = [carried('H5P.Question', 1, 4, 1)]
    const pack = [...PACK.filter(({ machineName }) => machineName !== 'H5P.Question'), inPack('H5P.Question', 1, 6, 0)]
    expect(plan({ own, provided: between, roots: dependencies([['H5P.Question', 1, 4]]), pack })).toBeNull()
  })
})

describe('supplying what a package lacks', () => {
  it('fills a content-only export from the pack, with what each part needs', () => {
    const result = plan({ roots: dependencies([['H5P.QuestionSet', 1, 20], ['H5P.MultiChoice', 1, 14]]) })
    expect(folders(result)).toEqual(['H5P.JoubelUI-1.3', 'H5P.MultiChoice-1.16', 'H5P.Question-1.5', 'H5P.QuestionSet-1.21'])
    expect(result?.superseded).toEqual([])
    expect(result?.refreshed).toEqual([])
  })

  it('fills nothing while a source listed before the pack is still to be tried', () => {
    expect(plan({ roots: dependencies([['H5P.QuestionSet', 1, 20]]), fill: false })).toBeNull()
  })

  it('still supplies what a refreshed part needs, fill or not', () => {
    const own = [carried('H5P.DragText', 1, 8, 0, [])]
    const result = plan({ own, roots: dependencies([['H5P.DragText', 1, 8]]), fill: false })
    expect(folders(result)).toEqual(['H5P.DragText-1.10', 'H5P.JoubelUI-1.3', 'H5P.Question-1.5'])
  })

  it("gives the package's older minor way to the version a part needs", () => {
    // No refresh: the package's own Question 1.4 stays until a part it needs asks for 1.5.
    const own = [carried('H5P.Accordion', 1, 0, 26), carried('H5P.Question', 1, 4, 1, [])]
    const result = plan({ own, roots: dependencies([['H5P.Accordion', 1, 0], ['H5P.DragText', 1, 10]]), refresh: false })
    expect(folders(result)).toEqual(['H5P.DragText-1.10', 'H5P.JoubelUI-1.3', 'H5P.Question-1.5'])
    expect(result?.superseded).toEqual(['H5P.Question-1.4'])
    expect(result?.refreshed).toEqual([{ library: 'H5P.Question', from: '1.4.1', to: '1.5.7' }])
  })

  it('leaves what the pack has not got for the error, and plans the rest', () => {
    const result = plan({ roots: dependencies([['H5P.Accordion', 1, 0], ['H5P.Unknown', 1, 0], ['H5P.QuestionSet', 1, 22]]) })
    expect(folders(result)).toEqual(['H5P.Accordion-1.0'])
  })

  it('asks nothing again of what an attached archive provides', () => {
    const provided = [{ folder: 'H5P.Accordion-1.0', machineName: 'H5P.Accordion', major: 1, minor: 0 }]
    expect(plan({ roots: dependencies([['H5P.Accordion', 1, 0]]), provided })).toBeNull()
  })
})

describe('content made for a newer minor than the pack has (#85)', () => {
  // A content-only export from h5p.com after a minor bump the pack has not caught up with.
  const newer = dependencies([['H5P.QuestionSet', 1, 22], ['H5P.MultiChoice', 1, 17]])

  it('supplies nothing for it until the load asks for the downgrade', () => {
    expect(plan({ roots: newer })).toBeNull()
  })

  it("then supplies the pack's newest older minor, with what each part needs", () => {
    const result = plan({ roots: newer, downgrade: true })
    expect(folders(result)).toEqual(['H5P.JoubelUI-1.3', 'H5P.MultiChoice-1.16', 'H5P.Question-1.5', 'H5P.QuestionSet-1.21'])
    expect(result?.refreshed).toEqual([])
  })

  it('keeps an older version the package carries when it is at least as new as the pack\'s', () => {
    const own = [carried('H5P.MultiChoice', 1, 16, 30, [['H5P.Question', 1, 5]]), carried('H5P.Question', 1, 5, 9)]
    expect(plan({ own, roots: dependencies([['H5P.MultiChoice', 1, 17]]), downgrade: true, refresh: false })).toBeNull()
  })

  it("gives one older than the pack's way to the pack's, as a refresh of what the package carries", () => {
    const own = [carried('H5P.MultiChoice', 1, 14, 2, [])]
    const result = plan({ own, roots: dependencies([['H5P.MultiChoice', 1, 17]]), downgrade: true, refresh: false })
    expect(folders(result)).toEqual(['H5P.JoubelUI-1.3', 'H5P.MultiChoice-1.16', 'H5P.Question-1.5'])
    expect(result?.superseded).toEqual(['H5P.MultiChoice-1.14'])
    expect(result?.refreshed).toEqual([{ library: 'H5P.MultiChoice', from: '1.14.2', to: '1.16.9' }])
  })

  it('asks nothing of the pack where an attached archive is as new already', () => {
    const provided = [{ folder: 'H5P.MultiChoice-1.16', machineName: 'H5P.MultiChoice', major: 1, minor: 16 }]
    expect(plan({ roots: dependencies([['H5P.MultiChoice', 1, 17]]), provided, downgrade: true })).toBeNull()
  })

  it('never crosses a major, and leaves a library the pack has not got for the error', () => {
    expect(plan({ roots: dependencies([['H5P.QuestionSet', 2, 0], ['H5P.Unknown', 1, 3]]), downgrade: true })).toBeNull()
  })
})

describe('addons', () => {
  const params = { text: 'The area is \\(\\pi r^2\\).' }

  it('adds one whose pattern matches the content, when the pack supplies anything', () => {
    expect(folders(plan({ roots: dependencies([['H5P.Accordion', 1, 0]]), params }))).toEqual(['H5P.Accordion-1.0', 'H5P.MathDisplay-1.0'])
  })

  it('adds one to a package that carries everything, when the pack refreshes', () => {
    const own = [carried('H5P.Accordion', 1, 0, 26)]
    expect(folders(plan({ own, roots: dependencies([['H5P.Accordion', 1, 0]]), params }))).toEqual(['H5P.MathDisplay-1.0'])
  })

  it('adds none to a package played as exported, nor to text that does not match', () => {
    const own = [carried('H5P.Accordion', 1, 0, 26)]
    expect(plan({ own, roots: dependencies([['H5P.Accordion', 1, 0]]), params, refresh: false })).toBeNull()
    expect(plan({ own, roots: dependencies([['H5P.Accordion', 1, 0]]), params: { text: 'No formula.' } })).toBeNull()
  })

  it('adds none where the package carries the addon itself', () => {
    const own = [carried('H5P.Accordion', 1, 0, 26), carried('H5P.MathDisplay', 1, 0, 60)]
    expect(plan({ own, roots: dependencies([['H5P.Accordion', 1, 0]]), params })).toBeNull()
  })
})
