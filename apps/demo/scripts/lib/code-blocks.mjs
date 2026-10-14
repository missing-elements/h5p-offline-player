/**
 * The demo pages' code blocks, highlighted when a page is served or built, so no highlighter
 * ships to a visitor. A page writes a block as
 *
 *   <pre class="code" data-lang="sh">npm i @missing-elements/h5p-offline-player</pre>
 *
 * with `data-lang` one of `sh`, `js`, `html`, `xml` or `text`, and `data-title` to name it other
 * than by its language. Blocks inside `<div class="code-tabs">` that each carry `data-tab` are
 * alternatives, shown as tabs: npm, pnpm and yarn for one install. Each becomes a `<figure
 * class="code-block">` with a head — the label, the tabs, a copy button — over the highlighted
 * code; `demo/code-blocks.js` makes the buttons work.
 *
 * Shiki highlights with a theme of our own whose colours are role names (`var(--tk-string)`),
 * and every colour leaves the output as a class (`tk-string`), never a `style` attribute: the
 * site's policy is `style-src 'self'`, which refuses those, and Shiki's own themes write one on
 * every token. The roles are coloured in `demo/player-page.css`.
 */
import { createHighlighter } from 'shiki'

/** Shiki's language for each `data-lang`, and the label a block shows for it. */
const LANGUAGES = {
  sh: { shiki: 'shellscript', label: 'Terminal' },
  js: { shiki: 'javascript', label: 'JavaScript' },
  html: { shiki: 'html', label: 'HTML' },
  xml: { shiki: 'xml', label: 'XML' },
  text: { shiki: 'text', label: '' }
}

/** @param {string} name */
const role = (name) => `var(--tk-${name})`

/**
 * The scopes the four grammars give the parts a reader tells apart. A more specific scope wins
 * over a shorter one, as in any TextMate theme: `punctuation.definition.string` takes the
 * string's colour, `keyword.operator` the punctuation's.
 */
const THEME = {
  name: 'h5p-demo',
  type: 'dark',
  colors: { 'editor.foreground': role('plain'), 'editor.background': role('plain') },
  tokenColors: [
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: role('comment') } },
    { scope: ['string', 'punctuation.definition.string'], settings: { foreground: role('string') } },
    { scope: ['keyword', 'storage', 'storage.type', 'storage.modifier', 'variable.language'], settings: { foreground: role('keyword') } },
    { scope: ['punctuation', 'keyword.operator', 'meta.brace', 'meta.tag.xml', 'meta.tag.preprocessor.xml'], settings: { foreground: role('punct') } },
    { scope: ['entity.name.tag'], settings: { foreground: role('tag') } },
    { scope: ['entity.other.attribute-name'], settings: { foreground: role('attr') } },
    { scope: ['entity.name.function', 'support.function', 'entity.name.command'], settings: { foreground: role('function') } },
    { scope: ['constant', 'support.constant', 'constant.other.option'], settings: { foreground: role('constant') } },
    // A shell argument is a word, not a string: a package name or a file reads as plain text.
    { scope: ['string.unquoted.argument.shell'], settings: { foreground: role('plain') } }
  ]
}

/** @type {Promise<import('shiki').Highlighter> | undefined} */
let highlighter

const BLOCK = /<pre class="code"([^>]*)>([\s\S]*?)<\/pre>/g
const GROUP = /<div class="code-tabs">\s*((?:<pre class="code"[^>]*>[\s\S]*?<\/pre>\s*)+)<\/div>/g

/**
 * Every code block in a page, highlighted. Ids are numbered per page, so a page's tabs and
 * panels name each other and nothing else.
 * @param {string} html
 * @returns {Promise<string>}
 */
export async function highlightCodeBlocks(html) {
  if (!html.includes('<pre class="code"')) return html
  highlighter ??= createHighlighter({ themes: [THEME], langs: ['shellscript', 'javascript', 'html', 'xml'] })
  const shiki = await highlighter
  let count = 0
  const nextId = () => `code-${++count}`
  return html
    .replace(GROUP, (_, blocks) => renderTabs(shiki, [...blocks.matchAll(BLOCK)].map(parseBlock), nextId()))
    .replace(BLOCK, (...match) => renderBlock(shiki, parseBlock(match)))
}

/**
 * @typedef {{ lang: keyof typeof LANGUAGES, title: string, tab: string, code: string }} Block
 * @param {RegExpMatchArray | string[]} match
 * @returns {Block}
 */
function parseBlock(match) {
  const attributes = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, decode(value)]))
  const lang = /** @type {keyof typeof LANGUAGES} */ (attributes['data-lang'] in LANGUAGES ? attributes['data-lang'] : 'text')
  return { lang, title: attributes['data-title'] ?? LANGUAGES[lang].label, tab: attributes['data-tab'] ?? '', code: decode(match[2]) }
}

/**
 * @param {import('shiki').Highlighter} shiki
 * @param {Block} block
 */
function renderBlock(shiki, block) {
  return figure(block.title, '', highlight(shiki, block, {}))
}

/**
 * @param {import('shiki').Highlighter} shiki
 * @param {Block[]} blocks
 * @param {string} id
 */
function renderTabs(shiki, blocks, id) {
  const titles = new Set(blocks.map((block) => block.title))
  const title = titles.size === 1 ? blocks[0].title : ''
  const tabs = blocks
    .map((block, index) => {
      const selected = index === 0
      return `<button type="button" role="tab" id="${id}-tab-${index}" aria-controls="${id}-panel-${index}" aria-selected="${selected}" tabindex="${selected ? 0 : -1}" data-tab="${escape(block.tab)}">${escape(block.tab)}</button>`
    })
    .join('')
  const panels = blocks
    .map((block, index) =>
      highlight(shiki, block, {
        role: 'tabpanel',
        id: `${id}-panel-${index}`,
        'aria-labelledby': `${id}-tab-${index}`,
        'data-tab': block.tab,
        ...(index === 0 ? {} : { hidden: true })
      })
    )
    .join('')
  return figure(title, `<div class="code-tablist" role="tablist" aria-label="${escape(title || 'Variants')}">${tabs}</div>`, panels, true)
}

/**
 * @param {string} title
 * @param {string} tabs
 * @param {string} body
 * @param {boolean} [tabbed]
 */
function figure(title, tabs, body, tabbed = false) {
  // A title with a dot is a file name, shown as it is written; a language is a label.
  const label = title ? `<span class="code-label${title.includes('.') ? ' code-file' : ''}">${escape(title)}</span>` : ''
  return (
    `<figure class="code-block"${tabbed ? ' data-tabs' : ''}>` +
    `<div class="code-head">${label}${tabs}<button type="button" class="code-copy">Copy</button><span class="code-status" role="status"></span></div>` +
    body +
    '</figure>'
  )
}

/**
 * @param {import('shiki').Highlighter} shiki
 * @param {Block} block
 * @param {Record<string, string | boolean>} properties more attributes for the `<pre>`
 */
function highlight(shiki, block, properties) {
  return shiki.codeToHtml(block.code, {
    lang: LANGUAGES[block.lang].shiki,
    theme: 'h5p-demo',
    transformers: [
      {
        pre(node) {
          delete node.properties.style
          Object.assign(node.properties, { class: 'code-body', tabindex: '0', ...properties })
        },
        span(node) {
          const name = /var\(--tk-([a-z]+)\)/.exec(String(node.properties.style ?? ''))?.[1]
          delete node.properties.style
          if (name && name !== 'plain') node.properties.class = `tk-${name}`
        }
      }
    ]
  })
}

/** The entities a page writes inside `<pre>`. `&amp;` last, so `&amp;lt;` stays `&lt;`. @param {string} text */
function decode(text) {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
}

/** @param {string} text */
function escape(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

/**
 * The Vite plugin: after `%SITE_URL%` is filled in, so a snippet shows the real address, and
 * before Vite reads the page for its scripts and styles.
 * @returns {import('vite').Plugin}
 */
export function codeBlocksPlugin() {
  return {
    name: 'h5p-code-blocks',
    transformIndexHtml: { order: 'pre', handler: highlightCodeBlocks }
  }
}
