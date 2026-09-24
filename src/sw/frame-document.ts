import bootSource from 'virtual:h5p-frame-boot'
import type { FrameAssets } from '../shared/protocol'

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
  /**
   * Extra origins the host vouches for, for content that reaches somewhere this package cannot
   * know about — a tenant's own Panopto or Echo360 host, an in-house CDN.
   */
  allowOrigins?: string[]
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Origins that appear in a CSP directive, deduplicated. `'self'` covers same-origin assets. */
function assetOrigins(assets: FrameAssets, base: string): string[] {
  const origins = new Set<string>()
  for (const url of Object.values(assets)) {
    try {
      const origin = new URL(url, base).origin
      if (origin !== new URL(base).origin) origins.add(origin)
    } catch {
      // An unparseable asset URL is left out of the policy; the load then fails visibly.
    }
  }
  return [...origins]
}

export function buildContentSecurityPolicy(options: FrameDocumentOptions): string {
  const origins = assetOrigins(options.assets, options.virtualRoot)
  const extra = sanitizeOrigins(options.allowOrigins)
  const directive = (name: string, ...sources: string[]) =>
    `${name} ${sources.filter(Boolean).join(' ')}`

  return [
    `default-src 'self'`,
    directive(
      'script-src',
      "'self'",
      ...origins,
      ...RUNTIME_ALLOWLIST.script,
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

  // A JSON block, not a script: it is data, so it needs no nonce, and the boot script proper is
  // then the same bytes for every package. `<` is escaped so no value can end the block early.
  const bootConfig = JSON.stringify({
    pkgId,
    h5pJsonPath: virtualRoot,
    frameJs: assets.frameJs,
    frameCss: assets.frameCss
  }).replaceAll('<', '\\u003c')

  // The last rule in the style block is for H5P.Video's YouTube handler, which pins its iframe
  // over the 16:9 box it builds with one line that reaches into the YouTube API object's minified
  // internals (`player.g.style = …`). The field it names changed, so up to H5P.Video 1.6.66 the
  // line throws and the iframe flows below the box instead: a black picture with sound. The rule
  // says what that line meant; a fixed library (1.6.80, `getIframe()`) sets the same styles.
  return `<!DOCTYPE html>
<html lang="en" class="h5p-iframe">
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
</style>
</head>
<body>
<div id="h5p-root"></div>
<script nonce="${nonce}" src="${escapeHtml(assets.mainJs)}" charset="UTF-8"></script>
<script type="application/json" id="h5p-boot-config">${bootConfig}</script>
<script nonce="${nonce}">${bootSource}</script>
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
