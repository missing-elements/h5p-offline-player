/**
 * Moves an mp4's `moov` atom in front of its `mdat`, so a player can decode the first frame from
 * the first few hundred kilobytes instead of after the last byte. A remux, not a re-encode: the
 * only bytes that change are the chunk offset tables (`stco` / `co64`) inside `moov`, which
 * shift by the length of `moov` itself because `moov` now sits in front of the data they point
 * into. The same thing `qt-faststart` and `ffmpeg -movflags +faststart` do.
 *
 * Works on a range of an open file rather than on a buffer: the video may be a stored entry read
 * in place in the source archive, or an inflated copy in a temp file, and neither is loaded
 * whole. Only `moov` — a few megabytes at most — is read into memory, because it is rewritten.
 */
import { formatBytes } from './format.mjs'

/** Atoms whose children hold the chunk offset tables. Nothing under any other branch does. */
const CONTAINERS = new Set(['trak', 'mdia', 'minf', 'stbl'])

/** Types a file can plausibly start with. Anything else is not an ISO media file. */
const LEADING_TYPES = new Set(['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'uuid', 'pnot', 'styp', 'sidx'])

/** Larger than any real index; a `moov` past this is a malformed file, and is left alone. */
const MAX_MOOV_SIZE = 256 * 1024 * 1024

const READ_CHUNK = 1024 * 1024

/**
 * @typedef {{ start: number, end: number } | { bytes: Uint8Array }} Piece
 *   Either a range of the source file — absolute positions, end exclusive — or literal bytes.
 *
 * @typedef {object} Atom
 * @property {string} type
 * @property {number} offset relative to the start of the media file
 * @property {number} size including the header
 * @property {number} headerSize 8, or 16 with a 64-bit size
 *
 * @typedef {object} FaststartPlan
 * @property {'moved' | 'already' | 'skipped'} status
 * @property {string} detail why, in words
 * @property {Piece[]} pieces the output in order; the input itself when nothing moved
 * @property {number} size the output length, always equal to the input length
 */

/**
 * Decides how to lay the file out. Never throws over content: a file that is not an mp4, or one
 * whose structure this does not understand, comes back `skipped` with the input as its output.
 *
 * @param {import('node:fs/promises').FileHandle} file
 * @param {number} base where the media file starts within `file`
 * @param {number} size its length
 * @returns {Promise<FaststartPlan>}
 */
export async function planFaststart(file, base, size) {
  /** @type {Piece[]} */
  const identity = [{ start: base, end: base + size }]
  /** @param {string} detail */
  const skipped = (detail) => ({ status: /** @type {const} */ ('skipped'), detail, pieces: identity, size })

  const atoms = await readTopLevelAtoms(file, base, size)
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

  const moovBytes = Buffer.alloc(moov.size)
  await readExact(file, moovBytes, base + moov.offset)

  // Where a byte ends up once `moov` is lifted out from behind `mdat` and dropped in front of it:
  // anything before `mdat` stays put, anything from `mdat` up to `moov` moves back by `moov`'s
  // length, and anything after `moov` loses it in front and gains it behind, so does not move.
  /** @param {number} position */
  const shift = (position) => (position >= mdat.offset && position < moov.offset ? moov.size : 0)

  const problem = patchChunkOffsets(moovBytes, moov.headerSize, moov.size, shift)
  if (problem) return skipped(problem)

  /** @type {Piece[]} */
  const pieces = [
    { start: base, end: base + mdat.offset },
    { bytes: moovBytes },
    { start: base + mdat.offset, end: base + moov.offset },
    { start: base + moov.offset + moov.size, end: base + size }
  ].filter((piece) => 'bytes' in piece || piece.end > piece.start)

  return {
    status: 'moved',
    detail: `moov was behind ${formatBytes(moov.offset - mdat.offset)} of mdat`,
    pieces,
    size
  }
}

/**
 * The bytes a plan describes, in order, in chunks of about a megabyte.
 * @param {import('node:fs/promises').FileHandle} file
 * @param {Piece[]} pieces
 * @returns {AsyncGenerator<Uint8Array>}
 */
export async function* readPieces(file, pieces) {
  for (const piece of pieces) {
    if ('bytes' in piece) {
      yield piece.bytes
      continue
    }
    let position = piece.start
    while (position < piece.end) {
      const length = Math.min(READ_CHUNK, piece.end - position)
      const buffer = Buffer.alloc(length)
      await readExact(file, buffer, position)
      yield buffer
      position += length
    }
  }
}

/**
 * The top-level atoms of the file, or `null` where its structure is not one this understands.
 * @param {import('node:fs/promises').FileHandle} file
 * @param {number} base
 * @param {number} size
 * @returns {Promise<Atom[] | null>}
 */
async function readTopLevelAtoms(file, base, size) {
  /** @type {Atom[]} */
  const atoms = []
  const header = Buffer.alloc(16)
  let position = 0

  while (position < size) {
    if (size - position < 8) return null
    await readExact(file, header.subarray(0, 8), base + position)
    let atomSize = header.readUInt32BE(0)
    const type = header.toString('latin1', 4, 8)
    let headerSize = 8

    if (atomSize === 1) {
      if (size - position < 16) return null
      await readExact(file, header.subarray(8, 16), base + position + 8)
      atomSize = Number(header.readBigUInt64BE(8))
      headerSize = 16
    } else if (atomSize === 0) {
      atomSize = size - position
    }

    if (atomSize < headerSize || position + atomSize > size) return null
    if (!/^[\x20-\x7e]{4}$/.test(type)) return null
    if (atoms.length === 0 && !LEADING_TYPES.has(type)) return null

    atoms.push({ type, offset: position, size: atomSize, headerSize })
    position += atomSize
  }

  return atoms
}

/**
 * Walks the atoms between `start` and `end` inside `moov`, descending into the containers that
 * lead to sample tables, and adds `shift(offset)` to every chunk offset it finds. Returns a
 * reason where the table cannot be rewritten, `null` on success.
 *
 * @param {Buffer} moov
 * @param {number} start
 * @param {number} end
 * @param {(position: number) => number} shift
 * @returns {string | null}
 */
function patchChunkOffsets(moov, start, end, shift) {
  let position = start

  while (position + 8 <= end) {
    let atomSize = moov.readUInt32BE(position)
    const type = moov.toString('latin1', position + 4, position + 8)
    let headerSize = 8

    if (atomSize === 1) {
      if (position + 16 > end) return 'truncated atom inside moov'
      atomSize = Number(moov.readBigUInt64BE(position + 8))
      headerSize = 16
    } else if (atomSize === 0) {
      atomSize = end - position
    }
    if (atomSize < headerSize || position + atomSize > end) return 'malformed atom inside moov'

    if (type === 'cmov') return 'compressed moov is not supported'

    if (CONTAINERS.has(type)) {
      const problem = patchChunkOffsets(moov, position + headerSize, position + atomSize, shift)
      if (problem) return problem
    } else if (type === 'stco' || type === 'co64') {
      const body = position + headerSize
      const wide = type === 'co64'
      const entrySize = wide ? 8 : 4
      if (body + 8 > position + atomSize) return `truncated ${type}`
      const count = moov.readUInt32BE(body + 4) // after the version and flags word
      if (body + 8 + count * entrySize > position + atomSize) return `${type} claims more entries than it holds`

      for (let index = 0; index < count; index++) {
        const at = body + 8 + index * entrySize
        if (wide) {
          const offset = moov.readBigUInt64BE(at)
          moov.writeBigUInt64BE(offset + BigInt(shift(Number(offset))), at)
        } else {
          const offset = moov.readUInt32BE(at)
          const moved = offset + shift(offset)
          if (moved > 0xffffffff) return 'a chunk offset would outgrow stco; the file needs co64'
          moov.writeUInt32BE(moved, at)
        }
      }
    }

    position += atomSize
  }

  return null
}

/**
 * Fills `buffer` from `position`, or throws: a short read here means the file changed under us.
 * @param {import('node:fs/promises').FileHandle} file
 * @param {Buffer} buffer
 * @param {number} position
 */
async function readExact(file, buffer, position) {
  let filled = 0
  while (filled < buffer.length) {
    const { bytesRead } = await file.read(buffer, filled, buffer.length - filled, position + filled)
    if (bytesRead === 0) throw new Error(`Unexpected end of file at ${position + filled}`)
    filled += bytesRead
  }
}
