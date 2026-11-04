/**
 * The demo's `/demo/scorm.html`: the SCORM page `@missing-elements/h5p-embed` writes into a player
 * domain, run with the demo's own copies — the pack's parts as Vite emits them, the launch page,
 * the bridge, the stylesheet and the pack's licence list as strings — and the player's files from
 * the site root, where the build puts them. One script for both, so what the demo offers is what
 * a host's own site offers.
 */

import { startScormPage } from '@missing-elements/h5p-embed/scorm-page.js'
import launch from '@missing-elements/h5p-embed/scorm/index.html?raw'
import bridge from '@missing-elements/h5p-embed/scorm/scorm.js?raw'
import lz from '@missing-elements/h5p-embed/scorm/lz-string.js?raw'
import css from '@missing-elements/h5p-embed/embed.css?raw'
import { pack } from '@missing-elements/h5p-libraries'
import libraries from '@missing-elements/h5p-libraries/libraries.txt?raw'
import { version as packVersion } from '@missing-elements/h5p-libraries/package.json'

startScormPage({ base: '/', pack, assets: { launch, bridge, lz, css, libraries }, version: __PLAYER_VERSION__, packVersion })
