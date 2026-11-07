import { beforeAll, describe, expect, it } from 'vitest'
import '../../src/h5p-offline-player'
import { BLOCK_SIZE } from '../../src/shared/constants'
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

/**
 * Two bytes of `installable.h5p`'s run, one in each editor's script, that neither the head's
 * block nor the tail's holds: only a request for the run itself asks for them.
 */
let probes: number[] = []
let archiveSize = 0

/** Whether a logged `Range` header asks for the byte at `offset`; a suffix range is counted from the end. */
function covers(range: string, offset: number): boolean {
  const closed = /^bytes=(\d+)-(\d*)$/.exec(range)
  if (closed) return Number(closed[1]) <= offset && (closed[2] === '' || offset <= Number(closed[2]))
  const suffix = /^bytes=-(\d+)$/.exec(range)
  return suffix !== null && offset >= archiveSize - Number(suffix[1])
}

beforeAll(async () => {
  const archive = new Uint8Array(await (await fetch('/fixtures/installable.h5p')).arrayBuffer())
  archiveSize = archive.length
  // A folder's first local header, which comes before the central directory names it: its name is 30 bytes in.
  const headerOf = (folder: string) => {
    const name = new TextEncoder().encode(folder)
    search: for (let at = 0; at + name.length <= archive.length; at += 1) {
      for (let i = 0; i < name.length; i += 1) if (archive[at + i] !== name[i]) continue search
      return at - 30
    }
    return -1
  }
  const editor = headerOf('H5PEditor.OfflineTest-1.0/')
  const widget = headerOf('H5PEditor.OfflineTestWidget-1.0/')
  probes = [Math.max(editor, BLOCK_SIZE) + 4096, widget + 4096]
  expect(editor).toBeGreaterThan(0)
  expect(probes[0]).toBeLessThan(widget)
  expect(probes[1]).toBeLessThan(archiveSize - BLOCK_SIZE)
})


describe('the requests a load costs', () => {
  it('reads a small archive’s index in one request', async () => {
    const ranges = await rangesOf('basic.h5p')
    // The probe, the index — tail, directory and both JSON files, one block — and the warm.
    expect(ranges).toHaveLength(3)
    expect(ranges[0]).toBe('bytes=0-0')
  })

  it('asks for none of a run after the content that the boot never reads (#146, #148)', async () => {
    // h5p-author's layout: after the content, the libraries an H5P site's upload check wants,
    // 200 kB here, most of it past the index's first block. The probe, the tail, the head, and the
    // warm, which stops where the run begins, since `h5p.json` does not declare those folders.
    // What it pulls, `h5p.json`, the content type and the content, lies in the head's block, which
    // the Jobs worker asks for again: its block cache is its own.
    const ranges = await rangesOf('installable.h5p')
    expect(ranges).toHaveLength(4)
    expect(ranges.filter((range) => range === `bytes=0-${BLOCK_SIZE - 1}`)).toHaveLength(2)
    expect(ranges.filter((range) => probes.some((probe) => covers(range, probe)))).toEqual([])
  })

  it('asks for none of it with the pack offered either: the plan reads only what the content reaches (#148)', async () => {
    // The pack's newer version of the content type replaces the package's own, which the plan
    // learns from the library.json files it reads after the warm: the content type's from the
    // cache, and none of the run's, each of which would be a request.
    const ranges = await rangesOf('installable.h5p', { libraries: 'pack', 'pack-base': '/fixtures/pack/' })
    expect(ranges).toHaveLength(4)
    expect(ranges.filter((range) => probes.some((probe) => covers(range, probe)))).toEqual([])
  })

  it('asks for nothing again once a bundle is attached and the reader is built anew', async () => {
    const ranges = await rangesOf('needs-dependency.h5p', { libraries: FIXTURES.libraries })
    // The probe, the tail, the head, and the warm: the reader built again with the bundle
    // attached finds every block it reads already held.
    expect(ranges).toHaveLength(4)
    expect(new Set(ranges).size).toBe(ranges.length)
  })
})
