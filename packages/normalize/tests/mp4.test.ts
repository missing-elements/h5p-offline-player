import { describe, expect, it } from 'vitest'
import { mp4Info, topLevelAtoms } from '../lib/mp4.mjs'
import { atom, concat, describedMp4, sampleMp4, u32s } from './helpers/mp4'

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
    // The media starts after `mdat`'s type, and runs for its million bytes: none of it is asked for.
    const media = bytes.findIndex((_, i) => String.fromCharCode(...bytes.subarray(i, i + 4)) === 'mdat') + 4
    const read = async (offset: number, length: number) => {
      if (offset + length > media && offset < media + 1_000_000) throw new Error(`read ${length} bytes of the media at ${offset}`)
      return bytes.subarray(offset, offset + length)
    }
    expect((await mp4Info(read, bytes.length))?.duration).toBe(30)
  })

  it('reads each field within its atom: a header cut short gives no length rather than a neighbour\'s bytes', async () => {
    const ftyp = atom('ftyp', new TextEncoder().encode('isom'))
    // An mvhd of 12 bytes, where version 0 needs 20: read past its end, the next atom's header
    // would pass for a timescale and a duration.
    const cut = concat([ftyp, atom('moov', atom('mvhd', u32s(0, 0, 0)), atom('free', u32s(1000, 30_000, 0, 0)))])
    expect(await infoOf(cut)).toEqual({ duration: undefined, tracks: [] })
  })

  it('is null for a file with no index, an index with no header, and a file that is no mp4', async () => {
    const ftyp = atom('ftyp', new TextEncoder().encode('isom'))
    expect(await infoOf(concat([ftyp, atom('mdat', new Uint8Array(100))]))).toBeNull()
    expect(await infoOf(concat([ftyp, atom('moov', atom('udta', new Uint8Array(4))), atom('mdat', new Uint8Array(100))]))).toBeNull()
    expect(await infoOf(new TextEncoder().encode('ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000'))).toBeNull()
  })

  it('stops at the index, and gives up on a file of more atoms than a real one has before it', async () => {
    // A fragmented file: its index first, then as many fragments as it likes, which are not walked.
    const fragmented = concat([describedMp4(), ...Array.from({ length: 20_000 }, () => atom('moof', new Uint8Array(0)))])
    const read = reader(fragmented)
    expect((await mp4Info(read, fragmented.length))?.duration).toBe(30)
    expect(read.given).toBeLessThan(1_000)
    // A file of tiny atoms and no index costs ten thousand headers at most, not one per atom.
    const tiny = concat([atom('ftyp', new TextEncoder().encode('isom')), ...Array.from({ length: 20_000 }, () => atom('free', new Uint8Array(0)))])
    const counted = reader(tiny)
    expect(await mp4Info(counted, tiny.length)).toBeNull()
    expect(counted.given).toBeLessThanOrEqual(10_000 * 8)
  })
})
