import zlib from 'node:zlib'

/** @type {Uint32Array | undefined} */
let table

/**
 * @param {Uint8Array} bytes
 * @param {number} previous
 */
function tableCrc32(bytes, previous) {
  if (!table) {
    table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
  }
  let crc = ~previous >>> 0
  for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return ~crc >>> 0
}

/**
 * CRC-32 of `bytes`, continuing from `previous`. Native from Node 22.2 on; a table before that.
 * A namespace import rather than a named one, because a named import of a builtin's missing
 * export fails at link time and would take the whole script down on an older Node.
 *
 * @type {(bytes: Uint8Array, previous?: number) => number}
 */
export const crc32 =
  typeof zlib.crc32 === 'function'
    ? (bytes, previous = 0) => zlib.crc32(bytes, previous)
    : (bytes, previous = 0) => tableCrc32(bytes, previous)
