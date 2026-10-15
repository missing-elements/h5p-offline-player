import { describe, expect, it } from 'vitest'
import '../../src/h5p-offline-player'
import type { H5PPlayerElement } from '../../src/h5p-offline-player'
import { FIXTURES, frameDocument, frameFetch, frameWindow, messageOf, virtualUrl, waitForSettled } from './utils'

/**
 * Several players showing one package at once. The bytes are the same, so the package's row and
 * cache are shared; what each load asked for is its own — trust, language, display options, the
 * bundle attached — kept under a key its frame's URLs carry. Until it was, the last player to
 * register set all of it for every frame of the package: a player asked for French showed German,
 * and one asked to play the package untrusted could be served the package's own code.
 */

type Marked = Window & { ownLibraryRan?: boolean }
type Core = Window & {
  H5P: { t(key: string): string }
  H5PIntegration: { contents: Record<string, { displayOptions?: Record<string, boolean> }> }
}
const displayOptions = (player: H5PPlayerElement) => Object.values((frameWindow(player) as Core).H5PIntegration.contents)[0].displayOptions

/** Mounts the players side by side and sets their `src` in the same task, so they race. */
async function playTogether(src: string, ...attributeSets: Array<Record<string, string>>): Promise<H5PPlayerElement[]> {
  document.body.innerHTML = ''
  const players = attributeSets.map((attributes) => {
    const player = document.createElement('h5p-player') as H5PPlayerElement
    player.style.height = '300px'
    for (const [name, value] of Object.entries(attributes)) player.setAttribute(name, value)
    document.body.append(player)
    return player
  })
  const settled = Promise.all(players.map((player) => waitForSettled(player)))
  for (const player of players) player.setAttribute('src', src)
  expect(await settled).toEqual(players.map(() => ({ ok: true })))
  return players
}

const message = messageOf

describe('several players of one package', () => {
  it('play it each in the mode asked for, untrusted beside trusted', async () => {
    const [untrusted, trusted] = await playTogether(
      FIXTURES.untrusted,
      { untrusted: '', libraries: FIXTURES.libraries },
      { libraries: FIXTURES.libraries }
    )
    expect(untrusted.pkgId).toBe(trusted.pkgId)

    expect(message(untrusted)).toBe('Content from an untrusted package.')
    expect((frameWindow(untrusted) as Marked).ownLibraryRan).toBeUndefined()
    expect(message(trusted)).toBe("The package's own code ran.")
    expect((frameWindow(trusted) as Marked).ownLibraryRan).toBe(true)

    // And go on being served so: each frame's requests name its own load.
    const script = 'H5P.OfflineTest-1.0/offline-test.js'
    expect(await (await frameFetch(untrusted, virtualUrl(untrusted, script))).text()).not.toContain('ownLibraryRan')
    expect((await frameFetch(untrusted, virtualUrl(untrusted, 'content/script.js'))).status).toBe(404)
    expect(await (await frameFetch(trusted, virtualUrl(trusted, script))).text()).toContain('ownLibraryRan')
  })

  it('keep a load untrusted when a trusted one of the same package registers after it', async () => {
    const [untrusted] = await playTogether(FIXTURES.untrusted, { untrusted: '', libraries: FIXTURES.libraries })

    // A second player, added once the first is up, the way a host's preview opens beside it.
    const trusted = document.createElement('h5p-player') as H5PPlayerElement
    document.body.append(trusted)
    const settled = waitForSettled(trusted)
    trusted.setAttribute('libraries', FIXTURES.libraries)
    trusted.setAttribute('src', FIXTURES.untrusted)
    expect(await settled).toEqual({ ok: true })

    const script = await frameFetch(untrusted, virtualUrl(untrusted, 'H5P.OfflineTest-1.0/offline-test.js'))
    expect(await script.text()).not.toContain('ownLibraryRan')
    expect((await frameFetch(untrusted, virtualUrl(untrusted, 'content/page.html'))).status).toBe(404)
  })

  it('show each in its own language, with its own display options', async () => {
    // The action bar shows the copyright button because the fixture's manifest names a licence.
    const [french, german] = await playTogether(FIXTURES.basic, { lang: 'fr', frame: '', copyright: '' }, { lang: 'de' })

    expect(frameDocument(french).documentElement.lang).toBe('fr')
    expect((frameWindow(french) as Core).H5P.t('fullscreen')).toBe('Plein écran')
    expect(displayOptions(french)).toMatchObject({ frame: true, copyright: true })
    expect(frameDocument(french).querySelector('.h5p-actions')).not.toBeNull()

    expect(frameDocument(german).documentElement.lang).toBe('de')
    expect((frameWindow(german) as Core).H5P.t('fullscreen')).toBe('Vollbild')
    expect(displayOptions(german)).toMatchObject({ frame: false })
    expect(frameDocument(german).querySelector('.h5p-actions')).toBeNull()
  })

  it('still answer a frame an older element opened, whose URLs name no load', async () => {
    const [player] = await playTogether(FIXTURES.basic, {})
    expect(virtualUrl(player, 'h5p.json')).toContain(`/virtual/${player.pkgId}-`)

    const legacy = await frameFetch(player, `${player.scope}virtual/${player.pkgId}/h5p.json`)
    expect(legacy.status).toBe(200)
    const unknownLoad = await frameFetch(player, `${player.scope}virtual/${player.pkgId}-${'0'.repeat(16)}/h5p.json`)
    expect(unknownLoad.status).toBe(404)
    const unknownFrame = await frameFetch(player, `${player.scope}frame/${player.pkgId}-${'0'.repeat(16)}`)
    expect(unknownFrame.status).toBe(404)
  })
})
