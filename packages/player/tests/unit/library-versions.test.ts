import { describe, expect, it } from 'vitest'
import {
  findMissingLibraries,
  indexLibraryFolders,
  parseLibraryFolder,
  resolveLibraryFolder
} from '../../src/sw/package-reader'

/**
 * H5P's compatibility rule: a library satisfies a dependency when the machine name and major
 * version match and the minor is at least as high. Platforms install one version per major and
 * content authored against an older minor keeps working — which is what makes libraries from a
 * hub bundle usable by a package that asks for older ones.
 */
describe('parseLibraryFolder', () => {
  it('splits a versioned folder', () => {
    expect(parseLibraryFolder('H5P.Text-1.1')).toEqual({
      machineName: 'H5P.Text',
      major: 1,
      minor: 1,
      folder: 'H5P.Text-1.1'
    })
  })

  it('handles a machine name that itself contains a dash', () => {
    expect(parseLibraryFolder('H5P.Drag-N-Bar-2.10')?.machineName).toBe('H5P.Drag-N-Bar')
  })

  it('returns null for a folder with no version, as older packages use', () => {
    expect(parseLibraryFolder('H5P.Text')).toBeNull()
  })

  it('returns null for something that is not a library folder', () => {
    expect(parseLibraryFolder('content')).toBeNull()
    expect(parseLibraryFolder('file-52fc90e466b65')).toBeNull()
  })
})

describe('resolveLibraryFolder', () => {
  const available = indexLibraryFolders([
    'H5P.Text-1.1/library.json',
    'H5P.Text-1.4/library.json',
    'H5P.Question-2.0/library.json',
    'content/content.json',
    'H5P.Text-1.1/text.js'
  ])

  it('serves a newer minor for content that asks for an older one', () => {
    expect(resolveLibraryFolder(available, { machineName: 'H5P.Text', major: 1, minor: 0 })).toBe(
      'H5P.Text-1.1'
    )
  })

  it('prefers the lowest version that satisfies, as the closest to what was authored', () => {
    expect(resolveLibraryFolder(available, { machineName: 'H5P.Text', major: 1, minor: 2 })).toBe(
      'H5P.Text-1.4'
    )
  })

  it('never crosses a major version, which is not backward compatible', () => {
    expect(
      resolveLibraryFolder(available, { machineName: 'H5P.Question', major: 1, minor: 0 })
    ).toBeUndefined()
  })

  it('does not serve an older minor than the one asked for', () => {
    expect(
      resolveLibraryFolder(available, { machineName: 'H5P.Text', major: 1, minor: 9 })
    ).toBeUndefined()
  })

  it('indexes only folders that actually carry a library.json', () => {
    expect(indexLibraryFolders(['H5P.Text-1.1/text.js']).size).toBe(0)
  })
})

describe('findMissingLibraries with compatible versions', () => {
  const manifest = {
    mainLibrary: 'H5P.InteractiveVideo',
    preloadedDependencies: [
      { machineName: 'H5P.InteractiveVideo', majorVersion: '1', minorVersion: '22' }
    ]
  }

  it('accepts a bundle that ships a newer minor than the export asks for', () => {
    // An older export against a current hub bundle: the whole reason this rule exists.
    const names = new Set(['H5P.InteractiveVideo-1.27/library.json'])
    expect(findMissingLibraries(names, manifest)).toEqual([])
  })

  it('still reports one that is genuinely absent', () => {
    const names = new Set(['H5P.InteractiveVideo-2.0/library.json'])
    expect(findMissingLibraries(names, manifest)).toHaveLength(1)
  })

  it('still accepts the unversioned folder name', () => {
    expect(findMissingLibraries(new Set(['H5P.InteractiveVideo/library.json']), manifest)).toEqual([])
  })
})
