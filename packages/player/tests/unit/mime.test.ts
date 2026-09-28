import { describe, expect, it } from 'vitest'
import { contentTypeOf, extensionOf, isTextEntry } from '../../src/shared/mime'

describe('contentTypeOf', () => {
  it('types a stylesheet, which browsers ignore without text/css', () => {
    expect(contentTypeOf('H5P.Blanks-1.14/blanks.css')).toBe('text/css; charset=utf-8')
  })

  it('types media, which Safari refuses to play as octet-stream', () => {
    expect(contentTypeOf('content/videos/lesson.mp4')).toBe('video/mp4')
    expect(contentTypeOf('content/audio/track.mp3')).toBe('audio/mpeg')
  })

  it('falls back to octet-stream for an unknown extension', () => {
    expect(contentTypeOf('content/data.unknown')).toBe('application/octet-stream')
    expect(contentTypeOf('content/no-extension')).toBe('application/octet-stream')
  })

  it('ignores case and directory dots', () => {
    expect(contentTypeOf('H5P.Blanks-1.14/styles/Main.CSS')).toBe('text/css; charset=utf-8')
  })

  it('does not treat a dotfile as an extension', () => {
    expect(extensionOf('content/.gitkeep')).toBe('')
  })
})

describe('isTextEntry', () => {
  it('marks what the runtime has to parse whole', () => {
    expect(isTextEntry('h5p.json')).toBe(true)
    expect(isTextEntry('lib/script.js')).toBe(true)
    expect(isTextEntry('lib/style.css')).toBe(true)
  })

  it('leaves media to the size-based strategies', () => {
    expect(isTextEntry('content/video.mp4')).toBe(false)
  })
})
