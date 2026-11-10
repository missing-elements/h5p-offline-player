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
    // The name itself, with a version or without, is exact; a version on a loose name is left off too.
    expect(machineNameOf('H5P.Blanks', NAMES)).toEqual({ machineName: 'H5P.Blanks', exact: true })
    expect(machineNameOf(' H5P.Blanks 1.14 ', NAMES)).toEqual({ machineName: 'H5P.Blanks', exact: true })
    expect(machineNameOf('blanks 1.14', NAMES)).toEqual({ machineName: 'H5P.Blanks', exact: false })
    // An editor library keeps its H5PEditor: "blanks" is not it.
    expect(machineNameOf('h5peditorblanks', NAMES)).toEqual({ machineName: 'H5PEditor.Blanks', exact: false })
  })

  it('is none where the letters are no library\'s, or two libraries\'', () => {
    // A title that is not the machine name's letters: the pack's index has no titles.
    for (const written of ['book', 'fill-in-the-blanks', 'Multiple Choice', 'H5P.Nope', '', '  ', 'H5P.', 7, null, undefined]) expect(machineNameOf(written, NAMES), String(written)).toBeNull()
    expect(machineNameOf('ab', ['H5P.AB', 'H5P.Ab'])).toBeNull()
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

  it('finds the key under which an object names a library, where one key does', () => {
    expect(namingKey({ contentType: 'H5P.AdvancedText', text: 'Hello' }, NAMES)).toEqual({ key: 'contentType', machineName: 'H5P.AdvancedText' })
    expect(namingKey({ type: 'multichoice', question: 'Which?' }, NAMES)).toEqual({ key: 'type', machineName: 'H5P.MultiChoice' })
    // Two keys that each name one, a text that only holds a name, and nothing that names one.
    expect(namingKey({ type: 'text', text: 'Blanks' }, NAMES)).toBeNull()
    expect(namingKey({ text: 'Fill in the blanks of this long sentence about H5P.Blanks, which is no name of a library but a sentence' }, NAMES)).toBeNull()
    expect(namingKey({ question: 'Which?', answers: ['H5P.Blanks'] }, NAMES)).toBeNull()
  })
})
