import { describe, expect, it } from 'vitest'
import { mp4Info, topLevelAtoms } from '../lib/mp4.mjs'
import { describedMp4, sampleMp4 } from './helpers/mp4'

/** A `read` over bytes, as a file's or a `Blob`'s: fewer at the end. It counts what it gave. */
function reader(bytes: Uint8Array) {
  const read = Object.assign(async (offset: number, length: number) => {
    const piece = bytes.subarray(offset, offset + length)
    read.given += piece.length
    return piece
  }, { given: 0 })
  return read
}

const infoOf = (bytes: Uint8Array) => mp4Info(reader(bytes), bytes.length)

describe('topLevelAtoms', () => {
  it('lists the file\'s atoms by their headers', async () => {
    const { bytes } = sampleMp4()
    expect((await topLevelAtoms(reader(bytes), bytes.length))?.map((atom) => atom.type)).toEqual(['ftyp', 'free', 'mdat', 'moov'])
  })

  it('is null for a file that is no ISO media file', async () => {
    const page = new TextEncoder().encode('<!DOCTYPE html><title>clip.mp4</title>')
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81])
    expect(await topLevelAtoms(reader(page), page.length)).toBeNull()
    expect(await topLevelAtoms(reader(webm), webm.length)).toBeNull()
  })
})

describe('mp4Info', () => {
  it('reads the length and each track\'s kind and codec, the index before its media or after', async () => {
    const expected = { duration: 30, tracks: [{ kind: 'video', codec: 'avc1' }, { kind: 'audio', codec: 'mp4a' }] }
    expect(await infoOf(describedMp4())).toEqual(expected)
    expect(await infoOf(describedMp4({ faststart: false }))).toEqual(expected)
  })

  it('reads a 64-bit header, a silent video and an HEVC one', async () => {
    expect(await infoOf(describedMp4({ wide: true, duration: 90_090, timescale: 30_000, tracks: [{ handler: 'vide', codec: 'hvc1' }] })))
      .toEqual({ duration: 3.003, tracks: [{ kind: 'video', codec: 'hvc1' }] })
  })

  it('gives no length where the index gives none, as a fragmented file\'s may', async () => {
    expect((await infoOf(describedMp4({ duration: 0 })))?.duration).toBeUndefined()
  })

  it('reads headers and the few atoms it needs, never the media', async () => {
    const bytes = describedMp4({ faststart: false, mdatSize: 1_000_000 })
    const read = reader(bytes)
    await mp4Info(read, bytes.length)
    expect(read.given).toBeLessThan(1_000)
  })

  it('is null for a file with no index, and for one that is no mp4', async () => {
    const { bytes } = sampleMp4()
    expect(await infoOf(bytes.subarray(0, 120))).toBeNull()
    expect(await infoOf(new TextEncoder().encode('ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000'))).toBeNull()
  })
})
