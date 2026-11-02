import { describe, expect, it } from 'vitest'
import {
  findMissingLibraries,
  indexLibraryFolders,
  parseLibraryFolder,
  reachableFolder,
  resolveLibraryFolder,
  walkDependencies
} from '../../src/shared/library-folders'
import type { LibraryDependency } from '../../src/shared/content-libraries'
import { ownLibraries } from '../../src/sw/pack-plan'

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

  it('with downgrade, serves the newest older minor of the same major for one nothing satisfies (#85)', () => {
    expect(resolveLibraryFolder(available, { machineName: 'H5P.Text', major: 1, minor: 9 }, true)).toBe('H5P.Text-1.4')
  })

  it('with downgrade, still serves a version that satisfies first, and never crosses a major', () => {
    expect(resolveLibraryFolder(available, { machineName: 'H5P.Text', major: 1, minor: 2 }, true)).toBe('H5P.Text-1.4')
    expect(resolveLibraryFolder(available, { machineName: 'H5P.Question', major: 1, minor: 0 }, true)).toBeUndefined()
    expect(resolveLibraryFolder(available, { machineName: 'H5P.Question', major: 3, minor: 0 }, true)).toBeUndefined()
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

  it('reports an older minor as missing, and with downgrade accepts it', () => {
    const names = new Set(['H5P.InteractiveVideo-1.21/library.json'])
    expect(findMissingLibraries(names, manifest)).toHaveLength(1)
    expect(findMissingLibraries(names, manifest, true)).toEqual([])
  })
})

describe('reachableFolder', () => {
  // The SCORM writer's own `servingFolder` until #109, now the one rule it and the reader share:
  // the folder as named or the bare name, else the lowest newer minor of the same major, never
  // another major, and with `downgrade` the newest older minor.
  const names = new Set(['H5P.Text-1.3/library.json', 'H5P.Text-1.5/library.json', 'H5P.Text-2.0/library.json', 'Bare/library.json'])
  const available = indexLibraryFolders(names)

  it('serves the folder named, or the bare name, before any other', () => {
    expect(reachableFolder({ machineName: 'H5P.Text', majorVersion: 1, minorVersion: 3 }, names, available)).toBe('H5P.Text-1.3')
    expect(reachableFolder({ machineName: 'Bare', majorVersion: '3', minorVersion: '0' }, names, available)).toBe('Bare')
  })

  it('takes the lowest newer minor of the same major, and only that', () => {
    expect(reachableFolder({ machineName: 'H5P.Text', majorVersion: 1, minorVersion: 1 }, names, available)).toBe('H5P.Text-1.3')
    expect(reachableFolder({ machineName: 'H5P.Text', majorVersion: 1, minorVersion: 4 }, names, available)).toBe('H5P.Text-1.5')
    expect(reachableFolder({ machineName: 'H5P.Text', majorVersion: 1, minorVersion: 6 }, names, available)).toBeUndefined()
    expect(reachableFolder({ machineName: 'H5P.Text', majorVersion: 1, minorVersion: 6 }, names, available, true)).toBe('H5P.Text-1.5')
  })
})

describe('walkDependencies', () => {
  const tree: Record<string, { preloadedDependencies?: LibraryDependency[] }> = {
    'H5P.Column-1.22': { preloadedDependencies: [{ machineName: 'H5P.TrueFalse', majorVersion: 1, minorVersion: 8 }, { machineName: 'H5P.Text', majorVersion: 1, minorVersion: 1 }] },
    'H5P.TrueFalse-1.8': { preloadedDependencies: [{ machineName: 'H5P.Question', majorVersion: '1', minorVersion: '5' }, { machineName: 'H5P.Text', majorVersion: 1, minorVersion: 1 }] },
    'H5P.Text-1.1': {},
    'H5P.Question-1.5': { preloadedDependencies: [{ machineName: 'FontAwesome', majorVersion: 4, minorVersion: 5 }] }
  }
  const names = new Set(Object.keys(tree).map((folder) => `${folder}/library.json`))
  const available = indexLibraryFolders(names)
  const locate = (dependency: LibraryDependency) => reachableFolder(dependency, names, available)
  const roots = [{ machineName: 'H5P.Column', majorVersion: 1, minorVersion: 22 }]

  it('walks the tree a level at a time, reads each library.json once, and names what nothing serves', async () => {
    const reads: string[] = []
    const { missing, found } = await walkDependencies(roots, locate, async (folder) => {
      reads.push(folder)
      return tree[folder]
    })
    expect(missing).toEqual([{ machineName: 'FontAwesome', majorVersion: 4, minorVersion: 5 }])
    expect(found.map(({ located }) => located).sort()).toEqual(['H5P.Column-1.22', 'H5P.Question-1.5', 'H5P.Text-1.1', 'H5P.TrueFalse-1.8'])
    expect(reads.sort()).toEqual(['H5P.Column-1.22', 'H5P.Question-1.5', 'H5P.Text-1.1', 'H5P.TrueFalse-1.8'])
  })

  it('ends with the error of a read that fails, rather than passing a tree it did not see', async () => {
    await expect(
      walkDependencies(roots, locate, async () => {
        throw new Error('not JSON')
      })
    ).rejects.toThrow('not JSON')
  })
})

describe('ownLibraries', () => {
  const files: Record<string, unknown> = {
    'H5P.Text-1.1': { machineName: 'H5P.Text', majorVersion: 1, minorVersion: 1, patchVersion: 7, preloadedDependencies: [{ machineName: 'H5P.Base', majorVersion: '1', minorVersion: '0' }] },
    Bare: { machineName: 'Bare', majorVersion: '2', minorVersion: '3' },
    'H5P.Other-1.0': { machineName: 'H5P.Mismatch', majorVersion: 1, minorVersion: 0 },
    'Broken-1.0': null
  }
  const read = async (folder: string) => {
    if (files[folder] === null) throw new Error('not JSON')
    return files[folder]
  }

  it("reads each folder's library.json for its version, patch and dependencies, leaving out one that does not parse or names another library", async () => {
    expect(await ownLibraries(Object.keys(files), read)).toEqual([
      { folder: 'H5P.Text-1.1', machineName: 'H5P.Text', major: 1, minor: 1, patch: 7, dependencies: [{ machineName: 'H5P.Base', majorVersion: 1, minorVersion: 0 }] },
      { folder: 'Bare', machineName: 'Bare', major: 2, minor: 3, patch: 0, dependencies: [] }
    ])
  })

  it("without a read, takes the version from a versioned folder's name and leaves the rest unknown", async () => {
    expect(await ownLibraries(['H5P.Text-1.1', 'Bare'])).toEqual([
      { folder: 'H5P.Text-1.1', machineName: 'H5P.Text', major: 1, minor: 1, patch: null, dependencies: null },
      { folder: 'Bare', machineName: 'Bare', major: null, minor: null, patch: null, dependencies: null }
    ])
  })
})
