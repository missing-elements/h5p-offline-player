/**
 * An ISO media file, an mp4's or an m4a's, read by its atoms: where they are, and what its index
 * (`moov`) says of it. Through a `read(offset, length)` that gives fewer bytes at the file's end,
 * so it runs wherever the bytes are, a file in Node or a `Blob` on a page. Only atoms' headers and
 * a few small atoms are read: never the media, nor the index's tables.
 */

/**
 * @typedef {(offset: number, length: number) => Promise<Uint8Array>} Read the file's bytes from an
 *   offset, fewer at its end
 *
 * @typedef {object} Atom
 * @property {string} type
 * @property {number} offset relative to the start of the media file
 * @property {number} size including the header
 * @property {number} headerSize 8, or 16 with a 64-bit size
 *
 * @typedef {object} Mp4Info
 * @property {number | undefined} duration in seconds, where the index says
 * @property {{ kind: 'video' | 'audio' | 'other', codec: string }[]} tracks each track's kind, by
 *   its handler, and the format of its first sample description: `avc1`, `hvc1`, `mp4a`…
 */

/** Types a file can plausibly start with. Anything else is not an ISO media file. */
const LEADING_TYPES = new Set(['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'uuid', 'pnot', 'styp', 'sidx'])

/** What a track holds, by its handler's type. */
const KINDS = /** @type {Record<string, 'video' | 'audio'>} */ ({ vide: 'video', soun: 'audio' })

/**
 * More atoms than a real file has at one level, a fragmented one included as far as its index:
 * a file of more is not one this reads, and is not walked to its end, so that one made of tiny
 * atoms costs neither the memory nor the time.
 */
const MAX_ATOMS = 10_000

/** @param {Uint8Array} bytes */
const ascii = (bytes) => String.fromCharCode(...bytes)

/**
 * The atoms between `start` and `end`, each by its header, as far as the first of type `until`
 * where one is given; `null` where one is not whole there or is no atom, or where there are more
 * than `MAX_ATOMS`.
 * @param {Read} read
 * @param {number} start
 * @param {number} end
 * @param {{ file?: boolean, until?: string }} [options] `file`, the file's own atoms, the first of
 *   which has a type a file starts with; `until`, the type to stop at
 * @returns {Promise<Atom[] | null>}
 */
async function atomsIn(read, start, end, { file = false, until } = {}) {
  /** @type {Atom[]} */
  const atoms = []
  let position = start
  while (position < end) {
    if (end - position < 8 || atoms.length === MAX_ATOMS) return null
    const header = await read(position, 8)
    if (header.length < 8) return null
    let size = new DataView(header.buffer, header.byteOffset, 8).getUint32(0)
    const type = ascii(header.subarray(4, 8))
    let headerSize = 8
    if (size === 1) {
      // A 64-bit size, read only where an atom has one: the eight bytes after a header are its data.
      const wide = end - position < 16 ? new Uint8Array(0) : await read(position + 8, 8)
      if (wide.length < 8) return null
      size = Number(new DataView(wide.buffer, wide.byteOffset, 8).getBigUint64(0))
      headerSize = 16
    } else if (size === 0) {
      size = end - position
    }
    if (size < headerSize || position + size > end) return null
    if (!/^[\x20-\x7e]{4}$/.test(type)) return null
    if (file && atoms.length === 0 && !LEADING_TYPES.has(type)) return null
    atoms.push({ type, offset: position, size, headerSize })
    if (type === until) break
    position += size
  }
  return atoms
}

/**
 * The top-level atoms of the file, as far as the first of type `until` where one is given, or
 * `null` where its structure is not one this understands.
 * @internal the walk the faststart shares
 * @param {Read} read
 * @param {number} size the file's length
 * @param {string} [until]
 * @returns {Promise<Atom[] | null>}
 */
export function topLevelAtoms(read, size, until) {
  return atomsIn(read, 0, size, { file: true, until })
}

/**
 * Text in an atom's body, from `at`: never past the atom, and none where it is too short.
 * @param {Read} read
 * @param {Atom | undefined} atom
 * @param {number} at
 * @param {number} length
 */
async function textIn(read, atom, at, length) {
  return atom && atom.size - atom.headerSize >= at + length ? ascii(await read(atom.offset + atom.headerSize + at, length)) : ''
}

/** @param {Read} read @param {Atom} atom */
const childrenOf = (read, atom) => atomsIn(read, atom.offset + atom.headerSize, atom.offset + atom.size)

/**
 * What an mp4's index says of it: how long it is, and its tracks with their codecs. `null` where
 * the file is no ISO media file or has no index this can read.
 * @param {Read} read
 * @param {number} size the file's length
 * @returns {Promise<Mp4Info | null>}
 */
export async function mp4Info(read, size) {
  // As far as the index, which a fragmented file has first, and any other first or last.
  const moov = (await topLevelAtoms(read, size, 'moov'))?.find((atom) => atom.type === 'moov')
  const index = moov && (await childrenOf(read, moov))
  // An index says what the movie is in its header: without one, it is none.
  if (!index?.some((atom) => atom.type === 'mvhd')) return null
  /** @type {Mp4Info} */
  const info = { duration: undefined, tracks: [] }
  for (const atom of index) {
    if (atom.type === 'mvhd') info.duration = await durationOf(read, atom)
    else if (atom.type === 'trak') {
      const track = await trackOf(read, atom)
      if (track) info.tracks.push(track)
    }
  }
  return info
}

/**
 * The movie header's duration in seconds, or `undefined` where it gives none: 0 or all ones, as a
 * fragmented file's may.
 * @param {Read} read
 * @param {Atom} mvhd
 */
async function durationOf(read, mvhd) {
  const body = await read(mvhd.offset + mvhd.headerSize, Math.min(32, mvhd.size - mvhd.headerSize))
  const wide = body[0] === 1
  if (body.length < (wide ? 32 : 20)) return undefined
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength)
  const timescale = view.getUint32(wide ? 20 : 12)
  const duration = wide ? view.getBigUint64(24) : BigInt(view.getUint32(16))
  if (!timescale || !duration || duration === (wide ? 0xffffffffffffffffn : 0xffffffffn)) return undefined
  return Number(duration) / timescale
}

/**
 * A track's kind, from `mdia` › `hdlr`, and its codec, the first sample description's format in
 * `mdia` › `minf` › `stbl` › `stsd`; `null` where it has no `mdia` this can read.
 * @param {Read} read
 * @param {Atom} trak
 */
async function trackOf(read, trak) {
  const mdia = (await childrenOf(read, trak))?.find((atom) => atom.type === 'mdia')
  const media = mdia && (await childrenOf(read, mdia))
  if (!media) return null
  const hdlr = media.find((atom) => atom.type === 'hdlr')
  const minf = media.find((atom) => atom.type === 'minf')
  const stbl = minf && (await childrenOf(read, minf))?.find((atom) => atom.type === 'stbl')
  const stsd = stbl && (await childrenOf(read, stbl))?.find((atom) => atom.type === 'stsd')
  // After the version and flags: `hdlr` has a word before its handler, `stsd` its count and the entry's size.
  const handler = await textIn(read, hdlr, 8, 4)
  const codec = await textIn(read, stsd, 12, 4)
  return { kind: KINDS[handler] ?? 'other', codec }
}
