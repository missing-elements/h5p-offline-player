/**
 * Moves an mp4's `moov` atom in front of its `mdat` in a range of an open file: the video may be
 * a stored entry read in place in the source archive, or an inflated copy in a temp file, and
 * neither is loaded whole. The plan is `faststartPlan`'s, in `mp4.mjs`, which a page runs on a
 * `Blob` too; this gives it the file's bytes and reads the pieces it names.
 */
import { faststartPlan } from './mp4.mjs'

const READ_CHUNK = 1024 * 1024

/**
 * @typedef {import('./mp4.mjs').Piece} Piece here a range of the source file, absolute positions,
 *   or literal bytes
 * @typedef {import('./mp4.mjs').FaststartPlan} FaststartPlan
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
  // The media file's own bytes, never past its end: it may be a range of a larger file.
  const read = async (/** @type {number} */ offset, /** @type {number} */ length) => {
    const buffer = Buffer.alloc(Math.max(0, Math.min(length, size - offset)))
    await readExact(file, buffer, base + offset)
    return buffer
  }
  const plan = await faststartPlan(read, size)
  return { ...plan, pieces: plan.pieces.map((piece) => ('bytes' in piece ? piece : { start: base + piece.start, end: base + piece.end })) }
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
