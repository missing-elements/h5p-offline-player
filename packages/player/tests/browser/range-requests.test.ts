import { describe, expect, it } from 'vitest'
import '../../src/h5p-offline-player'
import { FIXTURES, play } from './utils'

/**
 * What a load costs a host that honours `Range`, counted by the host itself: `/counted/` writes
 * down every request it answers. zip.js reads an index in small pieces — the tail, the central
 * directory, each entry's local header and then its data — and every piece was a request; the
 * reader the Service Worker builds again once libraries are attached asked for all of them again.
 * A 1.5 MB quiz paid thirteen requests before it booted (#133). The block cache under small reads
 * is what keeps the count down, and this keeps it from creeping back.
 */
async function rangesOf(fixture: string, attributes: Record<string, string> = {}): Promise<string[]> {
  const log = crypto.randomUUID()
  await play(`/counted/${fixture}?log=${log}`, attributes)
  return (await fetch(`/counted/__log?log=${log}`)).json()
}

describe('the requests a load costs', () => {
  it('reads a small archive’s index in one request', async () => {
    const ranges = await rangesOf('basic.h5p')
    // The probe, the index — tail, directory and both JSON files, one block — and the warm.
    expect(ranges).toHaveLength(3)
    expect(ranges[0]).toBe('bytes=0-0')
  })

  it('asks for nothing of its own for a run after the content that the boot never reads (#146)', async () => {
    // h5p-author's layout: after the content, the libraries an H5P site's upload check wants,
    // 200 kB here past the index's first block. The probe, the tail, the head, and the warm, which
    // pulls the run with the rest in its one request; the deep index then reads its library.json
    // files from the cache, where each would otherwise be a request.
    const ranges = await rangesOf('installable.h5p')
    expect(ranges).toHaveLength(4)
    expect(new Set(ranges).size).toBe(ranges.length)
  })

  it('asks for nothing again once a bundle is attached and the reader is built anew', async () => {
    const ranges = await rangesOf('needs-dependency.h5p', { libraries: FIXTURES.libraries })
    // The probe, the tail, the head, and the warm: the reader built again with the bundle
    // attached finds every block it reads already held.
    expect(ranges).toHaveLength(4)
    expect(new Set(ranges).size).toBe(ranges.length)
  })
})
