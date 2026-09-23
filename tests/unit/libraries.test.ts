import { describe, expect, it } from 'vitest'
import { findMissingLibraries } from '../../src/sw/package-reader'

/**
 * An export that carries content but not the libraries it names is the single most common broken
 * `.h5p` in the wild: h5p.com and h5p.org leave them out because the site they came from already
 * has them. Played anywhere else it is a `content/` folder and nothing else.
 */
const manifest = {
  title: 'Interactive Video',
  mainLibrary: 'H5P.InteractiveVideo',
  // An h5p.org export writes the versions as strings.
  preloadedDependencies: [
    { machineName: 'H5P.InteractiveVideo', majorVersion: '1', minorVersion: '27' },
    { machineName: 'H5P.Video', majorVersion: 1, minorVersion: 6 }
  ]
}

const entries = (...names: string[]) => new Set(names)

describe('findMissingLibraries', () => {
  it('finds every library when the archive is content only', () => {
    const missing = findMissingLibraries(entries('h5p.json', 'content/content.json'), manifest)
    expect(missing.map((dependency) => dependency.machineName)).toEqual([
      'H5P.InteractiveVideo',
      'H5P.Video'
    ])
  })

  it('accepts a versioned folder, whatever type the versions are', () => {
    const missing = findMissingLibraries(
      entries('H5P.InteractiveVideo-1.27/library.json', 'H5P.Video-1.6/library.json'),
      manifest
    )
    expect(missing).toEqual([])
  })

  it('accepts a bare machine name, which h5p-standalone falls back to', () => {
    const missing = findMissingLibraries(
      entries('H5P.InteractiveVideo/library.json', 'H5P.Video/library.json'),
      manifest
    )
    expect(missing).toEqual([])
  })

  it('reports a partial export, not just an empty one', () => {
    const missing = findMissingLibraries(entries('H5P.InteractiveVideo-1.27/library.json'), manifest)
    expect(missing.map((dependency) => dependency.machineName)).toEqual(['H5P.Video'])
  })

  it('does not accept a library folder without its library.json', () => {
    const missing = findMissingLibraries(
      entries('H5P.InteractiveVideo-1.27/scripts/interactive-video.js'),
      manifest
    )
    expect(missing).toHaveLength(2)
  })

  it('does not accept a different version of the same library', () => {
    const missing = findMissingLibraries(entries('H5P.InteractiveVideo-1.22/library.json'), manifest)
    expect(missing.map((dependency) => dependency.machineName)).toContain('H5P.InteractiveVideo')
  })

  it('has nothing to report when a manifest declares no dependencies', () => {
    expect(findMissingLibraries(entries('h5p.json'), { title: 'x' })).toEqual([])
  })
})
