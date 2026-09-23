import { describe, expect, it } from 'vitest'
import { indexEntryNames, normalizeEntryName, normalizeRequestPath } from '../../src/shared/entry-names'

describe('normalizeEntryName', () => {
  it('keeps an ordinary relative path as it is', () => {
    expect(normalizeEntryName('H5P.Blanks-1.14/blanks.js')).toBe('H5P.Blanks-1.14/blanks.js')
  })

  it('converts the backslashes a Windows-written archive uses', () => {
    expect(normalizeEntryName('content\\images\\photo.png')).toBe('content/images/photo.png')
  })

  it('drops redundant segments', () => {
    expect(normalizeEntryName('./content//images/photo.png')).toBe('content/images/photo.png')
  })

  it.each([
    ['../escaped.js', 'a parent segment'],
    ['nested/../../escaped.js', 'a parent segment anywhere in the path'],
    ['/absolute.js', 'an absolute path'],
    ['C:/windows.js', 'a drive letter'],
    ['', 'an empty name'],
    ['bad\u0000name.js', 'a control character']
  ])('rejects %s (%s)', (name) => {
    expect(normalizeEntryName(name)).toBeNull()
  })

  it('rejects rather than sanitises, so a hostile name cannot become a valid one', () => {
    // Stripping `..` would turn this into `content/h5p.json` and let it shadow a real entry.
    expect(normalizeEntryName('content/../h5p.json')).toBeNull()
  })
})

describe('normalizeRequestPath', () => {
  it('decodes before validating, so an encoded traversal is caught', () => {
    expect(normalizeRequestPath('%2e%2e/escaped.js')).toBeNull()
    expect(normalizeRequestPath('content/%2e%2e/h5p.json')).toBeNull()
  })

  it('decodes ordinary escapes', () => {
    expect(normalizeRequestPath('content/my%20image.png')).toBe('content/my image.png')
  })

  it('rejects a malformed escape instead of guessing', () => {
    expect(normalizeRequestPath('content/%zz.png')).toBeNull()
  })
})

describe('indexEntryNames', () => {
  it('drops directories and unusable names', () => {
    const { index, rejected } = indexEntryNames([
      { filename: 'h5p.json' },
      { filename: 'content/', directory: true },
      { filename: '../escaped.js' }
    ])

    expect([...index.keys()]).toEqual(['h5p.json'])
    expect(rejected).toEqual(['../escaped.js'])
  })

  it('keeps the first of two names that normalise together', () => {
    const { index, rejected } = indexEntryNames([
      { filename: 'content/a.json' },
      { filename: 'content\\a.json' }
    ])

    expect(index.size).toBe(1)
    expect(index.get('content/a.json')?.filename).toBe('content/a.json')
    expect(rejected).toEqual(['content\\a.json'])
  })
})
