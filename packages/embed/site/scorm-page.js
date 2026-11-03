/*! @missing-elements/h5p-embed. MIT. */
/**
 * The SCORM page: a `.h5p` picked or dropped becomes a SCORM 1.2 zip, built in the browser by
 * `buildScormInPage` from this site's own copies of the player, the runtime and the library
 * pack, with nothing uploaded anywhere. `startScormPage()` runs it; the site's `scorm-main.js`
 * calls it with what `h5p-embed` wrote into `config.js`, and the demo's `/demo/scorm.html` with
 * its own copies. The page holds `#file`, the input; `#status`, a line that says where the build
 * is and then what it made; `#download`, the link to the zip, hidden until there is one; and
 * `#notice`, for a refusal. A page with a `#state` badge, as the demo's pages have, gets the
 * state's name in it, `idle`, `building`, `ready` or `error`, and as `data-state` on it and on
 * the `.status` strip around `#status`, which its stylesheet colours.
 */
import { buildScormInPage } from '../lib/scorm-browser.mjs'
import { EmbedError } from '../lib/shared.mjs'

/**
 * What `buildScormInPage` is given beside the file: where the player's files and the pack are,
 * and the versions for the zip's notice.
 * @typedef {Omit<import('../lib/scorm-browser.mjs').PageScormOptions, 'file' | 'name' | 'onProgress'>} ScormPageOptions
 */

/** @param {number} bytes */
const megabytes = (bytes) => `${(bytes / 1_000_000).toFixed(1)} MB`

/** @param {number} count */
const libraries = (count) => `${count} ${count === 1 ? 'library' : 'libraries'}`

/**
 * @param {ScormPageOptions} [options]
 */
export function startScormPage(options = {}) {
  const input = /** @type {HTMLInputElement} */ (document.querySelector('#file'))
  const status = /** @type {HTMLElement} */ (document.querySelector('#status'))
  const link = /** @type {HTMLAnchorElement} */ (document.querySelector('#download'))
  const notice = /** @type {HTMLElement} */ (document.querySelector('#notice'))
  const badge = /** @type {HTMLElement | null} */ (document.querySelector('#state'))
  const strip = /** @type {HTMLElement | null} */ (status.closest('.status'))
  /** @type {string | null} the last zip's address, let go of when the next one replaces it */
  let last = null
  let busy = false

  /** @param {string} text */
  const say = (text) => {
    status.textContent = text
  }

  /** @param {'idle' | 'building' | 'ready' | 'error'} state */
  const mark = (state) => {
    for (const element of [badge, strip]) if (element) element.dataset.state = state
    if (badge) badge.textContent = state
  }

  /** @param {File} file */
  async function make(file) {
    if (busy) return
    busy = true
    input.disabled = true
    notice.hidden = true
    link.hidden = true
    if (last) URL.revokeObjectURL(last)
    last = null
    mark('building')
    try {
      const zip = await buildScormInPage({
        ...options,
        file,
        onProgress: ({ step, libraries: count }) => {
          if (step === 'reading') say(`Reading ${file.name}…`)
          else if (step === 'libraries' && count) say(`Fetching ${libraries(count)} from the pack…`)
          else if (step === 'writing') say('Writing the zip…')
        }
      })
      last = URL.createObjectURL(zip.blob)
      link.href = last
      link.download = zip.name
      link.textContent = `Download ${zip.name} (${megabytes(zip.size)})`
      link.hidden = false
      const carried = zip.libraries.length ? `, with ${libraries(zip.libraries.length)} from the pack` : ''
      say(`“${zip.title}” as a SCORM 1.2 package${carried}. Build ${zip.build}.`)
      mark('ready')
    } catch (error) {
      say('')
      notice.textContent = error instanceof EmbedError ? error.message : `The zip could not be written: ${error instanceof Error ? error.message : error}`
      notice.hidden = false
      mark('error')
    } finally {
      busy = false
      input.disabled = false
      // So that the same file, chosen again after a change to it, counts as a change.
      input.value = ''
    }
  }

  input.addEventListener('change', () => {
    const file = input.files?.[0]
    if (file) void make(file)
  })
  // A file dropped anywhere on the page.
  document.addEventListener('dragover', (event) => event.preventDefault())
  document.addEventListener('drop', (event) => {
    event.preventDefault()
    const file = event.dataTransfer?.files?.[0]
    if (file) void make(file)
  })
}
