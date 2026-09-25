import { describe, expect, it } from 'vitest'
import type { Entry } from '@zip.js/zip.js'
import { chooseStrategy } from '../../src/sw/package-reader'
import { INLINE_MAX_SIZE, MEDIA_INLINE_MAX_SIZE } from '../../src/shared/constants'

const entry = (overrides: Partial<Entry>): Entry =>
  ({ uncompressedSize: 0, compressedSize: 0, compressionMethod: 8, ...overrides }) as Entry

const STORED = 0
const DEFLATE = 8

describe('chooseStrategy', () => {
  it('inlines text however large, because the runtime parses it whole', () => {
    const strategy = chooseStrategy(
      'H5P.Big-1.0/big.js',
      entry({ uncompressedSize: INLINE_MAX_SIZE * 4, compressionMethod: DEFLATE })
    )
    expect(strategy).toEqual({ kind: 'inline' })
  })

  it('inlines small media, where a background job would cost more than it saves', () => {
    expect(chooseStrategy('content/clip.mp4', entry({ uncompressedSize: 1024 }))).toEqual({
      kind: 'inline'
    })
  })

  it('holds media to a lower bar: a stored video over a megabyte is sliced, a deflated one extracted', () => {
    const size = MEDIA_INLINE_MAX_SIZE * 4
    expect(size).toBeLessThan(INLINE_MAX_SIZE)
    expect(chooseStrategy('content/videos/clip.mp4', entry({ uncompressedSize: size, compressionMethod: STORED }))).toEqual({ kind: 'slice' })
    expect(chooseStrategy('content/videos/clip.mp4', entry({ uncompressedSize: size, compressionMethod: DEFLATE }))).toEqual({ kind: 'chunked' })
    expect(chooseStrategy('content/audio/clip.mp3', entry({ uncompressedSize: size, compressionMethod: DEFLATE }))).toEqual({ kind: 'chunked' })
    // The same size in an image is still inline: the browser needs it whole anyway.
    expect(chooseStrategy('content/images/photo.jpg', entry({ uncompressedSize: size, compressionMethod: DEFLATE }))).toEqual({ kind: 'inline' })
    // And media at the bar itself is small.
    expect(chooseStrategy('content/videos/clip.mp4', entry({ uncompressedSize: MEDIA_INLINE_MAX_SIZE, compressionMethod: DEFLATE }))).toEqual({ kind: 'inline' })
  })

  it('slices large stored media, which needs no extraction at all', () => {
    const strategy = chooseStrategy(
      'content/lesson.mp4',
      entry({ uncompressedSize: INLINE_MAX_SIZE + 1, compressionMethod: STORED })
    )
    expect(strategy).toEqual({ kind: 'slice' })
  })

  it('chunks large deflated media, the only case worth a background inflate', () => {
    const strategy = chooseStrategy(
      'content/lesson.mp4',
      entry({ uncompressedSize: INLINE_MAX_SIZE + 1, compressionMethod: DEFLATE })
    )
    expect(strategy).toEqual({ kind: 'chunked' })
  })

  it('treats the threshold itself as small', () => {
    expect(
      chooseStrategy('content/images/photo.png', entry({ uncompressedSize: INLINE_MAX_SIZE }))
    ).toEqual({ kind: 'inline' })
  })

  it('falls back to inline for a method zip.js may still have a codec for', () => {
    const strategy = chooseStrategy(
      'content/lesson.mp4',
      entry({ uncompressedSize: INLINE_MAX_SIZE + 1, compressionMethod: 93 })
    )
    expect(strategy).toEqual({ kind: 'inline' })
  })
})
