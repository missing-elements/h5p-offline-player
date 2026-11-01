import { describe, expect, it } from 'vitest'
import { ContentGenerator, type GeneratorOptions } from '../lib/author.mjs'

/** A pack of the libraries a test names: folder -> library.json and semantics.json. */
function pack(libraries: { machineName: string; major?: number; minor?: number; title?: string; semantics: unknown[] }[]) {
  return new Map(
    libraries.map(({ machineName, major = 1, minor = 0, title = machineName, semantics }) => [
      `${machineName}-${major}.${minor}`,
      { folder: `${machineName}-${major}.${minor}`, library: { machineName, majorVersion: major, minorVersion: minor, title, runnable: 1 }, semantics }
    ])
  )
}

const TEXT = { machineName: 'H5P.AdvancedText', minor: 1, title: 'Text', semantics: [{ name: 'text', type: 'text', widget: 'html', tags: ['strong', 'em'], label: 'Text' }] }

/** The sweep's way: what is written taken as it is, ids numbered. Its fill is the sweep's own (apps/demo). */
const LENIENT: GeneratorOptions = { lenient: true, id: (count) => `00000000-0000-4000-8000-${count.toString(16).padStart(12, '0')}` }

function generate(semantics: unknown[], written?: unknown, others: Parameters<typeof pack>[0] = [], options: GeneratorOptions = LENIENT) {
  const generator = new ContentGenerator(pack([{ machineName: 'H5P.Test', semantics }, ...others]), options)
  const params: Record<string, any> = generator.generate(generator.find('H5P.Test')!, written)
  return { params, problems: generator.problems, notes: generator.notes, media: generator.media, unset: generator.unset }
}

describe('content generated from semantics, as the sweep runs it', () => {
  it('saves a group of one field as that field, and a group default as the whole value', () => {
    const { params } = generate([
      { name: 'single', type: 'group', fields: [{ name: 'only', type: 'text', default: 'x' }] },
      { name: 'sub', type: 'group', isSubContent: true, fields: [{ name: 'only', type: 'text', default: 'y' }] },
      { name: 'size', type: 'group', default: { width: 620, height: 310 }, fields: [{ name: 'width', type: 'number' }, { name: 'height', type: 'number' }] }
    ])
    expect(params).toEqual({ single: 'x', sub: { only: 'y' }, size: { width: 620, height: 310 } })
  })

  it('fills an optional group nobody wrote with defaults only, as the editor saves one left closed', () => {
    const { params } = generate([
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
    const { params } = generate([
      { name: 'answers', type: 'list', min: 2, field: { name: 'answer', type: 'text', default: 'a' } },
      { name: 'cards', type: 'list', defaultNum: 3, field: { name: 'card', type: 'text', default: 'c' } },
      { name: 'one', type: 'list', field: { name: 'item', type: 'text', default: 'i' } },
      { name: 'keywords', type: 'list', optional: true, field: { name: 'keyword', type: 'text' } }
    ])
    expect(params).toEqual({ answers: ['a', 'a'], cards: ['c', 'c', 'c'], one: ['i'] })
  })

  it('uses a library field default as written content', () => {
    const { params } = generate([{ name: 'task', type: 'library', default: { library: 'H5P.AdvancedText 1.0', params: { text: '<p>Given</p>' } }, options: ['H5P.AdvancedText 1.1'] }], undefined, [TEXT])
    expect(params.task).toMatchObject({ library: 'H5P.AdvancedText 1.1', params: { text: '<p>Given</p>' } })
  })

  const QUESTION = [
    { name: 'question', type: 'text', widget: 'html', tags: ['strong'], label: 'Question', default: '<p>Question</p>' },
    {
      name: 'answers',
      type: 'list',
      min: 1,
      field: { name: 'answer', type: 'group', fields: [{ name: 'text', type: 'text', widget: 'html', tags: ['strong'], label: 'Text' }, { name: 'correct', type: 'boolean' }, { name: 'tip', type: 'text', default: '' }] }
    },
    { name: 'behaviour', type: 'group', fields: [{ name: 'random', type: 'boolean', default: true }, { name: 'retry', type: 'boolean', default: true }] }
  ]

  it('keeps what is written, fills in the rest, and keeps a written list as long as it is', () => {
    const { params } = generate(QUESTION, {
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
    const { params } = generate(QUESTION, { question: null, unknown: 1 })
    expect(params).not.toHaveProperty('question')
    expect(params.unknown).toBe(1)
  })

  it('fills written sub-content from its own semantics, at the version the pack has', () => {
    const { params } = generate([{ name: 'content', type: 'library', options: ['H5P.AdvancedText 1.1'] }], { content: { library: 'H5P.AdvancedText 1.0', params: { text: '<p>x</p>' } } }, [TEXT])
    expect(params.content).toMatchObject({ library: 'H5P.AdvancedText 1.1', params: { text: '<p>x</p>' }, metadata: { contentType: 'Text', license: 'U', title: 'Text' } })
    expect(params.content.subContentId).toMatch(/^00000000-0000-4000-8000-/)
  })

  it('keeps sub-content of a library the pack does not have as written', () => {
    const written = { library: 'H5P.Elsewhere 1.0', params: { a: 1 } }
    expect(generate([{ name: 'content', type: 'library', options: [] }], { content: written }).params.content).toEqual(written)
  })

  it('asks its fill for a required field without a value or default', () => {
    const { params } = generate([{ name: 'title', type: 'text' }, { name: 'count', type: 'number', min: 3 }], undefined, [], {
      ...LENIENT,
      fill: (field) => (field.type === 'text' ? 'filled' : field.min)
    })
    expect(params).toEqual({ title: 'filled', count: 3 })
  })
})

describe('content authored from semantics', () => {
  const STRICT: GeneratorOptions = { id: (count) => `id-${count}` }

  it('names every required field nobody wrote, by its path', () => {
    const { problems } = generate([
      { name: 'title', type: 'text' },
      { name: 'mode', type: 'select', options: [{ value: 'a' }] },
      { name: 'picture', type: 'image' },
      { name: 'group', type: 'group', fields: [{ name: 'inner', type: 'number' }, { name: 'other', type: 'boolean' }] },
      { name: 'note', type: 'text', optional: true },
      { name: 'shown', type: 'boolean' }
    ], {}, [], STRICT)
    expect(problems.map(({ path }) => path)).toEqual(['params.title', 'params.mode', 'params.picture', 'params.group.inner'])
    expect(problems[1].message).toContain('one of "a"')
  })

  it('refuses a field the semantics do not name, a wrong type, an unknown option and a list of the wrong size', () => {
    const { problems } = generate([
      { name: 'count', type: 'number', min: 1, max: 5 },
      { name: 'mode', type: 'select', default: 'a', options: [{ value: 'a' }, { value: 'b' }] },
      { name: 'flag', type: 'boolean' },
      { name: 'items', type: 'list', min: 2, max: 3, field: { name: 'item', type: 'text' } },
      { name: 'title', type: 'text', maxLength: 5 }
    ], { count: 9, mode: 'c', flag: 'yes', items: ['one'], title: 'too long', typo: 1 }, [], STRICT)
    expect(problems.map(({ path, message }) => `${path}: ${message}`)).toEqual([
      'params.count: is 9; the most it takes is 5',
      'params.mode: "c" is not an option; the options are "a", "b"',
      'params.flag: expected true or false',
      'params.items: has 1 item; it takes at least 2',
      'params.title: is 8 characters as stored; it takes at most 5',
      'params.typo: is not a field here; the fields are count, mode, flag, items, title'
    ])
  })

  it('takes whole numbers where the editor shows its number field, and decimals where a widget sets them', () => {
    const { problems } = generate([
      { name: 'count', type: 'number' },
      { name: 'ratio', type: 'number', decimals: 1 },
      { name: 'position', type: 'group', widget: 'coordinates', fields: [{ name: 'x', type: 'number' }, { name: 'y', type: 'number' }] },
      // A list's item is the widget's too, numbers and lists in it alike.
      { name: 'path', type: 'group', widget: 'polyline', fields: [{ name: 'points', type: 'list', field: { name: 'point', type: 'number' } }, { name: 'rows', type: 'list', field: { name: 'row', type: 'list', field: { name: 'cell', type: 'number' } } }] }
    ], { count: 1.5, ratio: 0.25, position: { x: 12.5, y: 40 }, path: { points: [0.5, 1.25] } }, [], STRICT)
    expect(problems.map(({ path }) => path)).toEqual(['params.count', 'params.ratio'])
  })

  it('counts a number\'s steps from 0, as the editor\'s check does', () => {
    const semantics = [{ name: 'size', type: 'number', min: 1, step: 2 }]
    expect(generate(semantics, { size: 4 }, [], STRICT).problems).toEqual([])
    expect(generate(semantics, { size: 3 }, [], STRICT).problems).toEqual([{ path: 'params.size', message: 'takes steps of 2' }])
  })

  it('stores plain text escaped and markup as the editor writes it, and refuses a tag the field does not take', () => {
    const { params, problems, notes } = generate([
      { name: 'title', type: 'text' },
      { name: 'body', type: 'text', widget: 'html', tags: ['strong'], enterMode: 'p' },
      { name: 'answer', type: 'text', widget: 'html', tags: ['em'] },
      { name: 'bad', type: 'text', widget: 'html', tags: ['em'] }
    ], { title: 'Tom & Jerry <b>', body: 'One\n\nTwo & three', answer: 'Plain', bad: '<p>A <script>x</script></p>' }, [], STRICT)
    expect(params.title).toBe('Tom &amp; Jerry &lt;b&gt;')
    expect(params.body).toBe('<p>One</p><p>Two &amp; three</p>')
    expect(params.answer).toBe('<div>Plain</div>')
    expect(problems).toEqual([{ path: 'params.bad', message: expect.stringContaining('has <script>, which this field does not take') }])
    expect(notes).toEqual([{ path: 'params.title', message: expect.stringContaining('shown as written') }])
  })

  it('takes a required field holding only tags as empty, unless one is a picture, and names a pattern by its description\'s text', () => {
    const { problems } = generate([
      { name: 'empty', type: 'text', widget: 'html', tags: ['strong'] },
      { name: 'picture', type: 'text', widget: 'html', tags: ['img'] },
      { name: 'code', type: 'text', regexp: { pattern: '^[A-Z]{3}$' }, description: 'Three <strong>capital</strong> letters' }
    ], { empty: '<p><strong> </strong></p>', picture: '<p><img src="https://example.org/a.png"></p>', code: 'abc' }, [], STRICT)
    expect(problems.map(({ path, message }) => `${path}: ${message}`)).toEqual([
      'params.empty: is required and is empty',
      'params.code: "abc" is not in the form this field takes (Three capital letters)'
    ])
  })

  it('asks for a required list that needs writing, and fills one that only has defaults', () => {
    const { params, problems } = generate([
      { name: 'answers', type: 'list', min: 2, field: { name: 'answer', type: 'group', fields: [{ name: 'text', type: 'text' }, { name: 'correct', type: 'boolean' }] } },
      { name: 'ranges', type: 'list', field: { name: 'range', type: 'group', fields: [{ name: 'from', type: 'number', default: 0 }, { name: 'to', type: 'number', default: 100 }] } }
    ], {}, [], STRICT)
    expect(problems).toEqual([{ path: 'params.answers', message: 'is required: write at least 2 items' }])
    expect(params.ranges).toEqual([{ from: 0, to: 100 }])
  })

  it('starts a list a widget of the content type draws empty, as that widget does', () => {
    const { params, problems } = generate([
      { name: 'assets', type: 'group', widget: 'custom', fields: [{ name: 'items', type: 'list', field: { name: 'item', type: 'group', fields: [{ name: 'text', type: 'text' }, { name: 'flag', type: 'boolean' }] } }, { name: 'flag', type: 'boolean' }] }
    ], {}, [], STRICT)
    expect(problems).toEqual([])
    expect(params.assets).toEqual({ items: [], flag: false })
  })

  it('does not ask for a field the editor hides under its showWhen rule', () => {
    const semantics = [
      { name: 'kind', type: 'select', default: 'icon', options: [{ value: 'icon' }, { value: 'image' }] },
      { name: 'icon', type: 'select', options: [{ value: 'plus' }], showWhen: { rules: [{ field: 'kind', equals: ['icon'] }] } },
      { name: 'picture', type: 'image', showWhen: { rules: [{ field: 'kind', equals: ['image'] }] } }
    ]
    expect(generate(semantics, {}, [], STRICT).problems.map(({ path }) => path)).toEqual(['params.icon'])
    expect(generate(semantics, { kind: 'image' }, [], STRICT).problems.map(({ path }) => path)).toEqual(['params.picture'])
  })

  it('climbs a showWhen path as the editor does, a list and a group of one field each a level', () => {
    // Advent Calendar's shape: a door's cover shows when the calendar's mode, outside the list,
    // is manual.
    const semantics = [
      { name: 'mode', type: 'select', default: 'automatic', options: [{ value: 'automatic' }, { value: 'manual' }] },
      { name: 'doors', type: 'list', field: { name: 'door', type: 'group', fields: [
        { name: 'label', type: 'text', default: 'Door' },
        { name: 'cover', type: 'image', showWhen: { rules: [{ field: '../../mode', equals: 'manual' }] } }
      ] } },
      { name: 'wrapped', type: 'group', fields: [{ name: 'picture', type: 'image', showWhen: { rules: [{ field: '../mode', equals: 'manual' }] } }] }
    ]
    expect(generate(semantics, { doors: [{}] }, [], STRICT).problems).toEqual([])
    expect(generate(semantics, { mode: 'manual', doors: [{}] }, [], STRICT).problems.map(({ path }) => path)).toEqual(['params.doors[0].cover', 'params.wrapped'])
  })

  it('takes sub-content by machine name, only of a library the field takes, and its title alone as metadata', () => {
    const semantics = [{ name: 'content', type: 'library', options: ['H5P.AdvancedText 1.1'] }]
    const ok = generate(semantics, { content: { library: 'H5P.AdvancedText', params: { text: 'Hello' }, metadata: { title: 'Intro' } } }, [TEXT], {
      ...STRICT,
      metadata: (entry, written) => ({ contentType: entry.library.title, title: written?.title })
    })
    expect(ok.problems).toEqual([])
    expect(ok.params.content).toEqual({ library: 'H5P.AdvancedText 1.1', params: { text: '<div>Hello</div>' }, subContentId: 'id-1', metadata: { contentType: 'Text', title: 'Intro' } })
    const wrong = generate(semantics, { content: { library: 'H5P.Image', params: {}, subContentId: 'x', metadata: { license: 'C' } } }, [TEXT], STRICT)
    expect(wrong.problems).toEqual([{ path: 'params.content.library', message: 'H5P.Image is not one this field takes; it takes H5P.AdvancedText' }])
  })

  it('leaves a library default an author never opened as the editor leaves it, asking nothing', () => {
    const { params, problems } = generate([{ name: 'task', type: 'library', default: { library: 'H5P.AdvancedText 1.1', params: {} }, options: ['H5P.AdvancedText 1.1'] }], {}, [TEXT], STRICT)
    expect(problems).toEqual([])
    expect(params.task).toMatchObject({ library: 'H5P.AdvancedText 1.1', params: {} })
  })

  it('collects the files written, and leaves a hidden field for the layout to set', () => {
    const { params, media, unset, problems } = generate([
      { name: 'picture', type: 'image' },
      { name: 'clips', type: 'video' },
      { name: 'x', type: 'number', widget: 'none' }
    ], { picture: { path: 'a.png', copyright: { license: 'CC BY' } }, clips: { path: 'b.mp4' } }, [], STRICT)
    expect(problems).toEqual([])
    expect(media.map(({ path, value }) => [path, value.path])).toEqual([['params.picture', 'a.png'], ['params.clips', 'b.mp4']])
    expect(params.clips).toHaveLength(1)
    expect(unset.map(({ path }) => path)).toEqual(['params.x'])
  })
})
