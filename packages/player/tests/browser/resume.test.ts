import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/h5p-offline-player'
import type { H5PPlayerElement, UserDataDetail } from '../../src/h5p-offline-player'
import { USER_DATA_DB_NAME } from '../../src/shared/constants'
import { readUserData, writeUserData } from '../../src/user-data-store'
import { FIXTURES, createPlayer, frameDocument, frameWindow, play, waitFor, waitForEvent, waitForSettled } from './utils'

/**
 * Save and resume: the runtime asks the content for its state and the element keeps it — on this
 * device, or with the host — so the next load of the same package starts where the learner left
 * off. The fixture content counts presses of Complete and saves the count; H5P core saves three
 * seconds after a `completed` statement, which is what the tests wait on.
 */

const count = (player: H5PPlayerElement) =>
  frameDocument(player).querySelector('.h5p-offline-test-count')?.textContent

const complete = (player: H5PPlayerElement) =>
  (frameDocument(player).querySelector('.h5p-offline-test-complete') as HTMLButtonElement).click()

/** A press of Complete, and the save it leads to. */
async function completeAndSave(player: H5PPlayerElement): Promise<UserDataDetail> {
  const saved = waitForEvent<UserDataDetail>(player, 'userdata', 10_000)
  complete(player)
  return (await saved).detail
}

function forgetEverything(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(USER_DATA_DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => resolve()
  })
}

describe('resume', () => {
  beforeEach(forgetEverything)

  it('saves the state on this device and hands it back on the next load of the package', async () => {
    const player = await play(FIXTURES.basic, { resume: '' })
    expect(count(player)).toBe('0')

    complete(player)
    const saved = await completeAndSave(player)
    expect(saved).toEqual({
      pkgId: player.pkgId,
      revision: player.revision,
      dataType: 'state',
      subContentId: '0',
      data: '{"clicks":2}'
    })
    expect(player.revision).toMatch(/^sha256:/)

    const again = await play(FIXTURES.basic, { resume: '' })
    expect(count(again)).toBe('2')
    // And it goes on from there, not from a copy of the old state.
    expect((await completeAndSave(again)).data).toBe('{"clicks":3}')
  })

  it('saves nothing, and hands nothing back, without the attribute', async () => {
    const player = await play(FIXTURES.basic)
    const frame = frameWindow(player) as Window & { H5PIntegration?: { saveFreq?: unknown } }
    expect(frame.H5PIntegration?.saveFreq).toBe(false)
    expect(player.shadowRoot?.querySelector('iframe')?.getAttribute('src')).not.toContain('resume')

    complete(player)
    await new Promise((resolve) => setTimeout(resolve, 3500))
    expect(await readUserData(player.pkgId!)).toEqual([])
  })

  it('offers a state saved against another build as a fresh start, the way H5P does', async () => {
    const first = await play(FIXTURES.basic, { resume: '' })
    const pkgId = first.pkgId!
    await writeUserData({
      pkgId,
      dataType: 'state',
      subContentId: '0',
      revision: 'sha256:some-other-build',
      data: '{"clicks":9}',
      updatedAt: Date.now()
    })

    const player = await play(FIXTURES.basic, { resume: '' })
    expect(count(player)).toBe('0')
    const dialog = frameDocument(player).querySelector('.h5p-content-user-data-reset-dialog')
    expect(dialog?.textContent).toContain('starting over')
    // The dialog wires its OK button one tick after opening.
    await waitFor(() => dialog!.classList.contains('h5p-open'))

    // OK on the dialog deletes the stale state, through the element, so it is not offered again.
    const deleted = waitForEvent<UserDataDetail>(player, 'userdata')
    ;(dialog!.querySelector('.h5p-dialog-ok-button') as HTMLElement).click()
    expect((await deleted).detail.data).toBeNull()
    expect(await readUserData(pkgId)).toEqual([])
  })

  it('keeps the last save of a package as the frame moves on to the next one', async () => {
    const player = await play(FIXTURES.basic, { resume: '' })
    const pkgId = player.pkgId!
    const revision = player.revision

    // Pressed and moved on at once: the three-second save has not happened when the frame
    // navigates, so this rides on the runtime's own unload handler.
    const saved = waitForEvent<UserDataDetail>(player, 'userdata', 10_000)
    complete(player)
    const settled = waitForSettled(player)
    player.setAttribute('src', FIXTURES.unversioned)

    const detail = (await saved).detail
    expect(detail.pkgId).toBe(pkgId)
    expect(detail.revision).toBe(revision)
    expect(detail.data).toBe('{"clicks":1}')
    expect((await settled).ok).toBe(true)

    const rows = await readUserData(pkgId)
    expect(rows.map((row) => [row.revision, row.data])).toEqual([[revision, '{"clicks":1}']])
  })

  it('forgets the state on clearUserData(), and the running document cannot bring it back', async () => {
    const player = await play(FIXTURES.basic, { resume: '' })
    await completeAndSave(player)
    expect(await readUserData(player.pkgId!)).toHaveLength(1)

    await player.clearUserData()
    expect(await readUserData(player.pkgId!)).toEqual([])

    // The document still running saves again — a second press, and its unload as the next load
    // replaces it — and none of it lands.
    complete(player)
    const again = await play(FIXTURES.basic, { resume: '' })
    expect(count(again)).toBe('0')
    expect(await readUserData(again.pkgId!)).toEqual([])
  })

  it('keeps the active resume mode until the next load', async () => {
    const player = await play(FIXTURES.basic, { resume: '' })
    await completeAndSave(player)
    expect((await readUserData(player.pkgId!))[0]?.data).toBe('{"clicks":1}')

    // The property is documented as taking effect on the next load. The running frame is still
    // the device-resume frame, so its next save must not be dropped when the host changes mode.
    player.resume = 'off'
    await completeAndSave(player)
    expect((await readUserData(player.pkgId!))[0]?.data).toBe('{"clicks":2}')

    const again = await play(FIXTURES.basic)
    expect(count(again)).toBe('0')
  })

  it('lets the host keep the state itself', async () => {
    const player = createPlayer({ resume: 'host' })
    player.userData = [{ dataType: 'state', subContentId: '0', data: '{"clicks":5}' }]
    const settled = waitForSettled(player)
    player.setAttribute('src', FIXTURES.basic)
    expect((await settled).ok).toBe(true)
    expect(count(player)).toBe('5')

    const saved = await completeAndSave(player)
    expect(saved.data).toBe('{"clicks":6}')
    expect(saved.revision).toBe(player.revision)
    // The host's store, not this device's.
    expect(await readUserData(player.pkgId!)).toEqual([])
  })

  it('stamps a state saved before the index answered, on a host that ignores Range', async () => {
    const player = await play(FIXTURES.noRangeBasic, { resume: '' })
    const saved = await completeAndSave(player)
    expect(saved.revision).toBe(player.revision)
    await waitFor(async () => (await readUserData(player.pkgId!))[0]?.revision === player.revision)

    const again = await play(FIXTURES.noRangeBasic, { resume: '' })
    expect(count(again)).toBe('1')
  })
})
