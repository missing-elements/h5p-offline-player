import { resolve } from 'node:path'
import { buildPlanModule } from './lib/worker-bundle.mjs'

/**
 * `dist/h5p-plan.js` on its own, without the rest of `pnpm build`: h5p-author imports it as it
 * runs, so `prepare:dev` and h5p-author's tests build it first.
 */
await buildPlanModule(resolve(import.meta.dirname, '..', 'dist', 'h5p-plan.js'))
