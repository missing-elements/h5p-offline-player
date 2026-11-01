/**
 * Authored text as H5P stores it. A field without `tags` is plain text, which the platforms keep
 * escaped (PHP's `htmlspecialchars`, existing entities left alone). A field with `tags` holds
 * markup, as H5P's editor writes it into that field: the tags the field names, and the four the
 * content check always keeps, `div`, `span`, `p` and `br`. Anything else is refused by name, so a
 * source never reaches a learner in a form the platforms would have changed.
 */

/** An `&` that does not begin an entity. */
const BARE_AMPERSAND = /&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#[0-9]+|#[xX][0-9a-fA-F]+);)/g

/**
 * Plain text as the platforms store a text field: `&`, `<`, `>`, `"` and `'` escaped, an entity
 * already there kept, as `htmlspecialchars` with `ENT_QUOTES` and no double encoding keeps it.
 * @param {string} value
 */
export function escapeText(value) {
  return value.replace(BARE_AMPERSAND, '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

/**
 * The tags a markup field keeps, as the content check derives them from its semantics: the four
 * it always keeps, the field's own, and those one of them implies. `null` for a plain text field.
 * @param {any} field
 * @returns {Set<string> | null}
 */
export function allowedTags(field) {
  if (field.tags === undefined || field.tags === null) return null
  const tags = new Set(['div', 'span', 'p', 'br', ...(Array.isArray(field.tags) ? field.tags.filter((/** @type {unknown} */ tag) => typeof tag === 'string') : [])])
  if (tags.has('table')) for (const tag of ['tr', 'td', 'th', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'figure', 'figcaption']) tags.add(tag)
  if (tags.has('b')) tags.add('strong')
  if (tags.has('i')) tags.add('em')
  if (tags.has('ul') || tags.has('ol')) tags.add('li')
  if (tags.has('del') || tags.has('strike')) tags.add('s')
  return tags
}

/**
 * The block a line of text becomes in a markup field, as H5P's editor writes it: `<p>` where the
 * field asks for paragraphs or offers headings, `<div>` otherwise.
 * @param {any} field
 */
export function blockTag(field) {
  const own = Array.isArray(field.tags) ? field.tags : []
  return field.enterMode === 'p' || own.some((/** @type {string} */ tag) => /^(h[1-6]|pre|p|div)$/.test(tag)) ? 'p' : 'div'
}

/** The tags a style attribute may sit on, and what it may say there, as the content check keeps them. */
const STYLEABLE = new Set(['span', 'p', 'div', 'h1', 'h2', 'h3', 'table', 'col', 'figure', 'td', 'th', 'li'])
const COLOR = '(#[a-f0-9]{3}[a-f0-9]{3}?|rgba?\\([0-9, ]+\\)|hsla?\\([0-9,.% ]+\\))'
const BORDER_STYLE = '(none|solid|dotted|dashed|double|groove|ridge|inset|outset)'

/** @param {any} field */
function stylePatterns(field) {
  const patterns = ['^text-align: *(center|left|right);?$']
  const font = field.font && typeof field.font === 'object' ? field.font : {}
  if (font.size) patterns.push('^font-size: *[0-9.]+(em|px|%) *;?$')
  if (font.family) patterns.push("^font-family: *[-a-z0-9,'&; ]+;?$")
  if (font.color) patterns.push(`^color: *${COLOR} *;?$`)
  if (font.background) patterns.push(`^background-color: *${COLOR} *;?$`)
  if (font.spacing) patterns.push('^letter-spacing: *[0-9.]+(em|px|%) *;?$')
  if (font.height) patterns.push('^line-height: *[0-9.]+(em|px|%|) *;?$')
  if (Array.isArray(field.tags) && field.tags.includes('table')) {
    patterns.push(
      `^border: *[0-9.]+(em|px|%|) *${BORDER_STYLE} *${COLOR} *;?$`, `^border-style: *${BORDER_STYLE} *;?$`,
      '^border-width: *[0-9.]+(em|px|%|) *;?$', `^border-color: *${COLOR} *;?$`, '^vertical-align: *(middle|top|bottom);?$',
      '^padding: *[0-9.]+(em|px|%|) *;?$', '^width: *[0-9.]+(em|px|%|) *;?$', '^height: *[0-9.]+(em|px|%|) *;?$',
      '^float: *(right|left|none) *;?$', '^border-collapse: *collapse *;?$', `^background-color: *${COLOR} *;?$`
    )
  }
  return patterns.map((pattern) => new RegExp(pattern, 'i'))
}

/**
 * A tag, a comment, or a lone `<` or `>`: the pieces the content check reads markup in. A comment
 * left open runs to the end, as a browser reads it, so its end is looked for once and not again
 * from every `<!--` after it.
 */
const PIECE = /(<(?=[^a-zA-Z!/])|<!--[\s\S]*?(?:-->|$)|<[^>]*(>|$)|>)/g
const ATTRIBUTE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
const SAFE_URL = /^(?:https?:|mailto:|ftp:|[^:]*$)/i

/**
 * Whether a value is written as markup: it has a tag. Text without one is plain, and is wrapped
 * as the editor wraps what an author types.
 * @param {string} value
 */
export function hasMarkup(value) {
  return /<[a-zA-Z!/]/.test(value)
}

/**
 * A markup field's value as it is stored. Plain text is escaped and wrapped in the field's block,
 * a paragraph per blank line and a `<br>` per other line break. Markup is checked: a tag the field
 * does not take, an event handler, a style the field does not allow, a script URL or a comment is
 * reported; a lone `<` or `>` is escaped, as the content check would escape it.
 * @param {string} value
 * @param {any} field
 * @param {(message: string) => void} report
 */
export function markupText(value, field, report) {
  const tags = allowedTags(field) ?? new Set()
  if (!hasMarkup(value)) {
    const block = blockTag(field)
    const paragraphs = value.trim().split(/\n[ \t]*\n+/).filter((paragraph) => paragraph.trim())
    if (!paragraphs.length) return ''
    return paragraphs.map((paragraph) => `<${block}>${escapeText(paragraph.trim()).replace(/\r?\n/g, '<br>')}</${block}>`).join('')
  }
  const styles = stylePatterns(field)
  // Each thing said once, however often the value repeats it: an opening tag and its closing one.
  const said = new Set()
  const once = (/** @type {string} */ message) => {
    if (said.has(message)) return
    said.add(message)
    report(message)
  }
  return value.replace(PIECE, (piece) => {
    if (piece === '<') return '&lt;'
    if (piece === '>') return '&gt;'
    if (piece.startsWith('<!--')) {
      once('has a comment, which H5P removes: take it out')
      return piece
    }
    const match = /^<\s*(?:(\/)\s*)?([a-zA-Z][a-zA-Z0-9]*)((?:[^>a-zA-Z0-9][^>]*)?)>$/.exec(piece)
    if (!match) {
      once(`has "${piece.slice(0, 30)}", which is not a complete tag: write &lt; for a literal <`)
      return piece
    }
    const tag = match[2].toLowerCase()
    if (!tags.has(tag)) {
      once(`has <${tag}>, which this field does not take; it takes ${[...tags].sort().map((name) => `<${name}>`).join(' ')}`)
      return piece
    }
    if (!match[1]) {
      // The slash of `<br />` is not part of the last attribute, as the content check reads it.
      const attributes = match[3].trimEnd().replace(/\/$/, '')
      for (const [, name, double, single, bare] of attributes.matchAll(ATTRIBUTE)) {
        const attribute = name.toLowerCase()
        const content = double ?? single ?? bare ?? ''
        if (attribute.startsWith('on')) once(`has an event handler, ${attribute}, on <${tag}>, which H5P removes`)
        else if (attribute === 'style') {
          if (!STYLEABLE.has(tag)) once(`has a style on <${tag}>, which H5P removes; styles are kept on ${[...STYLEABLE].join(', ')}`)
          else for (const declaration of content.split(';').map((part) => part.trim()).filter(Boolean)) {
            if (!styles.some((pattern) => pattern.test(declaration))) once(`has the style "${declaration}" on <${tag}>, which this field does not allow`)
          }
        } else if ((attribute === 'href' || attribute === 'src') && !SAFE_URL.test(content.trim())) {
          once(`has ${attribute}="${content.slice(0, 40)}": only http, https, mailto and ftp addresses are kept`)
        }
      }
    }
    return piece
  })
}

/**
 * A plain text field's value as it is stored: escaped, as the platforms store what an author types
 * into it. A tag in it is shown to a learner as written, which is right for a quiz on HTML and a
 * mistake otherwise, so it is noted.
 * @param {string} value
 * @param {(message: string) => void} note
 */
export function plainText(value, note) {
  if (/<\/?[a-zA-Z][a-zA-Z0-9]*(\s[^<>]*)?\/?>/.test(value)) note('is plain text, so its tags are shown as written, not as markup')
  return escapeText(value)
}
