import { describe, expect, it } from 'vitest'
import { ContentGenerator, MEDIA, librariesIn, mediaIn, sweepOptions } from '../scripts/lib/sweep-content.mjs'

/**
 * The sweep's way of running @missing-elements/h5p-author's generator: what it fills a required
 * field with so that every content type plays. The generator's own rules are tested in the package.
 */

/** A pack of the libraries a test names: folder -> library.json and semantics.json. */
function pack(libraries: { machineName: string; major?: number; minor?: number; title?: string; semantics: unknown[] }[]) {
  return new Map(
    libraries.map(({ machineName, major = 1, minor = 0, title = machineName, semantics }) => [
      `${machineName}-${major}.${minor}`,
      { folder: `${machineName}-${major}.${minor}`, library: { machineName, majorVersion: major, minorVersion: minor, title, runnable: 1 }, semantics }
    ])
  )
}

const TEXT = { machineName: 'H5P.AdvancedText', minor: 1, title: 'Text', semantics: [{ name: 'text', type: 'text', widget: 'html', label: 'Text' }] }

function generate(semantics: unknown[], written?: unknown, others: Parameters<typeof pack>[0] = []): Record<string, any> {
  const generator = new ContentGenerator(pack([{ machineName: 'H5P.Test', semantics }, ...others]), sweepOptions)
  return generator.generate(generator.find('H5P.Test')!, written)
}

describe('content the sweep generates', () => {
  it('takes every default, and the smallest valid value for a required field without one', () => {
    const params = generate([
      { name: 'title', type: 'text', default: 'Hello' },
      { name: 'body', type: 'text', widget: 'html', label: 'Body text' },
      { name: 'plain', type: 'text', label: 'Plain' },
      { name: 'note', type: 'text', optional: true },
      { name: 'count', type: 'number', min: 2 },
      { name: 'shown', type: 'boolean' },
      { name: 'mode', type: 'select', options: [{ value: 'a' }, { value: 'b' }] },
      { name: 'picture', type: 'image' },
      { name: 'clip', type: 'video' },
      { name: 'extra', type: 'image', optional: true }
    ])
    expect(params).toEqual({
      title: 'Hello',
      body: '<p>Body text</p>',
      plain: 'Plain',
      count: 2,
      shown: false,
      mode: 'a',
      picture: { ...MEDIA.image, copyright: { license: 'U' } },
      clip: [{ path: MEDIA.video.path, mime: MEDIA.video.mime, copyright: { license: 'U' } }]
    })
  })

  it('gives a patterned field the first sample its pattern accepts', () => {
    const params = generate([
      { name: 'color', type: 'text', regexp: { pattern: '^#[0-9a-f]{6}$', modifiers: 'i' } },
      { name: 'date', type: 'text', regexp: { pattern: '^[0-9]{4,}/0*([1-9]|1[0-2])/0*([1-9]|[12][0-9]|3[01])$' } }
    ])
    expect(params).toEqual({ color: '#808080', date: '2026/1/1' })
  })

  it('fills a library field with the first option the pack has, never the content type itself', () => {
    const params = generate(
      [{ name: 'content', type: 'library', options: ['H5P.Test 1.0', 'H5P.Missing 1.0', 'H5P.AdvancedText 1.1'] }],
      undefined,
      [TEXT]
    )
    expect(params).toEqual({
      content: {
        library: 'H5P.AdvancedText 1.1',
        params: { text: '<p>Text</p>' },
        subContentId: '00000000-0000-4000-8000-000000000001',
        metadata: { contentType: 'Text', license: 'U', title: 'Text' }
      }
    })
  })

  it('keeps a key the semantics do not name, which the content check is then to remove', () => {
    expect(generate([{ name: 'title', type: 'text', default: 'x' }], { unknown: 1 }).unknown).toBe(1)
  })
})

describe('what a package carries', () => {
  it('names the sample files and the libraries the parameters use', () => {
    const params = { a: { library: 'H5P.Image 1.1', params: { file: { path: MEDIA.image.path } } }, b: [{ library: 'H5P.Audio 1.5', params: { files: [{ path: MEDIA.audio.path }] } }] }
    expect(mediaIn(params)).toEqual(['image', 'audio'])
    expect([...librariesIn(params)].sort()).toEqual(['H5P.Audio 1.5', 'H5P.Image 1.1'])
  })
})
