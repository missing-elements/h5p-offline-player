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
  for (const [, opening, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
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
    ready({ detail: { metadata: { title: 'Quiz', mainLibrary: 'H5P.QuestionSet', license: 'CC BY', licenseVersion: '4.0' }, libraryBundle: { refreshed: [] } } })
    expect(told).toEqual([
      [{ source: 'h5p-preview', type: 'ready', title: 'Quiz', mainLibrary: 'H5P.QuestionSet', license: 'CC BY 4.0', refreshed: [], untrusted: true }, WEBVIEW_ORIGIN]
    ])

    const alone = runPage({}, [])
    ;(alone.player.listeners.get('ready') as Listener)({ detail: { metadata: null, libraryBundle: null } })
    expect(alone.told).toEqual([])
  })

  it('takes a web address as the package, and nothing else', () => {
    const { player, told } = runPage({ src: 'javascript:alert(1)' })
    expect(player.hasAttribute('src')).toBe(false)
    expect(told).toEqual([
      [{ source: 'h5p-preview', type: 'error', code: 'bad-archive', message: 'Invalid preview source.', afterReady: false, missing: [], carried: false }, WEBVIEW_ORIGIN]
    ])
  })
})
