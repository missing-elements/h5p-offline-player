import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { viewPage } from '../src/page.mjs'
import { webviewHtml } from '../src/webview.mjs'

const config = {
  origin: 'http://127.0.0.1:4646',
  id: '0123456789abcdef',
  name: '</script><b>quiz</b>.h5p',
  untrusted: false,
  newest: true,
  restricted: false,
  lang: 'en'
}

const WEBVIEW_ORIGIN = 'vscode-webview://webview'

/** The inline script of `html` whose opening tag's attributes `attributes` matches. */
function inlineScript(html: string, attributes: RegExp) {
  // An end tag ends at its own `>`: `</script >` and `</script foo>` end a script as `</script>` does.
  for (const [, opening, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi)) {
    if (attributes.test(opening)) return body
  }
  throw new Error(`no script with attributes ${attributes}`)
}

type Listener = (event: unknown) => void

/**
 * An element as the two scripts use one, and as `<h5p-player>` is before its module has defined it:
 * attributes and listeners, and no accessors of its own.
 */
class StandIn {
  attributes = new Map<string, string>()
  listeners = new Map<string, Listener>()
  children: unknown[] = []
  className = ''
  title = ''
  textContent = ''
  checked = false
  disabled = false
  hidden = false
  src = ''
  contentWindow = {}
  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value))
  }
  hasAttribute(name: string) {
    return this.attributes.has(name)
  }
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, listener)
  }
  replaceChildren(...nodes: unknown[]) {
    this.children = nodes
  }
  append(...nodes: unknown[]) {
    this.children.push(...nodes)
  }
}

/** The webview's script, run against stand-ins: what it posts to the extension, and a way to message it. */
function runWebview(state?: object) {
  const html = webviewHtml({ nonce: 'n0nce', config })
  const json = /<script type="application\/json" id="config">(.*?)<\/script>/s.exec(html)?.[1] ?? ''
  const elements = new Map<string, StandIn>()
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, new StandIn())
    return elements.get(id) as StandIn
  }
  const posted: Array<Record<string, unknown>> = []
  const listeners = new Map<string, Listener>()
  runInNewContext(inlineScript(html, /nonce=/), {
    acquireVsCodeApi: () => ({ postMessage: (message: Record<string, unknown>) => posted.push(message), getState: () => state, setState: () => {} }),
    document: {
      getElementById: (id: string) => (id === 'config' ? { textContent: json } : element(id)),
      createElement: () => new StandIn()
    },
    window: { origin: WEBVIEW_ORIGIN, addEventListener: (type: string, listener: Listener) => listeners.set(type, listener) },
    URL
  })
  const frame = element('frame')
  const receive = (data: unknown, from: { source: unknown; origin: string }) => (listeners.get('message') as Listener)({ data, ...from })
  return {
    posted,
    frame,
    status: element('status'),
    untrustedBox: element('untrusted'),
    media: element('media'),
    mediaText: element('media-text'),
    openInBrowser: element('open-in-browser'),
    receive,
    /** The page in the frame: its window, the server's origin. */
    fromPage: { source: frame.contentWindow, origin: config.origin },
    /** The extension, which VS Code delivers from the webview's own origin. */
    fromExtension: { source: null, origin: WEBVIEW_ORIGIN }
  }
}

/** The page's script, run against a stand-in for an element not yet defined: what it set, and what it told. */
function runPage(settings: Partial<Parameters<typeof viewPage>[0]> = {}, ancestorOrigins = [WEBVIEW_ORIGIN]) {
  const page = viewPage({ name: 'quiz.h5p', src: '/__package/0123456789abcdef/quiz.h5p', packBase: '/__pack/', untrusted: false, newest: true, lang: null, ...settings })
  const json = /<script type="application\/json" id="settings">(.*?)<\/script>/s.exec(page)?.[1] ?? ''
  const player = new StandIn()
  const told: Array<[Record<string, unknown>, string]> = []
  const location = { href: 'http://127.0.0.1:4646/view/0123456789abcdef', ancestorOrigins }
  runInNewContext(inlineScript(page, /^\s*$/), {
    document: {
      title: '',
      getElementById: (id: string) => (id === 'settings' ? { textContent: json } : null),
      querySelector: (selector: string) => (selector === 'h5p-player' ? player : null)
    },
    location,
    window: { location },
    parent: { postMessage: (message: Record<string, unknown>, origin: string) => told.push([message, origin]) },
    URL
  })
  return { player, told }
}

describe('the webview', () => {
  const html = webviewHtml({ nonce: 'n0nce', config })
  const policy = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? ''

  it('may frame the preview server alone, and run only its own script and style', () => {
    expect(policy.split(';').map((directive) => directive.trim()).filter(Boolean)).toEqual([
      "default-src 'none'",
      'frame-src http://127.0.0.1:4646',
      "style-src 'nonce-n0nce'",
      "script-src 'nonce-n0nce'"
    ])
    // Every script and style carries the nonce, but the configuration, which is data.
    // In any case: `<SCRIPT>` is a script as much as `<script>` is.
    for (const tag of html.match(/<(script|style)\b[^>]*>/gi) ?? []) {
      if (!tag.includes('type="application/json"')) expect(tag).toContain('nonce="n0nce"')
    }
  })

  it('writes its configuration as data, which no file name can end', () => {
    expect(html).not.toContain('</script><b>quiz')
    const json = /<script type="application\/json" id="config">(.*?)<\/script>/s.exec(html)?.[1] ?? ''
    expect(JSON.parse(json)).toEqual(config)
  })

  it('plays the package at once, and tells the extension the mode it plays in', () => {
    const { posted, frame } = runWebview()
    expect(posted).toEqual([{ type: 'mode', untrusted: false, newest: true }])
    expect(frame.src).toBe('http://127.0.0.1:4646/view/0123456789abcdef?lang=en')
  })

  it('starts in the mode its tab was left in', () => {
    const { posted, frame } = runWebview({ untrusted: true, newest: false })
    expect(posted).toEqual([{ type: 'mode', untrusted: true, newest: false }])
    expect(frame.src).toBe('http://127.0.0.1:4646/view/0123456789abcdef?untrusted=1&newest=0&lang=en')
  })

  it('relays what the page reports to the extension, and nothing else the page posts', () => {
    const { posted, receive, fromPage, status } = runWebview()
    posted.length = 0
    // What a package's own code could post as the page: its trust, a reload. Neither goes on.
    receive({ source: 'h5p-preview', type: 'mode', untrusted: false, newest: true }, fromPage)
    receive({ source: 'h5p-preview', type: 'reload' }, fromPage)
    receive({ source: 'h5p-preview', type: 'settings', restricted: false, untrusted: false, newest: true }, fromPage)
    expect(posted).toEqual([])

    const loading = { source: 'h5p-preview', type: 'state', state: 'loading' }
    const ready = { source: 'h5p-preview', type: 'ready', title: 'Quiz', mainLibrary: 'H5P.QuestionSet', license: null, refreshed: [], untrusted: false }
    const error = { source: 'h5p-preview', type: 'error', code: 'runtime', message: 'oops', afterReady: true, missing: [], carried: false }
    for (const message of [loading, ready, error]) receive(message, fromPage)
    expect(posted).toEqual([loading, ready, error])
    expect((status.children[0] as StandIn).textContent).toBe('Quiz')
  })

  it('says in the bar how many libraries played older than the content, and which in its tooltip', () => {
    const { receive, fromPage, status } = runWebview()
    const refreshed = [{ library: 'H5P.Question', from: '1.5.9', to: '1.5.12' }]
    const downgraded = [{ library: 'H5P.MultiChoice', from: '1.17', to: '1.16.27' }]
    receive({ source: 'h5p-preview', type: 'ready', title: 'Quiz', mainLibrary: 'H5P.QuestionSet', license: null, refreshed, downgraded, untrusted: false }, fromPage)
    expect((status.children[1] as StandIn).textContent).toBe(" · H5P.QuestionSet · one library at the pack's newer version · one library older than the content")
    expect(status.title).toBe('H5P.Question 1.5.9 → 1.5.12\nH5P.MultiChoice made for 1.17, played at 1.16.27')
  })

  it('names the media VS Code does not play under the bar, and opens the package in the browser from there', () => {
    const { posted, receive, fromPage, fromExtension, media, mediaText, openInBrowser } = runWebview()
    const ready = (kinds: string[]) => ({ source: 'h5p-preview', type: 'ready', title: 'Video', mainLibrary: 'H5P.InteractiveVideo', license: null, refreshed: [], media: kinds, untrusted: false })
    expect(media.hidden).toBe(true)

    receive(ready(['mp4', 'webm', 'youtube']), fromPage)
    expect(media.hidden).toBe(false)
    expect(mediaText.textContent).toBe('VS Code plays its MP4 video without sound and cannot play its WebM video or YouTube video.')
    posted.length = 0
    ;(openInBrowser.listeners.get('click') as Listener)({})
    expect(posted).toEqual([{ type: 'open-in-browser' }])

    receive(ready(['mp4']), fromPage)
    expect(mediaText.textContent).toBe('VS Code plays its MP4 video without sound.')
    receive(ready(['webm', 'aac', 'youtube']), fromPage)
    expect(mediaText.textContent).toBe('VS Code cannot play its WebM video, M4A audio or YouTube video.')
    // A page from before the note says nothing about media, and there is nothing to say.
    receive(ready([]), fromPage)
    expect(media.hidden).toBe(true)

    receive(ready(['aac']), fromPage)
    expect(media.hidden).toBe(false)
    // Playing again starts without it, until the content is up and says.
    receive({ type: 'reload' }, fromExtension)
    expect(media.hidden).toBe(true)
  })

  it('takes the page’s messages from the server’s origin only', () => {
    const { posted, receive, frame } = runWebview()
    posted.length = 0
    receive({ source: 'h5p-preview', type: 'ready', title: 'Quiz', refreshed: [] }, { source: frame.contentWindow, origin: 'http://127.0.0.1:9999' })
    expect(posted).toEqual([])
  })

  it('takes reload and settings from the extension alone', () => {
    const { posted, receive, frame, untrustedBox, fromExtension } = runWebview()
    posted.length = 0
    // A package's frame is another window on the server's origin: not the page, not the extension.
    const fromPackage = { source: {}, origin: config.origin }
    receive({ type: 'reload' }, fromPackage)
    receive({ type: 'settings', restricted: false, untrusted: true, newest: true }, fromPackage)
    expect(posted).toEqual([])

    receive({ type: 'reload' }, fromExtension)
    expect(posted).toEqual([{ type: 'mode', untrusted: false, newest: true }])
    // Restricted Mode plays untrusted whatever the setting says, and the switch cannot undo it.
    receive({ type: 'settings', restricted: true, untrusted: false, newest: true }, fromExtension)
    expect(posted.at(-1)).toEqual({ type: 'mode', untrusted: true, newest: true })
    expect(frame.src).toBe('http://127.0.0.1:4646/view/0123456789abcdef?untrusted=1&lang=en')
    expect(untrustedBox.disabled).toBe(true)
  })
})

describe('the page a preview frames', () => {
  it('sets the element up by its attributes, which it reads once its module has defined it', () => {
    const { player } = runPage({ untrusted: true, newest: false, lang: 'de' })
    expect(Object.fromEntries(player.attributes)).toEqual({
      libraries: 'pack',
      'pack-base': '/__pack/',
      'refresh-libraries': 'off',
      lang: 'de',
      untrusted: '',
      src: 'http://127.0.0.1:4646/__package/0123456789abcdef/quiz.h5p'
    })
    // A property set before the element is defined would stay on it, over the element's own.
    expect(Object.keys(player)).not.toContain('untrusted')
  })

  it('plays trusted unless the preview says otherwise', () => {
    expect(runPage().player.hasAttribute('untrusted')).toBe(false)
  })

  it('tells what the element reached to the webview around it, and to no other window', () => {
    const { player, told } = runPage({ untrusted: true })
    const ready = player.listeners.get('ready') as Listener
    const downgradedLibraries = [{ library: 'H5P.MultiChoice', from: '1.17', to: '1.16.27' }]
    ready({ detail: { metadata: { title: 'Quiz', mainLibrary: 'H5P.QuestionSet', license: 'CC BY', licenseVersion: '4.0' }, libraryBundle: { refreshed: [] }, downgradedLibraries } })
    expect(told).toEqual([
      [
        { source: 'h5p-preview', type: 'ready', title: 'Quiz', mainLibrary: 'H5P.QuestionSet', license: 'CC BY 4.0', refreshed: [], downgraded: downgradedLibraries, media: [], untrusted: true },
        WEBVIEW_ORIGIN
      ]
    ])

    const alone = runPage({}, [])
    ;(alone.player.listeners.get('ready') as Listener)({ detail: { metadata: null, libraryBundle: null } })
    expect(alone.told).toEqual([])
  })

  it('leaves out a licence H5P calls undisclosed', () => {
    const { player, told } = runPage()
    ;(player.listeners.get('ready') as Listener)({ detail: { metadata: { title: 'Tabs', mainLibrary: 'H5P.Tabs', license: 'U' }, libraryBundle: null } })
    expect(told[0][0].license).toBe(null)
  })

  it('names the media in the content that VS Code does not play in full, wherever it is in the parameters', () => {
    const { player, told } = runPage()
    const params = {
      interactiveVideo: { video: { files: [{ path: 'videos/clip.mp4', mime: 'video/mp4' }] } },
      // MP3 plays, with sound; an image is not media.
      audio: { files: [{ path: 'audios/voice.mp3', mime: 'audio/mpeg' }] },
      tabs: [
        { content: { params: { sources: [{ path: 'https://youtu.be/j4-yBgTVk3A', mime: 'video/YouTube' }] } } },
        { content: { params: { files: [{ path: 'audios/reading.m4a', mime: 'audio/mp4' }], image: { path: 'images/cover.jpg', mime: 'image/jpeg' } } } },
        { content: { params: { files: [{ path: 'https://example.org/clip.webm?t=1' }] } } }
      ]
    }
    const contents = { 'cid-quiz': { jsonContent: JSON.stringify(params) } }
    Object.assign(player, { shadowRoot: { querySelector: () => ({ contentWindow: { H5PIntegration: { contents } } }) } })
    ;(player.listeners.get('ready') as Listener)({ detail: { metadata: null, libraryBundle: null } })
    expect(told[0][0].media).toEqual(['mp4', 'webm', 'aac', 'youtube'])

    // A frame it cannot read says nothing.
    const closed = runPage()
    const frame = Object.defineProperty({}, 'contentWindow', { get: () => { throw new Error('SecurityError') } })
    Object.assign(closed.player, { shadowRoot: { querySelector: () => frame } })
    ;(closed.player.listeners.get('ready') as Listener)({ detail: { metadata: null, libraryBundle: null } })
    expect(closed.told[0][0].media).toEqual([])
  })

  it('takes a web address as the package, and nothing else', () => {
    const { player, told } = runPage({ src: 'javascript:alert(1)' })
    expect(player.hasAttribute('src')).toBe(false)
    expect(told).toEqual([
      [{ source: 'h5p-preview', type: 'error', code: 'bad-archive', message: 'Invalid preview source.', afterReady: false, missing: [], carried: false }, WEBVIEW_ORIGIN]
    ])
  })
})
