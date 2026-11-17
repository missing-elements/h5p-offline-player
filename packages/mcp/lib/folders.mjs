import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Where a build may read and write when neither the person nor the app named a folder: Desktop,
 * Documents and Downloads, those that exist. Never the home folder whole, which holds keys and
 * settings no build has a reason to read.
 * @param {string} [home]
 * @returns {Promise<string[]>}
 */
export async function defaultFolders(home = homedir()) {
  /** @type {string[]} */
  const found = []
  for (const name of ['Desktop', 'Documents', 'Downloads']) {
    const path = join(home, name)
    if ((await stat(path).catch(() => null))?.isDirectory()) found.push(path)
  }
  return found
}

/**
 * The folders among an app's roots: those it names by a `file:` address. A root of another scheme
 * is no folder on this computer.
 * @param {{ uri: string }[]} roots
 * @returns {string[]}
 */
export function rootFolders(roots) {
  return roots.filter((root) => root.uri.startsWith('file:')).map((root) => fileURLToPath(root.uri))
}

/**
 * A file name for a package from its title: its letters and digits, in any script and as written,
 * joined by `-`, at most 60 characters; `h5p-content` for a title with none of them.
 * @param {unknown} title
 * @returns {string}
 */
export function fileStem(title) {
  const stem = String(title ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return stem || 'h5p-content'
}
