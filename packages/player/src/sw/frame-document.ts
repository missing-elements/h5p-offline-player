import type { FrameAssets, FrameFont, FrameOptions } from '../shared/protocol'
import { contentMetadata, type ContentMetadata } from '../shared/metadata'
import { isEnglish, LANGUAGE_TAG } from '../shared/language'

/**
 * The frame document, generated per request. H5P core assumes it owns the page — it plants
 * `H5P`, `H5PIntegration` and jQuery on `window`, ships global CSS and drives its own fullscreen
 * and resize logic — so it gets a document of its own, exactly as it does on h5p.org. Nothing is
 * served from disk: the Service Worker answers the navigation with this string.
 *
 * The document element carries `class="h5p-iframe"`. H5P's core stylesheet keys seven rules on
 * `html.h5p-iframe` — the base font, the content's 16px/1.5 type, full width, the fullscreen
 * heights — because in a normal H5P install the content lives in an iframe whose `<html>` H5P
 * writes itself. Div embedding puts that class on a `<div>` instead, where none of those
 * selectors can match, and the content renders unstyled. This document *is* the H5P document,
 * so it is the one that should carry the class.
 */

/**
 * Origins that real content types reach at runtime, by the directive that governs them.
 * H5P.MathDisplay fetches MathJax from a CDN and renders nothing without it; H5P.ArithmeticQuiz
 * and its relatives pull Google's WebFont loader, which then injects a Google Fonts stylesheet
 * and fetches the font files themselves — three origins across three directives for one feature.
 * Everything else stays same-origin.
 *
 * These are written without a scheme on purpose. A host-source with no scheme is matched against
 * the page's own scheme, so an https frame accepts only https, while an http one — in practice
 * only `http://localhost` during development — also accepts http. That matters here because the
 * WebFont snippet builds its URL from `document.location.protocol`: pinning these to `https:`
 * would block the very content this list exists to allow, on the one origin where it is not a
 * downgrade to permit it.
 */
const RUNTIME_ALLOWLIST = {
  script: [
    // MathJax, for H5P.MathDisplay.
    'cdn.jsdelivr.net',
    'cdnjs.cloudflare.com',
    // Google's WebFont loader.
    'ajax.googleapis.com',
    // The video providers H5P.Video ships a handler for. Each loads a player API into this
    // document before putting the player itself in an iframe, which `frame-src *` covers.
    // Taken from H5P.Video's own scripts; Echo360 needs no script of its own.
    'www.youtube.com',
    'player.vimeo.com',
    'developers.panopto.com'
  ],
  style: ['fonts.googleapis.com'],
  font: ['fonts.gstatic.com', 'fonts.googleapis.com']
} as const

/**
 * The request header the runtime's boot script (0.2 and later) asks for an untrusted package's
 * `content/content.json` with, `semantics` as its value: it checks the content against its
 * libraries' semantics before the runtime reads it, and the worker serves the file to nothing else.
 */
export const CONTENT_CHECK_HEADER = 'x-h5p-content-check'

/**
 * What an `untrusted` package's frame may load scripts from beyond its own path and the runtime's
 * files: the video players' APIs H5P.Video loads, each by exact path — YouTube's `iframe_api` then
 * its widget script under `/s/player/`, Vimeo's `player.js`, Panopto's embed API. Whole hosts would
 * let markup a package injects load any script those hosts serve; a CDN such as jsDelivr serves
 * any file on npm and GitHub. MathJax is not here: H5P.MathDisplay carries it in its own folder
 * since 1.0, and an older copy fetching it from a CDN is the package's code, which does not run.
 * Google's WebFont loader is not here either, so an old Arithmetic Quiz falls back to its fonts.
 */
const UNTRUSTED_SCRIPT_PATHS = [
  'https://www.youtube.com/iframe_api',
  'https://www.youtube.com/s/player/',
  'https://player.vimeo.com/api/player.js',
  'https://developers.panopto.com/scripts/'
]

/**
 * A CSP host-source, and nothing else. Values reach this from the host page's own markup, but
 * they end up inside a policy: one containing a `;` or a quote would append directives of its
 * own rather than a host, so anything that is not plainly a host is dropped.
 */
const HOST_SOURCE = /^(?:(?:https?|wss?):\/\/)?(?:\*\.)?[a-z0-9.-]+(?::\d+)?$/i

export function sanitizeOrigins(values: readonly string[] | undefined): string[] {
  if (!values) return []
  return [...new Set(values.map((value) => value.trim()).filter((value) => HOST_SOURCE.test(value)))]
}

export interface FrameDocumentOptions {
  pkgId: string
  /** Absolute URL of the package root on the virtual file server, without a trailing slash. */
  virtualRoot: string
  assets: FrameAssets
  nonce: string
  title?: string
  /** The manifest's metadata, for the runtime's copyright dialog and the statements' object name. */
  metadata?: ContentMetadata
  /**
   * Extra origins the host vouches for, for content that reaches somewhere this package cannot
   * know about — a tenant's own Panopto or Echo360 host, an in-house CDN.
   */
  allowOrigins?: string[]
  /** What the host asked the frame to show and load; see `FrameOptions`. */
  frameOptions?: FrameOptions
  /**
   * The library folders that carry an `upgrades.js`, for the boot script's upgrade of content
   * written for an older minor than the one served.
   */
  upgrades?: string[]
  /** The language tag the element was in, which H5P's own strings follow; English without one. */
  language?: string
  /** Played as data: scripts by exact path only. See `untrustedScriptSources`. */
  untrusted?: boolean
  /** The URL of the worker serving the frame, which Firefox checks a script it made up against. */
  workerScript?: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * The frame's boot script. It is a file of the runtime package rather than a string inlined here
 * — it runs in the H5P document and calls the core's API, so it ships with the core, under the
 * core's licence, and this worker only names it. A record written by an element before 0.5
 * carries no `bootJs`; the file sits beside `main.bundle.js` in every layout the runtime is
 * served in, so that is where it is looked for then.
 */
export function bootScriptUrl(assets: FrameAssets): string {
  if (assets.bootJs) return assets.bootJs
  try {
    return new URL('frame-boot.js', assets.mainJs).href
  } catch {
    return 'frame-boot.js'
  }
}

/** A tag from a record, which came back from IndexedDB: held to a tag's shape, `und` read as none. */
function recordedTag(value: unknown): string | undefined {
  return typeof value === 'string' && LANGUAGE_TAG.test(value) && value.toLowerCase() !== 'und' ? value : undefined
}

/** The language H5P's own buttons and dialogs are in: the element's, else English, the core's own. */
function frameLanguage(language: string | undefined): string {
  return recordedTag(language) ?? 'en'
}

/**
 * The document's language, which is the content's: `h5p.json`'s `defaultLanguage`, which H5P
 * writes as the `lang` of the iframe it makes, so that a screen reader reads the content in its
 * own language while the buttons around it follow the page's. A package that names none takes the
 * element's language, likelier its own than English is; with neither, the document is English.
 */
function documentLanguage(metadata: ContentMetadata | undefined, language: string | undefined): string {
  return recordedTag(metadata?.defaultLanguage) ?? frameLanguage(language)
}

/**
 * The runtime's `l10n.js`, which the boot script picks the core's strings from, when the frame
 * needs it: in any language but English, the core's own. The URL comes back from IndexedDB too,
 * so it is held to http(s), like the host's own scripts. A record an older element wrote has
 * none, and its frame stays English.
 */
function l10nScriptUrl(assets: FrameAssets, language: string): string | undefined {
  if (isEnglish(language)) return undefined
  return customUrls(typeof assets.l10nJs === 'string' ? [assets.l10nJs] : [])[0]
}

/** Origins that appear in a CSP directive, deduplicated. `'self'` covers same-origin assets. */
function assetOrigins(assets: FrameAssets, base: string, language: string): string[] {
  const origins = new Set<string>()
  const strings = l10nScriptUrl(assets, language)
  const urls = [
    assets.mainJs,
    assets.frameJs,
    assets.frameCss,
    bootScriptUrl(assets),
    ...(assets.fonts ?? []).map((font) => font.url),
    ...(strings ? [strings] : [])
  ]
  for (const url of urls) {
    try {
      const origin = new URL(url, base).origin
      if (origin !== new URL(base).origin) origins.add(origin)
    } catch {
      // An unparseable asset URL is left out of the policy; the load then fails visibly.
    }
  }
  return [...origins]
}

/**
 * The `@font-face` rules for the text faces `sync-h5p-assets.mjs` took out of the core sheet, so
 * that each face is its own file a bundler can emit and the browser fetches only the ones in use.
 * The values arrive through IndexedDB, so each is held to the shape the sync script writes and a
 * face that does not fit is left out rather than escaped: a URL is reparsed and must be http(s),
 * and a parsed URL's `href` has `"`, `<` and whitespace percent-encoded, so it cannot leave the
 * quoted `url()` or the `<style>` block.
 */
export function fontFaceRules(fonts: readonly FrameFont[] | undefined): string {
  if (!fonts) return ''
  return fonts
    .flatMap(({ family, style, weight, url }) => {
      if (!/^[A-Za-z][A-Za-z0-9 -]*$/.test(family) || !/^(normal|italic)$/.test(style) || !/^\d{3}$/.test(weight)) {
        return []
      }
      let href: string
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return []
        href = parsed.href
      } catch {
        return []
      }
      return [
        `  @font-face { font-display: swap; font-family: '${family}'; font-style: ${style}; font-weight: ${weight}; src: url("${href}") format('woff2'); }`
      ]
    })
    .join('\n')
}

/**
 * The host's own stylesheets and scripts, held to the shape the element writes: absolute http(s)
 * URLs. They arrive through IndexedDB like the fonts, so anything else is dropped here rather than
 * written into the document.
 */
function customUrls(urls: readonly string[] | undefined): string[] {
  return (urls ?? []).flatMap((url) => {
    try {
      const parsed = new URL(url)
      return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? [parsed.href] : []
    } catch {
      return []
    }
  })
}

/** The origins of those URLs that are not the frame's own, for the directive each kind loads under. */
function customOrigins(urls: readonly string[], base: string): string[] {
  const own = new URL(base).origin
  return [...new Set(urls.map((url) => new URL(url).origin).filter((origin) => origin !== own))]
}

/**
 * The options as the boot script may see them: each value checked for its type, the URLs for
 * their shape, so a record from an older or a tampered store cannot hand the runtime a surprise.
 */
function sanitizeFrameOptions(options: FrameOptions | undefined): FrameOptions | undefined {
  if (!options) return undefined
  const out: FrameOptions = {}
  for (const flag of ['frame', 'copyright', 'export', 'icon', 'embed', 'fullScreen', 'reportingIsEnabled'] as const) {
    if (typeof options[flag] === 'boolean') out[flag] = options[flag]
  }
  for (const text of ['embedCode', 'resizeCode', 'activityId'] as const) {
    if (typeof options[text] === 'string' && options[text]) out[text] = options[text]
  }
  const [downloadUrl] = customUrls(options.downloadUrl ? [options.downloadUrl] : [])
  if (downloadUrl) out.downloadUrl = downloadUrl
  const customCss = customUrls(options.customCss)
  if (customCss.length) out.customCss = customCss
  const customJs = customUrls(options.customJs)
  if (customJs.length) out.customJs = customJs
  return Object.keys(out).length ? out : undefined
}

/**
 * Where an `untrusted` package's frame may load scripts from: the package's own path on the
 * virtual file server, which serves library code only from the attached bundle; the runtime's
 * files and the host's own `custom-js`, each by exact URL; and the video players' APIs. Not
 * `'self'`: the frame shares the host's origin, and `'self'` would let markup a package injects
 * load any script on the host's whole site, a JSONP endpoint or an old framework among them, which
 * `'unsafe-eval'` makes worse.
 */
function untrustedScriptSources(options: FrameDocumentOptions): string[] {
  const strings = l10nScriptUrl(options.assets, frameLanguage(options.language))
  const files = [
    options.assets.mainJs,
    options.assets.frameJs,
    bootScriptUrl(options.assets),
    ...(strings ? [strings] : []),
    ...customUrls(options.frameOptions?.customJs),
    ...(options.workerScript ? [options.workerScript] : [])
  ]
  return [pathSource(`${options.virtualRoot}/`, options.virtualRoot), ...files.map((url) => pathSource(url, options.virtualRoot)), ...UNTRUSTED_SCRIPT_PATHS].filter(
    (source): source is string => source !== null
  )
}

/**
 * A URL as a CSP source by its path: origin and path only, since a source carries no query, and
 * `;` and `,` percent-encoded so a URL cannot end the directive or the policy. The browser decodes
 * a path before it compares, so the encoded source still matches. `null` for what is not http(s).
 */
function pathSource(url: string, base: string): string | null {
  try {
    const parsed = new URL(url, base)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return `${parsed.origin}${parsed.pathname.replaceAll(';', '%3B').replaceAll(',', '%2C')}`
  } catch {
    return null
  }
}

export function buildContentSecurityPolicy(options: FrameDocumentOptions): string {
  const origins = assetOrigins(options.assets, options.virtualRoot, frameLanguage(options.language))
  const extra = sanitizeOrigins(options.allowOrigins)
  // The host's own stylesheets and scripts are the host's choice, like `assets-base`: their
  // origins join the directive they load under without an `allow-origins` entry.
  const customCss = customOrigins(customUrls(options.frameOptions?.customCss), options.virtualRoot)
  const customJs = customOrigins(customUrls(options.frameOptions?.customJs), options.virtualRoot)
  const directive = (name: string, ...sources: string[]) =>
    `${name} ${sources.filter(Boolean).join(' ')}`

  return [
    `default-src 'self'`,
    directive(
      'script-src',
      ...(options.untrusted ? untrustedScriptSources(options) : ["'self'", ...origins, ...customJs, ...RUNTIME_ALLOWLIST.script]),
      ...extra,
      `'nonce-${options.nonce}'`,
      // EmbeddedJS compiles its templates with `eval`, and content types built on it — the board
      // games, older question sets — render nothing without this.
      //
      // It buys an attacker nothing here. The archive's own scripts are served from this origin
      // and already run under `'self'` with no restriction, so anyone who can put a file in the
      // package can already run whatever they like; evaluating a string they also control adds
      // no reach. What this policy is for is limiting where code and data can come *from*, and
      // `'unsafe-eval'` does not widen that.
      "'unsafe-eval'"
    ),
    // CKEditor-authored text carries `style="…"` on nearly every field, so inline styles cannot
    // be refused without breaking the majority of real content.
    directive(
      'style-src',
      "'self'",
      ...origins,
      ...customCss,
      ...RUNTIME_ALLOWLIST.style,
      ...extra,
      "'unsafe-inline'"
    ),
    directive('font-src', "'self'", ...origins, ...RUNTIME_ALLOWLIST.font, ...extra, 'data:'),
    // Left open: content types embed YouTube, Vimeo and externally hosted media.
    `img-src * data: blob:`,
    `media-src * data: blob:`,
    `frame-src *`,
    // Deliberately narrow: this blocks the few content types that fetch external data files
    // (remote subtitles, remote JSON). Accepted for v1.
    directive('connect-src', "'self'", ...extra),
    `worker-src 'self' blob:`,
    `object-src 'none'`,
    // `'self'`, not `'none'`: H5P sets a `<base>` to the frame's own URL, and refusing it logs
    // an error on every load. Same-origin still keeps the protection that matters — a hostile
    // script cannot repoint the document's relative URLs at another origin.
    `base-uri 'self'`,
    `form-action 'none'`
  ].join('; ')
}

export function buildFrameDocument(options: FrameDocumentOptions): string {
  const { pkgId, virtualRoot, assets, nonce } = options
  const csp = buildContentSecurityPolicy(options)
  const language = frameLanguage(options.language)
  const l10nJs = l10nScriptUrl(assets, language)

  // A JSON block, not a script: it is data, so it needs no nonce, and the boot script proper —
  // `frame-boot.js` from the runtime package, loaded by URL under the nonce — is the same bytes
  // for every package. `<` is escaped so no value can end the block early.
  const bootConfig = JSON.stringify({
    pkgId,
    h5pJsonPath: virtualRoot,
    frameJs: assets.frameJs,
    frameCss: assets.frameCss,
    title: options.title,
    // Checked again on the way out, as the options are: the record came back from IndexedDB.
    metadata: contentMetadata(options.metadata),
    options: sanitizeFrameOptions(options.frameOptions),
    upgrades: options.upgrades,
    // What the boot script picks H5P's own strings by, when it has the runtime's translations.
    language: l10nJs ? language : undefined,
    // The boot script checks the content against its libraries' semantics, and asks for it with
    // `CONTENT_CHECK_HEADER`, which is how the worker knows it will.
    untrusted: options.untrusted || undefined
  }).replaceAll('<', '\\u003c')

  const fontFaces = fontFaceRules(assets.fonts)
  // The core's strings in every language the runtime has, a script that leaves them on `window`
  // for the boot script, which picks the element's language and hands its strings to
  // h5p-standalone: so it comes before it.
  const strings = l10nJs ? `<script nonce="${nonce}" src="${escapeHtml(l10nJs)}" charset="UTF-8"></script>\n` : ''

  // The last rule in the style block is for H5P.Video's YouTube handler, which pins its iframe
  // over the 16:9 box it builds with one line that reaches into the YouTube API object's minified
  // internals (`player.g.style = …`). The field it names changed, so up to H5P.Video 1.6.66 the
  // line throws and the iframe flows below the box instead: a black picture with sound. The rule
  // says what that line meant; a fixed library (1.6.80, `getIframe()`) sets the same styles.
  return `<!DOCTYPE html>
<html lang="${escapeHtml(documentLanguage(options.metadata, options.language))}" class="h5p-iframe">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">
<title>${escapeHtml(options.title ?? 'H5P content')}</title>
<style nonce="${nonce}">
  html, body { background: transparent; }
  body { overflow-x: hidden; }
  #h5p-root { width: 100%; }
  .h5p-video.h5p-youtube iframe { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
${fontFaces}
</style>
</head>
<body>
<div id="h5p-root"></div>
<script nonce="${nonce}" src="${escapeHtml(assets.mainJs)}" charset="UTF-8"></script>
${strings}<script type="application/json" id="h5p-boot-config">${bootConfig}</script>
<script nonce="${nonce}" src="${escapeHtml(bootScriptUrl(assets))}"></script>
</body>
</html>`
}

/** A fresh nonce per response: reusing one across responses would defeat the point of having it. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
