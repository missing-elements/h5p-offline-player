import { describe, expect, it } from 'vitest'
import '../../src/h5p-offline-player'
import type { H5PPlayerElement } from '../../src/h5p-offline-player'
import { FIXTURES, createPlayer, frameDocument, frameFetch, frameWindow, play, virtualUrl, waitForSettled } from './utils'

/**
 * `untrusted`: a package played as data. Its own library folders never run — the bundle's copy
 * does — `content/` serves only H5P's own list of content file types, every entry carries
 * `nosniff`, and the frame's policy names script paths rather than the origin. `untrusted.h5p`
 * carries a copy of the fixture content type that marks the frame (`ownLibraryRan`) and says so
 * on screen, and a file of each kind under `content/`.
 */

type Marked = Window & { ownLibraryRan?: boolean; contentFileRan?: boolean }

const playUntrusted = async (src: string) => {
  const player = createPlayer({ untrusted: '', libraries: FIXTURES.libraries })
  const settled = waitForSettled(player)
  player.setAttribute('src', src)
  return { player, result: await settled }
}

const message = (player: H5PPlayerElement) => frameDocument(player).querySelector('.h5p-offline-test-message')?.textContent

describe('an untrusted package', () => {
  it("plays with the bundle's copy of its libraries, never its own, and with its own once trusted", async () => {
    const { player, result } = await playUntrusted(FIXTURES.untrusted)
    expect(result).toEqual({ ok: true })
    expect(message(player)).toBe('Content from an untrusted package.')
    expect((frameWindow(player) as Marked).ownLibraryRan).toBeUndefined()

    // The same package, the same id: the mode is the load's, read from the record each time.
    const trusted = await play(FIXTURES.untrusted, { libraries: FIXTURES.libraries })
    expect(message(trusted)).toBe("The package's own code ran.")
    expect((frameWindow(trusted) as Marked).ownLibraryRan).toBe(true)
  })

  it('plays from a host that ignores Range, booting from the forward index on the bundle alone', async () => {
    // The archive's own library folders are withheld as they arrive, and the boot does not wait
    // for them to finish arriving: the folders it plays with are the bundle's, already whole.
    const { player, result } = await playUntrusted(FIXTURES.noRangeUntrusted)
    expect(result).toEqual({ ok: true })
    expect(message(player)).toBe('Content from an untrusted package.')
    expect((frameWindow(player) as Marked).ownLibraryRan).toBeUndefined()
  })

  it("serves only H5P's content file types, and nothing that a browser would run", async () => {
    const { player, result } = await playUntrusted(FIXTURES.untrusted)
    expect(result).toEqual({ ok: true })

    const status = async (entry: string) => {
      const response = await frameFetch(player, virtualUrl(player, entry))
      return { status: response.status, nosniff: response.headers.get('x-content-type-options') }
    }
    for (const entry of ['content/content.json', 'content/data.json', 'content/notes.txt', 'content/images/pixel.png']) {
      expect(await status(entry), entry).toEqual({ status: 200, nosniff: 'nosniff' })
    }
    for (const entry of ['content/script.js', 'content/page.html', 'content/drawing.svg', 'content/data.xml', 'loose.js']) {
      expect((await status(entry)).status, entry).toBe(404)
    }

    // The library's path answers with the bundle's script, not the package's.
    const library = await frameFetch(player, virtualUrl(player, 'H5P.OfflineTest-1.0/offline-test.js'))
    expect(library.status).toBe(200)
    expect(await library.text()).not.toContain('ownLibraryRan')
  })

  it('runs no content file as a script, and no script from elsewhere on the origin', async () => {
    const { player, result } = await playUntrusted(FIXTURES.untrusted)
    expect(result).toEqual({ ok: true })
    const doc = frameDocument(player)

    const inject = (src: string) =>
      new Promise<string>((resolve) => {
        const script = doc.createElement('script')
        script.src = src
        script.onload = () => resolve('ran')
        script.onerror = () => resolve('refused')
        doc.addEventListener('securitypolicyviolation', (event) => event.blockedURI === src && resolve('blocked by the policy'), { once: true })
        doc.body.append(script)
      })

    // Under the package's own path, so the policy lets it through: `nosniff` and its type stop it.
    expect(await inject(virtualUrl(player, 'content/notes.txt'))).toBe('refused')
    // On the same origin, but outside the package's path and the runtime's files.
    expect(await inject(`${location.origin}/not-a-runtime-file.js`)).toBe('blocked by the policy')
    expect((frameWindow(player) as Marked).contentFileRan).toBeUndefined()
  })

  it('names exact script paths in the frame policy instead of the origin and the CDNs', async () => {
    const { player, result } = await playUntrusted(FIXTURES.untrusted)
    expect(result).toEqual({ ok: true })

    const policy = frameDocument(player).querySelector<HTMLMetaElement>('meta[http-equiv="Content-Security-Policy"]')!.content
    const scripts = policy.split(';').find((directive) => directive.trim().startsWith('script-src'))!.trim().split(/\s+/)
    expect(scripts).not.toContain("'self'")
    expect(scripts).toContain(virtualUrl(player, ''))
    expect(scripts).toContain('https://www.youtube.com/iframe_api')
    expect(scripts.some((source) => source.includes('jsdelivr') || source.includes('googleapis'))).toBe(false)
  })

  it('refuses a package that needs a library only it carries, and says its own copy would play it', async () => {
    const { result } = await playUntrusted(FIXTURES.untrustedNewer)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.detail.code).toBe('bad-archive')
    expect(result.detail.missingLibraries).toMatchObject({ folders: ['H5P.OfflineTest-1.3'], carried: true })
    expect(result.detail.message).toContain('untrusted')

    // Trusted, it plays from its own folder.
    const trusted = await play(FIXTURES.untrustedNewer)
    expect(trusted.state).toBe('ready')
  })

  it('does not say "carried" when the package does not have the library either', async () => {
    // A stripped export: nothing of its own was refused, so playing it trusted would not help.
    const player = createPlayer({ untrusted: '', libraries: FIXTURES.contentOnly })
    const settled = waitForSettled(player)
    player.setAttribute('src', FIXTURES.needsLibraries)
    const result = await settled
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.detail.missingLibraries?.carried).toBeUndefined()
  })
})
