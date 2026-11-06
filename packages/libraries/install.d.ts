// Written by scripts/parts.mjs. Do not edit; run `pnpm parts` in packages/libraries.

import type { PackLibrary } from './index.js'

/** The whole pack, `installOnly` libraries included, for a page that writes packages. */
export declare const pack: { libraries: PackLibrary[] }
