import { describe, expect, it } from 'vitest'
import '../../src/h5p-offline-player'
import { FIXTURES, createPlayer, frameDocument, frameFetch, frameWindow, inject, messageOf, play, settle, virtualUrl, waitForSettled } from './utils'

/**
 * `untrusted`: a package played as data. Its own library folders never run — the bundle's copy
 * does — `content/` serves only H5P's own list of content file types, every entry carries
 * `nosniff`, and the frame's policy names script paths rather than the origin. `untrusted.h5p`
 * carries a copy of the fixture content type that marks the frame (`ownLibraryRan`) and says so
 * on screen, and a file of each kind under `content/`.
 */

type Marked = Window & {
  ownLibraryRan?: boolean
  contentFileRan?: boolean
  contentScriptRan?: boolean
  childScriptRan?: boolean
  H5P: { instances: { params: Record<string, unknown> }[] }
}

const playUntrusted = async (src: string) => {
  const player = createPlayer({ untrusted: '', libraries: FIXTURES.libraries })
  const settled = waitForSettled(player)
  player.setAttribute('src', src)
  return { player, result: await settled }
}

const message = messageOf

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
    for (const entry of ['content/data.json', 'content/notes.txt', 'content/images/pixel.png']) {
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

  it('checks the content against its semantics, at the top and in sub-content, before the runtime reads it', async () => {
    const { player, result } = await playUntrusted(FIXTURES.untrustedMarkup)
    expect(result).toEqual({ ok: true })
    const frame = frameWindow(player) as Marked
    const [main, child] = [...frameDocument(player).querySelectorAll('.h5p-offline-test-html')].map((each) => each.innerHTML)

    // The tags the field allows, with their attributes written anew; the rest gone, text kept.
    expect(main).toBe('<p class="kept">Kept <strong>bold</strong> and <a href="window.contentScriptRan = true">a link</a></p>window.contentScriptRan = true')
    expect(child).toBe('<em>Child</em>window.childScriptRan = true')
    expect(frameDocument(player).querySelector('.h5p-offline-test-html :is(form, input, img, script)')).toBeNull()
    // A field the semantics do not name never reaches the content type.
    expect(frame.H5P.instances[0].params).not.toHaveProperty('stray')
    expect(frame.H5P.instances[0].params.child).toMatchObject({ subContentId: '4f1b0c2e-8a7d-4e3b-9c1a-0d2e3f4a5b6c' })
  })

  it('lets the same markup through when played trusted, where only the frame policy stops its scripts', async () => {
    // The same content and the same bundle: only the check differs.
    const player = await play(FIXTURES.untrustedMarkup, { libraries: FIXTURES.libraries })
    const frame = frameWindow(player) as Marked
    const html = frameDocument(player).querySelector('.h5p-offline-test-html')!
    expect(html.querySelector('form[action="https://evil.example/collect"] input[name="password"]')).not.toBeNull()
    expect(html.querySelector('img[onerror]')).not.toBeNull()
    expect(html.querySelector('a[href^="javascript:"]')).not.toBeNull()
    expect(frame.H5P.instances[0].params).toHaveProperty('stray')
    // jQuery 3 runs a script it finds as an inline `<script>`, which carries no nonce, and the
    // frame's policy refuses inline handlers and `javascript:` too: a second layer, not the check.
    expect(frame.contentScriptRan).toBeUndefined()
    expect(frame.childScriptRan).toBeUndefined()
  })

  it('serves the content only to a boot script that checks it', async () => {
    const { player, result } = await playUntrusted(FIXTURES.untrustedMarkup)
    expect(result).toEqual({ ok: true })
    const url = virtualUrl(player, 'content/content.json')
    // An older runtime asks without the header, and would play the content as written.
    const refused = await frameFetch(player, url)
    expect(refused.status).toBe(403)
    expect(await refused.text()).toContain('h5p-runtime 0.2')
    const served = await frameFetch(player, url, { headers: { 'X-H5P-Content-Check': 'semantics' } })
    expect(served.status).toBe(200)
    expect(served.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('does not play content it cannot check: a bundle without the main library\'s semantics', async () => {
    const { player, result } = await settle(FIXTURES.untrustedMarkup, { untrusted: '', libraries: FIXTURES.librariesWithoutSemantics })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.detail.message).toMatch(/could not be checked.*semantics\.json for H5P\.OfflineTest 1\.0/)
    expect((frameWindow(player) as Marked).contentScriptRan).toBeUndefined()
  })

  it('runs no content file as a script, and no script from elsewhere on the origin', async () => {
    const { player, result } = await playUntrusted(FIXTURES.untrusted)
    expect(result).toEqual({ ok: true })
    const doc = frameDocument(player)

    // Under the package's own path, so the policy lets it through: `nosniff` and its type stop it.
    expect(await inject(doc, virtualUrl(player, 'content/notes.txt'))).toBe('refused')
    // On the same origin, but outside the package's path and the runtime's files.
    expect(await inject(doc, `${location.origin}/not-a-runtime-file.js`)).toBe('blocked by the policy')
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
    const { result } = await settle(FIXTURES.needsLibraries, { untrusted: '', libraries: FIXTURES.contentOnly })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.detail.missingLibraries?.carried).toBeUndefined()
  })
})
