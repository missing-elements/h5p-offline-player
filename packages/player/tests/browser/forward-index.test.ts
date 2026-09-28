import { describe, expect, it } from 'vitest'
import '../../src/h5p-offline-player'
import type { H5PPlayerElement, PlayerProgressDetail } from '../../src/h5p-offline-player'
import {
  FIXTURES,
  clearPackageCaches,
  createPlayer,
  frameDocument,
  frameFetch,
  play,
  virtualUrl,
  waitFor,
  waitForSettled
} from './utils'

/**
 * A host that ignores `Range` forces the whole archive down before its central directory can be
 * read. The forward index recovers entries from the local headers as they arrive, so a package
 * laid out libraries-first boots while its media is still on its way — and a request for what has
 * not arrived waits for it rather than being refused.
 */

/** 20 MB at 4 MB/s: about five seconds, long enough to watch the player get ahead of it. */
const THROTTLED = `${FIXTURES.noRangeLargeStored}?throttle=4000000`

function watchDownload(player: H5PPlayerElement): () => number {
  let fraction = 0
  player.addEventListener('progress', (event: Event) => {
    const detail = (event as unknown as CustomEvent<PlayerProgressDetail>).detail
    if (detail.phase === 'download' && detail.fraction !== null) fraction = detail.fraction
  })
  return () => fraction
}

describe('a host that ignores Range', () => {
  it('lets a held statement go, without its revision, when the page is hidden', async () => {
    await clearPackageCaches()
    const player = createPlayer()
    const settled = waitForSettled(player, 60_000)
    player.setAttribute('src', `${THROTTLED}&case=hidden`)
    expect(await settled).toEqual({ ok: true })
    expect(player.revision).toBeNull()

    const statements: Array<{ context?: { revision?: string; platform?: string } }> = []
    player.addEventListener('xapi', (event) => {
      statements.push((event as unknown as CustomEvent<{ statement: (typeof statements)[number] }>).detail.statement)
    })
    frameDocument(player).querySelector<HTMLButtonElement>('.h5p-offline-test-complete')!.click()
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(statements).toHaveLength(0)

    // The tab closing, or hidden on a phone and never shown again: the record goes out now.
    window.dispatchEvent(new Event('pagehide'))
    expect(statements).toHaveLength(1)
    expect(statements[0].context?.revision).toBeUndefined()
    expect(statements[0].context?.platform).toMatch(/^h5p-offline-player /)
  })

  it('holds a statement sent before the download ends until the revision is known', async () => {
    await clearPackageCaches()
    const player = createPlayer()
    const downloaded = watchDownload(player)
    const settled = waitForSettled(player, 60_000)
    player.setAttribute('src', THROTTLED)
    expect(await settled).toEqual({ ok: true })

    // Booted from the forward index: there is no central directory yet, so no fingerprint.
    expect(downloaded()).toBeLessThan(1)
    expect(player.revision).toBeNull()

    const statements: Array<{ revision?: string; downloaded: number }> = []
    player.addEventListener('xapi', (event) => {
      const { statement } = (event as unknown as CustomEvent<{ statement: { context?: { revision?: string } } }>).detail
      statements.push({ revision: statement.context?.revision, downloaded: downloaded() })
    })
    frameDocument(player).querySelector<HTMLButtonElement>('.h5p-offline-test-complete')!.click()

    await waitFor(() => statements.length > 0, 30_000)
    // Released only once the archive was whole, and with the revision the element now reports.
    expect(statements[0].downloaded).toBe(1)
    expect(statements[0].revision).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(statements[0].revision).toBe(player.revision)
  })

  it('boots from the forward index while the archive is still downloading', async () => {
    await clearPackageCaches()
    const player = createPlayer()
    const downloaded = watchDownload(player)
    const settled = waitForSettled(player, 60_000)
    player.setAttribute('src', THROTTLED)

    expect(await settled).toEqual({ ok: true })
    // Ready with the media still on its way: the libraries had arrived, and that was enough.
    expect(downloaded()).toBeLessThan(1)

    // A file in a folder that has finished arriving is refused at once, not after the download.
    const started = Date.now()
    const missing = await frameFetch(player, virtualUrl(player, 'H5P.OfflineTest-1.0/nope.js'))
    expect(missing.status).toBe(404)
    expect(Date.now() - started).toBeLessThan(2_000)

    // The media is waited for, not refused: the answer comes when it has arrived.
    const media = await frameFetch(player, virtualUrl(player, 'content/media/big.bin'))
    expect(media.status).toBe(200)
    expect(Number(media.headers.get('content-length'))).toBe(20 * 1024 * 1024)

    await waitFor(() => downloaded() === 1, 30_000)
    // The real index has taken over by now; everything still answers.
    expect((await frameFetch(player, virtualUrl(player, 'h5p.json'))).status).toBe(200)
  })

  it('plays an archive whose every entry carries a data descriptor', async () => {
    await clearPackageCaches()
    const player = await play(FIXTURES.noRangeStreamed)

    const json = await frameFetch(player, virtualUrl(player, 'h5p.json'))
    expect(json.status).toBe(200)
    expect(((await json.json()) as { title: string }).title).toBeDefined()
  })

  it('still plays a small archive from such a host exactly as before', async () => {
    await clearPackageCaches()
    const player = await play(FIXTURES.noRangeBasic)
    expect(player.state).toBe('ready')
  })
})
