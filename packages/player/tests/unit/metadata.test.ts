import { describe, expect, it } from 'vitest'
import { contentMetadata } from '../../src/shared/metadata'

/**
 * The manifest's metadata as the runtime's copyright dialog reads it. The manifest is untrusted,
 * and the record it is kept on comes back from IndexedDB, so each field is held to its shape.
 */
describe('contentMetadata', () => {
  it('keeps the fields H5P.buildMetadataCopyrights reads, as a real export writes them', () => {
    expect(
      contentMetadata({
        title: 'Ten seconds of Big Buck Bunny',
        language: 'en',
        mainLibrary: 'H5P.InteractiveVideo',
        license: 'CC BY',
        licenseVersion: '3.0',
        authors: [{ name: 'Blender Foundation', role: 'Originator' }, { name: 'missing-elements', role: 'Author' }],
        source: 'https://peach.blender.org/',
        changes: [{ date: '2026-10-07', author: 'missing-elements', log: 'Cut to ten seconds' }],
        preloadedDependencies: [{ machineName: 'H5P.InteractiveVideo', majorVersion: '1', minorVersion: '27' }]
      })
    ).toEqual({
      title: 'Ten seconds of Big Buck Bunny',
      license: 'CC BY',
      licenseVersion: '3.0',
      authors: [{ name: 'Blender Foundation', role: 'Originator' }, { name: 'missing-elements', role: 'Author' }],
      source: 'https://peach.blender.org/',
      changes: [{ date: '2026-10-07', author: 'missing-elements', log: 'Cut to ten seconds' }]
    })
  })

  it('drops what has the wrong shape and keeps the rest', () => {
    expect(
      contentMetadata({
        title: 42,
        license: 'CC0 1.0',
        authors: ['Ada', { role: 'Author' }, { name: 'Bob' }, null],
        changes: [{ date: 3 }, { log: 'Fixed a typo', date: 3 }],
        yearFrom: 2024,
        yearTo: ''
      })
    ).toEqual({ license: 'CC0 1.0', yearFrom: '2024', authors: [{ name: 'Bob' }], changes: [{ log: 'Fixed a typo' }] })
  })

  it('leaves out a licence the runtime has no name for, since its dialog would die on the lookup', () => {
    expect(contentMetadata({ title: 'From the CLI', license: 'MIT', licenseVersion: '1', authors: [{ name: 'Ada' }] })).toEqual({
      title: 'From the CLI',
      authors: [{ name: 'Ada' }]
    })
  })

  it('is undefined for a manifest that says nothing of the kind, and for what is not a manifest', () => {
    expect(contentMetadata({ mainLibrary: 'H5P.Accordion', preloadedDependencies: [] })).toBeUndefined()
    expect(contentMetadata(null)).toBeUndefined()
    expect(contentMetadata('{"title":"x"}')).toBeUndefined()
  })
})
