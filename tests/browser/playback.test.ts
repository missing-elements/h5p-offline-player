import { describe, expect, it } from 'vitest'
import '../../src/h5p-offline-player'
import {
  FIXTURES,
  clearPackageCaches,
  createPlayer,
  frameDocument,
  frameWindow,
  play,
  waitForEvent
} from './utils'

/**
 * The whole pipeline, end to end: probe, index, synthesize a frame, serve every file the H5P
 * runtime asks for out of a zip that was never extracted, and carry xAPI back out.
 */
describe('playing a package', () => {
  it('plays an archive from a host that honours Range', async () => {
    const player = await play(FIXTURES.basic)

    expect(player.state).toBe('ready')
    expect(player.pkgId).toMatch(/^[0-9a-f]{32}$/)
    expect(frameDocument(player).querySelector('.h5p-offline-test-message')?.textContent).toBe(
      'Served from the archive, never extracted to disk.'
    )
  })

  it('plays an archive from a host that ignores Range, after downloading it', async () => {
    const player = await play(FIXTURES.noRangeBasic)
    expect(frameDocument(player).querySelector('.h5p-offline-test')).toBeTruthy()
  })

  it('reports download progress for a host that ignores Range', async () => {
    // A package already in the chunk store is not downloaded again, and reports no progress.
    await clearPackageCaches()

    const player = document.createElement('h5p-player')
    document.body.innerHTML = ''
    document.body.append(player)

    const progress = waitForEvent<{ phase: string; loaded: number }>(player, 'progress')
    player.setAttribute('src', FIXTURES.noRangeBasic)

    const event = await progress
    expect(event.detail.phase).toBe('download')
    expect(event.detail.loaded).toBeGreaterThan(0)
  })

  it('applies the stylesheet from the archive, which needs a real text/css response', async () => {
    const player = await play(FIXTURES.basic)
    const message = frameDocument(player).querySelector('.h5p-offline-test-message')!

    // `offline-test.css` sets this margin. A stylesheet served as octet-stream is ignored, so a
    // wrong content type shows up here and nowhere else.
    expect(getComputedStyle(message).marginBottom).toBe('16px')
  })

  it('carries an xAPI statement out of the frame as a DOM event', async () => {
    const player = await play(FIXTURES.basic)

    const xapi = waitForEvent<{ statement: { verb: { id: string } } }>(player, 'xapi')
    const finished = waitForEvent(player, 'finished')

    frameDocument(player).querySelector<HTMLButtonElement>('.h5p-offline-test-complete')!.click()

    const event = await xapi
    expect(event.detail.statement.verb.id).toBe('http://adlnet.gov/expapi/verbs/completed')
    await finished
  })

  it('reloads when src is set again, and ends up on the new package', async () => {
    const player = await play(FIXTURES.basic)
    const firstPkgId = player.pkgId

    const settled = waitForEvent(player, 'ready')
    player.setAttribute('src', FIXTURES.noRangeBasic)
    await settled

    expect(player.pkgId).not.toBe(firstPkgId)
    expect(player.state).toBe('ready')
  })

  it('goes idle when src is removed, instead of failing to load nothing', async () => {
    const player = await play(FIXTURES.basic)

    const failures: unknown[] = []
    player.addEventListener('error', (event) => failures.push((event as unknown as CustomEvent).detail))
    player.removeAttribute('src')

    // A host that reloads the same URL removes the attribute and sets it again; erroring in
    // between would make that sequence unusable, and the demo's retry button does exactly it.
    expect(player.state).toBe('idle')
    expect(player.pkgId).toBeNull()
    expect(failures).toEqual([])
  })

  it('reloads when the same src is set again after being removed', async () => {
    const player = await play(FIXTURES.basic)
    player.removeAttribute('src')

    const settled = waitForEvent(player, 'ready')
    player.setAttribute('src', FIXTURES.basic)
    await settled

    expect(player.state).toBe('ready')
  })

  it('plays a package whose library folders carry no version', async () => {
    // Older packages are built this way. h5p-standalone probes the versioned name first and the
    // 404 it gets is what tells it to fall back to the bare one, so that 404 has to be a clean
    // 404 rather than an error.
    const player = await play(FIXTURES.unversioned)

    expect(player.state).toBe('ready')
    expect(frameDocument(player).querySelector('.h5p-offline-test')).toBeTruthy()
  })

  it('lets content evaluate a string, the way EmbeddedJS compiles templates', async () => {
    const player = await play(FIXTURES.basic)
    const view = frameWindow(player) as Window & { eval: (code: string) => unknown }

    // Not a CSP violation but a thrown EvalError is what a blocked eval looks like from inside.
    expect(view.eval('1 + 1')).toBe(2)
  })

  it('applies the H5P core styles, which are keyed on the document element', async () => {
    const player = await play(FIXTURES.basic)
    const frame = frameDocument(player)

    expect(frame.documentElement.classList.contains('h5p-iframe')).toBe(true)

    // Without the class the content renders in the browser's default serif at default metrics.
    const content = frame.querySelector('.h5p-content')!
    const styles = frame.defaultView!.getComputedStyle(content)
    expect(styles.fontSize).toBe('16px')
    expect(styles.lineHeight).toBe('24px')

    expect(frame.defaultView!.getComputedStyle(frame.documentElement).fontFamily).toBe('sans-serif')
  })

  it('reports a content height over H5P\'s own resizer protocol', async () => {
    const player = createPlayer()
    player.style.height = '600px'

    const resized = waitForEvent<{ height: number }>(player, 'resize')
    player.setAttribute('src', FIXTURES.basic)

    // H5P will not report a size until the handshake is answered: it keeps its document at full
    // height until then, so a height below the frame's proves the exchange completed.
    const { height } = (await resized).detail
    expect(height).toBeGreaterThan(0)
    expect(height).toBeLessThan(600)
  })

  it('completes the resizer handshake, which is what frees the content to size itself', async () => {
    const player = await play(FIXTURES.basic)
    await waitForEvent(player, 'resize').catch(() => undefined)

    // H5P sets these on its document only once the embedder has answered its `hello`.
    const body = frameDocument(player).body
    expect(body.style.height).toBe('auto')
    expect(body.style.overflow).toBe('hidden')
  })

  it('follows the content height when auto-resize is set', async () => {
    const player = createPlayer({ 'auto-resize': '' })
    player.style.removeProperty('height')

    const resized = waitForEvent<{ height: number }>(player, 'resize')
    player.setAttribute('src', FIXTURES.basic)
    const { height } = (await resized).detail

    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(Math.round(player.getBoundingClientRect().height)).toBe(height)
  })

  it('fills a host sized only by min-height', async () => {
    const player = createPlayer()
    player.style.minHeight = '420px'
    player.style.removeProperty('height')

    const ready = waitForEvent(player, 'ready')
    player.setAttribute('src', FIXTURES.basic)
    await ready

    // A percentage height would resolve against an auto height and leave the frame at an
    // iframe's intrinsic 150px, which is most of the box empty.
    const frame = player.shadowRoot!.querySelector('iframe')!
    expect(Math.round(frame.getBoundingClientRect().height)).toBe(420)
  })

  it('is not broken by a host page styling the element directly', async () => {
    // Any rule naming the element beats a :host rule, so the layout cannot live on :host. This
    // is the obvious thing for a host to write, and it used to collapse the frame.
    const style = document.createElement('style')
    style.textContent = 'h5p-player { display: block; min-height: 380px; }'
    document.head.append(style)

    try {
      const player = createPlayer()
      player.style.removeProperty('height')

      const ready = waitForEvent(player, 'ready')
      player.setAttribute('src', FIXTURES.basic)
      await ready

      const frame = player.shadowRoot!.querySelector('iframe')!
      expect(Math.round(frame.getBoundingClientRect().height)).toBe(380)
    } finally {
      style.remove()
    }
  })

  it('honours the hidden attribute', async () => {
    const player = await play(FIXTURES.basic)

    player.hidden = true
    expect(getComputedStyle(player).display).toBe('none')

    player.hidden = false
    expect(getComputedStyle(player).display).not.toBe('none')
  })

  it('loads the icon font H5P renders its UI glyphs with', async () => {
    const player = await play(FIXTURES.basic)
    const frame = frameDocument(player)

    // Fetched from the assets base, so a font-src that stopped covering it would turn every
    // H5P control — fullscreen, close, the action bar — into a tofu box and nothing else.
    const faces = await frame.fonts.load("16px 'h5p'")
    expect(faces.length).toBeGreaterThan(0)

    // The core stylesheet asks for it as 'H5P' in all seven places it draws a glyph, while the
    // @font-face declares 'h5p'. Family matching is case-insensitive, so both resolve.
    expect(frame.fonts.check("16px 'H5P'")).toBe(true)
  })

  it('plays the same package again from cache', async () => {
    const first = await play(FIXTURES.basic)
    const pkgId = first.pkgId

    const second = await play(FIXTURES.basic)
    expect(second.pkgId).toBe(pkgId)
    expect(frameDocument(second).querySelector('.h5p-offline-test')).toBeTruthy()
  })
})
