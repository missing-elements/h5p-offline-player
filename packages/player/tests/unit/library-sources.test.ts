import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { LIBRARY_PACK_BASE, LIBRARY_PACK_VERSION } from '../../src/shared/constants'
import { PACK_INDEX } from '../../src/shared/pack-index'
import { describe, expect, it } from 'vitest'
import { parseLibrarySources } from '../../src/shared/library-sources'

describe('the libraries attribute', () => {
  it('reads pack and URLs in order', () => {
    expect(parseLibrarySources(null)).toEqual([])
    expect(parseLibrarySources('  ')).toEqual([])
    expect(parseLibrarySources('pack')).toEqual(['pack'])
    expect(parseLibrarySources(' /libraries.h5p   pack ')).toEqual([{ url: '/libraries.h5p' }, 'pack'])
  })

  it('does not try the pack twice', () => {
    expect(parseLibrarySources('pack https://cdn.example.org/l.h5p pack')).toEqual(['pack', { url: 'https://cdn.example.org/l.h5p' }])
  })

  it('reads hub as any other word, a URL, since it no longer means pack', () => {
    expect(parseLibrarySources('hub')).toEqual([{ url: 'hub' }])
  })
})

describe('the pack the element names', () => {
  it('is the version in this checkout, its parts on jsDelivr', async () => {
    const libraries = JSON.parse(await readFile(resolve(import.meta.dirname, '../../../libraries/package.json'), 'utf8'))
    // Stamped by scripts/sync-h5p-assets.mjs; a mismatch means the stamp did not run.
    expect(LIBRARY_PACK_VERSION).toBe(libraries.version)
    expect(LIBRARY_PACK_BASE).toBe(`https://cdn.jsdelivr.net/npm/@missing-elements/h5p-libraries@${libraries.version}/parts/`)
  })

  it("carries the checkout's index, which the worker plans from and checks each part against", async () => {
    const index = JSON.parse(await readFile(resolve(import.meta.dirname, '../../../libraries/parts/index.json'), 'utf8'))
    // Written by scripts/sync-h5p-assets.mjs too: a part refused for its hash is this out of step.
    expect(PACK_INDEX).toEqual(index.libraries)
  })
})
