/**
 * The zip local header, the thirty bytes in front of every entry's data. Three places read it —
 * the virtual server before slicing a stored entry, the warm as it walks a span, the Jobs worker
 * before inflating an entry — and none of them needs zip.js for it: the central directory has
 * already said where the header is, and all that is left is to step over it.
 */

export const LOCAL_HEADER_SIGNATURE = 0x04034b50
export const LOCAL_HEADER_FIXED_SIZE = 30

/** Zip compression methods: the only two an H5P package is served with. */
export const STORED = 0
export const DEFLATE = 8

/**
 * Where an entry's compressed bytes begin, given the offset of its local header and the header's
 * first thirty bytes, or `null` when those bytes are not a local header. The name and extra
 * lengths are taken from the local header itself, not from the central directory: the two agree
 * in practice, but only the local one is authoritative for what precedes the data.
 */
export function localHeaderDataStart(offset: number, header: Uint8Array): number | null {
  if (header.length < LOCAL_HEADER_FIXED_SIZE) return null
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
  if (view.getUint32(0, true) !== LOCAL_HEADER_SIGNATURE) return null
  const nameLength = view.getUint16(26, true)
  const extraLength = view.getUint16(28, true)
  return offset + LOCAL_HEADER_FIXED_SIZE + nameLength + extraLength
}
