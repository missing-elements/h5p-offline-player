import { describe, expect, it } from 'vitest'
import '../../src/h5p-offline-player'
import { FIXTURES, createPlayer, frameDocument, waitForSettled } from './utils'

/**
 * The runtime handed over as a property, the way a bundled host does it with the `runtime`
 * export of `@missing-elements/h5p-runtime`: the element then names those URLs in the package's
 * record, and the worker writes them into the frame document — the boot script among them, as a
 * `<script src>` under the nonce rather than a string, since it ships with the runtime.
 */
describe('the runtime property', () => {
  const base = new URL('/frame-assets/', location.href).href
  const runtime = {
    mainJs: `${base}main.bundle.js?via=runtime`,
    frameJs: `${base}frame.bundle.js?via=runtime`,
    frameCss: `${base}h5p.css?via=runtime`,
    bootJs: `${base}frame-boot.js?via=runtime`,
    fonts: [{ family: 'Inter', style: 'normal', weight: '400', url: `${base}fonts/inter-400.woff2?via=runtime` }]
  }

  it('is what the frame loads, over the default directory beside the element', async () => {
    const player = createPlayer()
    player.runtime = runtime
    const settled = waitForSettled(player)
    player.setAttribute('src', FIXTURES.basic)

    const result = await settled
    if (!result.ok) expect.fail(`${result.detail.code} — ${result.detail.message}`)
    expect(player.state).toBe('ready')

    const scripts = [...frameDocument(player).querySelectorAll('script[src]')].map((script) => script.getAttribute('src'))
    expect(scripts).toContain(runtime.mainJs)
    expect(scripts).toContain(runtime.bootJs)
    expect(frameDocument(player).querySelector('style')?.textContent).toContain(runtime.fonts[0].url)
  })

  it('refuses a value missing one of the four files, since that frame would never boot', () => {
    const player = createPlayer()
    player.runtime = { mainJs: 'a', frameJs: 'b', frameCss: 'c' } as never
    expect(player.runtime).toBeNull()
    player.runtime = runtime
    expect(player.runtime?.bootJs).toBe(runtime.bootJs)
  })
})
