// Written by scripts/sync-h5p-assets.mjs from @missing-elements/h5p-runtime 0.1.0's
// MANIFEST.json (h5p-standalone 3.8.2). Do not edit; run `pnpm sync:assets` in packages/player.

/**
 * The text faces the runtime's stylesheet declares, in its order, by the file names under its
 * `fonts/`. The element resolves each against an `assets-base` or the default directory, and
 * the frame document declares the faces from the result; a host that imports the runtime package
 * hands over the resolved URLs instead, through the `runtime` property.
 */
export const FRAME_FONTS = [
  { family: 'Inter', style: 'normal', weight: '400', file: 'inter-400.woff2' },
  { family: 'Inter', style: 'italic', weight: '400', file: 'inter-400-italic.woff2' },
  { family: 'Inter', style: 'normal', weight: '600', file: 'inter-600.woff2' },
  { family: 'Inter', style: 'italic', weight: '600', file: 'inter-600-italic.woff2' },
  { family: 'Inter', style: 'normal', weight: '800', file: 'inter-800.woff2' },
  { family: 'Inter', style: 'italic', weight: '800', file: 'inter-800-italic.woff2' },
  { family: 'Open Sans', style: 'normal', weight: '400', file: 'open-sans-400.woff2' },
  { family: 'Open Sans', style: 'italic', weight: '400', file: 'open-sans-400-italic.woff2' },
  { family: 'Open Sans', style: 'normal', weight: '600', file: 'open-sans-600.woff2' },
  { family: 'Open Sans', style: 'italic', weight: '600', file: 'open-sans-600-italic.woff2' },
  { family: 'Open Sans', style: 'normal', weight: '700', file: 'open-sans-700.woff2' },
  { family: 'Open Sans', style: 'italic', weight: '700', file: 'open-sans-700-italic.woff2' }
] as const
