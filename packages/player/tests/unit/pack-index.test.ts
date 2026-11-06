import { describe, expect, it } from 'vitest'
import { packLibrariesIn } from '../../src/shared/pack'

/**
 * A pack index read from the network, held to the player's shape: what is kept of an entry, and
 * what the pack carries for an H5P site's upload check (#146), which the author's page build
 * reads through here too.
 */
const entry = {
  folder: 'H5P.QuestionSet-1.21',
  machineName: 'H5P.QuestionSet',
  majorVersion: 1,
  minorVersion: 21,
  patchVersion: 14,
  preloadedDependencies: [{ machineName: 'H5P.Question', majorVersion: 1, minorVersion: 5 }],
  editorDependencies: [{ machineName: 'H5PEditor.QuestionSetTextualEditor', majorVersion: 1, minorVersion: 3 }],
  size: 128024,
  sha256: 'a'.repeat(64),
  url: 'https://pack.example/H5P.QuestionSet-1.21.h5p'
}

describe('the shape a pack index is held to', () => {
  it('keeps the three dependency lists and the installOnly mark, well formed', () => {
    const editor = { ...entry, folder: 'H5PEditor.QuestionSetTextualEditor-1.3', machineName: 'H5PEditor.QuestionSetTextualEditor', minorVersion: 3, installOnly: true, dynamicDependencies: [{ machineName: 'H5P.Question', majorVersion: 1, minorVersion: 5 }] }
    const [first, second] = packLibrariesIn([entry, editor, { ...entry, folder: 'H5P.Other-1.0', machineName: 'H5P.Other', majorVersion: 1, minorVersion: 0, installOnly: 'yes' }])
    expect(first).toEqual(entry)
    expect(second).toEqual({ ...editor, preloadedDependencies: entry.preloadedDependencies })
    expect(packLibrariesIn([{ ...entry, installOnly: 'yes' }])[0]).not.toHaveProperty('installOnly')
    expect(packLibrariesIn([{ ...entry, editorDependencies: [{ machineName: 'H5PEditor.Bad' }] }])[0]).not.toHaveProperty('editorDependencies')
  })

  it('drops an entry whose folder, version, hash or address is not what a part has', () => {
    expect(packLibrariesIn([{ ...entry, folder: '../escape' }, { ...entry, sha256: 'xyz' }, { ...entry, url: 'file:///pack' }, null, 'text'])).toEqual([])
    expect(packLibrariesIn('not a list')).toEqual([])
  })
})
