import { afterEach, describe, expect, it } from 'vitest'
import '../../src/h5p-offline-player'
import type { PlayerErrorDetail } from '../../src/h5p-offline-player'
import { FIXTURES, clearPackageCaches, frameFetch, play, virtualUrl } from './utils'

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

const outage = (ms: number, mode: 'silent' | 'reset') =>
  fetch(`/stalling/__outage?ms=${ms}&mode=${mode}`, { cache: 'no-store' })

/** A request for the entry's last bytes: past the watermark, so its body follows the extraction. */
async function tailOf(player: Awaited<ReturnType<typeof play>>, errors: string[]) {
  player.addEventListener('error', ((event: CustomEvent<PlayerErrorDetail>) => {
    errors.push(event.detail.message)
  }) as EventListener)
  const probe = await frameFetch(player, virtualUrl(player, MEDIA), { headers: { Range: 'bytes=0-0' } })
  const size = Number(/\/(\d+)$/.exec(probe.headers.get('content-range') ?? '')?.[1])
  await probe.arrayBuffer()
  expect(size).toBeGreaterThan(TAIL)

  const tail = await frameFetch(player, virtualUrl(player, MEDIA), {
    headers: { Range: `bytes=${size - TAIL}-` }
  })
  expect(tail.status).toBe(206)
  return tail
}

describe('an extraction across an outage of the host', () => {
  afterEach(async () => {
    await outage(0, 'silent')
    await clearPackageCaches()
  })

  it('is not given up on while the link is silent for longer than the stall bound', { timeout: 120_000 }, async () => {
    await clearPackageCaches()
    const player = await play(FIXTURES.stalling)
    const errors: string[] = []
    const tail = await tailOf(player, errors)

    // The transfer is under way. Now nothing arrives for longer than the server would once wait.
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    const started = performance.now()
    await outage(35_000, 'silent')

    const body = await tail.arrayBuffer()
    expect(performance.now() - started).toBeGreaterThan(35_000)
    expect(body.byteLength).toBe(TAIL)
    expect(errors).toEqual([])
  })

  it('picks the transfer up where it stopped once a host that dropped it is back', { timeout: 90_000 }, async () => {
    await clearPackageCaches()
    const player = await play(FIXTURES.stalling)
    const errors: string[] = []
    const tail = await tailOf(player, errors)

    // Every request in flight is cut, and new ones are refused, for a while.
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    const started = performance.now()
    await outage(12_000, 'reset')

    const body = await tail.arrayBuffer()
    expect(performance.now() - started).toBeGreaterThan(12_000)
    expect(body.byteLength).toBe(TAIL)
    expect(errors).toEqual([])
  })
})
