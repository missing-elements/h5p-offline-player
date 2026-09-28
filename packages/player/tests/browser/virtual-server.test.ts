import { describe, expect, it } from 'vitest'
import '../../src/h5p-offline-player'
import {
  FIXTURES,
  clearPackageCaches,
  createPlayer,
  frameDocument,
  frameFetch,
  play,
  virtualUrl,
  waitForSettled
} from './utils'

/**
 * The virtual file server, addressed directly. Everything here is what the H5P runtime sees when
 * it asks for a file: the status, the content type and the range semantics it depends on.
 */
describe('the virtual file server', () => {
  it('serves an entry with a content type derived from its extension', async () => {
    const player = await play(FIXTURES.basic)

    const json = await frameFetch(player, virtualUrl(player, 'h5p.json'))
    expect(json.status).toBe(200)
    expect(json.headers.get('content-type')).toBe('application/json; charset=utf-8')

    const css = await frameFetch(player, virtualUrl(player, 'H5P.OfflineTest-1.0/offline-test.css'))
    expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8')
    expect(await css.text()).toContain('.h5p-offline-test')
  })

  it('advertises range support on every entry', async () => {
    const player = await play(FIXTURES.basic)
    const response = await frameFetch(player, virtualUrl(player, 'h5p.json'))
    expect(response.headers.get('accept-ranges')).toBe('bytes')
  })

  it('answers a range request with a 206 and a matching Content-Range', async () => {
    const player = await play(FIXTURES.basic)
    const url = virtualUrl(player, 'H5P.OfflineTest-1.0/offline-test.css')

    const whole = await (await frameFetch(player, url)).text()
    const response = await frameFetch(player, url, { headers: { Range: 'bytes=0-9' } })

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe(`bytes 0-9/${whole.length}`)
    expect(await response.text()).toBe(whole.slice(0, 10))
  })

  it('answers a suffix range, which is how a media element reads a trailer', async () => {
    const player = await play(FIXTURES.basic)
    const url = virtualUrl(player, 'H5P.OfflineTest-1.0/offline-test.css')

    const whole = await (await frameFetch(player, url)).text()
    const response = await frameFetch(player, url, { headers: { Range: 'bytes=-12' } })

    expect(response.status).toBe(206)
    expect(await response.text()).toBe(whole.slice(-12))
  })

  it('refuses a range that starts past the end', async () => {
    const player = await play(FIXTURES.basic)
    const url = virtualUrl(player, 'h5p.json')
    const response = await frameFetch(player, url, { headers: { Range: 'bytes=999999-' } })
    expect(response.status).toBe(416)
  })

  it('404s a missing entry, which is how h5p-standalone probes folder naming', async () => {
    const player = await play(FIXTURES.basic)
    const response = await frameFetch(player, virtualUrl(player, 'H5P.OfflineTest/library.json'))
    expect(response.status).toBe(404)
  })

  it('answers a burst of concurrent requests for one cold entry identically', async () => {
    const player = await play(FIXTURES.basic)
    // Every entry is cold again, while the worker keeps its reader: exactly the state in which
    // the runtime's first burst of library requests arrives.
    await clearPackageCaches()

    const url = virtualUrl(player, 'H5P.OfflineTest-1.0/offline-test.js')
    const responses = await Promise.all(Array.from({ length: 6 }, () => frameFetch(player, url)))
    const bodies = await Promise.all(responses.map((response) => response.text()))

    expect(responses.map((response) => response.status)).toEqual(Array(6).fill(200))
    expect(new Set(bodies).size).toBe(1)
    expect(bodies[0]).toContain('OfflineTest')
    for (const [i, response] of responses.entries()) {
      expect(Number(response.headers.get('content-length'))).toBe(new TextEncoder().encode(bodies[i]).length)
    }
  })

  it('404s a package it has never heard of, on the entry route as on the frame route', async () => {
    const player = await play(FIXTURES.basic)
    const unknown = '0'.repeat(32)

    const entry = await frameFetch(player, `${player.scope}virtual/${unknown}/h5p.json`)
    const frame = await frameFetch(player, `${player.scope}frame/${unknown}`)

    expect([entry.status, frame.status]).toEqual([404, 404])
  })

  it('answers the ping route with its own version', async () => {
    const player = await play(FIXTURES.basic)
    const response = await frameFetch(player, `${player.scope}virtual/_ping`)
    expect(response.ok).toBe(true)
    expect((await response.json()).version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('leaves requests outside its routes to the network', async () => {
    await play(FIXTURES.basic)
    const response = await fetch(FIXTURES.basic, { method: 'GET', headers: { Range: 'bytes=0-3' } })
    expect(response.status).toBe(206)
  })
})

describe('hostile entry names', () => {
  it('refuses a path it cannot decode', async () => {
    const player = await play(FIXTURES.traversal)

    // Traversal cannot arrive here through a URL: the URL parser collapses `..` and `%2e%2e`
    // alike before the request is made. What can arrive is a malformed escape, which is left
    // alone — and a path the worker cannot decode is refused rather than guessed at.
    const response = await frameFetch(player, `${player.scope}virtual/${player.pkgId}/%zz.json`)
    expect(response.status).toBe(400)
  })

  it('does not serve an entry whose name escapes the root, under any name', async () => {
    const player = await play(FIXTURES.traversal)

    // The archive really does contain `../escaped.js` and `nested/../../escaped-too.js`. Both
    // are dropped at index time rather than repaired, so neither the name they carry nor the
    // name they would collapse to is served.
    for (const path of ['escaped.js', 'escaped-too.js', 'nested/escaped-too.js']) {
      const response = await frameFetch(player, virtualUrl(player, path))
      expect(response.status).toBe(404)
    }
  })

  it('still serves the legitimate entries of the same archive', async () => {
    const player = await play(FIXTURES.traversal)
    expect((await frameFetch(player, virtualUrl(player, 'h5p.json'))).status).toBe(200)
  })

  it('normalises a Windows-written name onto its forward-slash form', async () => {
    const player = await play(FIXTURES.traversal)
    const response = await frameFetch(player, virtualUrl(player, 'content/windows.json'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ windows: true })
  })
})

describe('the version check', () => {
  it('does not go through the ping route from the page, which cannot reach the worker', async () => {
    // The `_ping` route only answers a client the worker controls, and the host page is not one:
    // our scope is a sub-directory the page does not sit under. The element asks over the
    // control channel instead, and must not regress to a fetch that would silently never answer.
    const original = window.fetch
    const asked: string[] = []
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      asked.push(String(input instanceof Request ? input.url : input))
      return original.call(window, input as RequestInfo, init)
    }) as typeof window.fetch

    try {
      await play(FIXTURES.basic)
    } finally {
      window.fetch = original
    }

    expect(asked.some((url) => url.includes('/virtual/_ping'))).toBe(false)
  })
})

describe('the frame policy', () => {
  /** Collects what the frame's CSP refuses while `run` does its thing. */
  const violationsDuring = async (
    document: Document,
    run: () => void,
    settleMs = 400
  ): Promise<string[]> => {
    const blocked: string[] = []
    const onViolation = (event: Event) =>
      blocked.push((event as SecurityPolicyViolationEvent).blockedURI)

    document.addEventListener('securitypolicyviolation', onViolation)
    try {
      run()
      await new Promise((resolve) => setTimeout(resolve, settleMs))
    } finally {
      document.removeEventListener('securitypolicyviolation', onViolation)
    }
    return blocked
  }

  const addScript = (document: Document, src: string) => () => {
    const script = document.createElement('script')
    script.src = src
    document.body.append(script)
  }

  it('refuses a script from an origin no content type needs', async () => {
    const player = await play(FIXTURES.basic)
    const document = frameDocument(player)

    const blocked = await violationsDuring(
      document,
      addScript(document, 'https://unrelated.example/tracker.js')
    )
    expect(blocked.some((uri) => uri.includes('unrelated.example'))).toBe(true)
  })

  it('allows the video player APIs H5P.Video loads', async () => {
    const player = await play(FIXTURES.basic)
    const document = frameDocument(player)

    // H5P.Video puts each provider's API into this document before embedding the player itself.
    // `frame-src *` covers the embed; it does nothing for the script that creates it.
    for (const src of [
      'https://www.youtube.com/iframe_api',
      'https://player.vimeo.com/api/player.js',
      'https://developers.panopto.com/scripts/embedapi.min.js'
    ]) {
      const blocked = await violationsDuring(document, addScript(document, src), 150)
      expect(blocked, `${src} was blocked`).toEqual([])
    }
  })

  it('allows an origin the host vouches for with allow-origins', async () => {
    const player = createPlayer({ 'allow-origins': 'https://tenant.panopto.example' })
    const settled = waitForSettled(player)
    player.setAttribute('src', FIXTURES.basic)
    expect((await settled).ok).toBe(true)

    const document = frameDocument(player)

    const vouched = await violationsDuring(
      document,
      addScript(document, 'https://tenant.panopto.example/Panopto/Pages/embedapi.js'),
      150
    )
    expect(vouched).toEqual([])

    // Everything else is still refused: the attribute adds hosts, it does not open the policy.
    const other = await violationsDuring(
      document,
      addScript(document, 'https://unvouched.example/x.js')
    )
    expect(other.some((uri) => uri.includes('unvouched.example'))).toBe(true)
  })

  it('allows the WebFont loader at the page\'s own scheme', async () => {
    const player = await play(FIXTURES.basic)
    const document = frameDocument(player)

    // The URL H5P.ArithmeticQuiz builds, scheme and all. Whether it then loads depends on the
    // network; what is asserted here is that the policy does not stop it, which is the part
    // that was broken. A scheme-qualified allowlist entry cannot match this on an http page.
    const blocked = await violationsDuring(
      document,
      addScript(document, `${location.protocol}//ajax.googleapis.com/ajax/libs/webfont/1/webfont.js`)
    )
    expect(blocked).toEqual([])
  })
})
