import { describe, expect, it } from 'vitest'
import {
  buildContentSecurityPolicy,
  buildFrameDocument,
  createNonce
} from '../../src/sw/frame-document'

const PKG = 'b'.repeat(32)

const options = {
  pkgId: PKG,
  virtualRoot: `https://site.example/assets/h5p/virtual/${PKG}`,
  assets: {
    mainJs: 'https://site.example/frame-assets/main.bundle.js',
    frameJs: 'https://site.example/frame-assets/frame.bundle.js',
    frameCss: 'https://site.example/frame-assets/styles/h5p.css'
  },
  nonce: 'deadbeef',
  title: 'A course'
}

describe('buildContentSecurityPolicy', () => {
  it('allows the per-response nonce and nothing else inline', () => {
    const csp = buildContentSecurityPolicy(options)
    expect(csp).toContain("'nonce-deadbeef'")
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'")
  })

  it('allows a cross-origin assets base, because assets-base may point at a CDN', () => {
    const csp = buildContentSecurityPolicy({
      ...options,
      assets: {
        mainJs: 'https://cdn.example/dist/main.bundle.js',
        frameJs: 'https://cdn.example/dist/frame.bundle.js',
        frameCss: 'https://cdn.example/dist/styles/h5p.css'
      }
    })
    expect(csp).toContain('https://cdn.example')
  })

  it('does not list the frame origin, which is already covered by self', () => {
    const csp = buildContentSecurityPolicy(options)
    expect(csp).not.toContain('https://site.example ')
  })

  it('allows inline styles, which CKEditor-authored content carries on nearly every field', () => {
    expect(buildContentSecurityPolicy(options)).toMatch(/style-src[^;]*'unsafe-inline'/)
  })

  it('allows the Google WebFont loader and the fonts it then pulls', () => {
    const csp = buildContentSecurityPolicy(options)

    // H5P.ArithmeticQuiz and its relatives load this at runtime; the loader then injects a
    // Google Fonts stylesheet, which in turn fetches font files from a third origin.
    expect(csp).toMatch(/script-src[^;]*\bajax\.googleapis\.com\b/)
    expect(csp).toMatch(/style-src[^;]*\bfonts\.googleapis\.com\b/)
    expect(csp).toMatch(/font-src[^;]*\bfonts\.gstatic\.com\b/)
  })

  it('writes runtime origins without a scheme, so they track the page scheme', () => {
    const csp = buildContentSecurityPolicy(options)

    // The WebFont snippet builds its URL from `document.location.protocol`. A scheme-less
    // host-source is matched against the page's own scheme, so an https frame still accepts
    // only https while `http://localhost` in development accepts the http URL it asks for.
    // Pinning these to `https:` is what made the loader fail on localhost.
    expect(csp).not.toContain('https://ajax.googleapis.com')
    expect(csp).not.toContain('https://cdn.jsdelivr.net')
    expect(csp).toMatch(/script-src[^;]*\bcdn\.jsdelivr\.net\b/)
  })

  it('allows the player APIs H5P.Video loads before it embeds anything', () => {
    const csp = buildContentSecurityPolicy(options)

    // Each provider puts a script in this document first and the player in an iframe after; the
    // iframe is covered by `frame-src`, the script is not. Taken from H5P.Video's own handlers.
    expect(csp).toMatch(/script-src[^;]*\bwww\.youtube\.com\b/)
    expect(csp).toMatch(/script-src[^;]*\bplayer\.vimeo\.com\b/)
    expect(csp).toMatch(/script-src[^;]*\bdevelopers\.panopto\.com\b/)
  })

  it('leaves media and frames open for YouTube and externally hosted video', () => {
    const csp = buildContentSecurityPolicy(options)
    expect(csp).toContain('media-src * data: blob:')
    expect(csp).toContain('frame-src *')
  })

  it('allows eval, which template engines shipped inside packages depend on', () => {
    // EmbeddedJS compiles its templates with `eval`, and the content types built on it render
    // nothing without this. It gives an attacker no reach the archive's own scripts lack: those
    // are served from this origin and already run under `'self'`.
    expect(buildContentSecurityPolicy(options)).toMatch(/script-src[^;]*'unsafe-eval'/)
  })

  it('keeps the escapes that matter closed', () => {
    const csp = buildContentSecurityPolicy(options)
    expect(csp).toContain("object-src 'none'")
    // `'self'` rather than `'none'`: H5P sets a same-origin `<base>`, and relative URLs still
    // cannot be repointed at another origin.
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("connect-src 'self'")
  })
})

describe('buildFrameDocument', () => {
  const html = buildFrameDocument(options)

  it('boots the runtime against the virtual file server', () => {
    expect(html).toContain(`"h5pJsonPath":"${options.virtualRoot}"`)
  })

  it('uses div embedding, so there is no inner about:blank frame to inherit a controller', () => {
    expect(html).toContain("embedType: 'div'")
  })

  it('turns off every result endpoint, because there is no server to post to', () => {
    expect(html).toContain('postUserStatistics: false')
    expect(html).toContain('saveFreq: false')
  })

  it('marks the document element the way H5P core styles expect', () => {
    // Seven rules in the core stylesheet are keyed on `html.h5p-iframe` — the base font, the
    // content's 16px/1.5 type, full width, the fullscreen heights. Div embedding puts that
    // class on a div, where none of them can match, so this document carries it instead.
    expect(html).toContain('<html lang="en" class="h5p-iframe">')
  })

  it('carries the policy and the nonce on the scripts it generates', () => {
    expect(html).toContain('http-equiv="Content-Security-Policy"')
    expect(html).toContain(`<script nonce="${options.nonce}"`)
  })

  it('escapes the title, which comes out of an untrusted h5p.json', () => {
    const hostile = buildFrameDocument({ ...options, title: '</title><script>alert(1)</script>' })
    expect(hostile).not.toContain('<script>alert(1)</script>')
    expect(hostile).toContain('&lt;script&gt;')
  })

  it('reports a runtime script or stylesheet that fails to load, in the capture phase', () => {
    // A failed resource fires 'error' on its own element and never bubbles, and the runtime's
    // loader waits on 'load' alone: without a capturing listener a library the server could not
    // deliver leaves the boot hanging with nothing reported anywhere.
    expect(html).toMatch(/window\.addEventListener\('error', function \(event\) \{[\s\S]*\}, true\);/)
    expect(html).toContain('Could not load ')
    // Only the tags the runtime injected itself, which it marks data-h5p: a content image that
    // 404s is the content's business.
    expect(html).toContain('target.dataset.h5p')
  })

  it('pins a YouTube iframe over its box, which H5P.Video up to 1.6.66 fails to do itself', () => {
    // Its handler sets the style through a minified private field of the YouTube API object,
    // `player.g`, which YouTube renamed; the line throws and the iframe lands below its 16:9 box,
    // clipped away by the wrapper — a black picture with sound.
    expect(html).toMatch(/\.h5p-video\.h5p-youtube iframe \{ position: absolute; top: 0; left: 0; width: 100%; height: 100%; \}/)
  })

  it('forwards xAPI to the parent, the only channel results have', () => {
    expect(html).toContain("dispatcher.on('xAPI'")
    expect(html).toContain('parent.postMessage')
  })

  it('relays the worker job requests the Service Worker cannot run itself', () => {
    expect(html).toContain("data.type === 'need-job'")
  })
})

describe('allow-origins', () => {
  const withOrigins = (allowOrigins: string[]) =>
    buildContentSecurityPolicy({ ...options, allowOrigins })

  it('adds a host the built-in list cannot know about', () => {
    const csp = withOrigins(['https://tenant.panopto.com'])

    // A tenant's own video host reaches this document for a script and, for some providers,
    // for data — so it goes on every directive a host source can help with.
    expect(csp).toMatch(/script-src[^;]*https:\/\/tenant\.panopto\.com/)
    expect(csp).toMatch(/style-src[^;]*https:\/\/tenant\.panopto\.com/)
    expect(csp).toMatch(/font-src[^;]*https:\/\/tenant\.panopto\.com/)
    expect(csp).toMatch(/connect-src[^;]*https:\/\/tenant\.panopto\.com/)
  })

  it('accepts the forms a CSP host-source takes', () => {
    const csp = withOrigins(['*.example.com', 'cdn.example.com:8443', 'wss://live.example.com'])
    expect(csp).toContain('*.example.com')
    expect(csp).toContain('cdn.example.com:8443')
    expect(csp).toContain('wss://live.example.com')
  })

  it('drops a value that would append directives of its own', () => {
    // The attribute comes from the host's markup, but a value carrying a `;` would end the
    // directive and start another — a stray quote or space likewise.
    const csp = withOrigins([
      "evil.example; script-src *",
      "'unsafe-inline'",
      'https://ok.example'
    ])

    expect(csp).not.toContain('evil.example')
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/)
    expect(csp).toContain('https://ok.example')
  })

  it('does not repeat a host given twice', () => {
    const csp = withOrigins(['a.example', 'a.example'])
    expect(csp.match(/a\.example/g)).toHaveLength(4)
  })
})

describe('createNonce', () => {
  it('is fresh per response, or it would not be a nonce', () => {
    expect(createNonce()).not.toBe(createNonce())
  })

  it('is long enough to be unguessable', () => {
    expect(createNonce()).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('the boot script', () => {
  it('posts to its own origin, never to whatever page happens to frame the document', () => {
    const html = buildFrameDocument(options)
    expect(html).toContain('parent.postMessage(')
    // Package ids are derived from the URL, so frame URLs are guessable; a wildcard here would
    // hand every xAPI statement to any third-party page that framed one.
    expect(html).not.toMatch(/parent\.postMessage\([^;]*'\*'\)/)
    expect(html).toMatch(/parent\.postMessage\([^;]*location\.origin\)/)
  })
})
