import { describe, expect, it } from 'vitest'
import {
  checkContent,
  checkContentMetadata,
  decodeEntities,
  escapeHtml,
  filterXss,
  librariesIn,
  type SemanticField,
  type SemanticsTable
} from '../src/content-check'

const UUID = '4f1b0c2e-8a7d-4e3b-9c1a-0d2e3f4a5b6c'

describe('escapeHtml, as PHP htmlspecialchars with ENT_QUOTES and no double encoding', () => {
  it('writes the five characters as references', () => {
    expect(escapeHtml(`Tom & "Jerry" <x> 'y'`)).toBe('Tom &amp; &quot;Jerry&quot; &lt;x&gt; &#039;y&#039;')
  })

  it('keeps a reference HTML 4.01 has, and writes any other ampersand as one', () => {
    expect(escapeHtml('&nbsp; &#160; &#x1F600; &amp;')).toBe('&nbsp; &#160; &#x1F600; &amp;')
    // `apos` and `colon` are HTML5's, not HTML 4.01's: PHP encodes them, and so a browser cannot
    // decode `javascript&colon;` into a scheme.
    expect(escapeHtml('&apos; &colon; &nbsp &#x110000;')).toBe('&amp;apos; &amp;colon; &amp;nbsp &amp;#x110000;')
  })

  it('is idempotent, so content a platform already filtered comes through unchanged', () => {
    const once = escapeHtml(`a & b < "c" 'd' &amp; &#039;`)
    expect(escapeHtml(once)).toBe(once)
  })

  it('gives nothing for text that is not valid UTF-16, as PHP for invalid UTF-8', () => {
    expect(escapeHtml('a\uD800b')).toBe('')
    expect(escapeHtml('😀')).toBe('😀')
  })

  it('decodes as html_entity_decode does: HTML 4.01 names and numbers, each with its semicolon', () => {
    expect(decodeEntities('&lt;&#106;&#x61;&quot;&eacute;')).toBe('<ja"é')
    expect(decodeEntities('&#106 &colon; &apos; &#0;')).toBe('&#106 &colon; &apos; &#0;')
  })
})

describe('filterXss, Drupal 7 filter_xss as h5p-php-library carries it', () => {
  const tags = ['div', 'span', 'p', 'br', 'a', 'strong', 'em']
  const filter = (html: string, styles: RegExp[] | false = false) => filterXss(html, tags, styles)

  it('removes tags it does not allow and keeps their text', () => {
    expect(filter('<p>a</p><script>alert(1)</script><img src=x onerror=alert(1)>')).toBe('<p>a</p>alert(1)')
    expect(filter('<scr<script>ipt>x')).toBe('ipt&gt;x')
    expect(filter('<IMG SRC="x">')).toBe('')
  })

  it('removes every event handler, quoted or not', () => {
    expect(filter('<p onclick="x()" class="k">a</p>')).toBe('<p class="k">a</p>')
    expect(filter('<p onmouseover=alert(1)>a</p>')).toBe('<p>a</p>')
    expect(filter("<a OnFocus='x()' href=\"http://e.org\">a</a>")).toBe('<a href="http://e.org">a</a>')
  })

  it('strips a scheme off the list from a URL, however it is written', () => {
    expect(filter('<a href="javascript:alert(1)">x</a>')).toBe('<a href="alert(1)">x</a>')
    expect(filter('<a href="jav&#x61;script:alert(1)">x</a>')).toBe('<a href="alert(1)">x</a>')
    expect(filter('<a href="&#106;&#97;vascript&#58;alert(1)">x</a>')).toBe('<a href="alert(1)">x</a>')
    expect(filter('<a href=" javascript:alert(1)">x</a>')).toBe('<a href="alert(1)">x</a>')
    expect(filter('<a href="java\tscript:alert(1)">x</a>')).toBe('<a href="alert(1)">x</a>')
    expect(filter('<a href="data:text/html,x">x</a>')).toBe('<a href="text/html,x">x</a>')
    expect(filter('<a href="javascript:javascript:x">x</a>')).toBe('<a href="x">x</a>')
    // A reference HTML 4.01 does not know stays text: the browser sees "&colon;", not a colon.
    expect(filter('<a href="javascript&colon;alert(1)">x</a>')).toBe('<a href="javascript&amp;colon;alert(1)">x</a>')
    expect(filter('<a href="https://e.org/a?b=c:d#e:f">x</a>')).toBe('<a href="https://e.org/a?b=c:d#e:f">x</a>')
    expect(filter('<a href="mailto:a@e.org">x</a>')).toBe('<a href="mailto:a@e.org">x</a>')
  })

  it('writes every attribute anew, escaped, and drops what is malformed', () => {
    expect(filter(`<a title='it"s' href=http://e.org>x</a>`)).toBe(`<a title='it&quot;s' href="http://e.org">x</a>`)
    expect(filter('<a =x href="http://e.org">x</a>')).toBe('<a href="http://e.org">x</a>')
    expect(filter('<a title"x" href="http://e.org">x</a>')).toBe('<a href="http://e.org">x</a>')
    expect(filter('<a href="unterminated>x</a>')).toBe('<a>x</a>')
    expect(filter('<p hidden>a</p><br/>')).toBe('<p hidden>a</p><br />')
  })

  it('keeps only the styles a pattern allows, and only on the tags that may carry them', () => {
    const styles = [/^color: *(#[a-f0-9]{3}[a-f0-9]{3}?) *;?$/i, /^text-align: *(center|left|right);?$/i]
    expect(filter('<p style="color: #ff0000; position: fixed; text-align: center">a</p>', styles)).toBe(
      '<p style="color: #ff0000;text-align: center;">a</p>'
    )
    expect(filter('<strong style="color: #ff0000">a</strong>', styles)).toBe('<strong>a</strong>')
    expect(filter('<p style="color: #ff0000">a</p>')).toBe('<p>a</p>')
    expect(filter("<p style='color: #ff0000'>a</p>", styles)).toBe('<p>a</p>')
  })

  it('removes comments, defuses lone angle brackets and keeps only well-formed references', () => {
    expect(filter('a<!-- <script>x</script> -->b')).toBe('ab')
    expect(filter('1 < 2 > 0')).toBe('1 &lt; 2 &gt; 0')
    expect(filter('&amp; &#65; &foo; & x &#x41; &{alert(1)};')).toBe('&amp; &#65; &foo; &amp; x &#x41; ')
    expect(filter('a\0b')).toBe('ab')
    expect(filter('a\uDC00')).toBe('')
  })
})

/** A content type's semantics, with one field of every kind the check knows. */
const QUIZ: SemanticField[] = [
  { name: 'intro', type: 'text', widget: 'html', tags: ['strong', 'a'], font: { color: true } } as SemanticField,
  { name: 'title', type: 'text', maxLength: 5 },
  { name: 'code', type: 'text', regexp: { pattern: '^[a-z]+$' } },
  { name: 'score', type: 'number', min: 0, max: 10, step: 2, decimals: 1 },
  { name: 'ratio', type: 'number', decimals: 2 },
  { name: 'enabled', type: 'boolean' },
  { name: 'mode', type: 'select', options: [{ value: 'easy' }, { value: 'hard' }] },
  { name: 'free', type: 'select', optional: true, options: [{ value: 'a' }] },
  { name: 'many', type: 'select', multiple: true, options: [{ value: 'a' }, { value: 'b' }] },
  { name: 'words', type: 'list', max: 2, field: { name: 'word', type: 'text' } },
  { name: 'wrapped', type: 'group', fields: [{ name: 'only', type: 'text' }] },
  {
    name: 'behaviour',
    type: 'group',
    optional: true,
    fields: [
      { name: 'code', type: 'text', regexp: { pattern: '^[a-z]+$' } },
      { name: 'retry', type: 'boolean' }
    ]
  },
  { name: 'question', type: 'library', options: ['H5P.Choice 1.16', 'H5P.Text 1.1'] },
  { name: 'image', type: 'image' },
  { name: 'video', type: 'video', extraAttributes: ['metadata'] },
  { name: 'audio', type: 'audio' },
  { name: 'odd', type: 'wysiwyg' }
]

const CHOICE: SemanticField[] = [
  { name: 'question', type: 'text', tags: ['em'] },
  { name: 'answers', type: 'list', field: { name: 'answer', type: 'text' } }
]

const table = (entries: Record<string, SemanticField[] | null>): SemanticsTable => new Map(Object.entries(entries))
const SEMANTICS = table({ 'H5P.Quiz 1.4': QUIZ, 'H5P.Choice 1.17': CHOICE, 'H5P.Text 1.1': null })

const check = (params: Record<string, unknown>) => checkContent('H5P.Quiz 1.4', params, SEMANTICS)

describe('checkContent, H5PContentValidator against a library\'s semantics', () => {
  it('filters formatted text to its tags and escapes plain text', () => {
    const { params } = check({
      intro: '<p style="color: #00ff00">Hi <strong>you</strong><script>x()</script><em>no</em></p>',
      words: ['<b>bold</b>', `it's`]
    })
    expect(params.intro).toBe('<p style="color: #00ff00;">Hi <strong>you</strong>x()no</p>')
    expect(params.words).toEqual(['&lt;b&gt;bold&lt;/b&gt;', 'it&#039;s'])
  })

  it('removes what the semantics do not name, at every level', () => {
    const { params } = check({ intro: 'a', stray: '<script>x()</script>', behaviour: { retry: true, stray: 1 } })
    expect(params).toEqual({ intro: 'a', behaviour: { retry: true } })
  })

  it('cuts text to its length, and empties text its pattern refuses', () => {
    const { params, messages } = check({ title: 'abcdefgh', code: 'ABC' })
    expect(params).toEqual({ title: 'abcde', code: '' })
    expect(messages.join()).toMatch(/pattern/)
  })

  it('lets an optional group\'s fields be empty, without writing that into the semantics', () => {
    const { params, messages } = check({ behaviour: { code: '' } })
    expect(params.behaviour).toEqual({ code: '' })
    expect(messages).toEqual([])
    expect(QUIZ.find((field) => field.name === 'behaviour')!.fields![0].optional).toBeUndefined()
  })

  it('holds numbers to their range, step and decimals, and makes a numeric string a number', () => {
    expect(check({ score: 11 }).params.score).toBe(10)
    expect(check({ score: -3 }).params.score).toBe(0)
    expect(check({ score: 7 }).params.score).toBe(6)
    expect(check({ score: '4' }).params.score).toBe(4)
    expect(check({ score: '<b>' }).params.score).toBe(0)
    expect(check({ ratio: 0.125 }).params.ratio).toBe(0.13)
    expect(check({ ratio: -0.125 }).params.ratio).toBe(-0.13)
  })

  it('keeps a boolean and removes anything else in its place', () => {
    expect(check({ enabled: false }).params).toEqual({ enabled: false })
    expect(check({ enabled: '<img src=x onerror=alert(1)>' }).params).toEqual({})
  })

  it('holds a select to its options, escaping what an optional one keeps', () => {
    expect(check({ mode: 'hard' }).params.mode).toBe('hard')
    expect(check({ mode: '<script>' }).params.mode).toBe('easy')
    expect(check({ mode: ['hard', 'easy'] }).params.mode).toBe('hard')
    expect(check({ free: '"x"' }).params.free).toBe('&quot;x&quot;')
    expect(check({ many: ['a', 'z', 'b', { x: 1 }] }).params.many).toEqual(['a', 'b'])
    expect(check({ many: 'b' }).params.many).toEqual(['b'])
  })

  it('cuts a list to its length and removes one left empty', () => {
    expect(check({ words: ['a', 'b', 'c'] }).params.words).toEqual(['a', 'b'])
    expect(check({ words: [] }).params).toEqual({})
    expect(check({ words: 'a' }).params).toEqual({})
  })

  it('takes a group of one field as that field\'s value, as the editor writes it', () => {
    expect(check({ wrapped: '<b>x</b>' }).params.wrapped).toBe('&lt;b&gt;x&lt;/b&gt;')
  })

  it('checks sub-content against its own library, and keeps only what sub-content carries', () => {
    const { params } = check({
      question: {
        library: 'H5P.Choice 1.17',
        params: { question: '<em>Why</em><script>x()</script>', answers: ['<i>a</i>'], stray: 1 },
        subContentId: UUID,
        metadata: { title: '<b>Q</b>', license: 'nope', extra: 1 },
        stray: '<script>'
      }
    })
    expect(params.question).toEqual({
      library: 'H5P.Choice 1.17',
      params: { question: '<em>Why</em>x()', answers: ['&lt;i&gt;a&lt;/i&gt;'] },
      subContentId: UUID,
      metadata: { title: '&lt;b&gt;Q&lt;/b&gt;', license: 'U' }
    })
  })

  it('accepts a newer minor of a library a field names, which is what the file server serves', () => {
    // The field names 1.16, the content was brought up to 1.17, the version served.
    expect(check({ question: { library: 'H5P.Choice 1.17', params: {} } }).params.question).toBeDefined()
  })

  it('removes sub-content of a library the field does not name, of another major, or with no semantics', () => {
    for (const library of ['H5P.Evil 1.0', 'H5P.Choice 2.0', 'H5P.Text 1.1', 'not a library']) {
      const { params, messages } = check({ question: { library, params: {} } })
      expect(params.question, library).toBeUndefined()
      expect(messages.length, library).toBe(1)
    }
    expect(check({ question: { params: {} } }).params).toEqual({})
  })

  it('removes a subContentId that is not one', () => {
    const { params } = check({ question: { library: 'H5P.Choice 1.17', params: {}, subContentId: '"><script>' } })
    expect(params.question).toEqual({ library: 'H5P.Choice 1.17', params: {} })
  })

  it('cuts a file path into another content\'s folder to its own, and escapes and trims a file', () => {
    const { params } = check({
      image: { path: '../../content/12/images/a.png', mime: 'image/png"', width: '640px', height: 480.7, alt: '<x>', copyright: { license: 'CC BY', title: '<b>t</b>', bad: 1 } },
      audio: [{ path: 'audio/a.mp3#tmp', mime: 'audio/mpeg', width: 3 }, 'not a file']
    })
    expect(params.image).toEqual({
      path: 'images/a.png',
      mime: 'image/png&quot;',
      width: 640,
      height: 480,
      copyright: { license: 'CC BY', title: '&lt;b&gt;t&lt;/b&gt;' }
    })
    expect(params.audio).toEqual([{ path: 'audio/a.mp3', mime: 'audio/mpeg' }])
  })

  it('checks a video\'s sources, their quality and the quality name its extra metadata carries', () => {
    const { params } = check({
      video: [
        { path: 'https://youtu.be/x"', mime: 'video/YouTube', quality: { level: '2', label: '<b>HD</b>', extra: 1 }, metadata: { qualityName: '<i>q</i>' }, codecs: 'a"b' },
        { path: 'v.mp4', quality: { level: 1 } }
      ]
    })
    expect(params.video).toEqual([
      { path: 'https://youtu.be/x&quot;', mime: 'video/YouTube', quality: { level: 2, label: '&lt;b&gt;HD&lt;/b&gt;' }, metadata: { qualityName: '&lt;i&gt;q&lt;/i&gt;' }, codecs: 'a&quot;b' },
      { path: 'v.mp4' }
    ])
  })

  it('removes a field of a type it does not know, and a value of the wrong shape', () => {
    const { params, messages } = check({ odd: '<script>', image: 'images/a.png', video: { path: 'v.mp4' }, behaviour: ['x'] })
    expect(params).toEqual({})
    expect(messages.join()).toMatch(/unknown field type "wysiwyg"/)
  })

  it('refuses content whose main library has no semantics, and leaves its input as it was', () => {
    expect(() => checkContent('H5P.Text 1.1', {}, SEMANTICS)).toThrow(/semantics\.json for H5P\.Text 1\.1/)
    expect(() => checkContent('H5P.Quiz', {}, SEMANTICS)).toThrow(/not a library name/)
    const input = { intro: '<script>x()</script>' }
    check(input)
    expect(input).toEqual({ intro: '<script>x()</script>' })
  })

  it('changes nothing the second time', () => {
    const once = check({
      intro: '<p>A &amp; B &nbsp;<a href="https://e.org" title="it\'s">l</a></p>',
      words: [`"q" & 'a'`],
      question: { library: 'H5P.Choice 1.17', params: { question: 'x &lt; y' } },
      image: { path: 'a b&c.png', copyright: { license: 'U' } }
    }).params
    expect(check(JSON.parse(JSON.stringify(once))).params).toEqual(once)
  })
})

describe('librariesIn', () => {
  it('finds every library string the content holds, at any depth, once each', () => {
    const found = librariesIn({
      a: { library: 'H5P.Choice 1.16', params: { b: [{ library: 'H5P.Text 1.1' }, { library: 'H5P.Choice 1.16' }] } },
      c: { library: 'nonsense' }
    })
    expect(found).toEqual([
      { machineName: 'H5P.Choice', major: 1, minor: 16 },
      { machineName: 'H5P.Text', major: 1, minor: 1 }
    ])
  })
})

describe('checkContentMetadata, as the platforms check content\'s own metadata', () => {
  it('escapes its text, holds its licence and authors to the lists, and removes the rest', () => {
    const { metadata } = checkContentMetadata({
      title: 'Q & <A>',
      license: 'CC BY',
      licenseVersion: '9.9',
      authors: [{ name: '<b>N</b>', role: 'Hacker' }],
      yearFrom: '1990',
      extraTitle: 'x',
      source: 'https://e.org'
    })
    expect(metadata).toEqual({
      title: 'Q &amp; &lt;A&gt;',
      license: 'CC BY',
      licenseVersion: '9.9',
      authors: [{ name: '&lt;b&gt;N&lt;/b&gt;', role: 'Author' }],
      yearFrom: 1990,
      source: 'https://e.org'
    })
  })

  it('gives content without a licence "U", and takes nothing for metadata that is not an object', () => {
    expect(checkContentMetadata({ title: 't' }).metadata).toEqual({ title: 't', license: 'U' })
    expect(checkContentMetadata('x').metadata).toEqual({ license: 'U' })
    expect(checkContentMetadata(undefined).metadata).toEqual({ license: 'U' })
  })
})
