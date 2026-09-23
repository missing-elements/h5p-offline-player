import { describe, expect, it } from 'vitest'
import '../../src/h5p-offline-player'
import { FIXTURES, createPlayer, waitForSettled } from './utils'

/**
 * Failure paths. The element reports a code and stops; it never renders an explanation of its
 * own, because what to show the user is the host page's decision.
 */
describe('reporting failures', () => {
  const failureFor = async (src: string) => {
    const player = createPlayer()
    const settled = waitForSettled(player)
    player.setAttribute('src', src)

    const result = await settled
    if (result.ok) throw new Error(`${src} unexpectedly played`)
    return { player, detail: result.detail }
  }

  it('reports a zip that is not an H5P package', async () => {
    const { detail } = await failureFor(FIXTURES.notH5P)
    expect(detail.code).toBe('bad-archive')
    expect(detail.message).toContain('h5p.json')
  })

  it('reports a file that is not a zip at all', async () => {
    const { detail } = await failureFor(FIXTURES.corrupt)
    expect(detail.code).toBe('bad-archive')
  })

  it('reports a URL that does not exist', async () => {
    const { detail } = await failureFor(FIXTURES.missing)
    expect(detail.code).toBe('network')
    expect(detail.message).toContain('404')
  })

  it('names the libraries an export left out, instead of 404ing on each in turn', async () => {
    const { detail } = await failureFor(FIXTURES.contentOnly)

    // Without this the runtime asks for `<MainLibrary>/library.json`, gets a 404, retries the
    // unversioned name, gets another, and fails with nothing anyone can act on.
    expect(detail.code).toBe('bad-archive')
    expect(detail.message).toContain('H5P.InteractiveVideo-1.27')
    expect(detail.message).toContain('no libraries')
  })

  it('fails before the frame boots, so no request is made for a library that is not there', async () => {
    const player = createPlayer()
    const requested: string[] = []
    const original = window.fetch
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      requested.push(String(input instanceof Request ? input.url : input))
      return original.call(window, input as RequestInfo, init)
    }) as typeof window.fetch

    try {
      const settled = waitForSettled(player)
      player.setAttribute('src', FIXTURES.contentOnly)
      expect((await settled).ok).toBe(false)
    } finally {
      window.fetch = original
    }

    expect(requested.some((url) => url.includes('library.json'))).toBe(false)
  })

  it('reports a URL that answers with a page instead of an archive', async () => {
    // A login wall or an error page served with status 200 is the common version of this.
    const { detail } = await failureFor(FIXTURES.htmlInsteadOfArchive)
    expect(detail.code).toBe('bad-archive')
  })

  it('reports a cross-origin host with no CORS headers', async () => {
    // Nothing is listening here, which a browser reports exactly as it reports a CORS rejection.
    const { detail } = await failureFor('http://127.0.0.1:9/no-cors.h5p')
    expect(detail.code).toBe('no-cors')
  })

  it('leaves the element in the error state', async () => {
    const { player } = await failureFor(FIXTURES.notH5P)
    expect(player.state).toBe('error')
    expect(player.getAttribute('state')).toBe('error')
  })

  it('recovers when a good src is set after a bad one', async () => {
    const { player } = await failureFor(FIXTURES.notH5P)

    const settled = waitForSettled(player)
    player.setAttribute('src', FIXTURES.basic)

    expect(await settled).toEqual({ ok: true })
    expect(player.state).toBe('ready')
  })
})
