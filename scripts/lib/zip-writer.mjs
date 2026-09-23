/**
 * A zip writer that streams. Every entry's sizes and CRC are known before its data is written,
 * so each local header is complete when it goes out, no data descriptor is ever needed, and no
 * entry is held in memory. zip.js's own `ZipWriter` cannot do this: asked not to write a
 * descriptor, it buffers the entry until it knows the sizes, which for a 220 MB video means the
 * whole video. The normalizer always knows the sizes — it copies stored bytes whose size the
 * source recorded, or bytes it has already measured — so it does not need to pay for that.
 *
 * Writes local headers, a central directory, and the zip64 records when a size, an offset or the
 * entry count outgrows its 32- or 16-bit field. Extra fields, comments and file attributes are
 * not written: nothing that plays an H5P package reads them.
 */

const LOCAL_HEADER = 0x04034b50
const CENTRAL_HEADER = 0x02014b50
const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const ZIP64_END_OF_CENTRAL_DIRECTORY = 0x06064b50
const ZIP64_LOCATOR = 0x07064b50
const ZIP64_EXTRA_ID = 0x0001

const MAX_32 = 0xffffffff
const MAX_16 = 0xffff
const VERSION_DEFAULT = 20
const VERSION_ZIP64 = 45
const FLAG_ENCRYPTED = 0x0001
const FLAG_UTF8 = 0x0800

const encoder = new TextEncoder()
const EMPTY = new Uint8Array(0)

/**
 * @typedef {object} EntryMeta
 * @property {string} name canonical entry name: forward slashes, no leading slash
 * @property {number} method 0 for stored, 8 for deflate, or whatever the source used when its bytes are copied raw
 * @property {number} crc32 CRC-32 of the uncompressed content
 * @property {number} compressedSize the number of bytes `produce` will write
 * @property {number} uncompressedSize
 * @property {number} [dosDateTime] the raw DOS date/time word as a zip stores it; now when omitted
 * @property {boolean} [encrypted] the bytes are copied raw from an encrypted source, so the flag is carried over
 */

/**
 * @typedef {object} WrittenEntry
 * @property {EntryMeta} meta
 * @property {Uint8Array} rawName
 * @property {number} offset
 * @property {number} flags
 * @property {boolean} zip64 whether the local header carried zip64 sizes
 */

export class StreamingZipWriter {
  /**
   * @param {WritableStream<Uint8Array>} destination
   * @param {{ zip64?: boolean }} [options] `zip64: true` forces the zip64 records on, for testing them
   */
  constructor(destination, options = {}) {
    this.writer = destination.getWriter()
    this.forceZip64 = options.zip64 === true
    this.offset = 0
    /** @type {WrittenEntry[]} */
    this.entries = []
    /** @type {Set<string>} */
    this.names = new Set()
    this.writing = false
  }

  /**
   * Writes one entry. `produce` receives a sink and must write exactly `meta.compressedSize`
   * bytes to it in their stored form — deflated bytes for method 8, the plain bytes for
   * method 0 — and then close it. A count that does not match is an error rather than a warning:
   * the header has already gone out, and an archive whose header lies is corrupt.
   *
   * @param {EntryMeta} meta
   * @param {(sink: WritableStream<Uint8Array>) => Promise<unknown>} produce
   */
  async add(meta, produce) {
    if (this.writing) throw new Error('The previous entry has not finished')
    if (this.names.has(meta.name)) throw new Error(`Duplicate entry name: ${meta.name}`)
    this.writing = true
    this.names.add(meta.name)

    const rawName = encoder.encode(meta.name)
    const utf8 = rawName.some((byte) => byte > 0x7f)
    const zip64 =
      this.forceZip64 ||
      meta.compressedSize >= MAX_32 ||
      meta.uncompressedSize >= MAX_32 ||
      this.offset >= MAX_32
    const flags = (utf8 ? FLAG_UTF8 : 0) | (meta.encrypted ? FLAG_ENCRYPTED : 0)
    const dosDateTime = meta.dosDateTime ?? dosDateTimeOf(new Date())

    const extra = zip64 ? zip64Extra([meta.uncompressedSize, meta.compressedSize]) : EMPTY
    const header = new Uint8Array(30 + rawName.length + extra.length)
    const view = new DataView(header.buffer)
    view.setUint32(0, LOCAL_HEADER, true)
    view.setUint16(4, zip64 ? VERSION_ZIP64 : VERSION_DEFAULT, true)
    view.setUint16(6, flags, true)
    view.setUint16(8, meta.method, true)
    view.setUint32(10, dosDateTime >>> 0, true)
    view.setUint32(14, meta.crc32 >>> 0, true)
    view.setUint32(18, zip64 ? MAX_32 : meta.compressedSize, true)
    view.setUint32(22, zip64 ? MAX_32 : meta.uncompressedSize, true)
    view.setUint16(26, rawName.length, true)
    view.setUint16(28, extra.length, true)
    header.set(rawName, 30)
    header.set(extra, 30 + rawName.length)

    const entryOffset = this.offset
    await this.write(header)

    let written = 0
    let closed = false
    const sink = new WritableStream({
      write: async (chunk) => {
        written += chunk.byteLength
        await this.write(chunk)
      },
      close: () => {
        closed = true
      }
    })
    await produce(sink)
    if (!closed) await sink.close()

    if (written !== meta.compressedSize) {
      throw new Error(
        `${meta.name}: ${written} bytes were written but the header promised ${meta.compressedSize}`
      )
    }

    this.entries.push({ meta: { ...meta, dosDateTime }, rawName, offset: entryOffset, flags, zip64 })
    this.writing = false
  }

  /** Writes the central directory and closes the destination. */
  async close() {
    if (this.writing) throw new Error('An entry is still being written')
    const centralStart = this.offset

    for (const entry of this.entries) {
      const { meta, rawName, flags, offset } = entry
      const offset64 = this.forceZip64 || offset >= MAX_32
      const fields = []
      if (entry.zip64) fields.push(meta.uncompressedSize, meta.compressedSize)
      if (offset64) fields.push(offset)
      const extra = fields.length ? zip64Extra(fields) : EMPTY
      const version = entry.zip64 || offset64 ? VERSION_ZIP64 : VERSION_DEFAULT

      const header = new Uint8Array(46 + rawName.length + extra.length)
      const view = new DataView(header.buffer)
      view.setUint32(0, CENTRAL_HEADER, true)
      view.setUint16(4, version, true)
      view.setUint16(6, version, true)
      view.setUint16(8, flags, true)
      view.setUint16(10, meta.method, true)
      view.setUint32(12, (meta.dosDateTime ?? 0) >>> 0, true)
      view.setUint32(16, meta.crc32 >>> 0, true)
      view.setUint32(20, entry.zip64 ? MAX_32 : meta.compressedSize, true)
      view.setUint32(24, entry.zip64 ? MAX_32 : meta.uncompressedSize, true)
      view.setUint16(28, rawName.length, true)
      view.setUint16(30, extra.length, true)
      view.setUint16(32, 0, true) // comment length
      view.setUint16(34, 0, true) // disk number start
      view.setUint16(36, 0, true) // internal attributes
      view.setUint32(38, 0, true) // external attributes
      view.setUint32(42, offset64 ? MAX_32 : offset, true)
      header.set(rawName, 46)
      header.set(extra, 46 + rawName.length)
      await this.write(header)
    }

    const centralSize = this.offset - centralStart
    const count = this.entries.length
    const zip64 =
      this.forceZip64 || count >= MAX_16 || centralStart >= MAX_32 || centralSize >= MAX_32

    if (zip64) {
      const recordOffset = this.offset
      const record = new Uint8Array(56)
      const view = new DataView(record.buffer)
      view.setUint32(0, ZIP64_END_OF_CENTRAL_DIRECTORY, true)
      view.setBigUint64(4, 44n, true) // size of the rest of this record
      view.setUint16(12, VERSION_ZIP64, true)
      view.setUint16(14, VERSION_ZIP64, true)
      view.setUint32(16, 0, true) // this disk
      view.setUint32(20, 0, true) // disk with the central directory
      view.setBigUint64(24, BigInt(count), true)
      view.setBigUint64(32, BigInt(count), true)
      view.setBigUint64(40, BigInt(centralSize), true)
      view.setBigUint64(48, BigInt(centralStart), true)
      await this.write(record)

      const locator = new Uint8Array(20)
      const locatorView = new DataView(locator.buffer)
      locatorView.setUint32(0, ZIP64_LOCATOR, true)
      locatorView.setUint32(4, 0, true)
      locatorView.setBigUint64(8, BigInt(recordOffset), true)
      locatorView.setUint32(16, 1, true)
      await this.write(locator)
    }

    const end = new Uint8Array(22)
    const endView = new DataView(end.buffer)
    endView.setUint32(0, END_OF_CENTRAL_DIRECTORY, true)
    endView.setUint16(4, 0, true)
    endView.setUint16(6, 0, true)
    // With a zip64 record present, the classic fields carry the "look there" markers, which is
    // also what makes a reader exercise that record rather than trust these.
    endView.setUint16(8, zip64 ? MAX_16 : count, true)
    endView.setUint16(10, zip64 ? MAX_16 : count, true)
    endView.setUint32(12, zip64 ? MAX_32 : centralSize, true)
    endView.setUint32(16, zip64 ? MAX_32 : centralStart, true)
    endView.setUint16(20, 0, true)
    await this.write(end)

    await this.writer.close()
  }

  /** @param {Uint8Array} bytes */
  async write(bytes) {
    await this.writer.write(bytes)
    this.offset += bytes.byteLength
  }
}

/**
 * The zip64 extended information extra field: the 64-bit values, in the order the spec fixes,
 * for the fields that were written as `0xFFFFFFFF`.
 * @param {number[]} values
 */
function zip64Extra(values) {
  const extra = new Uint8Array(4 + values.length * 8)
  const view = new DataView(extra.buffer)
  view.setUint16(0, ZIP64_EXTRA_ID, true)
  view.setUint16(2, values.length * 8, true)
  values.forEach((value, index) => view.setBigUint64(4 + index * 8, BigInt(value), true))
  return extra
}

/**
 * The DOS date/time word for a `Date`, local time, two-second resolution, as zip stores it:
 * the date in the high 16 bits and the time in the low 16.
 * @param {Date} date
 */
export function dosDateTimeOf(date) {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107)
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  return ((dosDate << 16) | dosTime) >>> 0
}
