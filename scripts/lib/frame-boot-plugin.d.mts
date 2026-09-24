import type { Plugin } from 'esbuild'

export const FRAME_BOOT_VIRTUAL_ID: string
export const FRAME_BOOT_ENTRY: string
export function bundleFrameBoot(minify?: boolean): Promise<string>
export function frameBootEsbuildPlugin(minify?: boolean): Plugin
