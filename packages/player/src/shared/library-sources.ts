import type { LibrarySource } from './protocol'

/**
 * The `libraries` attribute: `pack` or a URL, or several separated by whitespace, in order.
 *
 * `hub` is read as `pack`. Up to 0.5 it asked the H5P hub for the content type's bundle; the one
 * hub host that sends CORS headers serves a catalogue older than current exports need, so a page
 * written for `hub` now gets the pack. `onHub` hears that it happened, for a console note.
 */
export function parseLibrarySources(value: string | null | undefined, onHub?: () => void): LibrarySource[] {
  const words = value?.trim() ? value.trim().split(/\s+/) : []
  const sources = words.map((word): LibrarySource => {
    if (word === 'pack') return 'pack'
    if (word === 'hub') {
      onHub?.()
      return 'pack'
    }
    return { url: word }
  })
  // `pack hub`, written when the pack came before the hub, would try the same bundle twice.
  return sources.filter((source, index) => source !== 'pack' || sources.indexOf('pack') === index)
}
