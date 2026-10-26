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

  it('takes the frame’s messages from the server’s origin, and the extension’s from its own', () => {
    expect(html).toContain('event.source === frame.contentWindow')
    expect(html).toContain('event.origin !== config.origin')
    expect(html).toContain('event.origin !== window.origin')
  })
})

describe('the page a preview frames', () => {
  it('tells what the element reached to the webview around it, and to no other window', () => {
    const page = viewPage({ name: 'quiz.h5p', src: '/__package/0123456789abcdef/quiz.h5p', packBase: '/__pack/', untrusted: false, newest: true, lang: null })
    expect(page).toContain('location.ancestorOrigins[0]')
    expect(page).toContain('parent.postMessage({ source: \'h5p-preview\', ...message }, webview)')
    expect(page).not.toMatch(/postMessage\([^)]*'\*'\)/)
  })
})
