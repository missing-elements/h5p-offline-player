// Written by scripts/sync-h5p-assets.mjs from the @font-face rules in h5p-standalone
// 3.8.2's styles/h5p.css. Do not edit; run `pnpm sync:assets` in packages/player.

/**
 * The text faces the core stylesheet declares, in its order. `file` is the name under
 * `frame-assets/fonts/`, for an `assets-base`; `packaged` is the file as it sits beside the
 * built element, one static `new URL` per face so that a consumer's bundler emits each and
 * rewrites its URL.
 */
export const FRAME_FONTS = [
  {
    family: 'Inter',
    style: 'normal',
    weight: '400',
    file: 'inter-400.woff2',
    packaged: new URL(/* @vite-ignore */ './frame-assets/fonts/inter-400.woff2', import.meta.url).href
  },
  {
    family: 'Inter',
    style: 'italic',
    weight: '400',
    file: 'inter-400-italic.woff2',
    packaged: new URL(/* @vite-ignore */ './frame-assets/fonts/inter-400-italic.woff2', import.meta.url).href
  },
  {
    family: 'Inter',
    style: 'normal',
    weight: '600',
    file: 'inter-600.woff2',
    packaged: new URL(/* @vite-ignore */ './frame-assets/fonts/inter-600.woff2', import.meta.url).href
  },
  {
    family: 'Inter',
    style: 'italic',
    weight: '600',
    file: 'inter-600-italic.woff2',
    packaged: new URL(/* @vite-ignore */ './frame-assets/fonts/inter-600-italic.woff2', import.meta.url).href
  },
  {
    family: 'Inter',
    style: 'normal',
    weight: '800',
    file: 'inter-800.woff2',
    packaged: new URL(/* @vite-ignore */ './frame-assets/fonts/inter-800.woff2', import.meta.url).href
  },
  {
    family: 'Inter',
    style: 'italic',
    weight: '800',
    file: 'inter-800-italic.woff2',
    packaged: new URL(/* @vite-ignore */ './frame-assets/fonts/inter-800-italic.woff2', import.meta.url).href
  },
  {
    family: 'Open Sans',
    style: 'normal',
    weight: '400',
    file: 'open-sans-400.woff2',
    packaged: new URL(/* @vite-ignore */ './frame-assets/fonts/open-sans-400.woff2', import.meta.url).href
  },
  {
    family: 'Open Sans',
    style: 'italic',
    weight: '400',
    file: 'open-sans-400-italic.woff2',
    packaged: new URL(/* @vite-ignore */ './frame-assets/fonts/open-sans-400-italic.woff2', import.meta.url).href
  },
  {
    family: 'Open Sans',
    style: 'normal',
    weight: '600',
    file: 'open-sans-600.woff2',
    packaged: new URL(/* @vite-ignore */ './frame-assets/fonts/open-sans-600.woff2', import.meta.url).href
  },
  {
    family: 'Open Sans',
    style: 'italic',
    weight: '600',
    file: 'open-sans-600-italic.woff2',
    packaged: new URL(/* @vite-ignore */ './frame-assets/fonts/open-sans-600-italic.woff2', import.meta.url).href
  },
  {
    family: 'Open Sans',
    style: 'normal',
    weight: '700',
    file: 'open-sans-700.woff2',
    packaged: new URL(/* @vite-ignore */ './frame-assets/fonts/open-sans-700.woff2', import.meta.url).href
  },
  {
    family: 'Open Sans',
    style: 'italic',
    weight: '700',
    file: 'open-sans-700-italic.woff2',
    packaged: new URL(/* @vite-ignore */ './frame-assets/fonts/open-sans-700-italic.woff2', import.meta.url).href
  }
] as const
