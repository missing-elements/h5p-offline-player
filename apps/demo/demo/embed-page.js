/**
 * The demo's `/embed`: the page `@missing-elements/h5p-embed` writes for a player domain, run
 * with the demo's own copy of the library pack, which `libraries=pack` then names. One script for
 * both, so what the demo shows is what a host deploys.
 */

import '@missing-elements/h5p-embed/embed.css'
import { startEmbed } from '@missing-elements/h5p-embed/embed.js'
import librariesPack from '@missing-elements/h5p-libraries/libraries.h5p?url'

startEmbed({ librariesPack })
