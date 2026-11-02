import zlib from 'node:zlib'
import { crc32 as tableCrc32 } from './crc32-table.mjs'

/**
 * CRC-32 of `bytes`, continuing from `previous`. Native from Node 22.2 on; a table before that.
 * A namespace import rather than a named one, because a named import of a builtin's missing
 * export fails at link time and would take the whole script down on an older Node. Exported as
 * `@missing-elements/h5p-normalize/crc32` for Node; a page resolves that to `lib/crc32-table.mjs`.
 *
 * @type {(bytes: Uint8Array, previous?: number) => number}
 */
export const crc32 =
  typeof zlib.crc32 === 'function'
    ? (bytes, previous = 0) => zlib.crc32(bytes, previous)
    : (bytes, previous = 0) => tableCrc32(bytes, previous)
