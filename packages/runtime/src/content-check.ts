/**
 * The content of a package checked against its libraries' semantics, the way the H5P platforms
 * check it before they show it: every field held to the type its library's `semantics.json`
 * gives it, text stripped to the tags the field allows, plain text escaped, numbers held to their
 * range, sub-content to the libraries a field names, and anything the semantics do not name
 * removed. H5P's content types are written for parameters that have been through this — they put
 * text into the page as HTML — so a package whose own code is withheld (`untrusted`) still needs
 * it, or a `<script>` in a text field would run through jQuery's `.html()`.
 *
 * A port of `H5PContentValidator` from h5p-php-library's `h5p.classes.php` (GPL-3.0), at commit
 * cb64a1f3884408487c3178e31fc140f5d45ca165 (2026-08-11), with the XSS filter it copied from
 * Drupal 7's `common.inc` (GPL-2.0-or-later). Pure and synchronous: the semantics are loaded by
 * the caller first, for the libraries `librariesIn` finds, so this module needs no browser and
 * its rules are tested in Node.
 *
 * Where it differs from upstream, it is stricter, or it has to be:
 * - A sub-content library is accepted when a field names the same machine name and major
 *   version, not only the exact string. The file server answers for a minor with the newest one
 *   reachable, and the content upgrade moves the content to it, so a field written for
 *   `H5P.MultiChoice 1.16` holds `H5P.MultiChoice 1.17` once the pack serves 1.17. Upstream
 *   upgrades sub-content to the version its parent's semantics name, which keeps both installed.
 * - A boolean that is not a boolean is removed; upstream checks and keeps it.
 * - A number written as a string becomes a number, and so does one clamped to a bound the
 *   semantics wrote as a string; upstream keeps the string in both cases.
 * - A multi-select is a list after an invalid option is removed; upstream unsets the index and
 *   leaves a hole, which JSON writes as an object (`{"0": "a", "2": "b"}`).
 * - A field's `optional` is not written into the semantics: upstream marks the fields of an
 *   optional group optional on the shared object, which then holds for every later use of it.
 * - A `subContentId` in a sub-content group is held to the shape `validateLibrary` holds one to;
 *   upstream keeps whatever is there.
 * - A value of the wrong shape — a string where a group, a list or a file belongs — is removed;
 *   upstream fails on several of them with a PHP error, which fails the save.
 * - A malformed attribute is dropped up to the next whitespace. Upstream's pattern for that has an
 *   empty alternative, which in PCRE can match nothing at all.
 * - The step check uses whole steps of at least one, as PHP's integer `%` does; a fractional step,
 *   which PHP 8 divides by zero on, is not checked.
 */

/** One field of a library's `semantics.json`, as far as the check reads it. */
export interface SemanticField {
  name?: string
  type?: string
  fields?: SemanticField[]
  field?: SemanticField
  optional?: boolean
  isSubContent?: boolean
  tags?: unknown
  font?: { size?: unknown; family?: unknown; color?: unknown; background?: unknown; spacing?: unknown; height?: unknown }
  maxLength?: unknown
  regexp?: { pattern?: unknown; modifiers?: unknown }
  min?: unknown
  max?: unknown
  step?: unknown
  decimals?: unknown
  options?: unknown[]
  multiple?: boolean
  extraAttributes?: unknown
}

/** A library as content names it: `"H5P.MultiChoice 1.16"`. */
export interface LibraryName {
  machineName: string
  major: number
  minor: number
}

/** The semantics loaded for the content, by the library string `libraryKey` gives; `null` for a library with none. */
export type SemanticsTable = Map<string, SemanticField[] | null>

export interface CheckResult {
  params: Record<string, unknown>
  /** What was changed for a reason worth saying, as upstream reports it to the author. */
  messages: string[]
}

type Json = unknown
type Fields = Record<string, Json>

const isObject = (value: Json): value is Fields => value !== null && typeof value === 'object' && !Array.isArray(value)
const isScalar = (value: Json): value is string | number | boolean =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'

/* ------------------------------------------------------------------ libraries */

/** `H5PCore::libraryFromString`. */
export function parseLibrary(value: unknown): LibraryName | null {
  if (typeof value !== 'string') return null
  const match = /^([\w\-.]{1,255})[- ]([0-9]{1,5})\.([0-9]{1,5})$/i.exec(value)
  return match ? { machineName: match[1], major: Number(match[2]), minor: Number(match[3]) } : null
}

export const libraryKey = (library: LibraryName): string => `${library.machineName} ${library.major}.${library.minor}`

/**
 * Every library the content could name, found by shape — an object whose `library` is a library
 * string — so its semantics can be loaded before the check. A superset of what the check reaches:
 * it looks in every field, not only in the ones the semantics call a library.
 */
export function librariesIn(params: Json): LibraryName[] {
  const found = new Map<string, LibraryName>()
  const walk = (value: Json): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (!isObject(value)) return
    const library = parseLibrary(value.library)
    if (library) found.set(libraryKey(library), library)
    for (const key of Object.keys(value)) walk(value[key])
  }
  walk(params)
  return [...found.values()]
}

/* ------------------------------------------------------------------ escaping */

/**
 * HTML 4.01's named character references, which PHP decodes and keeps by default: the name and
 * the code point in hex. `apos` is not among them.
 */
const HTML4_ENTITIES = new Map(
  (
    'quot:22 amp:26 lt:3c gt:3e nbsp:a0 iexcl:a1 cent:a2 pound:a3 curren:a4 yen:a5 brvbar:a6 ' +
    'sect:a7 uml:a8 copy:a9 ordf:aa laquo:ab not:ac shy:ad reg:ae macr:af deg:b0 plusmn:b1 sup2:b2 ' +
    'sup3:b3 acute:b4 micro:b5 para:b6 middot:b7 cedil:b8 sup1:b9 ordm:ba raquo:bb frac14:bc ' +
    'frac12:bd frac34:be iquest:bf Agrave:c0 Aacute:c1 Acirc:c2 Atilde:c3 Auml:c4 Aring:c5 AElig:c6 ' +
    'Ccedil:c7 Egrave:c8 Eacute:c9 Ecirc:ca Euml:cb Igrave:cc Iacute:cd Icirc:ce Iuml:cf ETH:d0 ' +
    'Ntilde:d1 Ograve:d2 Oacute:d3 Ocirc:d4 Otilde:d5 Ouml:d6 times:d7 Oslash:d8 Ugrave:d9 ' +
    'Uacute:da Ucirc:db Uuml:dc Yacute:dd THORN:de szlig:df agrave:e0 aacute:e1 acirc:e2 atilde:e3 ' +
    'auml:e4 aring:e5 aelig:e6 ccedil:e7 egrave:e8 eacute:e9 ecirc:ea euml:eb igrave:ec iacute:ed ' +
    'icirc:ee iuml:ef eth:f0 ntilde:f1 ograve:f2 oacute:f3 ocirc:f4 otilde:f5 ouml:f6 divide:f7 ' +
    'oslash:f8 ugrave:f9 uacute:fa ucirc:fb uuml:fc yacute:fd thorn:fe yuml:ff OElig:152 oelig:153 ' +
    'Scaron:160 scaron:161 Yuml:178 fnof:192 circ:2c6 tilde:2dc Alpha:391 Beta:392 Gamma:393 ' +
    'Delta:394 Epsilon:395 Zeta:396 Eta:397 Theta:398 Iota:399 Kappa:39a Lambda:39b Mu:39c Nu:39d ' +
    'Xi:39e Omicron:39f Pi:3a0 Rho:3a1 Sigma:3a3 Tau:3a4 Upsilon:3a5 Phi:3a6 Chi:3a7 Psi:3a8 ' +
    'Omega:3a9 alpha:3b1 beta:3b2 gamma:3b3 delta:3b4 epsilon:3b5 zeta:3b6 eta:3b7 theta:3b8 ' +
    'iota:3b9 kappa:3ba lambda:3bb mu:3bc nu:3bd xi:3be omicron:3bf pi:3c0 rho:3c1 sigmaf:3c2 ' +
    'sigma:3c3 tau:3c4 upsilon:3c5 phi:3c6 chi:3c7 psi:3c8 omega:3c9 thetasym:3d1 upsih:3d2 piv:3d6 ' +
    'ensp:2002 emsp:2003 thinsp:2009 zwnj:200c zwj:200d lrm:200e rlm:200f ndash:2013 mdash:2014 ' +
    'lsquo:2018 rsquo:2019 sbquo:201a ldquo:201c rdquo:201d bdquo:201e dagger:2020 Dagger:2021 ' +
    'bull:2022 hellip:2026 permil:2030 prime:2032 Prime:2033 lsaquo:2039 rsaquo:203a oline:203e ' +
    'frasl:2044 euro:20ac image:2111 weierp:2118 real:211c trade:2122 alefsym:2135 larr:2190 ' +
    'uarr:2191 rarr:2192 darr:2193 harr:2194 crarr:21b5 lArr:21d0 uArr:21d1 rArr:21d2 dArr:21d3 ' +
    'hArr:21d4 forall:2200 part:2202 exist:2203 empty:2205 nabla:2207 isin:2208 notin:2209 ni:220b ' +
    'prod:220f sum:2211 minus:2212 lowast:2217 radic:221a prop:221d infin:221e ang:2220 and:2227 ' +
    'or:2228 cap:2229 cup:222a int:222b there4:2234 sim:223c cong:2245 asymp:2248 ne:2260 ' +
    'equiv:2261 le:2264 ge:2265 sub:2282 sup:2283 nsub:2284 sube:2286 supe:2287 oplus:2295 ' +
    'otimes:2297 perp:22a5 sdot:22c5 lceil:2308 rceil:2309 lfloor:230a rfloor:230b lang:2329 ' +
    'rang:232a loz:25ca spades:2660 clubs:2663 hearts:2665 diams:2666 ' +
    ''
  )
    .trim()
    .split(' ')
    .map((pair) => {
      const [name, hex] = pair.split(':')
      return [name, parseInt(hex, 16)] as const
    })
)

/** Whether PHP decodes a numeric reference to this code point in an HTML 4.01 document (`unicode_cp_is_allowed`). */
const decodableCodePoint = (cp: number): boolean =>
  cp === 0x09 ||
  cp === 0x0a ||
  cp === 0x0d ||
  (cp >= 0x20 && cp <= 0x7e) ||
  (cp >= 0xa0 && cp <= 0xd7ff) ||
  (cp >= 0xe000 && cp <= 0x10ffff && (cp & 0xffff) < 0xfffe && (cp < 0xfdd0 || cp > 0xfdef))

/**
 * A lone surrogate: what PHP would see as invalid UTF-8, which its functions refuse whole. A loop,
 * not a pattern: a lookbehind is a syntax error in Safari before 16.4, and this script is the boot.
 */
function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) i++
      else return true
    } else if (code >= 0xdc00 && code <= 0xdfff) return true
  }
  return false
}

/** The reference at the start of `rest` (just after `&`), when PHP takes it for one: its length. */
function entityLength(rest: string): number {
  const numeric = /^#(?:([0-9]+)|[xX]([0-9a-fA-F]+));/.exec(rest)
  if (numeric) {
    const cp = numeric[1] !== undefined ? parseInt(numeric[1], 10) : parseInt(numeric[2], 16)
    // Kept whatever it names, as long as it is a code point (`numeric_entity_is_allowed`).
    return cp <= 0x10ffff ? numeric[0].length : 0
  }
  const named = /^([a-zA-Z0-9]+);/.exec(rest)
  return named && HTML4_ENTITIES.has(named[1]) ? named[0].length : 0
}

/**
 * PHP's `htmlspecialchars($text, ENT_QUOTES, 'UTF-8', $doubleEncode)`: `&`, `"`, `'`, `<` and `>`
 * written as references — `'` as `&#039;` — and, without double encoding, a reference already
 * there kept. Invalid UTF-8, a lone surrogate here, gives an empty string, as PHP does.
 */
export function escapeHtml(text: string, doubleEncode = false): string {
  if (hasLoneSurrogate(text)) return ''
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '&') {
      const length = doubleEncode ? 0 : entityLength(text.slice(i + 1))
      if (length) {
        out += text.slice(i, i + 1 + length)
        i += length
      } else out += '&amp;'
    } else if (char === '"') out += '&quot;'
    else if (char === "'") out += '&#039;'
    else if (char === '<') out += '&lt;'
    else if (char === '>') out += '&gt;'
    else out += char
  }
  return out
}

/** PHP's `html_entity_decode($text, ENT_QUOTES, 'UTF-8')`: HTML 4.01's names and numeric references, each with its `;`. */
export function decodeEntities(text: string): string {
  return text.replace(/&(?:#([0-9]+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z0-9]+));/g, (whole, decimal, hex, name) => {
    if (name !== undefined) {
      const cp = HTML4_ENTITIES.get(name)
      return cp === undefined ? whole : String.fromCodePoint(cp)
    }
    const cp = decimal !== undefined ? parseInt(decimal, 10) : parseInt(hex, 16)
    return decodableCodePoint(cp) ? String.fromCodePoint(cp) : whole
  })
}

/** A scalar as PHP turns it into a string for `htmlspecialchars`; anything else as nothing. */
const phpString = (value: Json): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : value === true ? '1' : ''

/** PHP's `intval`, for the numbers a file carries. */
const intval = (value: Json): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : 0
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'string') {
    const number = parseFloat(value)
    return Number.isFinite(number) ? Math.trunc(number) : 0
  }
  return 0
}

/* ------------------------------------------------------------------ the XSS filter */

// PCRE's `\s` without the `u` modifier: ASCII whitespace only. The browser separates attributes
// by ASCII whitespace too, and JavaScript's `\s` would also take a no-break space.
const WS = '[\\t\\n\\x0B\\f\\r ]'
const NON_WS = '[^\\t\\n\\x0B\\f\\r ]'

/** The tags a style attribute is kept on, as upstream lists them. */
const STYLEABLE_TAGS = ['span', 'p', 'div', 'h1', 'h2', 'h3', 'table', 'col', 'figure', 'td', 'th', 'li']

const TAG = new RegExp(`^<${WS}*(/${WS}*)?([a-zA-Z0-9\\-]+)${WS}*([^>]*)>?|(<!--.*?-->)$`)
const XHTML_SLASH = new RegExp(`(${WS}?)/${WS}*$`)
const ATTR_NAME = /^([-a-zA-Z]+)/
const ATTR_EQUALS = new RegExp(`^${WS}*=${WS}*`)
const ATTR_SPACE = new RegExp(`^${WS}+`)
const ATTR_DOUBLE = new RegExp(`^"([^"]*)"(${WS}+|$)`)
const ATTR_SINGLE = new RegExp(`^'([^']*)'(${WS}+|$)`)
const ATTR_BARE = new RegExp(`^([^\\t\\n\\x0B\\f\\r "']+)(${WS}+|$)`)
const ATTR_JUNK = new RegExp(`^("[^"]*("|$)|'[^']*('|$)|${NON_WS})*${WS}*`)

/** URL schemes an attribute may keep. */
const ALLOWED_PROTOCOLS = new Set(['ftp', 'http', 'https', 'mailto'])

/** Drupal's `_strip_dangerous_protocols`: any scheme off the list taken away, again until none is left. */
function stripDangerousProtocols(uri: string): string {
  let before: string
  do {
    before = uri
    const colon = uri.indexOf(':')
    if (colon > 0) {
      const protocol = uri.slice(0, colon)
      // A colon after a slash, a question mark or a hash is not a scheme's.
      if (/[/?#]/.test(protocol)) break
      if (!ALLOWED_PROTOCOLS.has(protocol.toLowerCase())) uri = uri.slice(colon + 1)
    }
  } while (before !== uri)
  return uri
}

const badProtocol = (value: string): string => escapeHtml(stripDangerousProtocols(decodeEntities(value)))

/** Upstream's `_filter_xss_attributes`: the attributes kept, each written anew. */
function filterAttributes(attr: string, allowedStyles: RegExp[] | false): string[] {
  const kept: string[] = []
  let mode = 0
  let name = ''
  let skip = false

  while (attr.length !== 0) {
    let working = false
    let match: RegExpExecArray | null
    if (mode === 0) {
      if ((match = ATTR_NAME.exec(attr))) {
        name = match[1].toLowerCase()
        skip = name === 'style' || name.startsWith('on') || name.startsWith('-') || name.length > 96
        working = true
        mode = 1
        attr = attr.slice(match[0].length)
      }
    } else if (mode === 1) {
      if ((match = ATTR_EQUALS.exec(attr))) {
        working = true
        mode = 2
        attr = attr.slice(match[0].length)
      } else if ((match = ATTR_SPACE.exec(attr))) {
        working = true
        mode = 0
        if (!skip) kept.push(name)
        attr = attr.slice(match[0].length)
      }
    } else if ((match = ATTR_DOUBLE.exec(attr))) {
      if (allowedStyles && name === 'style') {
        // Kept piece by piece, each one whole against a pattern. Upstream leaves the value for the
        // malformed-attribute step below to take away, and so does this.
        let value = match[1]
        if (value.toLowerCase().includes('font-family')) value = value.replaceAll('&quot;', "'")
        const styles = value.split(';')
        const validated: string[] = []
        for (const pattern of allowedStyles) {
          for (const style of styles) {
            const trimmed = style.replace(/^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/g, '')
            if (pattern.test(trimmed)) validated.push(trimmed)
          }
        }
        kept.push(`style="${validated.join(';')};"`)
      } else {
        if (!skip) kept.push(`${name}="${badProtocol(match[1])}"`)
        working = true
        mode = 0
        attr = attr.slice(match[0].length)
      }
    } else if ((match = ATTR_SINGLE.exec(attr))) {
      if (!skip) kept.push(`${name}='${badProtocol(match[1])}'`)
      working = true
      mode = 0
      attr = attr.slice(match[0].length)
    } else if ((match = ATTR_BARE.exec(attr))) {
      if (!skip) kept.push(`${name}="${badProtocol(match[1])}"`)
      working = true
      mode = 0
      attr = attr.slice(match[0].length)
    }

    if (!working) {
      // Not well formed: drop up to the next whitespace, quoted strings whole, and go on.
      const junk = ATTR_JUNK.exec(attr)
      const length = junk && junk[0].length ? junk[0].length : 1
      attr = attr.slice(length)
      mode = 0
    }
  }

  // The list ends with a valueless attribute, "selected" for instance.
  if (mode === 1 && !skip) kept.push(name)
  return kept
}

/** Upstream's `_filter_xss_split`: one tag, or a lone `<` or `>`, as it may stay. */
function filterTag(piece: string, allowed: Set<string>, allowedStyles: RegExp[] | false): string {
  if (piece[0] !== '<') return '&gt;'
  if (piece.length === 1) return '&lt;'

  const match = TAG.exec(piece)
  if (!match) return ''
  const slash = (match[1] ?? '').trim()
  const comment = match[4]
  const elem = comment ? '!--' : match[2]
  if (!allowed.has(elem.toLowerCase())) return ''
  if (comment) return comment
  if (slash !== '') return `</${elem}>`

  let attrList = match[3] ?? ''
  let xhtmlSlash = ''
  if (XHTML_SLASH.test(attrList)) {
    attrList = attrList.replace(XHTML_SLASH, '$1')
    xhtmlSlash = ' /'
  }
  const attributes = filterAttributes(attrList, STYLEABLE_TAGS.includes(elem) ? allowedStyles : false)
    .join(' ')
    .replace(/[<>]/g, '')
  return `<${elem}${attributes ? ` ${attributes}` : ''}${xhtmlSlash}>`
}

/**
 * Upstream's `filter_xss`, Drupal 7's: only the allowed tags, each with its attributes written
 * anew — no `on…` handler, no style but the allowed ones on the tags that may carry one, no URL
 * with a scheme off the list — and every entity well formed.
 */
export function filterXss(text: string, allowedTags: string[], allowedStyles: RegExp[] | false = false): string {
  if (text.length === 0) return text
  if (hasLoneSurrogate(text)) return ''
  const allowed = new Set(allowedTags)
  const defused = text
    .replace(/\0/g, '')
    // Netscape 4's JavaScript entities.
    .replace(/&[\t\n\x0B\f\r ]*\{[^}]*(\}[\t\n\x0B\f\r ]*;?|$)/g, '')
    .replace(/&/g, '&amp;')
    .replace(/&amp;#([0-9]+;)/g, '&#$1')
    .replace(/&amp;#[Xx]0*((?:[0-9A-Fa-f]{2})+;)/g, '&#x$1')
    .replace(/&amp;([A-Za-z][A-Za-z0-9]*;)/g, '&$1')
  return defused.replace(/(<(?=[^a-zA-Z!/])|<!--.*?-->|<[^>]*(>|$)|>)/g, (piece) => filterTag(piece, allowed, allowedStyles))
}

/* ------------------------------------------------------------------ the fields */

const COLOR = '(#[a-f0-9]{3}[a-f0-9]{3}?|rgba?\\([0-9, ]+\\)|hsla?\\([0-9,.% ]+\\))'
const BORDER_STYLE = '(none|solid|dotted|dashed|double|groove|ridge|inset|outset)'

/** The styles a text field keeps, as upstream builds them from its `font` and `tags`. */
function stylePatterns(field: SemanticField, tags: string[]): RegExp[] {
  const patterns: string[] = []
  const font = field.font
  if (font && typeof font === 'object') {
    if (font.size) patterns.push('^font-size: *[0-9.]+(em|px|%) *;?$')
    if (font.family) patterns.push("^font-family: *[-a-z0-9,'&; ]+;?$")
    if (font.color) patterns.push(`^color: *${COLOR} *;?$`)
    if (font.background) patterns.push(`^background-color: *${COLOR} *;?$`)
    if (font.spacing) patterns.push('^letter-spacing: *[0-9.]+(em|px|%) *;?$')
    if (font.height) patterns.push('^line-height: *[0-9.]+(em|px|%|) *;?$')
  }
  if (tags.includes('table')) {
    patterns.push(
      `^border: *[0-9.]+(em|px|%|) *${BORDER_STYLE} *${COLOR} *;?$`,
      `^border-style: *${BORDER_STYLE} *;?$`,
      '^border-width: *[0-9.]+(em|px|%|) *;?$',
      `^border-color: *${COLOR} *;?$`,
      '^vertical-align: *(middle|top|bottom);?$',
      '^padding: *[0-9.]+(em|px|%|) *;?$',
      '^width: *[0-9.]+(em|px|%|) *;?$',
      '^height: *[0-9.]+(em|px|%|) *;?$',
      '^float: *(right|left|none) *;?$',
      '^border-collapse: *collapse *;?$',
      `^background-color: *${COLOR} *;?$`
    )
  }
  patterns.push('^text-align: *(center|left|right);?$')
  return patterns.map((pattern) => new RegExp(pattern, 'i'))
}

/** The modifiers a PHP pattern may carry that mean the same in JavaScript. */
const regexpFor = (regexp: SemanticField['regexp']): RegExp | null => {
  if (!regexp || typeof regexp.pattern !== 'string') return null
  const modifiers = typeof regexp.modifiers === 'string' ? regexp.modifiers : ''
  // A modifier JavaScript does not have — `x`, `U`, `D` — and upstream's own test cannot be
  // reproduced; a pattern that will not compile is ignored upstream, and here.
  if (!/^[imsu]*$/.test(modifiers)) return null
  try {
    return new RegExp(regexp.pattern, [...new Set(modifiers)].join(''))
  } catch {
    return null
  }
}

const numberOf = (value: unknown): number | undefined => {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isFinite(number) ? number : undefined
}

/** PHP's `is_numeric` for a string. */
const NUMERIC = /^[ \t\n\r\x0B\f]*[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?[ \t\n\r\x0B\f]*$/

/** PHP's `round`: halves away from zero. */
const round = (value: number, decimals: number): number => {
  const factor = 10 ** decimals
  return (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor
}

/** A key of a PHP array, for comparing a select's value with its options as upstream does. */
const phpKey = (value: Json): string =>
  typeof value === 'boolean' ? (value ? '1' : '0') : typeof value === 'number' ? String(Math.trunc(value)) : String(value)

/** `H5PCore::$relativePathRegExp`: a path into another content's folder, which is cut to its own part. */
const RELATIVE_PATH = /^((\.\.\/){1,2})(.*content\/)?(\d+|editor)\/(.+)$/

const SUB_CONTENT_ID = /^\{?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\}?$/

const CC_VERSIONS = [{ value: '4.0' }, { value: '3.0' }, { value: '2.5' }, { value: '2.0' }, { value: '1.0' }]

/** Upstream's `getMetadataSemantics`, as far as checking reads it. */
const METADATA_FIELDS: SemanticField[] = [
  { name: 'title', type: 'text' },
  { name: 'a11yTitle', type: 'text', optional: true },
  {
    name: 'license',
    type: 'select',
    options: [
      { value: 'U' },
      {
        type: 'optgroup',
        options: ['CC BY', 'CC BY-SA', 'CC BY-ND', 'CC BY-NC', 'CC BY-NC-SA', 'CC BY-NC-ND', 'CC0 1.0', 'CC PDM'].map((value) => ({ value }))
      },
      { value: 'GNU GPL' },
      { value: 'PD' },
      { value: 'ODC PDDL' },
      { value: 'C' }
    ]
  },
  { name: 'licenseVersion', type: 'select', options: CC_VERSIONS, optional: true },
  { name: 'yearFrom', type: 'number', min: '-9999', max: '9999', optional: true },
  { name: 'yearTo', type: 'number', min: '-9999', max: '9999', optional: true },
  { name: 'source', type: 'text', optional: true },
  {
    name: 'authors',
    type: 'list',
    field: {
      name: 'author',
      type: 'group',
      fields: [
        { name: 'name', type: 'text', optional: true },
        { name: 'role', type: 'select', options: ['Author', 'Editor', 'Licensee', 'Originator'].map((value) => ({ value })) }
      ]
    }
  },
  { name: 'licenseExtras', type: 'text', optional: true },
  {
    name: 'changes',
    type: 'list',
    field: {
      name: 'change',
      type: 'group',
      fields: [
        { name: 'date', type: 'text', optional: true },
        { name: 'author', type: 'text', optional: true },
        { name: 'log', type: 'text', optional: true }
      ]
    }
  },
  { name: 'authorComments', type: 'text', optional: true },
  { name: 'contentType', type: 'text' },
  { name: 'defaultLanguage', type: 'text' }
]

/** Upstream's `getCopyrightSemantics`: the copyright a file carries. */
const COPYRIGHT_FIELD: SemanticField = {
  name: 'copyright',
  type: 'group',
  fields: [
    { name: 'title', type: 'text', optional: true },
    { name: 'author', type: 'text', optional: true },
    { name: 'year', type: 'text', optional: true },
    { name: 'source', type: 'text', optional: true, regexp: { pattern: '^http[s]?://.+', modifiers: 'i' } },
    {
      name: 'license',
      type: 'select',
      options: ['U', 'CC BY', 'CC BY-SA', 'CC BY-ND', 'CC BY-NC', 'CC BY-NC-SA', 'CC BY-NC-ND', 'GNU GPL', 'PD', 'C'].map((value) => ({ value }))
    },
    { name: 'version', type: 'select', options: [] }
  ]
}

/** One run of the check, which collects what it has to say. */
class ContentChecker {
  readonly messages: string[] = []

  constructor(private readonly semantics: SemanticsTable) {}

  /** A value of any field: what it becomes, or `undefined` for removed. */
  check(value: Json, field: SemanticField): Json {
    switch (field.type) {
      case 'text':
        return this.text(value, field)
      case 'number':
        return this.number(value, field)
      case 'boolean':
        return typeof value === 'boolean' ? value : undefined
      case 'select':
        return this.select(value, field)
      case 'list':
        return this.list(value, field)
      case 'group':
        return this.group(value, field)
      case 'file':
        return this.file(value, field, [])
      case 'image':
        return this.file(value, field, ['width', 'height', 'originalImage'])
      case 'video':
        return this.variants(value, field, ['width', 'height', 'codecs', 'quality', 'bitrate'])
      case 'audio':
        return this.variants(value, field, [])
      case 'library':
        return this.library(value, field)
      default:
        this.messages.push(`unknown field type "${String(field.type)}" in semantics: ${String(field.name)} removed`)
        return undefined
    }
  }

  text(value: Json, field: SemanticField): string {
    let text = typeof value === 'string' ? value : ''
    if (field.tags !== undefined && field.tags !== null) {
      // Not testing for an empty list lets a field use the four defaults without naming them.
      const tags = ['div', 'span', 'p', 'br', ...(Array.isArray(field.tags) ? field.tags.filter((tag): tag is string => typeof tag === 'string') : [])]
      if (tags.includes('table')) tags.push('tr', 'td', 'th', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'figure', 'figcaption')
      if (tags.includes('b') && !tags.includes('strong')) tags.push('strong')
      if (tags.includes('i') && !tags.includes('em')) tags.push('em')
      // Upstream's precedence, kept: `ul`, or `ol` without `li`.
      if (tags.includes('ul') || (tags.includes('ol') && !tags.includes('li'))) tags.push('li')
      if (tags.includes('del') || (tags.includes('strike') && !tags.includes('s'))) tags.push('s')
      text = filterXss(text, tags, stylePatterns(field, Array.isArray(field.tags) ? field.tags : []))
    } else {
      text = escapeHtml(text)
    }

    const maxLength = numberOf(field.maxLength)
    if (maxLength !== undefined && maxLength >= 0) text = Array.from(text).slice(0, maxLength).join('')

    const pattern = regexpFor(field.regexp)
    if (pattern && !(text === '' && field.optional) && !pattern.test(text)) {
      this.messages.push(`${String(field.name)}: "${text.slice(0, 40)}" does not match its pattern, emptied`)
      text = ''
    }
    return text
  }

  number(value: Json, field: SemanticField): number {
    let number =
      typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && NUMERIC.test(value) ? Number(value) : 0
    if (!Number.isFinite(number)) number = 0
    const min = numberOf(field.min)
    const max = numberOf(field.max)
    if (min !== undefined && number < min) number = min
    if (max !== undefined && number > max) number = max
    const step = numberOf(field.step)
    if (step !== undefined && Math.trunc(step) >= 1) {
      const rest = Math.trunc(number - (min ?? 0)) % Math.trunc(step)
      if (rest !== 0) number -= rest
    }
    const decimals = numberOf(field.decimals)
    if (decimals !== undefined && decimals >= 0) number = round(number, Math.trunc(decimals))
    return number
  }

  select(value: Json, field: SemanticField): string | string[] {
    const optional = field.optional === true
    const options = new Set<string>()
    let strict = false
    let first: Json = undefined
    if (Array.isArray(field.options) && field.options.length > 0) {
      strict = true
      field.options.forEach((option, index) => {
        if (!isObject(option)) return
        if (option.type === 'optgroup') {
          if (Array.isArray(option.options)) for (const sub of option.options) if (isObject(sub) && sub.value != null) options.add(phpKey(sub.value))
        } else if (option.value != null) options.add(phpKey(option.value))
        if (index === 0) first = option.value
      })
    }
    const valid = (item: Json) => isScalar(item) && options.has(phpKey(item))

    if (field.multiple) {
      const items = Array.isArray(value) ? value : [value]
      const kept: string[] = []
      for (const item of items) {
        if (strict && !optional && !valid(item)) {
          this.messages.push(`${String(field.name)}: invalid option removed`)
          continue
        }
        if (isScalar(item)) kept.push(escapeHtml(phpString(item)))
      }
      return kept
    }

    let single = Array.isArray(value) ? value[0] : value
    if (strict && !optional && !valid(single)) {
      this.messages.push(`${String(field.name)}: invalid option replaced by the first`)
      single = first
    }
    return escapeHtml(phpString(single))
  }

  list(value: Json, field: SemanticField): Json[] | undefined {
    if (!Array.isArray(value)) return undefined
    const child = field.field
    if (!isObject(child as Json)) return undefined
    const max = numberOf(field.max)
    const items = max !== undefined && max >= 0 ? value.slice(0, Math.trunc(max)) : value
    const kept: Json[] = []
    for (const item of items) {
      const checked = this.check(item, child as SemanticField)
      if (checked !== undefined) kept.push(checked)
    }
    return kept.length ? kept : undefined
  }

  /**
   * A group's members, each by its own field; one the semantics do not name is removed. A group
   * of one field is written by the editor as that field's value alone, unless it is sub-content.
   */
  group(value: Json, field: SemanticField, flatten = true): Json {
    const fields = Array.isArray(field.fields) ? field.fields.filter((each) => isObject(each as Json)) : []
    const isSubContent = field.isSubContent === true
    if (fields.length === 1 && flatten && !isSubContent) return this.check(value, fields[0])
    if (!isObject(value)) return undefined

    for (const key of Object.keys(value)) {
      if (isSubContent && key === 'subContentId') {
        if (typeof value[key] !== 'string' || !SUB_CONTENT_ID.test(value[key] as string)) delete value[key]
        continue
      }
      const member = fields.find((each) => each.name === key)
      if (!member) {
        delete value[key]
        continue
      }
      const checked = this.check(value[key], field.optional ? { ...member, optional: true } : member)
      if (checked === undefined) delete value[key]
      else value[key] = checked
    }
    return value
  }

  /**
   * Sub-content: a library one of the field's options names, with its parameters checked against
   * that library's own semantics, its metadata against the platforms', and nothing else kept.
   */
  library(value: Json, field: SemanticField): Json {
    if (!isObject(value) || typeof value.library !== 'string') return undefined
    const wanted = parseLibrary(value.library)
    const names = (Array.isArray(field.options) ? field.options : [])
      .map((option) => (typeof option === 'string' ? option : isObject(option as Json) && typeof (option as Fields).name === 'string' ? ((option as Fields).name as string) : null))
      .filter((name): name is string => name !== null)
    const accepted =
      wanted !== null &&
      names.some((name) => {
        const option = parseLibrary(name)
        return name === value.library || (option !== null && option.machineName === wanted.machineName && option.major === wanted.major)
      })
    if (!accepted || !wanted) {
      this.messages.push(`the library ${value.library} is not one ${String(field.name ?? 'the field')} allows: removed`)
      return undefined
    }

    const semantics = this.semantics.get(libraryKey(wanted))
    if (!semantics) {
      this.messages.push(`no semantics for ${value.library}: removed`)
      return undefined
    }

    value.params = this.group(isObject(value.params) ? value.params : {}, { type: 'group', fields: semantics }, false) as Fields
    if (value.metadata !== undefined && value.metadata !== null) value.metadata = checkMetadata(value.metadata, this)

    const keys = ['library', 'params', 'subContentId', 'metadata', ...extraAttributes(field)]
    keep(value, keys)
    if (value.subContentId !== undefined && !(typeof value.subContentId === 'string' && SUB_CONTENT_ID.test(value.subContentId))) {
      delete value.subContentId
    }
    return value
  }

  /** A file, an image or one variant of a video or audio: its path cut to its own, its few keys escaped, the rest removed. */
  file(value: Json, field: SemanticField, typeKeys: string[]): Json {
    if (!isObject(value)) return undefined
    let path = typeof value.path === 'string' ? value.path : ''
    const relative = RELATIVE_PATH.exec(path)
    if (relative) path = relative[5]
    if (path.endsWith('#tmp')) path = path.slice(0, -4)
    value.path = escapeHtml(path)
    if (value.mime !== undefined && value.mime !== null) value.mime = escapeHtml(phpString(value.mime))

    const keys = ['path', 'mime', 'copyright', ...typeKeys, ...extraAttributes(field)]
    // Upstream's own exception: a quality's name, which a video's `metadata` can carry.
    if (keys.includes('metadata') && isObject(value.metadata) && value.metadata.qualityName !== undefined && value.metadata.qualityName !== null) {
      value.metadata.qualityName = escapeHtml(phpString(value.metadata.qualityName))
    }
    keep(value, keys)

    if (value.width !== undefined && value.width !== null) value.width = intval(value.width)
    if (value.height !== undefined && value.height !== null) value.height = intval(value.height)
    if (value.codecs !== undefined && value.codecs !== null) value.codecs = escapeHtml(phpString(value.codecs))
    if (value.bitrate !== undefined && value.bitrate !== null) value.bitrate = intval(value.bitrate)
    if (value.quality !== undefined && value.quality !== null) {
      const quality = value.quality
      if (!isObject(quality) || quality.level === undefined || quality.level === null || quality.label === undefined || quality.label === null) {
        delete value.quality
      } else {
        keep(quality, ['level', 'label'])
        quality.level = intval(quality.level)
        quality.label = escapeHtml(phpString(quality.label))
      }
    }
    if (value.copyright !== undefined && value.copyright !== null) {
      const copyright = this.group(value.copyright, COPYRIGHT_FIELD)
      if (copyright === undefined) delete value.copyright
      else value.copyright = copyright
    }
    return value
  }

  /** A video's or an audio's sources, each checked as a file. */
  variants(value: Json, field: SemanticField, typeKeys: string[]): Json[] | undefined {
    if (!Array.isArray(value)) return undefined
    return value.map((variant) => this.file(variant, field, typeKeys)).filter((variant) => variant !== undefined)
  }
}

const extraAttributes = (field: SemanticField): string[] =>
  Array.isArray(field.extraAttributes) ? field.extraAttributes.filter((name): name is string => typeof name === 'string') : []

/** Upstream's `filterParams`: only the keys named. */
function keep(value: Fields, keys: string[]): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) delete value[key]
}

function checkMetadata(metadata: Json, checker: ContentChecker): Fields {
  const group: Fields = isObject(metadata) ? metadata : {}
  // Old content without a licence would otherwise read as an invalid option.
  if (group.license === undefined || group.license === null) group.license = 'U'
  return checker.group(group, { type: 'group', fields: METADATA_FIELDS }, false) as Fields
}

/**
 * Upstream's `validateMetadata`, for content's own metadata — `h5p.json`'s, in the shape the
 * runtime reads — as the platforms check it when they load content. A copy; the input is untouched.
 */
export function checkContentMetadata(metadata: Json): { metadata: Fields; messages: string[] } {
  const checker = new ContentChecker(new Map())
  const copy = metadata === undefined ? undefined : (JSON.parse(JSON.stringify(metadata)) as Json)
  return { metadata: checkMetadata(copy, checker), messages: checker.messages }
}

/**
 * The content's parameters checked against the semantics of `library` — the main library's
 * string, as the content is to run it — and of every library it names, all already in
 * `semantics`. Throws when the main library has none: content that cannot be checked does not
 * play. A copy; the input is untouched.
 */
export function checkContent(library: string, params: Json, semantics: SemanticsTable): CheckResult {
  const main = parseLibrary(library)
  if (!main) throw new Error(`"${library}" is not a library name`)
  if (!semantics.get(libraryKey(main))) throw new Error(`there is no semantics.json for ${library}`)
  const checker = new ContentChecker(semantics)
  const root: Fields = { library, params: isObject(params) ? (JSON.parse(JSON.stringify(params)) as Fields) : {} }
  checker.library(root, { type: 'library', options: [library] })
  return { params: root.params as Fields, messages: checker.messages }
}
