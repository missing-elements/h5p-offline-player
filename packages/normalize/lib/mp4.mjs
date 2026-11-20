/**
 * An ISO media file, an mp4's or an m4a's, read by its atoms: where they are, and what its index
 * (`moov`) says of it. Through a `read(offset, length)` that gives fewer bytes at the file's end,
 * so it runs wherever the bytes are, a file in Node or a `Blob` on a page. Only atoms' headers and
 * a few small atoms are read: never the media, nor the index's tables, but where the index is moved
 * in front of the media (`faststartPlan`), which reads it whole to rewrite its chunk offsets.
 */
import { formatBytes } from './format.mjs'

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

/** Atoms whose children hold the chunk offset tables. Nothing under any other branch does. */
const CONTAINERS = new Set(['trak', 'mdia', 'minf', 'stbl'])

/** Larger than any real index; a `moov` past this is a malformed file, and is left alone. */
const MAX_MOOV_SIZE = 256 * 1024 * 1024

/**
 * Deeper than the containers of a real index nest, which is four, `trak` to `stbl`: an index made
 * of containers inside containers, as only a crafted file has, is left alone before the walk
 * through it runs out of stack.
 */
const MAX_DEPTH = 8

/**
 * @typedef {{ start: number, end: number } | { bytes: Uint8Array }} Piece a range of the media
 *   file, end exclusive, or literal bytes
 *
 * @typedef {object} FaststartPlan
 * @property {'moved' | 'already' | 'skipped'} status
 * @property {string} detail why, in words
 * @property {Piece[]} pieces the output in order; the whole file when nothing moved
 * @property {number} size the output length, always the input's
 */

/**
 * How to lay an mp4 out with its index (`moov`) in front of its media (`mdat`), so that a player
 * decodes the first frame from the first few hundred kilobytes instead of after the last byte. A
 * remux, not a re-encode: the only bytes that change are the chunk offset tables (`stco`, `co64`)
 * inside `moov`, which shift by its length, since it now sits in front of the data they point
 * into: what `qt-faststart` and `ffmpeg -movflags +faststart` do. Only `moov`, a few megabytes at
 * most, is read into memory; the rest is ranges of the file. So it runs wherever the bytes are: a
 * range of a file in Node, as the normalizer's faststart, or a `Blob` on a page, whose slices are
 * the ranges, as the author's build page lays out a video it stores.
 *
 * Never throws over content: a file that is no ISO media file, or one whose structure this does
 * not understand, comes back `skipped`, with the input as its output.
 * @param {Read} read
 * @param {number} size the file's length
 * @returns {Promise<FaststartPlan>}
 */
export async function faststartPlan(read, size) {
  /** @type {Piece[]} */
  const identity = [{ start: 0, end: size }]
  /** @param {string} detail */
  const skipped = (detail) => ({ status: /** @type {const} */ ('skipped'), detail, pieces: identity, size })

  // As far as a fragment, which says the file streams as it is, however many follow.
  const atoms = await topLevelAtoms(read, size, 'moof')
  if (!atoms) return skipped('not an ISO media file')
  if (atoms.some((atom) => atom.type === 'moof')) return skipped('fragmented mp4, already streamable')

  const moov = atoms.find((atom) => atom.type === 'moov')
  const mdat = atoms.find((atom) => atom.type === 'mdat')
  if (!moov) return skipped('no moov atom')
  if (!mdat) return skipped('no mdat atom')
  if (moov.offset < mdat.offset) {
    return { status: 'already', detail: 'moov already precedes mdat', pieces: identity, size }
  }
  if (moov.size > MAX_MOOV_SIZE) return skipped('moov is implausibly large')

  const whole = await read(moov.offset, moov.size)
  if (whole.length < moov.size) throw new Error(`Unexpected end of file at ${moov.offset + whole.length}`)
  // A copy: a read may hand back a view of bytes it keeps, which are not this to change.
  const index = new Uint8Array(whole)

  // Where a byte ends up once `moov` is lifted out from behind `mdat` and dropped in front of it:
  // anything before `mdat` stays put, anything from `mdat` up to `moov` moves back by `moov`'s
  // length, and anything after `moov` loses it in front and gains it behind, so does not move.
  /** @param {number} position */
  const shift = (position) => (position >= mdat.offset && position < moov.offset ? moov.size : 0)

  const problem = patchChunkOffsets(index, moov.headerSize, moov.size, shift)
  if (problem) return skipped(problem)

  /** @type {Piece[]} */
  const pieces = [
    { start: 0, end: mdat.offset },
    { bytes: index },
    { start: mdat.offset, end: moov.offset },
    { start: moov.offset + moov.size, end: size }
  ].filter((piece) => 'bytes' in piece || piece.end > piece.start)

  return {
    status: 'moved',
    detail: `moov was behind ${formatBytes(moov.offset - mdat.offset)} of mdat`,
    pieces,
    size
  }
}

/**
 * Walks the atoms between `start` and `end` inside `moov`, descending into the containers that
 * lead to sample tables, and adds `shift(offset)` to every chunk offset it finds. Any other
 * absolute position it knows of, `saio`, makes the file one it will not move. Returns a reason
 * where the table cannot be rewritten, `null` on success.
 * @param {Uint8Array} moov
 * @param {number} start
 * @param {number} end
 * @param {(position: number) => number} shift
 * @param {number} [depth] how many containers deep `start` is
 * @returns {string | null}
 */
function patchChunkOffsets(moov, start, end, shift, depth = 0) {
  if (depth > MAX_DEPTH) return 'containers nested deeper than an index has'
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength)
  let position = start

  while (position + 8 <= end) {
    let atomSize = view.getUint32(position)
    const type = ascii(moov.subarray(position + 4, position + 8))
    let headerSize = 8

    if (atomSize === 1) {
      if (position + 16 > end) return 'truncated atom inside moov'
      atomSize = Number(view.getBigUint64(position + 8))
      headerSize = 16
    } else if (atomSize === 0) {
      atomSize = end - position
    }
    if (atomSize < headerSize || position + atomSize > end) return 'malformed atom inside moov'

    if (type === 'cmov') return 'compressed moov is not supported'
    // Common Encryption keeps the offsets of its per-sample data in `saio`, and in a file that is
    // not fragmented those are absolute file positions, like the chunk offsets. Moving `moov`
    // without rewriting them would leave a protected video that can no longer be decrypted, so
    // such a file is left as it was.
    if (type === 'saio') return 'encrypted sample data (saio) is not supported'

    if (CONTAINERS.has(type)) {
      const problem = patchChunkOffsets(moov, position + headerSize, position + atomSize, shift, depth + 1)
      if (problem) return problem
    } else if (type === 'stco' || type === 'co64') {
      const body = position + headerSize
      const wide = type === 'co64'
      const entrySize = wide ? 8 : 4
      if (body + 8 > position + atomSize) return `truncated ${type}`
      const count = view.getUint32(body + 4) // after the version and flags word
      if (body + 8 + count * entrySize > position + atomSize) return `${type} claims more entries than it holds`

      for (let index = 0; index < count; index++) {
        const at = body + 8 + index * entrySize
        if (wide) {
          const offset = view.getBigUint64(at)
          view.setBigUint64(at, offset + BigInt(shift(Number(offset))))
        } else {
          const offset = view.getUint32(at)
          const moved = offset + shift(offset)
          if (moved > 0xffffffff) return 'a chunk offset would outgrow stco; the file needs co64'
          view.setUint32(at, moved)
        }
      }
    }

    position += atomSize
  }

  return null
}
