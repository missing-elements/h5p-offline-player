/*! @missing-elements/h5p-embed. MIT. */
// The page's entry: `config.js` is what `h5p-embed` was told when it wrote this site — whether
// the library pack's parts are here, and which hosts packages may come from.
import config from './config.js'
import { startEmbed } from './embed.js'

startEmbed({
  packBase: config.libraries ? new URL('./libraries/', import.meta.url).href : null,
  packages: config.packages,
  defaultLibraries: config.defaultLibraries
})
