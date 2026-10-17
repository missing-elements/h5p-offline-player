/**
 * The markup the pages share, written once in `partials/`. A page writes
 *
 *   <!-- partial: topbar -->
 *
 * on a line of its own, and the line becomes `partials/topbar.html`, indented as the comment was,
 * when the page is served or built. A partial can name partials of its own: the app's bar names
 * the nav and the icons the other pages' bar is made of, around buttons of its own. A name with
 * no file, or a partial that names itself at any depth, fails the build rather than shipping a
 * page with a hole in it.
 *
 * The site's nav then marks the page it is on: the link whose address is the longest prefix of
 * the page's own gets `aria-current="page"`, so `/demo/setup.html` marks Setup and
 * `/demo/xapi.html`, one of the examples, marks Examples.
 *
 * The files are read on every request, and a change to one reloads every open page, so an edit
 * shows at once in dev; Vite's own reload for an HTML file reaches only the page of that name.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PARTIAL = /^([ \t]*)<!--\s*partial:\s*([\w-]+)\s*-->[ \t]*$/gm

/**
 * @param {string} dir the partials' directory
 * @param {string} html
 * @param {string[]} [trail] the partials being expanded, outermost first
 * @returns {string}
 */
export function expandPartials(dir, html, trail = []) {
  return html.replace(PARTIAL, (_, indent, name) => {
    if (trail.includes(name)) throw new Error(`The partial ${name} names itself: ${[...trail, name].join(' > ')}`)
    let source
    try {
      source = readFileSync(resolve(dir, `${name}.html`), 'utf8')
    } catch {
      throw new Error(`No partial named ${name} in ${dir}`)
    }
    return expandPartials(dir, source.replace(/\n$/, ''), [...trail, name])
      .split('\n')
      .map((line) => (line ? indent + line : line))
      .join('\n')
  })
}

/**
 * @param {string} html
 * @param {string} path the page's own address, `/demo/setup.html` or `/demo/index.html`
 * @returns {string}
 */
export function markCurrentPage(html, path) {
  return html.replace(/<nav aria-label="Site">[\s\S]*?<\/nav>/, (nav) => {
    const [current] = [...nav.matchAll(/<a href="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((href) => path.startsWith(href))
      .sort((a, b) => b.length - a.length)
    return current ? nav.replace(`<a href="${current}"`, `<a href="${current}" aria-current="page"`) : nav
  })
}

/** @param {string} dir the partials' directory */
export function partialsPlugin(dir) {
  return {
    name: 'h5p-partials',
    transformIndexHtml: {
      order: /** @type {const} */ ('pre'),
      /** @param {string} html @param {{ path: string }} context */
      handler: (html, context) => markCurrentPage(expandPartials(dir, html), context.path.split('?')[0])
    },
    /** @param {{ file: string, server: import('vite').ViteDevServer }} update */
    handleHotUpdate({ file, server }) {
      if (!file.startsWith(dir)) return
      server.ws.send({ type: 'full-reload' })
      return []
    }
  }
}
