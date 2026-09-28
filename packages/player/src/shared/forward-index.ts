/**
 * A forward index of a zip: the entries readable from its local headers alone, in the order the
 * bytes arrive, without the central directory that sits at the end of the file.
 *
 * A host that ignores `Range` forces the whole archive down before the central directory can be
 * read, and with it every entry — including the ones that arrived in the first second. Walking
 * the local headers as they stream in recovers those entries early, so a package laid out
 * libraries-first (the PHP exporter's order) can boot while its media is still downloading.
 *
 * Two things the format does that a forward walk has to survive:
 *
 * - **Data descriptors** (general-purpose bit 3). A writer that streams cannot know an entry's
 *   compressed size before it has written the data, so it writes zeros in the local header and the
 *   real sizes *after* the data. h5p.com's exporter does this for every entry. There is no length
 *   to skip by, so the data is scanned for the descriptor signature and a candidate is accepted
 *   only when the compressed size it carries equals the number of bytes seen since the data began
 *   — a 64-bit coincidence for a false positive. A writer that omits the optional signature leaves
 *   the entry unresolvable; the scanner then stops and the central directory decides at the end.
 * - **zip64**. Sizes of `0xFFFFFFFF` in the header defer to the zip64 extra field, and an entry
 *   whose header carries that field writes 8-byte sizes in its descriptor.
 *
 * Nothing here is trusted further than the central directory would be: names go through the same
 * normalisation as everything else, and the snapshot is replaced by the real index once the whole
 * archive is present.
 */

export interface ForwardEntry {
  /** The name as written in the archive. Normalised by the reader, not here. */
  name: string
  directory: boolean
  method: number
  encrypted: boolean
  crc32: number
  compressedSize: number
  uncompressedSize: number
  headerOffset: number
  dataStart: number
}

export type ForwardStop =
  /** The central directory began: every entry has been seen and the index is complete. */
  | 'central-directory'
  /** Bytes where a local header should be were not one. */
  | 'bad-signature'
  /** A descriptor entry ran to the end of the input without its descriptor being found. */
  | 'unresolved-descriptor'

export interface ForwardIndexSnapshot {
  /** Entries whose bytes have all arrived, in archive order. Nothing here is still in transit. */
  entries: ForwardEntry[]
  /** The offset up to which the archive is accounted for: the end of the last entry in `entries`. */
  parsedTo: number
  /** The central directory was reached, so `entries` is the whole archive. */
  done: boolean
  stopped: ForwardStop | null
}

const LOCAL_HEADER = 0x04034b50
const CENTRAL_HEADER = 0x02014b50
const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const ZIP64_END_OF_CENTRAL_DIRECTORY = 0x06064b50
const ZIP64_END_LOCATOR = 0x07064b50
const DESCRIPTOR = 0x08074b50
const LOCAL_HEADER_FIXED_SIZE = 30
const ZIP64_EXTRA_ID = 0x0001
const FLAG_ENCRYPTED = 0x0001
const FLAG_DESCRIPTOR = 0x0008
const MAX_UINT32 = 0xffffffff

interface HeaderFields {
  name: string
  directory: boolean
  method: number
  encrypted: boolean
  crc32: number
  compressedSize: number
  uncompressedSize: number
  headerOffset: number
  dataStart: number
  /** The header carried a zip64 extra field, so a descriptor for it uses 8-byte sizes. */
  zip64: boolean
}

type State =
  | { kind: 'header' }
  /** Inside data of known length. The entry is recorded once the data has fully passed. */
  | { kind: 'skip'; remaining: number; entry: HeaderFields }
  | { kind: 'descriptor'; entry: HeaderFields }

const decoder = new TextDecoder()

/**
 * Feeds on the bytes of an archive in order and collects entries as their local headers pass.
 * Chunks may be of any size and may split a header, a descriptor or a name anywhere.
 */
export class LocalHeaderScanner {
  readonly entries: ForwardEntry[] = []
  parsedTo = 0
  done = false
  stopped: ForwardStop | null = null

  /** Bytes not yet consumed, carried between pushes. Small: a header prefix or a descriptor tail. */
  private buffer: Uint8Array = new Uint8Array(0)
  /** Absolute offset of `buffer[0]`. */
  private position = 0
  private state: State = { kind: 'header' }

  push(chunk: Uint8Array): void {
    if (this.stopped || this.done || chunk.length === 0) return
    this.buffer = this.buffer.length === 0 ? chunk : join(this.buffer, chunk)
    this.drain()
  }

  /** The input ended. A descriptor still being looked for can now never be found. */
  finish(): void {
    if (!this.done && !this.stopped && this.state.kind === 'descriptor') {
      this.stopped = 'unresolved-descriptor'
    }
  }

  snapshot(): ForwardIndexSnapshot {
    return { entries: [...this.entries], parsedTo: this.parsedTo, done: this.done, stopped: this.stopped }
  }

  private consume(count: number): void {
    this.buffer = this.buffer.subarray(count)
    this.position += count
  }

  private drain(): void {
    for (;;) {
      const state = this.state

      if (state.kind === 'skip') {
        const take = Math.min(state.remaining, this.buffer.length)
        this.consume(take)
        state.remaining -= take
        if (state.remaining > 0) return
        // Only now: an entry is in the index when its bytes are all here, never before. A reader
        // served an entry off its header alone would reach for data that has not arrived.
        this.record(state.entry)
        this.state = { kind: 'header' }
        this.parsedTo = this.position
        continue
      }

      if (state.kind === 'header') {
        if (!this.readHeader()) return
        continue
      }

      if (!this.findDescriptor(state.entry)) return
    }
  }

  /** Returns false when more bytes are needed or the scan has ended. */
  private readHeader(): boolean {
    const { buffer } = this
    if (buffer.length < 4) return false

    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    const signature = view.getUint32(0, true)

    if (
      signature === CENTRAL_HEADER ||
      signature === END_OF_CENTRAL_DIRECTORY ||
      signature === ZIP64_END_OF_CENTRAL_DIRECTORY ||
      signature === ZIP64_END_LOCATOR
    ) {
      this.done = true
      this.stopped = 'central-directory'
      this.parsedTo = this.position
      return false
    }
    if (signature !== LOCAL_HEADER) {
      this.stopped = 'bad-signature'
      return false
    }
    if (buffer.length < LOCAL_HEADER_FIXED_SIZE) return false

    const flags = view.getUint16(6, true)
    const method = view.getUint16(8, true)
    const crc32 = view.getUint32(14, true)
    let compressedSize = view.getUint32(18, true)
    let uncompressedSize = view.getUint32(22, true)
    const nameLength = view.getUint16(26, true)
    const extraLength = view.getUint16(28, true)
    const headerLength = LOCAL_HEADER_FIXED_SIZE + nameLength + extraLength
    if (buffer.length < headerLength) return false

    const name = decoder.decode(buffer.subarray(LOCAL_HEADER_FIXED_SIZE, LOCAL_HEADER_FIXED_SIZE + nameLength))
    const extra = buffer.subarray(LOCAL_HEADER_FIXED_SIZE + nameLength, headerLength)
    const zip64 = readZip64(extra, uncompressedSize === MAX_UINT32, compressedSize === MAX_UINT32)
    if (zip64) {
      uncompressedSize = zip64.uncompressedSize ?? uncompressedSize
      compressedSize = zip64.compressedSize ?? compressedSize
    }

    const entry: HeaderFields = {
      name,
      directory: name.endsWith('/'),
      method,
      encrypted: (flags & FLAG_ENCRYPTED) !== 0,
      crc32,
      compressedSize,
      uncompressedSize,
      headerOffset: this.position,
      dataStart: this.position + headerLength,
      zip64: zip64 !== null
    }
    this.consume(headerLength)

    if (flags & FLAG_DESCRIPTOR) {
      // Sizes come after the data. Nothing to skip by, so the data is scanned for them.
      this.state = { kind: 'descriptor', entry }
      return true
    }

    this.state = { kind: 'skip', remaining: compressedSize, entry }
    return true
  }

  /**
   * Looks for the descriptor that ends `entry`. Returns false when more bytes are needed.
   *
   * A candidate is the signature followed by a compressed size equal to the bytes seen since the
   * data began. Bytes that cannot start a candidate that fits are consumed; the last few are kept,
   * since a descriptor can straddle two chunks.
   */
  private findDescriptor(entry: HeaderFields): boolean {
    const { buffer } = this
    const length = entry.zip64 ? 24 : 16
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

    let at = 0
    while (at + length <= buffer.length) {
      at = buffer.indexOf(0x50, at)
      if (at < 0 || at + length > buffer.length) break

      if (view.getUint32(at, true) === DESCRIPTOR) {
        const consumed = this.position + at - entry.dataStart
        const compressedSize = entry.zip64 ? readUint64(view, at + 8) : view.getUint32(at + 8, true)

        if (compressedSize === consumed) {
          entry.crc32 = view.getUint32(at + 4, true)
          entry.compressedSize = compressedSize
          entry.uncompressedSize = entry.zip64 ? readUint64(view, at + 16) : view.getUint32(at + 12, true)
          this.record(entry)
          this.consume(at + length)
          this.state = { kind: 'header' }
          this.parsedTo = this.position
          return true
        }
      }
      at += 1
    }

    // No descriptor in what is here. Keep only what could still begin one.
    const keep = Math.min(buffer.length, length - 1)
    this.consume(buffer.length - keep)
    return false
  }

  private record(entry: HeaderFields): void {
    const { zip64: _zip64, ...fields } = entry
    this.entries.push(fields)
  }
}

/**
 * The zip64 extra field carries the real sizes when the header's are `0xFFFFFFFF` — only those, in
 * the fixed order uncompressed then compressed. Returns null when the header has no such field.
 */
function readZip64(
  extra: Uint8Array,
  uncompressedIsMax: boolean,
  compressedIsMax: boolean
): { uncompressedSize?: number; compressedSize?: number } | null {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength)
  let at = 0
  while (at + 4 <= extra.length) {
    const id = view.getUint16(at, true)
    const size = view.getUint16(at + 2, true)
    if (id === ZIP64_EXTRA_ID) {
      const sizes: { uncompressedSize?: number; compressedSize?: number } = {}
      let field = at + 4
      if (uncompressedIsMax && field + 8 <= at + 4 + size) {
        sizes.uncompressedSize = readUint64(view, field)
        field += 8
      }
      if (compressedIsMax && field + 8 <= at + 4 + size) {
        sizes.compressedSize = readUint64(view, field)
      }
      return sizes
    }
    at += 4 + size
  }
  return null
}

function readUint64(view: DataView, at: number): number {
  const value = view.getBigUint64(at, true)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('zip64 size beyond a safe integer')
  return Number(value)
}

function join(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}
