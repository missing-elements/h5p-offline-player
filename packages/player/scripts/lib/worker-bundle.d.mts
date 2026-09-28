// Types for worker-bundle.mjs, which TypeScript sees through the demo's `vite.config.ts`; the
// tsconfigs that do not enable `allowJs` read this instead.
import type { BuildResult, Plugin } from 'esbuild'

export function buildServiceWorker(outfile: string): Promise<BuildResult>
export function buildMountModule(outfile: string): Promise<BuildResult>
export const mountFromSource: Plugin
export function bundleHostWorker(entry: string, options?: { define?: Record<string, string>; dev?: boolean }): Promise<string>
