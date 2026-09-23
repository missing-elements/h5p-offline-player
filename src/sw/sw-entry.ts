/// <reference lib="webworker" />
import { configure } from '@zip.js/zip.js'
import { mountH5P } from './mount'

/**
 * The standalone Service Worker. Built to `dist/h5p-sw.js` as a self-contained IIFE so it can be
 * dropped onto a site that has no build step. Hosts that enforce a single worker import
 * `mountH5P` from `@missing-elements/h5p-offline-player/sw` into their own instead.
 */

// A Service Worker cannot spawn a nested Worker, so zip.js has to inflate in place. It uses the
// platform's own `DecompressionStream` for deflate, which is where the work would have gone anyway.
configure({ useWebWorkers: false })

mountH5P(self as unknown as ServiceWorkerGlobalScope)
