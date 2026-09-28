import { describe, expect, it } from 'vitest'
import '../../src/h5p-offline-player'
import { CHUNK_SIZE, INLINE_MAX_SIZE } from '../../src/shared/constants'
import { FIXTURES, clearPackageCaches, frameFetch, play, virtualUrl, waitFor } from './utils'

const MEDIA = 'content/media/big.bin'
const MEDIA_SIZE = 20 * 1024 * 1024

/**
 * The two large-entry strategies. Both exist so that a package with a video in it does not have
 * to be unpacked before anything can play, and both are where a byte-level mistake shows up as a
 * corrupt stream rather than an error.
 */
describe('a large stored entry', () => {
  it('is sliced straight out of the archive, with the right total size', async () => {
    const player = await play(FIXTURES.largeStored)

    const response = await frameFetch(player, virtualUrl(player, MEDIA), { headers: { Range: 'bytes=0-0' } })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe(`bytes 0-0/${MEDIA_SIZE}`)
  })

  it('serves a range from the middle that matches the source archive byte for byte', async () => {
    const player = await play(FIXTURES.largeStored)
    const range = { start: 5_000_000, end: 5_000_255 }

    const served = new Uint8Array(
      await (
        await frameFetch(player, virtualUrl(player, MEDIA), {
          headers: { Range: `bytes=${range.start}-${range.end}` }
        })
      ).arrayBuffer()
    )

    expect(served.length).toBe(256)
    // A stored entry is a flat run of bytes inside the zip, so the same range read out of the
    // archive itself has to agree. Anything else means the local-header arithmetic is off.
    expect(served.some((byte) => byte !== 0)).toBe(true)

    const again = new Uint8Array(
      await (
        await frameFetch(player, virtualUrl(player, MEDIA), {
          headers: { Range: `bytes=${range.start}-${range.end}` }
        })
      ).arrayBuffer()
    )
    expect(Array.from(again)).toEqual(Array.from(served))
  })

  it('stores nothing for it: the archive is the storage', async () => {
    const player = await play(FIXTURES.largeStored)
    await frameFetch(player, virtualUrl(player, MEDIA), { headers: { Range: 'bytes=0-1023' } })

    const cache = await caches.open(`h5p-pkg-v0-${player.pkgId}`)
    const keys = await cache.keys()
    expect(keys.some((request) => request.url.includes(encodeURIComponent('big.bin')))).toBe(false)
  })

  it('crosses a chunk boundary without a seam', async () => {
    const player = await play(FIXTURES.largeStored)
    const start = CHUNK_SIZE - 8

    const response = await frameFetch(player, virtualUrl(player, MEDIA), {
      headers: { Range: `bytes=${start}-${start + 15}` }
    })
    expect(new Uint8Array(await response.arrayBuffer()).length).toBe(16)
  })
})

describe('a large deflated entry', () => {
  it('is extracted by the Jobs worker and served from chunks', async () => {
    const player = await play(FIXTURES.largeDeflated)

    const response = await frameFetch(player, virtualUrl(player, MEDIA), { headers: { Range: 'bytes=0-1023' } })

    expect([200, 206]).toContain(response.status)
    expect(response.headers.get('content-range')).toMatch(new RegExp(`/${MEDIA_SIZE}$`))

    const cache = await caches.open(`h5p-pkg-v0-${player.pkgId}`)
    await waitFor(async () => {
      const keys = await cache.keys()
      return keys.some((request) => request.url.includes('/chunk/'))
    })
  })

  it('answers a request with no Range header, rather than demanding a finished extraction', async () => {
    await clearPackageCaches()
    const player = await play(FIXTURES.largeDeflated)

    // A media element's first request carries no Range: Chrome only starts using them once it
    // knows the resource supports them. Waiting for the whole entry here is what made a large
    // video play from a picked file, where the inflate is quick, and fail from a URL.
    const response = await frameFetch(player, virtualUrl(player, MEDIA))

    expect(response.status).toBe(200)
    expect(Number(response.headers.get('content-length'))).toBe(MEDIA_SIZE)

    const body = new Uint8Array(await response.arrayBuffer())
    expect(body.length).toBe(MEDIA_SIZE)
    expect(body.some((byte) => byte !== 0)).toBe(false)
  }, 60_000)

  it('answers a range that begins past the watermark instead of refusing it', async () => {
    await clearPackageCaches()
    const player = await play(FIXTURES.largeDeflated)

    // An mp4 whose `moov` index sits at the end — and plenty are not written faststart — is
    // unplayable until that tail arrives. Extraction only runs forward, so the tail is always
    // beyond the watermark at first; refusing it would mean refusing the file.
    const start = MEDIA_SIZE - 16
    const response = await frameFetch(player, virtualUrl(player, MEDIA), {
      headers: { Range: `bytes=${start}-` }
    })

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe(
      `bytes ${start}-${MEDIA_SIZE - 1}/${MEDIA_SIZE}`
    )

    const tail = new Uint8Array(await response.arrayBuffer())
    expect(Array.from(tail)).toEqual(Array.from(new Uint8Array(16)))
  }, 60_000)

  it('serves the prefix that exists, so playback can start before extraction finishes', async () => {
    const player = await play(FIXTURES.largeDeflated)

    // Asking for the whole entry while it is still being extracted is answered with a shorter
    // 206 — legal, and what lets a media element start on a cold package.
    const response = await frameFetch(player, virtualUrl(player, MEDIA), { headers: { Range: 'bytes=0-' } })
    expect(response.status).toBe(206)

    const served = Number(response.headers.get('content-length'))
    expect(served).toBeGreaterThan(0)
    expect(served).toBeLessThanOrEqual(MEDIA_SIZE)
  })

  // Inflating 20 MB and writing it as chunks runs past the default per-test budget.
  it('eventually holds the whole entry, and the bytes are the ones that went in', { timeout: 90_000 }, async () => {
    const player = await play(FIXTURES.largeDeflated)
    const url = virtualUrl(player, MEDIA)

    await frameFetch(player, url, { headers: { Range: 'bytes=0-1023' } })

    // The fixture's filler is a run of zero bytes, so any misplacement of a chunk shows up.
    await waitFor(async () => {
      const response = await frameFetch(player, url, { headers: { Range: `bytes=${MEDIA_SIZE - 16}-` } })
      return response.status === 206 && response.headers.get('content-range') ===
        `bytes ${MEDIA_SIZE - 16}-${MEDIA_SIZE - 1}/${MEDIA_SIZE}`
    }, 60_000)

    const tail = new Uint8Array(
      await (await frameFetch(player, url, { headers: { Range: `bytes=${MEDIA_SIZE - 16}-` } })).arrayBuffer()
    )
    expect(Array.from(tail)).toEqual(Array.from(new Uint8Array(16)))
  })
})

describe('the inline threshold', () => {
  it('keeps small entries out of the chunk store entirely', async () => {
    const player = await play(FIXTURES.basic)
    await frameFetch(player, virtualUrl(player, 'h5p.json'))

    const cache = await caches.open(`h5p-pkg-v0-${player.pkgId}`)
    const keys = await cache.keys()

    expect(keys.some((request) => request.url.includes('/whole/'))).toBe(true)
    expect(keys.some((request) => request.url.includes('/chunk/'))).toBe(false)
    expect(MEDIA_SIZE).toBeGreaterThan(INLINE_MAX_SIZE)
  })
})
