/**
 * One of the text faces the core stylesheet declares. The player's frame document writes the
 * `@font-face` rule from it, so the browser fetches only the faces a page renders.
 */
export interface RuntimeFont {
  family: string
  style: 'normal' | 'italic'
  weight: string
  url: string
}

/**
 * The runtime's files, as absolute URLs resolved against this module — what `<h5p-player>`'s
 * `runtime` property takes. Each is a static `new URL(…, import.meta.url)` in `index.js`, so a
 * bundler emits the file under a name of its own and rewrites the address.
 */
export interface FrameRuntime {
  /** This package's version. */
  version: string
  /** `frame.bundle.js`: the H5P core's scripts, jQuery and h5p.js among them, from h5p-php-library. */
  frameJs: string
  /** The core stylesheet, rebuilt to stand alone: icon fonts and images inlined. */
  frameCss: string
  /** The frame's boot script, which the player's Service Worker names in the frame document. */
  bootJs: string
  fonts: RuntimeFont[]
  /**
   * The core's interface strings in every language this package has, and which language tag gets
   * which: one script, which the frame loads ahead of the boot script when the element's `lang`
   * is not English, the core's own.
   */
  l10nJs: string
}

export const runtime: FrameRuntime
