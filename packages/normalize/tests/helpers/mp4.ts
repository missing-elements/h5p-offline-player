/**
 * Tiny but structurally honest ISO media files for the faststart tests: real atom framing,
 * two tracks with a 32-bit and a 64-bit chunk offset table, and a payload the offsets point
 * into. Nothing here decodes; the remux only ever touches framing and offsets.
 */
const encoder = new TextEncoder()

export function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

export function atom(type: string, ...payload: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const body = concat(payload)
  const out = new Uint8Array(8 + body.length)
  new DataView(out.buffer).setUint32(0, out.length)
  out.set(encoder.encode(type), 4)
  out.set(body, 8)
  return out
}

export function u32s(...values: number[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(values.length * 4)
  const view = new DataView(out.buffer)
  values.forEach((value, index) => view.setUint32(index * 4, value))
  return out
}

export function u64s(...values: number[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(values.length * 8)
  const view = new DataView(out.buffer)
  values.forEach((value, index) => view.setBigUint64(index * 8, BigInt(value)))
  return out
}

/** A `stco`: version and flags, count, 32-bit offsets. */
export const stco = (offsets: number[]) => atom('stco', u32s(0, offsets.length), u32s(...offsets))
/** A `co64`: version and flags, count, 64-bit offsets. */
export const co64 = (offsets: number[]) => atom('co64', u32s(0, offsets.length), u64s(...offsets))

export interface SampleMp4 {
  bytes: Uint8Array<ArrayBuffer>
  /** The chunk offsets written into both tables, absolute within `bytes`. */
  offsets: number[]
  moovSize: number
  mdatPayload: Uint8Array<ArrayBuffer>
}

/**
 * `ftyp`, `free`, `mdat`, `moov` — the layout every non-faststart encoder produces — or with
 * `faststart` the `moov` before the `mdat`. `trailer` adds a `free` after everything, the
 * shape a file gets when a tool appends metadata.
 */
export function sampleMp4(options: { faststart?: boolean; mdatSize?: number; trailer?: boolean } = {}): SampleMp4 {
  const mdatSize = options.mdatSize ?? 200
  const ftyp = atom('ftyp', encoder.encode('isom'), u32s(0x200), encoder.encode('isomiso2mp41'))
  const free = atom('free', new Uint8Array(8))
  const mdatPayload = new Uint8Array(mdatSize).map((_, index) => index & 0xff)
  const mdat = atom('mdat', mdatPayload)

  const moovOf = (offsets: number[]) =>
    atom(
      'moov',
      atom('mvhd', new Uint8Array(100).fill(0xaa)),
      atom('trak', atom('tkhd', new Uint8Array(84)), atom('mdia', atom('minf', atom('stbl', atom('stsd', new Uint8Array(16)), stco(offsets))))),
      atom('trak', atom('mdia', atom('minf', atom('stbl', co64(offsets))))),
      atom('udta', atom('meta', new Uint8Array(4)))
    )

  // The tables' size does not depend on the values, so the length is known before the offsets.
  const moovSize = moovOf([0, 0, 0]).length
  const dataStart = (options.faststart ? moovSize : 0) + ftyp.length + free.length + 8
  const offsets = [dataStart, dataStart + 50, dataStart + Math.max(0, mdatSize - 40)]
  const moov = moovOf(offsets)
  const trailer = options.trailer ? [atom('free', new Uint8Array(16).fill(0x11))] : []

  const parts = options.faststart ? [ftyp, free, moov, mdat, ...trailer] : [ftyp, free, mdat, moov, ...trailer]
  return { bytes: concat(parts), offsets, moovSize, mdatPayload }
}

export interface FoundAtom {
  type: string
  offset: number
  size: number
}

/** The atoms directly inside `[start, end)`. */
export function atomsIn(bytes: Uint8Array, start = 0, end = bytes.length): FoundAtom[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const found: FoundAtom[] = []
  let position = start
  while (position + 8 <= end) {
    const size = view.getUint32(position)
    const type = String.fromCharCode(...bytes.subarray(position + 4, position + 8))
    found.push({ type, offset: position, size })
    position += size
  }
  return found
}

/**
 * The first atom reachable along `path` from the top level, trying every branch: a file has
 * one `trak` per stream, and the table asked for may be in the second.
 */
export function findAtom(bytes: Uint8Array, path: string[], start = 0, end = bytes.length): FoundAtom | null {
  const [type, ...rest] = path
  for (const found of atomsIn(bytes, start, end)) {
    if (found.type !== type) continue
    if (rest.length === 0) return found
    const inner = findAtom(bytes, rest, found.offset + 8, found.offset + found.size)
    if (inner) return inner
  }
  return null
}

/** The offsets a `stco` or `co64` holds. */
export function chunkOffsets(bytes: Uint8Array, table: FoundAtom): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const body = table.offset + 8
  const count = view.getUint32(body + 4)
  const wide = String.fromCharCode(...bytes.subarray(table.offset + 4, table.offset + 8)) === 'co64'
  return Array.from({ length: count }, (_, index) =>
    wide ? Number(view.getBigUint64(body + 8 + index * 8)) : view.getUint32(body + 8 + index * 4)
  )
}
