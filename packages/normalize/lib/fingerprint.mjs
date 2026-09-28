import { createHash } from 'node:crypto'
import { BlobReader, ZipReader } from '@zip.js/zip.js'
import { openAsBlob } from 'node:fs'

/**
 * The player's index fingerprint, for Node: what h5p-offline-player puts in every xAPI
 * statement's `context.revision` for this archive (with ` libraries …` after it when a bundle is
 * attached at play time). A copy of `indexFingerprint` in the player's `src/shared/revision.ts`,
 * because this package is plain JavaScript and cannot import the player's TypeScript; the
 * player's unit tests check both against one vector, so keep them in step.
 *
 * SHA-256 over the central directory's records in archive order: per entry the name's length
 * (u32) and raw bytes, the CRC-32 (u32), the compressed and uncompressed sizes (u64) and the
 * method (u16), little-endian.
 */

/**
 * @param {Iterable<{ rawName: Uint8Array, crc32: number, compressedSize: number, size: number, method: number }>} entries
 * @returns {string} `sha256:<hex>`
 */
export function indexFingerprint(entries) {
  const hash = createHash('sha256')
  for (const entry of entries) {
    const head = Buffer.alloc(4)
    head.writeUInt32LE(entry.rawName.length, 0)
    const tail = Buffer.alloc(4 + 8 + 8 + 2)
    tail.writeUInt32LE(entry.crc32 >>> 0, 0)
    tail.writeBigUInt64LE(BigInt(entry.compressedSize), 4)
    tail.writeBigUInt64LE(BigInt(entry.size), 12)
    tail.writeUInt16LE(entry.method, 20)
    hash.update(head).update(entry.rawName).update(tail)
  }
  return `sha256:${hash.digest('hex')}`
}

/**
 * The fingerprint of an archive on disk, read from its central directory.
 *
 * @param {string} path
 * @returns {Promise<string>}
 */
export async function archiveFingerprint(path) {
  const reader = new ZipReader(new BlobReader(await openAsBlob(path)))
  try {
    const entries = await reader.getEntries({ filenameValidation: 'tolerant' })
    return indexFingerprint(
      entries.map((entry) => ({
        rawName: entry.rawFilename,
        crc32: entry.signature ?? 0,
        compressedSize: entry.compressedSize,
        size: entry.uncompressedSize,
        method: entry.compressionMethod
      }))
    )
  } finally {
    await reader.close()
  }
}
