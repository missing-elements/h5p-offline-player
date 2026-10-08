/// <reference types="vite/client" />

/**
 * The Jobs worker, pre-bundled to a self-contained classic script by the `jobsWorker()` plugin in
 * `vite.config.ts`. It ships as a string so the element can spawn it from a `blob:` URL: one fewer
 * artefact for a host to deploy. `dist/h5p-jobs.js` is the same script as a file, for a page whose
 * policy refuses that; see `JobsWorkerHandle`.
 */
declare module 'virtual:h5p-jobs-worker' {
  const source: string
  export default source
}

