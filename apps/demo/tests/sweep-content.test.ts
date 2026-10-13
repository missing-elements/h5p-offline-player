import { describe, expect, it } from 'vitest'
import { ContentGenerator, MEDIA, librariesIn, mediaIn } from '../scripts/lib/sweep-content.mjs'

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
  const libraries = pack([{ machineName: 'H5P.Test', semantics }, ...others])
  const generator = new ContentGenerator(libraries)
  return generator.generate(generator.find('H5P.Test')!, written)
}

describe('content generated from semantics', () => {
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

  it('saves a group of one field as that field, and a group default as the whole value', () => {
    const params = generate([
      { name: 'single', type: 'group', fields: [{ name: 'only', type: 'text', default: 'x' }] },
      { name: 'sub', type: 'group', isSubContent: true, fields: [{ name: 'only', type: 'text', default: 'y' }] },
      { name: 'size', type: 'group', default: { width: 620, height: 310 }, fields: [{ name: 'width', type: 'number' }, { name: 'height', type: 'number' }] }
    ])
    expect(params).toEqual({ single: 'x', sub: { only: 'y' }, size: { width: 620, height: 310 } })
  })

  it('fills an optional group nobody wrote with defaults only, as the editor saves one left closed', () => {
    const params = generate([
      {
        name: 'image',
        type: 'group',
        optional: true,
        fields: [
          { name: 'file', type: 'image' },
          { name: 'alt', type: 'text' },
          { name: 'decorative', type: 'boolean' },
          { name: 'position', type: 'select', default: 'left', options: [{ value: 'left' }] }
        ]
      }
    ])
    expect(params).toEqual({ image: { decorative: false, position: 'left' } })
  })

  it('makes a list as long as its minimum or default number, and leaves an optional one out', () => {
    const params = generate([
      { name: 'answers', type: 'list', min: 2, field: { name: 'answer', type: 'text', default: 'a' } },
      { name: 'cards', type: 'list', defaultNum: 3, field: { name: 'card', type: 'text', default: 'c' } },
      { name: 'one', type: 'list', field: { name: 'item', type: 'text', default: 'i' } },
      { name: 'keywords', type: 'list', optional: true, field: { name: 'keyword', type: 'text' } }
    ])
    expect(params).toEqual({ answers: ['a', 'a'], cards: ['c', 'c', 'c'], one: ['i'] })
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

  it('uses a library field default as written content', () => {
    const params = generate([{ name: 'task', type: 'library', default: { library: 'H5P.AdvancedText 1.0', params: { text: '<p>Given</p>' } }, options: ['H5P.AdvancedText 1.1'] }], undefined, [TEXT])
    expect(params.task).toMatchObject({ library: 'H5P.AdvancedText 1.1', params: { text: '<p>Given</p>' } })
  })
})

describe('hand-written content laid in', () => {
  const QUESTION = [
    { name: 'question', type: 'text', widget: 'html', label: 'Question' },
    {
      name: 'answers',
      type: 'list',
      min: 1,
      field: { name: 'answer', type: 'group', fields: [{ name: 'text', type: 'text', widget: 'html', label: 'Text' }, { name: 'correct', type: 'boolean' }, { name: 'tip', type: 'text', default: '' }] }
    },
    { name: 'behaviour', type: 'group', fields: [{ name: 'random', type: 'boolean', default: true }, { name: 'retry', type: 'boolean', default: true }] }
  ]

  it('keeps what is written, fills in the rest, and keeps a written list as long as it is', () => {
    const params = generate(QUESTION, {
      answers: [{ text: '<div>Right</div>', correct: true }, { text: '<div>Wrong</div>' }],
      behaviour: { random: false }
    })
    expect(params).toEqual({
      question: '<p>Question</p>',
      answers: [
        { text: '<div>Right</div>', correct: true, tip: '' },
        { text: '<div>Wrong</div>', correct: false, tip: '' }
      ],
      behaviour: { random: false, retry: true }
    })
  })

  it('removes a field written as null, and keeps a key the semantics do not name', () => {
    const params = generate(QUESTION, { question: null, unknown: 1 })
    expect(params).not.toHaveProperty('question')
    expect(params.unknown).toBe(1)
  })

  it('fills written sub-content from its own semantics, at the version the pack has', () => {
    const params = generate([{ name: 'content', type: 'library', options: ['H5P.AdvancedText 1.1'] }], { content: { library: 'H5P.AdvancedText 1.0', params: {} } }, [TEXT])
    expect(params.content).toMatchObject({ library: 'H5P.AdvancedText 1.1', params: { text: '<p>Text</p>' } })
    expect(params.content.subContentId).toMatch(/^00000000-0000-4000-8000-/)
  })

  it('keeps sub-content of a library the pack does not have as written', () => {
    const written = { library: 'H5P.Elsewhere 1.0', params: { a: 1 } }
    expect(generate([{ name: 'content', type: 'library', options: [] }], { content: written }).content).toEqual(written)
  })
})

describe('what a package carries', () => {
  it('names the sample files and the libraries the parameters use', () => {
    const params = { a: { library: 'H5P.Image 1.1', params: { file: { path: MEDIA.image.path } } }, b: [{ library: 'H5P.Audio 1.5', params: { files: [{ path: MEDIA.audio.path }] } }] }
    expect(mediaIn(params)).toEqual(['image', 'audio'])
    expect([...librariesIn(params)].sort()).toEqual(['H5P.Audio 1.5', 'H5P.Image 1.1'])
  })
})
