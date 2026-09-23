import { describe, expect, it } from 'vitest'
import '../../src/h5p-offline-player'
import type { H5PPlayerElement, PlayerProgressDetail } from '../../src/h5p-offline-player'
import { FIXTURES, clearPackageCaches, createPlayer, waitFor, waitForSettled } from './utils'

/**
 * Pulling large deflated media before the content asks for it.
 *
 * The lever exists because a deflate stream has no restart points: the runtime asking for the
 * tail of a big entry — where a non-faststart mp4 keeps the index it cannot decode without —
 * waits for the entire extraction. Nothing shortens that wait, so the only thing left is to
 * start it while the learner is still reading the first slide.
 *
 * `content/media/unused.bin` in the fixture is referenced by nothing, so an extraction of it can
 * only have been started ahead of demand. `content/media/big.bin`, which the content does render
 * as a video, cannot tell the two apart and is deliberately not asserted on.
 */

const UNREFERENCED = 'content/media/unused.bin'

/** Entries seen extracting, collected from the element's own progress events. */
function watchExtractions(player: H5PPlayerElement): Set<string> {
  const seen = new Set<string>()
  player.addEventListener('progress', (event: Event) => {
    const detail = (event as unknown as CustomEvent<PlayerProgressDetail>).detail
    if (detail.phase === 'extract' && detail.entry) seen.add(detail.entry)
  })
  return seen
}

describe('preload', () => {
  it('pulls a large deflated entry the content never asks for', async () => {
    await clearPackageCaches()

    const player = createPlayer({ preload: 'auto' })
    const extracting = watchExtractions(player)
    const settled = waitForSettled(player)
    player.setAttribute('src', FIXTURES.largeDeflated)

    expect(await settled).toEqual({ ok: true })
    await waitFor(() => extracting.has(UNREFERENCED))
  })

  it('leaves it alone by default, so a host decides whether to spend the bandwidth', async () => {
    await clearPackageCaches()

    const player = createPlayer()
    expect(player.preload).toBe('none')

    const extracting = watchExtractions(player)
    const settled = waitForSettled(player)
    player.setAttribute('src', FIXTURES.largeDeflated)

    expect(await settled).toEqual({ ok: true })
    // The referenced media may well be extracting by now — the content renders it as a video.
    // The unreferenced one has nobody to ask for it.
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    expect([...extracting]).not.toContain(UNREFERENCED)
  })
})
