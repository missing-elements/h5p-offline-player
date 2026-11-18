import { realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Where a build may read and write when neither the person nor the app named a folder: Desktop,
 * Documents and Downloads, those that exist. Never the home folder whole, which holds keys and
 * settings no build has a reason to read: one that is a link to the home folder, or to a folder
 * that holds it, is left out. A link to a folder elsewhere, as on another drive, is kept.
 * @param {string} [home]
 * @returns {Promise<string[]>}
 */
export async function defaultFolders(home = homedir()) {
  const own = await realpath(home).catch(() => resolve(home))
  /** @type {string[]} */
  const found = []
  for (const name of ['Desktop', 'Documents', 'Downloads']) {
    const path = join(home, name)
    if (!(await stat(path).catch(() => null))?.isDirectory()) continue
    const up = relative(await realpath(path), own)
    if (up === '' || (!isAbsolute(up) && up !== '..' && !up.startsWith(`..${sep}`))) continue
    found.push(path)
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

/** The names Windows keeps for its devices, an extension or not: no file can take one there. */
const DEVICE = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/

/**
 * A file name for a package from its title: its letters and digits, in any script and as written,
 * joined by `-`, at most 60 characters; `h5p-content` for a title with none of them, and `-file`
 * after a name Windows keeps for a device, as `con`.
 * @param {unknown} title
 * @returns {string}
 */
export function fileStem(title) {
  const words = String(title ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  // Cut by characters, not by halves of one: a letter outside the basic range is two.
  const stem = Array.from(words).slice(0, 60).join('').replace(/-+$/, '')
  if (!stem) return 'h5p-content'
  return DEVICE.test(stem) ? `${stem}-file` : stem
}
