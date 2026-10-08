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
  /** h5p-standalone `main.bundle.js`: the loader that walks dependencies and boots the runtime. */
  mainJs: string
  /** h5p-standalone `frame.bundle.js`: h5p.js, jQuery and the core runtime. */
  frameJs: string
  /** The core stylesheet, rebuilt to stand alone: icon fonts and images inlined. */
  frameCss: string
  /** The frame's boot script, which the player's Service Worker names in the frame document. */
  bootJs: string
  fonts: RuntimeFont[]
}

export const runtime: FrameRuntime
