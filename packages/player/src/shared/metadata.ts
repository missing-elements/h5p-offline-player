/**
 * The package's own description of itself, from `h5p.json`, in the shape H5P's runtime reads:
 * the copyright dialog is built from these fields (`H5P.buildMetadataCopyrights`), and the
 * title names the activity in every statement's `object.definition`. h5p-standalone takes the
 * metadata as an option and, given none, invents `{ title, license: 'U' }` — "Undisclosed" —
 * for every package, whatever its manifest says; so the worker reads it off the manifest and
 * the frame hands it over.
 */
export interface ContentMetadata {
  title?: string
  license?: string
  licenseVersion?: string
  licenseExtras?: string
  source?: string
  yearFrom?: string
  yearTo?: string
  authorComments?: string
  defaultLanguage?: string
  authors?: Array<{ name: string; role?: string }>
  changes?: Array<{ date?: string; author?: string; log: string }>
}

const TEXT_FIELDS = ['title', 'license', 'licenseVersion', 'licenseExtras', 'source', 'yearFrom', 'yearTo', 'authorComments', 'defaultLanguage'] as const

/**
 * The licences H5P's copyright dialog has a name for (`H5P.copyrightLicenses` in the core). It
 * reads its table by the manifest's value with no check, so a package carrying any other
 * string — a CLI-built one saying `MIT`, a hand-written manifest — would die at boot on the
 * lookup. Such a licence is left out, which the runtime reads as "none given": the title and
 * the authors still go through.
 */
const KNOWN_LICENSES = new Set([
  'U', 'CC BY', 'CC BY-SA', 'CC BY-ND', 'CC BY-NC', 'CC BY-NC-SA', 'CC BY-NC-ND', 'CC0 1.0', 'GNU GPL', 'PD', 'CC PDM', 'C'
])

/**
 * The metadata fields of a manifest, each kept only when it has the type the runtime expects —
 * the manifest is untrusted, and so is a record read back from IndexedDB, which is why the frame
 * document runs it through here again. `undefined` for a manifest that says nothing of the kind.
 */
export function contentMetadata(manifest: unknown): ContentMetadata | undefined {
  if (!manifest || typeof manifest !== 'object') return undefined
  const source = manifest as Record<string, unknown>
  const out: ContentMetadata = {}
  for (const field of TEXT_FIELDS) {
    const value = source[field]
    // A year arrives as a number from some exporters; the runtime only concatenates it.
    if (typeof value === 'string' && value) out[field] = value
    else if (typeof value === 'number' && (field === 'yearFrom' || field === 'yearTo')) out[field] = String(value)
  }
  if (out.license && !KNOWN_LICENSES.has(out.license)) {
    delete out.license
    delete out.licenseVersion
  }
  const authors = list(source.authors, (item) => {
    const name = text(item.name)
    if (!name) return null
    const role = text(item.role)
    return role ? { name, role } : { name }
  })
  if (authors.length) out.authors = authors
  const changes = list(source.changes, (item) => {
    const log = text(item.log)
    if (!log) return null
    const change: { date?: string; author?: string; log: string } = { log }
    const date = text(item.date)
    const author = text(item.author)
    if (date) change.date = date
    if (author) change.author = author
    return change
  })
  if (changes.length) out.changes = changes
  return Object.keys(out).length ? out : undefined
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

function list<T>(value: unknown, pick: (item: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(value)) return []
  const out: T[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const picked = pick(item as Record<string, unknown>)
    if (picked) out.push(picked)
  }
  return out
}
