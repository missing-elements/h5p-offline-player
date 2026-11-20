import { mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { planFaststart, readPieces } from '../lib/mp4-faststart.mjs'
import { faststartPlan } from '../lib/mp4.mjs'
import { atom, atomsIn, chunkOffsets, concat, findAtom, sampleMp4, stco, u32s } from './helpers/mp4'

async function withFile<T>(bytes: Uint8Array, run: (file: Awaited<ReturnType<typeof open>>) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'faststart-test-'))
  const path = join(dir, 'media.bin')
  await writeFile(path, bytes)
  const file = await open(path, 'r')
  try {
    return await run(file)
  } finally {
    await file.close()
    await rm(dir, { recursive: true, force: true })
  }
}

type FileHandle = Awaited<ReturnType<typeof open>>
type Plan = Awaited<ReturnType<typeof planFaststart>>

async function assemble(file: FileHandle, plan: Plan) {
  const chunks: Uint8Array[] = []
  for await (const chunk of readPieces(file, plan.pieces)) chunks.push(chunk)
  return concat(chunks)
}

const types = (bytes: Uint8Array) => atomsIn(bytes).map((found) => found.type)

describe('planFaststart', () => {
  it('moves moov in front of mdat and shifts every chunk offset by its length', async () => {
    const sample = sampleMp4()
    await withFile(sample.bytes, async (file) => {
      const plan = await planFaststart(file, 0, sample.bytes.length)
      expect(plan.status).toBe('moved')
      expect(plan.detail).toMatch(/moov was behind/)

      const out = await assemble(file, plan)
      expect(out.length).toBe(sample.bytes.length)
      expect(types(out)).toEqual(['ftyp', 'free', 'moov', 'mdat'])

      const shifted = sample.offsets.map((offset) => offset + sample.moovSize)
      expect(chunkOffsets(out, findAtom(out, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stco'])!)).toEqual(shifted)
      expect(chunkOffsets(out, findAtom(out, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'co64'])!)).toEqual(shifted)

      // The data itself and the rest of the index are untouched.
      const mdat = findAtom(out, ['mdat'])!
      expect(out.subarray(mdat.offset + 8, mdat.offset + mdat.size)).toEqual(sample.mdatPayload)
      const mvhd = findAtom(out, ['moov', 'mvhd'])!
      expect(out.subarray(mvhd.offset + 8, mvhd.offset + mvhd.size)).toEqual(new Uint8Array(100).fill(0xaa))
      // And the offsets now point where the data actually is.
      expect(shifted[0]).toBe(mdat.offset + 8)
    })
  })

  it('leaves a file that is already faststart alone', async () => {
    const sample = sampleMp4({ faststart: true })
    await withFile(sample.bytes, async (file) => {
      const plan = await planFaststart(file, 0, sample.bytes.length)
      expect(plan.status).toBe('already')
      expect(await assemble(file, plan)).toEqual(sample.bytes)
    })
  })

  it('works on a media file that starts partway into the file', async () => {
    const sample = sampleMp4()
    const prefix = new Uint8Array(37).fill(0xee)
    await withFile(concat([prefix, sample.bytes]), async (file) => {
      const plan = await planFaststart(file, prefix.length, sample.bytes.length)
      expect(plan.status).toBe('moved')
      const out = await assemble(file, plan)
      expect(types(out)).toEqual(['ftyp', 'free', 'moov', 'mdat'])
      const shifted = sample.offsets.map((offset) => offset + sample.moovSize)
      expect(chunkOffsets(out, findAtom(out, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stco'])!)).toEqual(shifted)
    })
  })

  it('keeps an atom that follows moov where it was', async () => {
    const sample = sampleMp4({ trailer: true })
    await withFile(sample.bytes, async (file) => {
      const plan = await planFaststart(file, 0, sample.bytes.length)
      expect(plan.status).toBe('moved')
      const out = await assemble(file, plan)
      expect(types(out)).toEqual(['ftyp', 'free', 'moov', 'mdat', 'free'])
      const trailer = atomsIn(out).at(-1)!
      expect(trailer.offset).toBe(atomsIn(sample.bytes).at(-1)!.offset)
      expect(out.subarray(trailer.offset + 8, trailer.offset + trailer.size)).toEqual(new Uint8Array(16).fill(0x11))
    })
  })

  it('skips what it does not understand, and hands the input back unchanged', async () => {
    const cases: Array<[Uint8Array, RegExp]> = [
      [new Uint8Array(64).map((_, index) => (index * 31) & 0xff), /not an ISO media file/],
      [concat([atom('ftyp', u32s(1, 2)), atom('mdat', new Uint8Array(20))]), /no moov/],
      [concat([atom('ftyp', u32s(1, 2)), atom('moov', atom('mvhd', new Uint8Array(8)))]), /no mdat/],
      [concat([atom('ftyp', u32s(1)), atom('mdat', new Uint8Array(8)), atom('moof', new Uint8Array(8)), atom('moov', new Uint8Array(8))]), /fragmented/],
      [concat([atom('ftyp', u32s(1)), atom('mdat', new Uint8Array(8)), atom('moov', atom('cmov', new Uint8Array(8)))]), /compressed moov/],
      // Common Encryption: `saio` holds absolute positions the remux does not rewrite.
      [
        concat([
          atom('ftyp', u32s(1)),
          atom('mdat', new Uint8Array(8)),
          atom('moov', atom('trak', atom('mdia', atom('minf', atom('stbl', atom('saio', u32s(0, 1, 16)), stco([16]))))))
        ]),
        /encrypted sample data/
      ]
    ]
    for (const [bytes, reason] of cases) {
      await withFile(bytes, async (file) => {
        const plan = await planFaststart(file, 0, bytes.length)
        expect(plan.status).toBe('skipped')
        expect(plan.detail).toMatch(reason)
        expect(await assemble(file, plan)).toEqual(bytes)
      })
    }
  })
})

describe('faststartPlan', () => {
  it('leaves alone an index of containers nested deeper than a real one, however deep, and one just as deep as a real one is moved', async () => {
    // A hundred thousand `trak` atoms, each holding the next: a walk into every one runs out of stack.
    const levels = 100_000
    const nested = new Uint8Array(levels * 8)
    const view = new DataView(nested.buffer)
    for (let level = 0; level < levels; level++) {
      view.setUint32(level * 8, nested.length - level * 8)
      nested.set(new TextEncoder().encode('trak'), level * 8 + 4)
    }
    const crafted = concat([atom('ftyp', u32s(1)), atom('mdat', new Uint8Array(8)), atom('moov', nested)])
    const plan = await faststartPlan(async (offset, length) => crafted.subarray(offset, offset + length), crafted.length)
    expect(plan).toMatchObject({ status: 'skipped', detail: 'containers nested deeper than an index has', pieces: [{ start: 0, end: crafted.length }] })

    const real = concat([atom('ftyp', u32s(1)), atom('mdat', new Uint8Array(8)), atom('moov', atom('trak', atom('mdia', atom('minf', atom('stbl', stco([16]))))))])
    expect((await faststartPlan(async (offset, length) => real.subarray(offset, offset + length), real.length)).status).toBe('moved')
  })


  it('lays out bytes held in memory as the faststart lays out a file, and leaves the bytes it read as they were', async () => {
    const sample = sampleMp4()
    const original = sample.bytes.slice()
    // A read that hands back views of the bytes it holds, as a page reading a Blob's slices need not.
    const read = async (offset: number, length: number) => sample.bytes.subarray(offset, Math.min(offset + length, sample.bytes.length))
    const plan = await faststartPlan(read, sample.bytes.length)
    expect(plan.status).toBe('moved')
    const laid = concat(plan.pieces.map((piece) => ('bytes' in piece ? piece.bytes : sample.bytes.subarray(piece.start, piece.end))))
    const fromFile = await withFile(sample.bytes, async (file) => assemble(file, await planFaststart(file, 0, sample.bytes.length)))
    expect(laid).toEqual(fromFile)
    expect(types(laid)).toEqual(['ftyp', 'free', 'moov', 'mdat'])
    expect(sample.bytes).toEqual(original)

    for (const bytes of [sampleMp4({ faststart: true }).bytes, new TextEncoder().encode('<!DOCTYPE html>')]) {
      const left = await faststartPlan(async (offset, length) => bytes.subarray(offset, offset + length), bytes.length)
      expect(left.pieces).toEqual([{ start: 0, end: bytes.length }])
    }
  })
})
