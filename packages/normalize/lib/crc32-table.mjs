/** @type {Uint32Array | undefined} */
let table

/**
 * CRC-32 of `bytes`, continuing from `previous`, by a table: no Node import, so a page can import
 * it, as `@missing-elements/h5p-normalize/crc32` resolves there. Node takes `lib/crc32.mjs`, which
 * runs zlib's where Node has it.
 *
 * @param {Uint8Array} bytes
 * @param {number} [previous]
 * @returns {number}
 */
export function crc32(bytes, previous = 0) {
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
