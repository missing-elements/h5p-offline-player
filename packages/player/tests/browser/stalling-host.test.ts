import { type H5PPlayerElement, type PlayerProgressDetail } from '../../src/h5p-offline-player'
import { afterEach, describe, expect, it } from 'vitest'
import '../../src/h5p-offline-player'
import type { PlayerErrorDetail } from '../../src/h5p-offline-player'
import { FIXTURES, clearPackageCaches, frameFetch, play, virtualUrl, waitForEvent } from './utils'

/**
 * An extraction that loses its link in the middle. What must hold: the virtual server keeps
 * serving the response that follows it — the job is alive, only the host is not answering — and
 * the Jobs worker picks the transfer up where it stopped once the host is back. Before this, a
 * link silent for thirty seconds ended the media element's response with an error, and a media
 * element never asks again after one of those: the video sat with its play icon on until the
 * page was reloaded, by which time the extraction had long finished.
 */

const MEDIA = 'content/media/big.bin'
const TAIL = 1024

/** This file's own host on the stalling server, so other files' outages leave it alone. */
const HOST = 'stalling-host'

const outage = (ms: number, mode: 'silent' | 'reset') =>
  fetch(`/stalling/__outage?ms=${ms}&mode=${mode}&host=${HOST}`, { cache: 'no-store' })

/**
 * A request for the entry's last bytes: past the watermark, so its body follows the extraction.
 * Returned pending: Chromium hands the page the headers at once, Firefox only with the first
 * bytes of the body, which for the tail is once the extraction has reached it — so the outage has
 * to start while the response is still pending, or in Firefox it would start after the transfer
 * was over.
 */
async function tailOf(player: Awaited<ReturnType<typeof play>>, errors: string[]): Promise<() => Promise<ArrayBuffer>> {
  player.addEventListener('error', ((event: CustomEvent<PlayerErrorDetail>) => {
    errors.push(event.detail.message)
  }) as EventListener)
  const probe = await frameFetch(player, virtualUrl(player, MEDIA), { headers: { Range: 'bytes=0-0' } })
  const size = Number(/\/(\d+)$/.exec(probe.headers.get('content-range') ?? '')?.[1])
  await probe.arrayBuffer()
  expect(size).toBeGreaterThan(TAIL)

  const tail = frameFetch(player, virtualUrl(player, MEDIA), {
    headers: { Range: `bytes=${size - TAIL}-` }
  })
  return async () => {
    const response = await tail
    expect(response.status).toBe(206)
    return response.arrayBuffer()
  }
}

/** Resolves on the next extraction progress with bytes landed: the transfer is under way. */
const underWay = (player: H5PPlayerElement) =>
  waitForEvent<PlayerProgressDetail>(player, 'progress', 30_000, (detail) => detail.phase === 'extract' && detail.loaded > 0)

describe('an extraction across an outage of the host', () => {
  afterEach(async () => {
    await outage(0, 'silent')
    await clearPackageCaches()
  })

  it('is not given up on while the link is silent for longer than the stall bound', { timeout: 120_000 }, async () => {
    await clearPackageCaches()
    const player = await play(`${FIXTURES.stalling}&host=${HOST}`)
    const errors: string[] = []
    const tail = await tailOf(player, errors)

    // The transfer is under way: bytes of the tail's extraction have landed. Now nothing arrives
    // for longer than the server would once wait.
    await underWay(player)
    const started = performance.now()
    await outage(35_000, 'silent')

    const body = await tail()
    expect(performance.now() - started).toBeGreaterThan(35_000)
    expect(body.byteLength).toBe(TAIL)
    expect(errors).toEqual([])
  })

  it('picks the transfer up where it stopped once a host that dropped it is back', { timeout: 90_000 }, async () => {
    await clearPackageCaches()
    const player = await play(`${FIXTURES.stalling}&host=${HOST}`)
    const errors: string[] = []
    const tail = await tailOf(player, errors)

    // The transfer is under way; then every request in flight is cut, and new ones are refused, for a while.
    await underWay(player)
    const started = performance.now()
    await outage(12_000, 'reset')

    const body = await tail()
    expect(performance.now() - started).toBeGreaterThan(12_000)
    expect(body.byteLength).toBe(TAIL)
    expect(errors).toEqual([])
  })
})
