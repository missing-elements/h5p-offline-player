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
  return { params, problems: generator.problems, notes: generator.notes, media: generator.media, unset: generator.unset, moved: generator.moved, shortened: generator.shortened }
}

describe('content generated from semantics, as the sweep runs it', () => {
  it('saves a group of one field as that field, unless it is sub-content, which has an id, and a group default as the whole value', () => {
    const { params } = generate([
      { name: 'single', type: 'group', fields: [{ name: 'only', type: 'text', default: 'x' }] },
      { name: 'sub', type: 'group', isSubContent: true, fields: [{ name: 'only', type: 'text', default: 'y' }] },
      { name: 'size', type: 'group', default: { width: 620, height: 310 }, fields: [{ name: 'width', type: 'number' }, { name: 'height', type: 'number' }] }
    ])
    expect(params).toEqual({ single: 'x', sub: { only: 'y', subContentId: '00000000-0000-4000-8000-000000000001' }, size: { width: 620, height: 310 } })
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

  it('takes a multiple of a fractional step, which the editor\'s `%` misses by a rounding error (#162)', () => {
    const semantics = [{ name: 'ratio', type: 'number', decimals: 2, step: 0.1 }]
    for (const ratio of [0.3, 0.7, 2.3, 1234.5, 50000000.1]) expect(generate(semantics, { ratio }, [], STRICT).problems, String(ratio)).toEqual([])
    // Half a step off, however large: the bound is the arithmetic's error, not a share of the value.
    for (const ratio of [0.35, 50000000.05]) expect(generate(semantics, { ratio }, [], STRICT).problems, String(ratio)).toEqual([{ path: 'params.ratio', message: 'takes steps of 0.1' }])
  })

  it('takes a field named as an object\'s own properties are, toString or constructor, for what it is: not a field (#162)', () => {
    const { problems } = generate([{ name: 'count', type: 'number', default: 1 }], JSON.parse('{ "toString": 1, "constructor": 2, "__proto__": 3 }'), [], STRICT)
    expect(problems.map(({ path }) => path)).toEqual(['params.toString', 'params.constructor', 'params.__proto__'])
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

  it('shows sub-content with the library a field takes, every one where it takes several, and the one written by name (#172)', () => {
    const IMAGE = { machineName: 'H5P.Image', minor: 1, title: 'Image', semantics: [{ name: 'alt', type: 'text' }] }
    const { problems } = generate([
      { name: 'one', type: 'library', optional: true, options: ['H5P.AdvancedText 1.1'] },
      { name: 'any', type: 'library', optional: true, options: ['H5P.AdvancedText 1.1', 'H5P.Image 1.1'] },
      { name: 'named', type: 'library', optional: true, options: ['H5P.AdvancedText 1.1', 'H5P.Image 1.1'] }
    ], { one: 'Hello', any: { text: 'Hello' }, named: 'H5P.Image 1.1' }, [TEXT, IMAGE], STRICT)
    // The first of several read as the one to write, and a scenario's texts came back as questions.
    expect(problems.map(({ path, message }) => `${path}: ${message}`)).toEqual([
      'params.one: expected sub-content, { "library": "H5P.AdvancedText", "params": { … } }',
      'params.any: expected sub-content, { "library": "…", "params": { … } }, of H5P.AdvancedText, H5P.Image',
      'params.named: expected sub-content, { "library": "H5P.Image", "params": { … } }'
    ])
  })

  it('says once what to write for sub-content in the place of the group that holds it, and checks it in the same round (#172)', () => {
    const column = [{
      name: 'content',
      type: 'list',
      field: { name: 'item', type: 'group', fields: [
        { name: 'content', type: 'library', options: ['H5P.AdvancedText 1.1'] },
        { name: 'useSeparator', type: 'select', default: 'auto', options: [{ value: 'auto' }, { value: 'enabled' }] }
      ] }
    }]
    const { params, problems, moved } = generate(column, { content: [
      { library: 'H5P.AdvancedText', params: { text: 'One' }, metadata: { title: 'First' } },
      { library: 'H5P.AdvancedText 1.1', params: { text: '<h1>Two</h1>', size: 2 }, useSeparator: 'enabled', colour: 'red' }
    ] }, [TEXT], STRICT)
    // One problem an item, naming the item and showing it whole: "it goes in the field content"
    // was read as the list of that name. What is wrong inside is named by where the source has it.
    expect(problems.map(({ path, message }) => `${path}: ${message}`)).toEqual([
      'params.content[0]: is sub-content, but here it goes inside an object, in its field content: write params.content[0] as { "content": { "library": "H5P.AdvancedText", "params": { … }, "metadata": { … } } }',
      'params.content[1]: is sub-content, but here it goes inside an object, in its field content: write params.content[1] as { "content": { "library": "H5P.AdvancedText 1.1", "params": { … } }, "useSeparator": … }',
      expect.stringMatching(/^params\.content\[1\]\.params\.text: has <h1>, which this field does not take/),
      'params.content[1].params.size: is not a field here; the fields are text',
      'params.content[1].colour: is not a field here; the fields are content, useSeparator'
    ])
    // Generated where it belongs, so that a check of the content finds what is inside it.
    expect(params.content[0]).toMatchObject({ content: { library: 'H5P.AdvancedText 1.1', params: { text: '<div>One</div>' } }, useSeparator: 'auto' })
    expect(params.content[1].useSeparator).toBe('enabled')
    expect(moved).toEqual([{ from: 'params.content[0]', to: 'params.content[0].content' }, { from: 'params.content[1]', to: 'params.content[1].content' }])

    // Nothing is guessed where `library` is a field of the group that holds no sub-content, where
    // the field that holds it is written too, or where two fields could be meant.
    const plain = generate([{ name: 'item', type: 'group', fields: [{ name: 'library', type: 'text' }, { name: 'content', type: 'library', optional: true, options: ['H5P.AdvancedText 1.1'] }] }], { item: { library: 'The city library' } }, [TEXT], STRICT)
    expect(plain.problems).toEqual([])
    const both = generate(column, { content: [{ library: 'H5P.AdvancedText', content: { library: 'H5P.AdvancedText', params: { text: 'One' } } }] }, [TEXT], STRICT)
    expect(both.problems.map(({ path, message }) => `${path}: ${message}`)).toEqual(['params.content[0].library: is not a field here; the fields are content, useSeparator'])
    const two = generate([{ name: 'item', type: 'group', fields: [
      { name: 'front', type: 'library', optional: true, options: ['H5P.AdvancedText 1.1'] },
      { name: 'back', type: 'library', optional: true, options: ['H5P.AdvancedText 1.1'] }
    ] }], { item: { library: 'H5P.AdvancedText', params: { text: 'One' } } }, [TEXT], STRICT)
    expect(two.problems.map(({ path }) => path)).toEqual(['params.item.library', 'params.item.params'])
    expect(two.moved).toEqual([])
  })

  it('takes the params of the one library a field takes, written without their sub-content, as such, and checks them (#172)', () => {
    const book = [{ name: 'chapters', type: 'list', min: 1, field: { name: 'chapter', type: 'library', options: ['H5P.AdvancedText 1.1'] } }]
    const { params, problems, moved, shortened } = generate(book, { chapters: [{ text: '<h1>One</h1>', title: 'First' }, { text: 'Two', metadata: { title: 'Second' } }] }, [TEXT], {
      ...STRICT,
      metadata: (entry, written) => ({ contentType: entry.library.title, title: written?.title })
    })
    expect(problems.map(({ path, message }) => `${path}: ${message}`)).toEqual([
      'params.chapters[0]: is the params of sub-content, without the sub-content around them: write params.chapters[0] as { "library": "H5P.AdvancedText", "params": { "text": … } }',
      expect.stringMatching(/^params\.chapters\[0\]\.text: has <h1>, which this field does not take/),
      'params.chapters[0].title: is not a field here; the fields are text',
      'params.chapters[1]: is the params of sub-content, without the sub-content around them: write params.chapters[1] as { "library": "H5P.AdvancedText", "params": { "text": … }, "metadata": { … } }'
    ])
    expect(params.chapters[1]).toMatchObject({ library: 'H5P.AdvancedText 1.1', params: { text: '<div>Two</div>' }, metadata: { title: 'Second' } })
    expect(moved).toEqual([{ from: 'params.chapters[0]', to: 'params.chapters[0].params' }, { from: 'params.chapters[1]', to: 'params.chapters[1].params' }])
    expect(shortened).toEqual([])
    // Not where the field takes several libraries, or none of what is written is a field of the one.
    const other = generate(book, { chapters: [{ heading: 'One' }] }, [TEXT], STRICT)
    expect(other.problems).toEqual([{ path: 'params.chapters[0]', message: 'expected sub-content, { "library": "H5P.AdvancedText", "params": { … } }' }])
  })

  it('says where a field written above the group that has it belongs, and checks it there in the same round (#172)', () => {
    const semantics = [
      { name: 'presentation', type: 'group', fields: [
        { name: 'slides', type: 'list', field: { name: 'slide', type: 'group', fields: [{ name: 'title', type: 'text' }, { name: 'keywords', type: 'text', optional: true }] } },
        { name: 'display', type: 'boolean', default: true }
      ] },
      { name: 'behaviour', type: 'group', fields: [
        { name: 'enableRetry', type: 'boolean', default: true },
        { name: 'passPercentage', type: 'number', min: 0, max: 100, default: 100 },
        { name: 'deep', type: 'group', fields: [{ name: 'mode', type: 'select', default: 'a', options: [{ value: 'a' }, { value: 'b' }] }, { name: 'depth', type: 'number', default: 1 }] }
      ] },
      { name: 'solo', type: 'group', optional: true, fields: [{ name: 'inner', type: 'text', optional: true }] },
      { name: 'l10n', type: 'group', common: true, fields: [{ name: 'slides', type: 'text', default: 'Slides' }, { name: 'retry', type: 'text', default: 'Retry' }] }
    ]
    const { params, problems, moved } = generate(semantics, {
      slides: [{ title: 'One' }, { title: 2 }], enableRetry: false, passPercentage: 150, mode: 'c', inner: 'x', retry: 'Again', nowhere: []
    }, [], STRICT)
    expect(problems.map(({ path, message }) => `${path}: ${message}`)).toEqual([
      // A list named as an interface text is too is the list's field: `l10n.slides` takes a text.
      'params.slides: is a field of presentation, not of this level: write params.presentation.slides',
      'params.enableRetry: is a field of behaviour, not of this level: write params.behaviour.enableRetry',
      'params.passPercentage: is a field of behaviour, not of this level: write params.behaviour.passPercentage',
      'params.mode: is a field of behaviour.deep, not of this level: write params.behaviour.deep.mode',
      'params.slides[1].title: expected text, such as "2"',
      'params.passPercentage: is 150; the most it takes is 100',
      'params.mode: "c" is not an option; the options are "a", "b"',
      // A group of one field is written as that field's value, so it is no level to point to.
      'params.inner: is not a field here; the fields are presentation, behaviour, solo, and the interface texts',
      // Nor is an interface text: a text sent to a label of its name would build, and read wrong.
      'params.retry: is not a field here; the fields are presentation, behaviour, solo, and the interface texts',
      'params.nowhere: is not a field here; the fields are presentation, behaviour, solo, and the interface texts'
    ])
    expect(params.presentation.slides).toEqual([{ title: 'One' }, {}])
    expect(params.behaviour).toMatchObject({ enableRetry: false, deep: { depth: 1 } })
    expect(moved.map(({ from, to }) => `${from} > ${to}`)).toEqual([
      'params.slides > params.presentation.slides', 'params.enableRetry > params.behaviour.enableRetry',
      'params.passPercentage > params.behaviour.passPercentage', 'params.mode > params.behaviour.deep.mode'
    ])

    // Left where it is, where something is written in its place already, or two groups have such a field.
    const taken = generate(semantics, { slides: [{ title: 'One' }], presentation: { slides: [{ title: 'Two' }] } }, [], STRICT)
    expect(taken.problems.map(({ path }) => path)).toEqual(['params.slides'])
    expect(taken.moved).toEqual([])
    const twice = generate([
      { name: 'first', type: 'group', fields: [{ name: 'label', type: 'text', default: 'a' }, { name: 'x', type: 'number', default: 0 }] },
      { name: 'second', type: 'group', fields: [{ name: 'label', type: 'text', default: 'b' }, { name: 'y', type: 'number', default: 0 }] }
    ], { label: 'c' }, [], STRICT)
    expect(twice.problems).toEqual([{ path: 'params.label', message: 'is not a field here; the fields are first, second' }])
    // Or where an object has a group's name and writes none of its fields: a `map` written for a
    // picture is not Game Map's `behaviour.map`, and saying so would send the next source the wrong way.
    const namesake = generate(semantics, { presentation: { slides: [{ title: 'One' }] }, deep: { picture: 'x' } }, [], STRICT)
    expect(namesake.problems).toEqual([{ path: 'params.deep', message: 'is not a field here; the fields are presentation, behaviour, solo, and the interface texts' }])
    expect(namesake.moved).toEqual([])
    const written = generate(semantics, { presentation: { slides: [{ title: 'One' }] }, deep: { depth: 2, picture: 'x' } }, [], STRICT)
    expect(written.problems.map(({ path, message }) => `${path}: ${message}`)).toEqual([
      'params.deep: is a field of behaviour, not of this level: write params.behaviour.deep',
      'params.deep.picture: is not a field here; the fields are mode, depth'
    ])
    expect(written.params.behaviour.deep.depth).toBe(2)
  })

  it('names a list it refused an item of, which then holds fewer items than were written (#172)', () => {
    const { params, problems, shortened } = generate([
      { name: 'chapters', type: 'list', min: 2, field: { name: 'chapter', type: 'library', options: ['H5P.AdvancedText 1.1', 'H5P.Image 1.1'] } },
      { name: 'tags', type: 'list', optional: true, field: { name: 'tag', type: 'text', default: 'none' } }
    ], { chapters: [{ title: 'One' }, { library: 'H5P.AdvancedText', params: { text: 'Two' } }, 'Three'], tags: ['a', null] }, [TEXT], STRICT)
    expect(problems.map(({ path }) => path)).toEqual(['params.chapters[0]', 'params.chapters[2]'])
    expect(params.chapters).toHaveLength(1)
    // An item written as null and left out, as one with a default may be, is no refusal.
    expect(params.tags).toEqual(['a'])
    expect(shortened).toEqual(['params.chapters'])
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

describe('content as H5P saves it', () => {
  const SAVED: GeneratorOptions = { saved: true, id: (count) => `00000000-0000-4000-8000-${count.toString(16).padStart(12, '0')}` }
  const [FIRST, SECOND] = ['6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b', '0b9a8c7d-6e5f-4a3b-9c2d-1e0f2a3b4c5d']
  const IMAGE = { machineName: 'H5P.Image', semantics: [{ name: 'file', type: 'image' }, { name: 'alt', type: 'text' }] }
  const holding = (library: string) => [{ name: 'content', type: 'library', options: [library] }]

  it('takes files, sub-content metadata and each part\'s id as saved', () => {
    const saved = {
      content: {
        library: 'H5P.Image 1.0',
        params: { file: { path: 'images/river.png', mime: 'image/png', width: 480, height: 270, copyright: { license: 'CC BY', author: 'Ann' } }, alt: 'A river' },
        subContentId: FIRST,
        metadata: { contentType: 'Image', license: 'CC BY', title: 'River', authors: [{ name: 'Ann', role: 'Author' }], extraTitle: 'River' }
      }
    }
    const { params, problems, notes, media } = generate(holding('H5P.Image 1.0'), saved, [IMAGE], SAVED)
    expect(problems).toEqual([])
    expect(notes).toEqual([])
    expect(params).toEqual(saved)
    expect(media.map(({ value }) => value.path)).toEqual(['images/river.png'])
  })

  it('refuses what H5P would not keep of a file, of sub-content and of its metadata', () => {
    const { problems } = generate(holding('H5P.Image 1.0'), {
      content: {
        library: 'H5P.Image 1.0',
        params: { file: { path: 'images/river.png', mime: 'image/png', width: '480', aspectRatio: '16:9' }, alt: 'A river' },
        subContentId: FIRST,
        metadata: { license: 'MIT', authors: [{ name: 'Ann', role: 'Writer' }] },
        userDatas: {}
      }
    }, [IMAGE], SAVED)
    expect(problems.map(({ path }) => path)).toEqual([
      'params.content.userDatas', 'params.content.metadata.license', 'params.content.metadata.authors[0].role',
      'params.content.params.file.aspectRatio', 'params.content.params.file.width'
    ])
    expect(problems[3].message).toBe('is not part of a file as H5P stores it; it keeps path, mime, copyright, width, height, originalImage')
  })

  it('gives a part without an id, with one H5P would not keep, or with another part\'s, a new one', () => {
    const text = (subContentId?: string) => ({ library: 'H5P.AdvancedText 1.1', params: { text: '<p>Hi</p>' }, ...(subContentId ? { subContentId } : {}), metadata: { contentType: 'Text', license: 'U', title: 'Text' } })
    const semantics = [{ name: 'items', type: 'list', field: { name: 'item', type: 'library', options: ['H5P.AdvancedText 1.1'] } }]
    const { params, notes } = generate(semantics, { items: [text(FIRST), text(FIRST), text('not-an-id'), text()] }, [TEXT], SAVED)
    expect(params.items.map(({ subContentId }: { subContentId: string }) => subContentId)).toEqual([
      FIRST, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'
    ])
    expect(notes).toEqual([
      { path: 'params.items[1].subContentId', message: 'is another part\'s id too, so this part has a new one' },
      { path: 'params.items[2].subContentId', message: 'is not an id H5P keeps, so the part has a new one' }
    ])
  })

  it('notes and keeps a field only another minor of its library names, and refuses one at the same minor', () => {
    // Question Set 1.21's step moved 1.20's background image into `override`.
    const generator = new ContentGenerator(pack([{ machineName: 'H5P.Test', minor: 21, semantics: [{ name: 'override', type: 'group', optional: true, fields: [{ name: 'backgroundImage', type: 'image', optional: true }] }] }]), SAVED)
    const saved = { backgroundImage: { path: 'images/sky.png', mime: 'image/png' } }
    expect(generator.generate(generator.find('H5P.Test')!, saved, 'params', 20)).toMatchObject(saved)
    expect(generator.problems).toEqual([])
    expect(generator.notes).toEqual([{ path: 'params.backgroundImage', message: 'is not a field of H5P.Test 1.21; the content names 1.20, which the player upgrades to 1.21 as it plays, and that may move it' }])
    const same = new ContentGenerator(generator.pack, SAVED)
    expect(same.generate(same.find('H5P.Test')!, saved, 'params', 21)).not.toHaveProperty('backgroundImage')
    expect(same.problems).toEqual([{ path: 'params.backgroundImage', message: 'is not a field here; the fields are override' }])
  })

  it('keeps what a group\'s own default carries beyond its fields', () => {
    // Drag and Drop's task size, whose default names the field its widget sizes it by.
    const semantics = [{ name: 'size', type: 'group', widget: 'dimensions', default: { width: 620, height: 310, field: 'background' }, fields: [{ name: 'width', type: 'number' }, { name: 'height', type: 'number' }] }]
    const { params, problems } = generate(semantics, { size: { width: 800, height: 400, field: 'background' } }, [], SAVED)
    expect(problems).toEqual([])
    expect(params.size).toEqual({ width: 800, height: 400, field: 'background' })
  })

  it('keeps a markup field\'s text as stored, without wrapping it again', () => {
    const { params, problems } = generate([{ name: 'text', type: 'text', widget: 'html', tags: ['strong'] }], { text: 'Rivers &amp; lakes, 1 < 2' }, [], SAVED)
    expect(problems).toEqual([])
    expect(params.text).toBe('Rivers &amp; lakes, 1 &lt; 2')
  })

  it('asks nothing of what the editor saves for an author who never touched it', () => {
    // Interactive Video's shapes: an adaptivity nobody set, a goto nobody chose, and the subtitle
    // track its editor starts an optional list with.
    const semantics = [
      { name: 'adaptivity', type: 'group', optional: true, fields: [
        { name: 'correct', type: 'group', fields: [{ name: 'seekTo', type: 'number' }, { name: 'allowOptOut', type: 'boolean' }, { name: 'message', type: 'text', widget: 'html', tags: ['strong'] }] },
        { name: 'requireCompletion', type: 'boolean' }
      ] },
      { name: 'goto', type: 'group', fields: [{ name: 'type', type: 'select', optional: true, options: [{ value: 'timecode' }, { value: 'url' }] }, { name: 'visualize', type: 'boolean' }] },
      { name: 'tracks', type: 'list', optional: true, defaultNum: 1, field: { name: 'track', type: 'group', fields: [{ name: 'label', type: 'text', default: 'Subtitles' }, { name: 'track', type: 'file' }] } }
    ]
    const saved = { adaptivity: { correct: { allowOptOut: false, message: '' }, requireCompletion: true }, goto: { type: '', visualize: false }, tracks: [{ label: 'Subtitles' }] }
    const untouched = generate(semantics, saved, [], SAVED)
    expect(untouched.problems).toEqual([])
    expect(untouched.params).toEqual(saved)
    // Once an author writes what the group asks for, all of it is asked for.
    const started = generate(semantics, { ...saved, adaptivity: { correct: { seekTo: 10, allowOptOut: false, message: '' } } }, [], SAVED)
    expect(started.problems.map(({ path }) => path)).toEqual(['params.adaptivity.correct.message'])
  })

  it('asks nothing of content a field gives as its default, as the editor started it', () => {
    // Interactive Video's summary task, with the statement its editor starts with.
    const SUMMARY = {
      machineName: 'H5P.Summary',
      semantics: [
        { name: 'intro', type: 'text', default: 'Choose the correct statement.' },
        { name: 'summaries', type: 'list', min: 1, field: { name: 'statements', type: 'group', isSubContent: true, fields: [{ name: 'summary', type: 'list', min: 2, field: { name: 'text', type: 'text', widget: 'html', tags: [] } }, { name: 'tip', type: 'text', optional: true }] } }
      ]
    }
    const semantics = [{ name: 'task', type: 'library', default: { library: 'H5P.Summary 1.0', params: {} }, options: ['H5P.Summary 1.0'] }]
    const saved = { task: { library: 'H5P.Summary 1.0', params: { intro: 'Choose the correct statement.', summaries: [{ subContentId: SECOND, tip: '' }] }, subContentId: FIRST, metadata: { contentType: 'Summary', license: 'U', title: 'Untitled Summary' } } }
    const { params, problems, notes } = generate(semantics, saved, [SUMMARY], SAVED)
    expect([problems, notes]).toEqual([[], []])
    expect(params).toEqual(saved)
  })
})
