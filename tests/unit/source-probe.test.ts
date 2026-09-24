import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeSource } from '../../src/shared/source'

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
