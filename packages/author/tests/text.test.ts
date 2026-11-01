import { describe, expect, it } from 'vitest'
import { allowedTags, blockTag, escapeText, markupText, plainText } from '../lib/text.mjs'
import { translateDefaults, translationFiles } from '../lib/translate.mjs'

describe('text as H5P stores it', () => {
  it('escapes plain text as htmlspecialchars does, keeping entities already there', () => {
    expect(escapeText(`Tom & Jerry's "<b>"`)).toBe('Tom &amp; Jerry&#39;s &quot;&lt;b&gt;&quot;')
    expect(escapeText('AT&amp;T &#169; &#x2014; & more')).toBe('AT&amp;T &#169; &#x2014; &amp; more')
  })

  it('derives a markup field\'s tags as the content check does, and its block as the editor does', () => {
    expect([...allowedTags({ tags: ['b', 'ul', 'del', 'table'] })!].sort()).toEqual(
      ['b', 'br', 'col', 'colgroup', 'del', 'div', 'figcaption', 'figure', 'li', 'p', 's', 'span', 'strong', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul'].sort()
    )
    expect(allowedTags({})).toBeNull()
    expect(blockTag({ tags: ['strong'] })).toBe('div')
    expect(blockTag({ tags: ['strong'], enterMode: 'p' })).toBe('p')
    expect(blockTag({ tags: ['h2', 'strong'] })).toBe('p')
  })

  it('wraps plain text written into a markup field as the editor wraps what an author types', () => {
    const report = () => { throw new Error('nothing to report') }
    expect(markupText('One line\nand the next\n\nA second: x < 5 & more', { tags: [], enterMode: 'p' }, report)).toBe(
      '<p>One line<br>and the next</p><p>A second: x &lt; 5 &amp; more</p>'
    )
    expect(markupText('Plain', { tags: ['em'] }, report)).toBe('<div>Plain</div>')
  })

  it('keeps markup the field takes, escapes a stray < or >, and reports what H5P would remove', () => {
    const problems: string[] = []
    const field = { tags: ['strong', 'a'], font: { color: true } }
    const kept = markupText('<p style="text-align: center; color: #ff0000">A <strong>b</strong> <a href="https://example.org">c</a> 1 > 0</p>', field, (message) => problems.push(message))
    expect(kept).toBe('<p style="text-align: center; color: #ff0000">A <strong>b</strong> <a href="https://example.org">c</a> 1 &gt; 0</p>')
    expect(problems).toEqual([])
    markupText('<p onclick="x()">a</p><table><tr><td>b</td></tr></table><span style="position: fixed">c</span><a href="javascript:alert(1)">d</a><!-- e -->', field, (message) => problems.push(message))
    expect(problems).toEqual([
      'has an event handler, onclick, on <p>, which H5P removes',
      expect.stringContaining('has <table>, which this field does not take'),
      expect.stringContaining('has <tr>'),
      expect.stringContaining('has <td>'),
      'has the style "position: fixed" on <span>, which this field does not allow',
      'has href="javascript:alert(1)": only http, https, mailto and ftp addresses are kept',
      'has a comment, which H5P removes: take it out'
    ])
  })

  it('notes a tag in a plain field, which a learner sees as written', () => {
    const notes: string[] = []
    expect(plainText('What does <div> do?', (message) => notes.push(message))).toBe('What does &lt;div&gt; do?')
    expect(notes).toHaveLength(1)
  })
})

describe('the libraries\' translations', () => {
  // Names as the pack's quiz libraries have them, `sme` and Question Set's Traditional `zh` among them.
  const files = ['de', 'es', 'es-mx', 'he', 'nb', 'nn', 'pt', 'pt-br', 'sme', 'sr', 'zh', 'zh-cn', 'zh-hans', 'zh-hant', 'zh-tw']
  it.each([
    ['de', ['de']],
    ['de-AT', ['de']],
    ['es-MX', ['es-mx', 'es']],
    ['pt-BR', ['pt-br', 'pt']],
    ['iw', ['he']],
    ['no', ['nb']],
    ['se', ['sme']],
    ['sr-Cyrl-BA', ['sr']],
    ['sr-Latn', []],
    ['sh', []],
    ['zh', ['zh-hans', 'zh-cn']],
    ['zh-TW', ['zh-hant', 'zh-tw']],
    ['zh-Hant', ['zh-hant', 'zh-tw']],
    ['en', []]
  ])('looks the translation for %s up by H5P\'s file names, never in another script', (tag, names) => {
    expect(translationFiles(files, tag)).toEqual(names)
  })

  it('takes a translation\'s text defaults only, and keeps the English where it has none, the same, or loses a placeholder', () => {
    const fields = [
      { name: 'check', type: 'text', default: 'Check' },
      { name: 'mode', type: 'select', default: 'auto' },
      { name: 'score', type: 'text', default: 'You got :num of :total' },
      {
        name: 'texts', type: 'group', fields: [
          { name: 'question', type: 'text', default: 'Question' },
          { name: 'next', type: 'text', default: 'Next' },
          { name: 'progress', type: 'text', default: '@current of @total' },
          { name: 'results', type: 'text', default: 'Results' }
        ]
      },
      { name: 'items', type: 'list', field: { name: 'item', type: 'text', default: 'Item' } }
    ]
    const { strings, translated, english } = translateDefaults(fields, [
      { default: 'Prüfen' },
      { default: 'manuell' },
      { default: 'Du hast :num von :max' },
      { fields: [{ default: 'Question' }, { default: ' ' }, { default: '@current von @total' }] },
      { field: { default: 'Eintrag' } }
    ])
    expect(strings).toBe(7)
    expect(translated.map(({ field, text }) => [field.name, text])).toEqual([['check', 'Prüfen'], ['progress', '@current von @total'], ['item', 'Eintrag']])
    expect(english).toEqual([
      { field: 'score', text: 'You got :num of :total', dropped: [':total'] },
      { field: 'texts.question', text: 'Question' },
      { field: 'texts.next', text: 'Next' },
      { field: 'texts.results', text: 'Results' }
    ])
    expect(translateDefaults(fields, { semantics: [] }).translated).toEqual([])
  })
})
