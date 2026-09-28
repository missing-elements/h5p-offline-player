/** A byte range with an inclusive end, the form HTTP uses. */
export interface ByteRange {
  start: number
  end: number
}

export type RangeResult = ByteRange | 'none' | 'unsatisfiable'

/**
 * Parses a `Range` header against a known resource size. Only single `bytes` ranges are handled;
 * a multi-range request is treated as absent, which is a legal response (the server may always
 * answer `200` with the whole body).
 *
 * Returns `'none'` when there is no usable range and `'unsatisfiable'` when the range starts
 * beyond the end of the resource, which the caller must answer with `416`.
 */
export function parseRange(header: string | null | undefined, size: number): RangeResult {
  if (!header) return 'none'

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return 'none'

  const [, rawStart, rawEnd] = match

  if (rawStart === '' && rawEnd === '') return 'none'

  // Suffix range: `bytes=-N` means the last N bytes.
  if (rawStart === '') {
    const suffixLength = Number(rawEnd)
    if (suffixLength === 0) return 'unsatisfiable'
    const start = Math.max(0, size - suffixLength)
    return { start, end: size - 1 }
  }

  const start = Number(rawStart)
  if (start >= size) return 'unsatisfiable'

  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (end < start) return 'unsatisfiable'

  return { start, end }
}

export function contentRange(range: ByteRange, size: number): string {
  return `bytes ${range.start}-${range.end}/${size}`
}
