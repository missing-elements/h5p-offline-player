import { describe, expect, it, vi } from 'vitest'
import { parseLibrarySources } from '../../src/shared/library-sources'

describe('the libraries attribute', () => {
  it('reads pack and URLs in order', () => {
    expect(parseLibrarySources(null)).toEqual([])
    expect(parseLibrarySources('  ')).toEqual([])
    expect(parseLibrarySources('pack')).toEqual(['pack'])
    expect(parseLibrarySources(' /libraries.h5p   pack ')).toEqual([{ url: '/libraries.h5p' }, 'pack'])
  })

  it('reads hub as pack, says so, and does not try the pack twice', () => {
    const onHub = vi.fn()
    expect(parseLibrarySources('hub', onHub)).toEqual(['pack'])
    expect(onHub).toHaveBeenCalledTimes(1)
    expect(parseLibrarySources('https://cdn.example.org/l.h5p pack hub')).toEqual([{ url: 'https://cdn.example.org/l.h5p' }, 'pack'])
  })
})

describe('the pack the element names', () => {
  it('is the version in this checkout, on jsDelivr', async () => {
    const { readFile } = await import('node:fs/promises')
    const { resolve } = await import('node:path')
    const { LIBRARY_PACK_URL, LIBRARY_PACK_VERSION } = await import('../../src/shared/constants')
    const libraries = JSON.parse(await readFile(resolve(import.meta.dirname, '../../../libraries/package.json'), 'utf8'))
    // Stamped by scripts/sync-h5p-assets.mjs; a mismatch means the stamp did not run.
    expect(LIBRARY_PACK_VERSION).toBe(libraries.version)
    expect(LIBRARY_PACK_URL).toBe(`https://cdn.jsdelivr.net/npm/@missing-elements/h5p-libraries@${libraries.version}/libraries.h5p`)
  })
})
