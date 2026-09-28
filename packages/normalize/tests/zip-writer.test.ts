import { deflateRawSync } from 'node:zlib'
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader, type FileEntry } from '@zip.js/zip.js'
import { describe, expect, it } from 'vitest'
import { crc32 } from '../../scripts/lib/crc32.mjs'
import { StreamingZipWriter, dosDateTimeOf } from '../../scripts/lib/zip-writer.mjs'
import { concat } from './helpers/mp4'

function memorySink() {
  const chunks: Uint8Array[] = []
  const stream = new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(chunk.slice())
    }
  })
  return { stream, bytes: () => concat(chunks) }
}

const text = new TextEncoder().encode(JSON.stringify({ title: 'x'.repeat(2000) }))
const binary = new Uint8Array(100_000).map((_, index) => (index * 7919) & 0xff)

async function pour(sink: WritableStream<Uint8Array>, ...parts: Uint8Array[]) {
  const writer = sink.getWriter()
  for (const part of parts) await writer.write(part)
  await writer.close()
}

async function writeSample(options: { zip64?: boolean } = {}) {
  const sink = memorySink()
  const writer = new StreamingZipWriter(sink.stream, options)
  const deflated = deflateRawSync(text)
  const stamp = dosDateTimeOf(new Date(2024, 4, 6, 7, 8, 10))
  await writer.add(
    { name: 'h5p.json', method: 8, crc32: crc32(text), compressedSize: deflated.length, uncompressedSize: text.length, dosDateTime: stamp },
    (out) => pour(out, deflated)
  )
  await writer.add(
    { name: 'content/media/a.bin', method: 0, crc32: crc32(binary), compressedSize: binary.length, uncompressedSize: binary.length, dosDateTime: stamp },
    (out) => pour(out, binary.subarray(0, 40_000), binary.subarray(40_000))
  )
  await writer.close()
  return { bytes: sink.bytes(), stamp }
}

async function readBack(bytes: Uint8Array<ArrayBuffer>) {
  const reader = new ZipReader(new Uint8ArrayReader(bytes))
  const entries = (await reader.getEntries()).filter((entry): entry is FileEntry => !entry.directory)
  const data = await Promise.all(entries.map((entry) => entry.getData(new Uint8ArrayWriter())))
  await reader.close()
  return { entries, data }
}

/** Bit 3 of the general purpose flags in the local header at `offset`. */
function descriptorBitAt(bytes: Uint8Array, offset: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  expect(view.getUint32(offset, true)).toBe(0x04034b50)
  return (view.getUint16(offset + 6, true) & 0x0008) !== 0
}

describe('StreamingZipWriter', () => {
  it('writes stored and deflated entries that zip.js reads back, with no data descriptors', async () => {
    const { bytes, stamp } = await writeSample()
    const { entries, data } = await readBack(bytes)

    expect(entries.map((entry) => entry.filename)).toEqual(['h5p.json', 'content/media/a.bin'])
    expect(entries.map((entry) => entry.compressionMethod)).toEqual([8, 0])
    expect(entries.map((entry) => entry.bitFlag?.dataDescriptor)).toEqual([false, false])
    expect(entries.map((entry) => entry.rawLastModDate)).toEqual([stamp, stamp])
    expect(entries.map((entry) => entry.zip64)).toEqual([false, false])
    expect(data[0]).toEqual(text)
    expect(data[1]).toEqual(binary)

    // The local headers themselves, not only what zip.js makes of them.
    for (const entry of entries) expect(descriptorBitAt(bytes, entry.offset)).toBe(false)
  })

  it('writes the zip64 records when asked to, and zip.js still reads it', async () => {
    const { bytes } = await writeSample({ zip64: true })
    const { entries, data } = await readBack(bytes)

    expect(entries.map((entry) => entry.zip64)).toEqual([true, true])
    expect(data[0]).toEqual(text)
    expect(data[1]).toEqual(binary)
    // The classic end record points at the zip64 one.
    const view = new DataView(bytes.buffer)
    expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50)
    expect(view.getUint16(bytes.length - 22 + 10, true)).toBe(0xffff)
    expect(view.getUint32(bytes.length - 22 - 20, true)).toBe(0x07064b50)
  })

  it('keeps a non-ASCII name and flags it as UTF-8', async () => {
    const sink = memorySink()
    const writer = new StreamingZipWriter(sink.stream)
    const name = 'content/média/übung.txt'
    await writer.add({ name, method: 0, crc32: crc32(binary), compressedSize: binary.length, uncompressedSize: binary.length }, (out) => pour(out, binary))
    await writer.close()
    const { entries } = await readBack(sink.bytes())
    expect(entries[0].filename).toBe(name)
    expect(entries[0].bitFlag?.languageEncodingFlag).toBe(true)
  })

  it('refuses an entry whose data does not match the size its header promised', async () => {
    const sink = memorySink()
    const writer = new StreamingZipWriter(sink.stream)
    await expect(
      writer.add({ name: 'short.bin', method: 0, crc32: 0, compressedSize: 10, uncompressedSize: 10 }, (out) => pour(out, binary.subarray(0, 5)))
    ).rejects.toThrow(/5 bytes were written but the header promised 10/)
  })

  it('refuses a duplicate name', async () => {
    const sink = memorySink()
    const writer = new StreamingZipWriter(sink.stream)
    const meta = { name: 'a.txt', method: 0, crc32: crc32(text), compressedSize: text.length, uncompressedSize: text.length }
    await writer.add(meta, (out) => pour(out, text))
    await expect(writer.add(meta, (out) => pour(out, text))).rejects.toThrow(/Duplicate entry name/)
  })
})
