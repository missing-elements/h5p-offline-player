/*! @missing-elements/h5p-embed. MIT. */
// The SCORM page's entry: `config.js` is what `h5p-embed` was told when it wrote this site —
// whether the library pack's parts are here, and which player and pack it was written with.
import config from './config.js'
import { startScormPage } from './scorm-page.js'

startScormPage({
  packBase: config.libraries ? new URL('./libraries/', import.meta.url).href : null,
  version: config.version,
  packVersion: config.packVersion
})
