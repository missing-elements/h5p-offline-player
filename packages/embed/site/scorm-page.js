/*! @missing-elements/h5p-embed. MIT. */
/**
 * The SCORM page: `.h5p` files picked or dropped become SCORM 1.2 zips, built in the browser by
 * `planScormInPage` and its `write` from this site's own copies of the player, the runtime and
 * the library pack, with nothing uploaded anywhere. `startScormPage()` runs it; the site's
 * `scorm-main.js` calls it with what `h5p-embed` wrote into `config.js`, and the demo's
 * `/demo/scorm.html` with its own copies.
 *
 * The page holds `#file`, the input; `#status`, a line that says where the build is and then what
 * it made; `#download`, the link to the zip, hidden until there is one; and `#notice`, for a
 * refusal. A page with a `#state` badge, as the demo's pages have, gets the state's name in it,
 * `idle`, `building`, `ready` or `error`, and as `data-state` on it and on the `.status` strip
 * around `#status`, which its stylesheet colours.
 *
 * A page that also holds `#files`, a list, and `#build`, a button, as both pages here do, works in
 * steps. Each file chosen gets a row in the list, which says what its zip will hold, or why none
 * can be written, and takes the title the LMS lists it by; nothing is written until `#build` is
 * pressed, which writes the rows one after another; `#download` is then the zip, or, for several,
 * one zip that holds them all, while each row links its own. The closest `[data-step]` around
 * each of the two is shown once it can be reached. A page with neither builds the first file it
 * is given at once, as the page did up to embed 1.5.
 */
import { BlobWriter, ZipWriter } from '@zip.js/zip.js'
import { addStored } from '../lib/scorm-core.mjs'
import { buildScormInPage, planScormInPage } from '../lib/scorm-browser.mjs'
import { EmbedError } from '../lib/shared.mjs'

/**
 * What `buildScormInPage` is given beside the file: where the player's files and the pack are,
 * and the versions for the zip's notice.
 * @typedef {Omit<import('../lib/scorm-browser.mjs').PageScormOptions, 'file' | 'name' | 'title' | 'onProgress'>} ScormPageOptions
 */

/** What a page in steps calls the zip that holds the others. */
const TOGETHER = 'scorm-packages.zip'

/** @param {number} bytes */
const megabytes = (bytes) => `${(bytes / 1_000_000).toFixed(1)} MB`

/**
 * A package's size, in kilobytes below a megabyte, where a tenth of one says nothing.
 * @param {number} bytes
 */
const sized = (bytes) => (bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} kB` : megabytes(bytes))

/** @param {number} count */
const libraries = (count) => `${count} ${count === 1 ? 'library' : 'libraries'}`

/** @param {unknown} error */
const reason = (error) => (error instanceof EmbedError ? error.message : `The zip could not be written: ${error instanceof Error ? error.message : error}`)

/**
 * What a zip is, said in one line.
 * @param {import('../lib/scorm-browser.mjs').PageScorm} zip
 */
const made = (zip) => {
  const carried = zip.libraries.length ? `, with ${libraries(zip.libraries.length)} from the pack` : ''
  return `“${zip.title}” as a SCORM 1.2 package${carried}. Build ${zip.build}.`
}

/**
 * What a package's zip will hold, as its row says it.
 * @param {import('../lib/scorm-browser.mjs').PlannedScorm} plan
 */
const holds = ({ mainLibrary: main, libraries: parts, librariesSize }) => {
  const named = !main ? 'no main library named' : main.majorVersion === undefined ? main.machineName : `${main.machineName} ${main.majorVersion}.${main.minorVersion}`
  return `${named} · ${parts.length === 0 ? 'carries its libraries' : `${libraries(parts.length)} from the pack, ${sized(librariesSize)}`}`
}

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {string} className
 * @param {string} [text]
 * @returns {HTMLElementTagNameMap[K]}
 */
const create = (tag, className, text = '') => {
  const element = document.createElement(tag)
  element.className = className
  element.textContent = text
  return element
}

/** The elements every SCORM page has, and the two ways of changing them. */
function common() {
  const input = /** @type {HTMLInputElement} */ (document.querySelector('#file'))
  const status = /** @type {HTMLElement} */ (document.querySelector('#status'))
  const link = /** @type {HTMLAnchorElement} */ (document.querySelector('#download'))
  const notice = /** @type {HTMLElement} */ (document.querySelector('#notice'))
  const badge = /** @type {HTMLElement | null} */ (document.querySelector('#state'))
  const strip = /** @type {HTMLElement | null} */ (status.closest('.status'))
  // Text is written only when it changes: rewritten as it is, a live region may be read out again.
  /** @param {string} text */
  const say = (text) => {
    if (status.textContent !== text) status.textContent = text
  }
  /** @param {'idle' | 'building' | 'ready' | 'error'} state */
  const mark = (state) => {
    for (const element of [badge, strip]) if (element) element.dataset.state = state
    if (badge && badge.textContent !== state) badge.textContent = state
  }
  return { input, link, notice, say, mark }
}

/**
 * @param {ScormPageOptions} [options]
 */
export function startScormPage(options = {}) {
  const list = document.querySelector('#files')
  const button = document.querySelector('#build')
  if (list instanceof HTMLElement && button instanceof HTMLButtonElement) inSteps(options, list, button)
  else atOnce(options)
}

/**
 * The page as it was up to embed 1.5, for a page without `#files` and `#build`: the first file
 * given is built at once, and a refusal goes to `#notice`.
 * @param {ScormPageOptions} options
 */
function atOnce(options) {
  const { input, link, notice, say, mark } = common()
  /** @type {string | null} the last zip's address, let go of when the next one replaces it */
  let last = null
  let busy = false

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
      say(made(zip))
      mark('ready')
    } catch (error) {
      say('')
      notice.textContent = reason(error)
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

/**
 * The page in steps: choose, review, download.
 * @param {ScormPageOptions} options
 * @param {HTMLElement} list `#files`
 * @param {HTMLButtonElement} button `#build`
 */
function inSteps(options, list, button) {
  const { input, link, notice, say, mark } = common()
  const reviewStep = /** @type {HTMLElement | null} */ (list.closest('[data-step]'))
  const downloadStep = /** @type {HTMLElement | null} */ (button.closest('[data-step]'))
  /**
   * A file chosen on a page in steps, and what became of it.
   * @typedef {object} Row
   * @property {File} file
   * @property {HTMLLIElement} element its row in `#files`
   * @property {HTMLElement} facts what the zip will hold, or why it cannot be written: a live region
   *   from the start, so that what the reading found is announced
   * @property {HTMLButtonElement} remove
   * @property {HTMLInputElement | null} field the title, once the file is read
   * @property {HTMLAnchorElement} download its own zip, shown when the page has several
   * @property {import('../lib/scorm-browser.mjs').PlannedScorm | null} plan
   * @property {string | null} error why it cannot be built, or why its last build failed
   * @property {(import('../lib/scorm-browser.mjs').PageScorm & { url: string }) | null} zip
   */
  /** @type {Row[]} */
  const rows = []
  let busy = false
  /** @type {Row | null} the row being written */
  let current = null
  /** Files are read one after another, in the order they came. */
  let reading = Promise.resolve()
  /** @type {{ key: string, url: string, size: number } | null} the zip of zips, and which zips it holds */
  let together = null
  /** Which offer of `#download` is the latest, so that a slower one that was overtaken lets go. */
  let offers = 0

  /** @param {Row} row */
  const forget = (row) => {
    if (row.zip) URL.revokeObjectURL(row.zip.url)
    row.zip = null
  }

  /**
   * @param {Row} row
   * @param {boolean} several whether the page has more than one zip to build, so that each row
   *   links its own
   */
  const render = (row, several) => {
    row.element.dataset.state = row === current ? 'building' : row.zip ? 'built' : row.plan ? (row.error ? 'failed' : 'planned') : row.error ? 'refused' : 'reading'
    // Only when it changes, as with `say`: every row is rendered again on each change to any.
    const facts = row.error ?? (row.plan ? holds(row.plan) : 'Reading…')
    if (row.facts.textContent !== facts) row.facts.textContent = facts
    row.remove.disabled = busy
    if (row.field) row.field.disabled = busy
    if (row.zip && several) {
      row.download.href = row.zip.url
      row.download.download = row.zip.name
      row.download.textContent = `Download ${row.zip.name} (${megabytes(row.zip.size)})`
    }
    row.download.hidden = !(row.zip && several)
  }

  /** `#download`: the one zip, or the zip of zips; hidden while there is neither, or while writing. */
  const offer = async () => {
    const turn = ++offers
    const buildable = rows.filter((entry) => entry.plan)
    const built = buildable.flatMap((entry) => (entry.zip ? [entry.zip] : []))
    // Which zips the zip of zips would hold now; none while writing, or with fewer than two.
    const key = !busy && buildable.length > 1 && built.length > 1 ? built.map((zip) => zip.url).join(' ') : null
    if (together && together.key !== key) {
      URL.revokeObjectURL(together.url)
      together = null
    }
    link.hidden = true
    link.removeAttribute('href')
    if (busy || built.length === 0) return
    if (buildable.length === 1) {
      const [zip] = built
      link.href = zip.url
      link.download = zip.name
      link.textContent = `Download ${zip.name} (${megabytes(zip.size)})`
      link.hidden = false
      return
    }
    // With several, each row links its own, and this is all of them in one.
    if (key === null) return
    if (!together) {
      let blob
      try {
        blob = await bundle(built)
      } catch (error) {
        if (turn === offers) {
          notice.textContent = `The zip of all of them could not be written: ${error instanceof Error ? error.message : error}`
          notice.hidden = false
        }
        return
      }
      if (turn !== offers) return
      together = { key, url: URL.createObjectURL(blob), size: blob.size }
    }
    link.href = together.url
    link.download = TOGETHER
    link.textContent = `Download all ${built.length} as one zip (${megabytes(together.size)})`
    link.hidden = false
  }

  /** Everything from the state: the rows, the steps, the button, the strip and its link. */
  const refresh = () => {
    const buildable = rows.filter((entry) => entry.plan)
    const pending = buildable.filter((entry) => !entry.zip)
    const built = buildable.filter((entry) => entry.zip)
    const several = buildable.length > 1
    for (const entry of rows) render(entry, several)
    if (reviewStep) reviewStep.hidden = rows.length === 0
    if (downloadStep) downloadStep.hidden = buildable.length === 0
    const count = pending.length || buildable.length
    button.textContent = several ? `Build ${count} SCORM ${count === 1 ? 'package' : 'packages'}` : 'Build the SCORM package'
    button.disabled = busy || pending.length === 0 || rows.some((entry) => !entry.plan && !entry.error)
    input.disabled = busy
    if (!busy) {
      const failed = pending.filter((entry) => entry.error).length
      const waiting = pending.length - failed
      const unwritten = failed === 1 ? 'one could not be written, as its row says' : `${failed} could not be written, as their rows say`
      if (built.length === 0) {
        mark(failed ? 'error' : 'idle')
        say(failed ? `${several ? unwritten.charAt(0).toUpperCase() + unwritten.slice(1) : 'The zip could not be written, as its row says'}.` : '')
      } else if (!several) {
        mark('ready')
        say(made(/** @type {NonNullable<Row['zip']>} */ (built[0].zip)))
      } else {
        const notes = [failed ? unwritten : '', waiting ? `${waiting} more to build` : ''].filter(Boolean)
        const counted = built.length === 1 ? 'One SCORM 1.2 package, with its link above' : `${built.length} SCORM 1.2 packages, each with its link above`
        mark('ready')
        say(`${counted}${notes.map((note) => `; ${note}`).join('')}.`)
      }
    }
    return offer()
  }

  /** @param {File} file */
  const row = (file) => {
    const element = create('li', 'scorm-row')
    const head = create('div', 'scorm-row-head')
    const remove = create('button', 'scorm-row-remove', 'Remove')
    remove.type = 'button'
    remove.setAttribute('aria-label', `Remove ${file.name}`)
    head.append(create('span', 'scorm-row-name', file.name), create('span', 'scorm-row-size', sized(file.size)), remove)
    const facts = create('p', 'scorm-row-facts', 'Reading…')
    facts.setAttribute('role', 'status')
    const download = create('a', 'scorm-row-download')
    download.hidden = true
    element.append(head, facts, download)
    /** @type {Row} */
    const entry = { file, element, facts, remove, field: null, download, plan: null, error: null, zip: null }
    remove.addEventListener('click', () => {
      const at = rows.indexOf(entry)
      if (busy || at < 0) return
      rows.splice(at, 1)
      forget(entry)
      element.remove()
      // Where the row was: the next one's button, the one before it, or the input.
      const next = rows[at] ?? rows[at - 1]
      ;(next ? next.remove : input).focus()
      void refresh()
    })
    return entry
  }

  /** @param {Row} entry */
  const read = async (entry) => {
    if (!rows.includes(entry)) return
    try {
      const plan = await planScormInPage({ ...options, file: entry.file })
      entry.plan = plan
      const label = create('label', 'scorm-row-title', 'Title in the LMS')
      const field = document.createElement('input')
      field.type = 'text'
      field.value = plan.title
      // Emptied, the field shows what the zip is then called.
      field.placeholder = plan.title
      field.setAttribute('aria-label', `Title in the LMS for ${entry.file.name}`)
      field.addEventListener('input', () => {
        forget(entry)
        void refresh()
      })
      label.append(field)
      entry.facts.after(label)
      entry.field = field
    } catch (error) {
      entry.error = reason(error)
    }
    if (rows.includes(entry)) void refresh()
  }

  /** @param {File[]} files */
  const add = (files) => {
    if (busy) return
    notice.hidden = true
    for (const file of files) {
      // The same file twice is one row.
      if (rows.some(({ file: listed }) => listed.name === file.name && listed.size === file.size && listed.lastModified === file.lastModified)) continue
      const entry = row(file)
      rows.push(entry)
      list.append(entry.element)
      reading = reading.then(() => read(entry))
    }
    void refresh()
  }

  const build = async () => {
    const queue = rows.filter((entry) => entry.plan && !entry.zip)
    if (busy || queue.length === 0) return
    busy = true
    notice.hidden = true
    mark('building')
    for (const [at, entry] of queue.entries()) {
      current = entry
      entry.error = null
      void refresh()
      /** @param {string} text */
      const step = (text) => say(queue.length > 1 ? `${entry.file.name}, ${at + 1} of ${queue.length}: ${text}` : text.charAt(0).toUpperCase() + text.slice(1))
      try {
        const zip = await /** @type {import('../lib/scorm-browser.mjs').PlannedScorm} */ (entry.plan).write({
          title: entry.field?.value,
          onProgress: ({ step: where, libraries: count }) => {
            if (where === 'libraries') step(count ? `fetching ${libraries(count)} from the pack…` : 'fetching the player…')
            else if (where === 'writing') step('writing the zip…')
          }
        })
        entry.zip = { ...zip, url: URL.createObjectURL(zip.blob) }
      } catch (error) {
        entry.error = reason(error)
      }
    }
    current = null
    busy = false
    await refresh()
    // On to what was made, rather than left on a button that has nothing more to do.
    const target = !link.hidden ? link : rows.find((entry) => !entry.download.hidden)?.download
    target?.focus()
  }

  input.addEventListener('change', () => {
    const files = [...(input.files ?? [])]
    // So that the same file, chosen again after a change to it, counts as a change.
    input.value = ''
    if (files.length) add(files)
  })
  // Files dropped anywhere on the page.
  document.addEventListener('dragover', (event) => event.preventDefault())
  document.addEventListener('drop', (event) => {
    event.preventDefault()
    const files = [...(event.dataTransfer?.files ?? [])]
    if (files.length) add(files)
  })
  button.addEventListener('click', () => void build())
  void refresh()
}

/**
 * The zips in one, each stored as it is, since each is compressed already; a name taken twice gets
 * a number.
 * @param {Array<{ name: string, blob: Blob }>} zips
 */
async function bundle(zips) {
  const zip = new ZipWriter(new BlobWriter('application/zip'), { useWebWorkers: false })
  const taken = new Set()
  for (const { name, blob } of zips) {
    const stem = name.replace(/(\.scorm)?\.zip$/, '')
    let unique = name
    for (let n = 2; taken.has(unique); n++) unique = `${stem} (${n})${name.slice(stem.length)}`
    taken.add(unique)
    await addStored(zip, unique, blob)
  }
  return zip.close()
}
