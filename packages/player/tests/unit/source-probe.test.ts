import { afterEach, describe, expect, it, vi } from 'vitest'
import { insecureOnSecurePage, probeSource, unfetchableScheme } from '../../src/shared/source'

/**
 * What the probe can learn about an archive from the headers a browser lets it read. The fake
 * host answers as a browser presents a cross-origin response: only the CORS-safelisted headers
 * survive unless the host exposes more. And it compresses the way GitHub Pages does — a request
 * that carries `Range` is made with `Accept-Encoding: identity` by every engine, a plain one
 * accepts gzip, so only the plain answer is the compressed copy, at the compressed copy's length.
 */

const URL_ = 'https://pages.example/course.h5p'
const SIZE = 84_635_182
const GZIPPED = 84_360_012
const SAFELISTED = ['cache-control', 'content-length', 'content-type', 'expires', 'last-modified', 'pragma']

interface Host {
  /** Honours `Range`. */
  range: boolean
  /** Gzips a plain `GET`, so its `Content-Length` is the compressed copy's. */
  compresses?: boolean
  /** `Access-Control-Expose-Headers`. */
  exposes?: string[]
}

function fakeHost(host: Host) {
  const ranges: Array<string | null> = []

  const fetch = async (_url: string, init?: RequestInit): Promise<Response> => {
    const range = new Headers(init?.headers).get('range')
    ranges.push(range)

    const headers = new Headers({ 'content-type': 'application/octet-stream', etag: '"v1"' })
    let status = 200
    if (range && host.range) {
      const [, start, end] = /^bytes=(\d+)-(\d*)$/.exec(range)!
      const last = end ? Number(end) : SIZE - 1
      status = 206
      headers.set('content-length', String(last - Number(start) + 1))
      headers.set('content-range', `bytes ${start}-${last}/${SIZE}`)
    } else {
      const gzip = Boolean(host.compresses) && !range
      headers.set('content-length', String(gzip ? GZIPPED : SIZE))
      if (gzip) headers.set('content-encoding', 'gzip')
    }

    const visible = new Headers()
    for (const [name, value] of headers) {
      if (SAFELISTED.includes(name) || host.exposes?.includes(name)) visible.set(name, value)
    }
    return new Response(new Uint8Array(8), { status, headers: visible })
  }

  return { fetch, ranges }
}

describe('probeSource', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('measures a host that compresses the archive through a ranged request, never a plain GET', async () => {
    const host = fakeHost({ range: true, compresses: true })
    vi.stubGlobal('fetch', host.fetch)

    const descriptor = await probeSource(URL_)

    expect(descriptor).toMatchObject({ type: 'range-http', size: SIZE })
    // The classifying probe, then the open-ended range for the size. A plain GET here would have
    // measured the gzipped copy, 275 kB short, and the central directory would not be found.
    expect(host.ranges).toEqual(['bytes=0-0', 'bytes=0-'])
  })

  it('takes the size from Content-Range in one request when the host exposes it', async () => {
    const host = fakeHost({ range: true, compresses: true, exposes: ['content-range', 'etag'] })
    vi.stubGlobal('fetch', host.fetch)

    const descriptor = await probeSource(URL_)

    expect(descriptor).toMatchObject({ type: 'range-http', size: SIZE, validator: '"v1"' })
    expect(host.ranges).toEqual(['bytes=0-0'])
  })

  it('records the uncompressed size of an archive a host without Range sends whole', async () => {
    const host = fakeHost({ range: false, compresses: true })
    vi.stubGlobal('fetch', host.fetch)

    const descriptor = await probeSource(URL_)

    expect(descriptor).toMatchObject({ type: 'chunked', size: SIZE, validator: null })
    expect(host.ranges).toEqual(['bytes=0-0'])
  })
})

describe('an http: package on an https: page', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is refused before any request, with the https: URL to use instead', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('location', new URL('https://player.example/'))

    // The browser would refuse it as mixed content, which reads like a host without CORS; the
    // element used to say `no-cors` and send people to ask for a download.
    const probe = probeSource('http://alekswebnet.github.io/h5p/gh-normalized.h5p')
    await expect(probe).rejects.toMatchObject({ code: 'network' })
    await expect(probe).rejects.toThrow('https://alekswebnet.github.io/h5p/gh-normalized.h5p')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('lets loopback through, which browsers treat as trustworthy from an https: page', () => {
    for (const url of ['http://localhost:5173/a.h5p', 'http://app.localhost/a.h5p', 'http://127.0.0.1/a.h5p', 'http://[::1]/a.h5p']) {
      expect(insecureOnSecurePage(url, 'https://player.example/')).toBeNull()
    }
  })

  it('leaves an http: page, an https: package and a relative URL alone', () => {
    expect(insecureOnSecurePage('http://host.example/a.h5p', 'http://player.example/')).toBeNull()
    expect(insecureOnSecurePage('https://host.example/a.h5p', 'https://player.example/')).toBeNull()
    expect(insecureOnSecurePage('/fixtures/a.h5p', 'https://player.example/')).toBeNull()
    expect(insecureOnSecurePage('http://host.example/a.h5p', undefined)).toBeNull()
  })
})

describe('a URL no package can be fetched from', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is refused before any request, naming the scheme', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('location', new URL('https://player.example/'))

    // `fetch` would reject these with a TypeError that reads like a network failure.
    for (const url of ['javascript:alert(1)', 'file:///home/learner/course.h5p', 'ftp://host.example/a.h5p']) {
      const probe = probeSource(url)
      await expect(probe).rejects.toMatchObject({ code: 'network' })
      await expect(probe).rejects.toThrow(`${new URL(url).protocol} URLs cannot be played`)
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('lets http:, https:, blob:, data: and a relative URL through', () => {
    const page = 'https://player.example/demo/'
    for (const url of [
      'http://host.example/a.h5p',
      'https://host.example/a.h5p',
      'blob:https://player.example/8d4a0c1e-0000-4000-8000-000000000000',
      'data:application/zip;base64,UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==',
      '/fixtures/a.h5p',
      'course.h5p'
    ]) {
      expect(unfetchableScheme(url, page)).toBeNull()
    }
  })
})
