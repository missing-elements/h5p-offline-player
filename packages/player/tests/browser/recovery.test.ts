import { describe, expect, it } from 'vitest'
import '../../src/h5p-offline-player'
import type { H5PPlayerElement } from '../../src/h5p-offline-player'
import { DB_NAME } from '../../src/shared/constants'
import { FIXTURES, frameDocument, messageOf, play, waitFor, waitForSettled } from './utils'

/**
 * Surviving the storage going away underneath the player.
 *
 * Clearing site data is one action in the browser's UI and three separate demolitions here: the
 * IndexedDB table, the chunk store, and the Service Worker registration itself. Each one is held
 * by a long-lived handle that keeps looking valid afterwards, and the failures are quiet — a
 * transaction that throws for the rest of the worker's life, or routes that fall through to the
 * origin server and come back as whatever it serves for an unknown path.
 */
describe('recovering from cleared storage', () => {
  it('lets the database be deleted underneath it, and rebuilds it', async () => {
    await play(FIXTURES.basic)

    // `deleteDatabase` waits for every open connection to close. The worker holds one for its
    // whole life, so without a `versionchange` handler that closes it, this never completes.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
      request.onblocked = () =>
        reject(new Error('delete was blocked: a handle was never closed'))
      setTimeout(() => reject(new Error('delete never settled')), 10_000)
    })

    const player = await play(FIXTURES.basic)
    expect(player.state).toBe('ready')
    expect(frameDocument(player).querySelector('.h5p-offline-test')).toBeTruthy()
  })

  it('registers again after its worker has been unregistered', async () => {
    const first = await play(FIXTURES.basic)
    const scope = first.scope!

    const registration = await navigator.serviceWorker.getRegistration(scope)
    expect(registration).toBeTruthy()
    await registration!.unregister()

    // With the registration gone, every route it answered falls through to the origin. A dev
    // server or an SPA host answers an unknown path with its own index.html — so the frame would
    // render the host page inside itself, with no error anywhere, rather than the content.
    const player = await play(FIXTURES.basic)
    expect(player.state).toBe('ready')
    expect(messageOf(player)).toBe(
      'Served from the archive, never extracted to disk.'
    )
  })

  it('registers again when another player has taken the scope since', async () => {
    // Site data cleared, then another player on the page, or another tab, registering first: the
    // scope has a live registration again, but not the one this element holds (#57).
    const first = await play(FIXTURES.basic)
    const old = (await navigator.serviceWorker.getRegistration(first.scope!))!
    // Emptied first, so that no client holds the registration and unregistering tears it down
    // as clearing site data does. Unregistered under a client, Chromium revives the same
    // registration for the next `register`, which is not the state this is about.
    first.removeAttribute('src')
    await old.unregister()
    await waitFor(() => old.active === null)

    const second = document.createElement('h5p-player') as H5PPlayerElement
    second.style.height = '400px'
    document.body.append(second)
    const played = waitForSettled(second)
    second.setAttribute('src', FIXTURES.german)
    expect(await played).toEqual({ ok: true })
    expect(await navigator.serviceWorker.getRegistration(first.scope!)).not.toBe(old)

    const settled = waitForSettled(first)
    first.setAttribute('src', FIXTURES.basic)
    expect(await settled).toEqual({ ok: true })
    expect(messageOf(first)).toBe('Served from the archive, never extracted to disk.')
  })
})
