import type { LibrarySource } from './protocol'

/**
 * The `libraries` attribute: `pack` or a URL, or several separated by whitespace, in order.
 *
 * Any other word is a URL, relative to the page. Up to 0.10 `hub` was read as `pack`, the H5P hub
 * having been replaced by the pack in 0.6; it went before 1.0, and a page that still writes it
 * now fails on the address, named in the error, rather than playing something it did not name.
 */
export function parseLibrarySources(value: string | null | undefined): LibrarySource[] {
  const words = value?.trim() ? value.trim().split(/\s+/) : []
  const sources = words.map((word): LibrarySource => (word === 'pack' ? 'pack' : { url: word }))
  // `pack` written twice would try the same parts twice.
  return sources.filter((source, index) => source !== 'pack' || sources.indexOf('pack') === index)
}
