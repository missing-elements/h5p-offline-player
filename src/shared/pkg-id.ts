/**
 * Package identity. The id is derived from what identifies the bytes, not from a counter, so the
 * same URL (with the same validator) or the same picked file finds its cached chunks again on a
 * later visit.
 */

const encoder = new TextEncoder()

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/** 32 hex characters: 128 bits, short enough to read in a URL and far past collision risk here. */
async function shortHash(input: string): Promise<string> {
  return (await sha256Hex(input)).slice(0, 32)
}

/**
 * Id for a remote package. The validator (`ETag`, falling back to `Last-Modified`) is folded in
 * when the host exposes one, so a republished archive at the same URL gets a new id instead of
 * colliding with the stale chunks of the old one.
 */
export function remotePkgId(url: string, validator?: string | null): Promise<string> {
  return shortHash(`url\u0000${url}\u0000${validator ?? ''}`)
}

/**
 * Id for a picked file. Name, size and mtime are all a browser exposes. The descriptor row dies
 * with the session because a `File` handle cannot be persisted, but the chunks survive and are
 * found again when the same file is picked.
 */
export function filePkgId(file: { name: string; size: number; lastModified: number }): Promise<string> {
  return shortHash(`file\u0000${file.name}\u0000${file.size}\u0000${file.lastModified}`)
}
