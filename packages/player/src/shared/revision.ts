/**
 * Which build of a package a learner completed, in the two fields xAPI defines for it.
 *
 * `context.revision` — "revision of the learning activity associated with this Statement. Format
 * is free" — carries a fingerprint of the archive's index; `context.platform` names the player.
 * Neither is set by H5P core, and both are allowed on every H5P statement, whose object is an
 * Activity. *When* a build was the current one is not the statement's to say: that is the
 * publishing organisation's version record, which an audit compares these against.
 */

/** One central-directory record, as much of it as the fingerprint covers. */
export interface FingerprintEntry {
  /** The name's bytes as stored, so no decoding choice — CP437 or UTF-8 — can change the result. */
  rawName: Uint8Array
  crc32: number
  compressedSize: number
  size: number
  method: number
}

/**
 * SHA-256 over the central directory's records, in archive order: per entry the name's length
 * (u32) and bytes, the CRC-32 (u32), the compressed and uncompressed sizes (u64) and the method
 * (u16), all little-endian. Written as `sha256:<hex>`.
 *
 * The index, not the whole file, because it is already read at index time and is a few
 * kilobytes, while a range-read package is never read whole. It changes with any entry's name,
 * size, checksum, method or place in the archive, so it identifies a build; zipping the same
 * files again in another order is another build. Dates, comments and extra fields stay out: they
 * say nothing about what the learner was shown. It is not proof against forgery — CRC-32 can be
 * matched on purpose — which is why the original `.h5p` is what an audit keeps and recomputes
 * this from. The normalizer's `lib/fingerprint.mjs` is the same recipe for Node; keep the two in
 * step, as the shared test vector checks.
 */
export async function indexFingerprint(entries: Iterable<FingerprintEntry>): Promise<string> {
  const parts: Uint8Array[] = []
  let length = 0
  for (const entry of entries) {
    const record = new Uint8Array(4 + entry.rawName.length + 4 + 8 + 8 + 2)
    const view = new DataView(record.buffer)
    let at = 0
    view.setUint32(at, entry.rawName.length, true)
    at += 4
    record.set(entry.rawName, at)
    at += entry.rawName.length
    view.setUint32(at, entry.crc32 >>> 0, true)
    at += 4
    view.setBigUint64(at, BigInt(entry.compressedSize), true)
    at += 8
    view.setBigUint64(at, BigInt(entry.size), true)
    at += 8
    view.setUint16(at, entry.method, true)
    parts.push(record)
    length += record.length
  }

  const all = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    all.set(part, offset)
    offset += part.length
  }

  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', all))
  return `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

/**
 * The revision of what was played: the package's fingerprint, and each attached library
 * bundle's after it. A bundle is part of what the learner saw — the hub changes its libraries
 * over time — so the same package played against another bundle is another revision.
 */
export function revisionOf(content: string, libraries: readonly string[] = []): string {
  return libraries.length === 0 ? content : `${content}; libraries ${libraries.join(', ')}`
}

/** What `context.platform` says: the player, and its version. */
export function platformOf(version: string): string {
  return `h5p-offline-player ${version}`
}

type Statement = Record<string, unknown> & {
  object?: { objectType?: unknown }
  context?: Record<string, unknown>
}

/**
 * A copy of `statement` with `context.revision` and `context.platform` filled in. Only where the
 * spec allows them — the object is an Activity, which is also what an absent `objectType` means —
 * and never over a value the content set itself.
 */
export function withProvenance(statement: unknown, revision: string | null, platform: string): unknown {
  if (!statement || typeof statement !== 'object') return statement
  const source = statement as Statement
  const objectType = source.object?.objectType
  if (objectType !== undefined && objectType !== 'Activity') return statement

  const context = { ...(source.context ?? {}) }
  if (revision && context.revision === undefined) context.revision = revision
  if (context.platform === undefined) context.platform = platform
  return { ...source, context }
}
