import { describe, expect, it } from 'vitest'
import { machineNameOf, namingKey, nearestNames } from '../lib/names.mjs'

// The names a chat with no skill beside it wrote for a content type (#174), against a pack's.
const NAMES = ['H5P.InteractiveBook', 'H5P.Blanks', 'H5P.AdvancedBlanks', 'H5P.Dialogcards', 'H5P.MultiChoice', 'H5P.QuestionSet', 'H5P.CoursePresentation', 'H5P.Flashcards', 'H5P.Text', 'H5P.AdvancedText', 'H5PEditor.Blanks']

describe('a library named another way than by its machine name', () => {
  it('is the one library of those letters, with H5P. or without, in any case', () => {
    for (const [written, machineName] of [
      ['interactive-book', 'H5P.InteractiveBook'], ['interactiveBook', 'H5P.InteractiveBook'], ['Interactive Book', 'H5P.InteractiveBook'],
      ['blanks', 'H5P.Blanks'], ['h5p blanks', 'H5P.Blanks'], ['H5P_Blanks', 'H5P.Blanks'],
      ['dialog-cards', 'H5P.Dialogcards'], ['multichoice', 'H5P.MultiChoice'], ['Question Set', 'H5P.QuestionSet'], ['Course Presentation', 'H5P.CoursePresentation']
    ]) expect(machineNameOf(written, NAMES), written).toEqual({ machineName, exact: false })
    // The name itself, alone or with the major and minor that sub-content names a library by, is
    // exact, and says the version; a version of three parts is read loosely, as a version on a
    // loose name, and left off, since what reads a library's name takes two.
    expect(machineNameOf('H5P.Blanks', NAMES)).toEqual({ machineName: 'H5P.Blanks', exact: true })
    expect(machineNameOf(' H5P.Blanks 1.14 ', NAMES)).toEqual({ machineName: 'H5P.Blanks', exact: true, major: 1, minor: 14 })
    expect(machineNameOf('H5P.Blanks\t1.14', NAMES)).toEqual({ machineName: 'H5P.Blanks', exact: true, major: 1, minor: 14 })
    expect(machineNameOf('H5P.Blanks 1.14.2', NAMES)).toEqual({ machineName: 'H5P.Blanks', exact: false })
    expect(machineNameOf('blanks 1.14', NAMES)).toEqual({ machineName: 'H5P.Blanks', exact: false })
    // An editor library keeps its H5PEditor: "blanks" is not it.
    expect(machineNameOf('h5peditorblanks', NAMES)).toEqual({ machineName: 'H5PEditor.Blanks', exact: false })
  })

  it('is none where the letters are no library\'s, or two libraries\'', () => {
    // A title that is not the machine name's letters: the pack's index has no titles.
    for (const written of ['book', 'fill-in-the-blanks', 'Multiple Choice', 'H5P.Nope', '', '  ', 'H5P.', '1.14', 7, null, undefined]) expect(machineNameOf(written, NAMES), String(written)).toBeNull()
    expect(machineNameOf('ab', ['H5P.AB', 'H5P.Ab'])).toBeNull()
    // A number with no point is no version: "Question Set 2" is not Question Set.
    expect(machineNameOf('Question Set 2', NAMES)).toBeNull()
    expect(machineNameOf('H5P.Blanks 2', NAMES)).toBeNull()
    // A text longer than a name is none, however it ends, and is read in no time.
    expect(machineNameOf(`H5P.Blanks${' '.repeat(60)}`, NAMES)).toBeNull()
    const started = performance.now()
    for (const written of [`a${'\t'.repeat(100_000)}x`, `${'\t'.repeat(100_000)}1.1x`, `a ${'1.'.repeat(50_000)}`]) {
      expect(machineNameOf(written, NAMES)).toBeNull()
      expect(nearestNames(written, NAMES)).toEqual([])
    }
    expect(performance.now() - started).toBeLessThan(500)
  })

  it('offers the nearest names: those the letters are part of, and those the letters end with', () => {
    expect(nearestNames('book', NAMES)).toEqual(['H5P.InteractiveBook'])
    expect(nearestNames('fill-in-the-blanks', NAMES)).toEqual(['H5P.Blanks'])
    // A name the letters begin with is no lead: an "image choice" is not an H5P.Image.
    expect(nearestNames('H5P.ImageChoice', [...NAMES, 'H5P.Image'])).toEqual([])
    expect(nearestNames('text', NAMES)).toEqual(['H5P.Text', 'H5P.AdvancedText'])
    expect(nearestNames('Multiple Choice', NAMES)).toEqual([])
    // Too short to mean anything, and no more than five.
    expect(nearestNames('bo', NAMES)).toEqual([])
    expect(nearestNames('h5p.a', ['H5P.A1', 'H5P.A2'])).toEqual([])
    expect(nearestNames('card', Array.from({ length: 8 }, (_, i) => `H5P.Card${i}`))).toHaveLength(5)
  })

  it('finds the key under which an object names a library, type or contentType, where one of them does', () => {
    expect(namingKey({ contentType: 'H5P.AdvancedText', text: 'Hello' }, NAMES)).toEqual({ key: 'contentType', machineName: 'H5P.AdvancedText', library: 'H5P.AdvancedText' })
    expect(namingKey({ type: 'multichoice', question: 'Which?' }, NAMES)).toEqual({ key: 'type', machineName: 'H5P.MultiChoice', library: 'H5P.MultiChoice' })
    // The version written is kept, for a field that takes two majors of a library.
    expect(namingKey({ type: 'H5P.MultiChoice 1.16' }, NAMES)).toEqual({ key: 'type', machineName: 'H5P.MultiChoice', major: 1, library: 'H5P.MultiChoice 1.16' })
    // A source's own type under another key than `type`.
    expect(namingKey({ library: 'H5P.Blanks', mainLibrary: 'H5P.Text' }, NAMES)).toEqual({ key: 'library', machineName: 'H5P.Blanks', library: 'H5P.Blanks' })
    // Under another key a text is no name, however it reads: a title "Text", a card's answer, a
    // text that is a library's name, a sentence that holds one.
    expect(namingKey({ title: 'Text', contentType: 'H5P.AdvancedText' }, NAMES)).toEqual({ key: 'contentType', machineName: 'H5P.AdvancedText', library: 'H5P.AdvancedText' })
    for (const given of [{ title: 'Text' }, { answer: 'blanks' }, { text: 'H5P.AdvancedText' }, { kind: 'H5P.MultiChoice' }, { question: 'Which?', answers: ['H5P.Blanks'] }]) {
      expect(namingKey(given, NAMES), JSON.stringify(given)).toBeNull()
    }
    expect(namingKey({ type: 'Fill in the blanks of this long sentence about H5P.Blanks, which is no name of a library' }, NAMES)).toBeNull()
    // Two keys that each name one: neither is taken.
    expect(namingKey({ type: 'text', contentType: 'Blanks' }, NAMES)).toBeNull()
  })
})
