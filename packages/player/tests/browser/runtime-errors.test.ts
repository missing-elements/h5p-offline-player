import { describe, expect, it } from 'vitest'
import '../../src/h5p-offline-player'
import type { PlayerErrorDetail } from '../../src/h5p-offline-player'
import { FIXTURES, frameWindow, play, waitForEvent } from './utils'

/**
 * What an exception inside the content means once the content is up. H5P content types throw
 * non-fatal exceptions routinely — on resize in particular — and carry on working, so the
 * element reports them and keeps its state: a host that hides the player on `error` must not
 * hide working content.
 */
describe('a runtime error after ready', () => {
  it('is reported as an event and leaves the state at ready', async () => {
    const player = await play(FIXTURES.basic)
    const reported = waitForEvent<PlayerErrorDetail>(player, 'error')

    // What an uncaught exception in a content type looks like to the frame's listener.
    frameWindow(player).dispatchEvent(new ErrorEvent('error', { message: 'Cannot set properties of undefined' }))

    const { detail } = await reported
    expect(detail.code).toBe('runtime')
    expect(detail.message).toContain('Cannot set properties of undefined')
    expect(player.state).toBe('ready')
  })
})
