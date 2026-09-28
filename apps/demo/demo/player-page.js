/**
 * The hosted player page's own logic. Everything here is the host's job: the element reports what
 * happened and this decides what to show. That split is the point of the demo — the element has
 * no URL field, no file picker, no progress bar and no "open in another browser" banner.
 */

const player = document.querySelector('h5p-player')
const form = document.querySelector('#load-form')
const urlInput = document.querySelector('#url')
const fileInput = document.querySelector('#file')
const status = document.querySelector('#status')
const stateBadge = document.querySelector('#state')
const timer = document.querySelector('#timer')
const bar = document.querySelector('#progress')
const message = document.querySelector('#message')
const log = document.querySelector('#log')
const useHub = document.querySelector('#use-hub')
const offer = document.querySelector('#offer')

const write = (line) => {
  const stamp = new Date().toLocaleTimeString([], { hour12: false })
  log.textContent = `${stamp}  ${line}\n${log.textContent}`.slice(0, 20000)
}

const show = (text, kind = 'hint') => {
  message.textContent = text
  message.className = `message ${kind}`
  message.hidden = !text
}

/**
 * What a host page can usefully say about each failure. Only the codes whose own message is
 * technical get a canned one; `bad-archive`, `runtime` and `quota` already arrive as a sentence
 * written for a person — the library a package is missing, the size a package needed against
 * what the browser gives the site — so they are shown as-is.
 */
const EXPLANATIONS = {
  'no-cors':
    'That host does not send CORS headers, so no browser can read the file from this page. ' +
    'Download the .h5p and open it with "Choose file".',
  'no-worker':
    'This page needs a Service Worker. Open it over https:// or localhost in Safari, Chrome, ' +
    'Firefox or Edge — an in-app browser will not do.',
  network: 'The package could not be fetched. Check the URL.'
}

/**
 * The clock: from the moment a load is asked for until the player is ready or has failed. Each
 * state on the way is logged with the time it was reached, which is what tells a slow host from
 * a slow package: a long `probing` is the host answering slowly, a long `indexing` is the
 * libraries coming down.
 */
let loadStarted = null
let ticking = null

const seconds = (ms) => `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`
const elapsed = () => (loadStarted === null ? null : performance.now() - loadStarted)

const startClock = () => {
  loadStarted = performance.now()
  clearInterval(ticking)
  ticking = setInterval(() => {
    timer.textContent = seconds(elapsed())
  }, 100)
  timer.textContent = '0.00 s'
  timer.hidden = false
}

const stopClock = (label) => {
  clearInterval(ticking)
  ticking = null
  const ms = elapsed()
  if (ms === null) return null
  timer.textContent = `${label} ${seconds(ms)}`
  return ms
}

player.addEventListener('statechange', (event) => {
  const { state } = event.detail
  stateBadge.textContent = state
  stateBadge.dataset.state = state
  status.dataset.state = state
  if (state !== 'error') show('')
  bar.hidden = state !== 'downloading'

  if (state === 'ready') {
    const ms = stopClock('ready in')
    write(ms === null ? 'ready' : `ready  ${seconds(ms)}`)
  } else if (state === 'error') {
    stopClock('failed after')
  } else if (state === 'idle') {
    stopClock('')
    timer.hidden = true
    loadStarted = null
  } else if (loadStarted !== null) {
    write(`${state}  ${seconds(elapsed())}`)
  }
})

player.addEventListener('progress', (event) => {
  const { fraction, phase, entry } = event.detail
  // A download from a host that ignores Range keeps going after the content is up: the bar shows
  // it, and goes away when it is done.
  bar.hidden = fraction === 1
  if (fraction === null) bar.removeAttribute('value')
  else bar.value = fraction

  if (phase === 'warm') {
    // The libraries being pulled into the cache in a few requests, before the frame boots.
    show('Loading the libraries')
  }
  if (phase === 'extract') {
    // Deliberately not "playback starts before it finishes": whether it does depends on where
    // the mp4 keeps its index, and a file with it at the end plays nothing until the last byte.
    show(`Extracting ${entry}`)
  }
})

player.addEventListener('ready', () => {
  bar.hidden = true
})

player.addEventListener('xapi', (event) => {
  write(`xapi  ${event.detail.verb ?? '(no verb)'}`)
})

player.addEventListener('finished', (event) => {
  const result = event.detail.statement?.result
  write(`finished  score ${result?.score?.raw ?? '?'} / ${result?.score?.max ?? '?'}`)
})

player.addEventListener('error', (event) => {
  const { code, message: detail, missingLibraries } = event.detail
  bar.hidden = true
  // A runtime error once the content is up does not stop it — content types throw non-fatal
  // exceptions routinely — so it is shown as a note, not as the player failing.
  const late = code === 'runtime' && player.state === 'ready'
  show(late ? `The content reported an error and kept running: ${detail}` : (EXPLANATIONS[code] ?? detail), late ? 'hint' : 'error')
  write(`error  ${code}: ${detail}`)

  // The element reports what a package is missing; offering to go and get it is the host's call,
  // because it means a request to a third party.
  offer.hidden = !missingLibraries || useHub.checked
})

player.addEventListener('resize', (event) => {
  player.style.height = `${Math.max(event.detail.height, 240)}px`
})

/** `libraries` has to be set before `src`: it is read when a load discovers it needs it. */
const applyLibrarySource = (value) => {
  if (value) player.setAttribute('libraries', value)
  else player.removeAttribute('libraries')
}

/**
 * Replays the last load. Kept as a closure rather than a URL because a package picked from disk
 * has no URL to re-set — and picking one is exactly the case where the retry is wanted.
 */
let reload = null

const loadUrl = (url, librarySource) => {
  log.textContent = ''
  offer.hidden = true
  reload = () => loadUrl(url, librarySource)
  applyLibrarySource(librarySource)
  write(`loading  ${url}`)
  startClock()
  // Removed first so re-setting the same URL still counts as a change.
  player.removeAttribute('src')
  player.setAttribute('src', url)
}

const loadFile = (file) => {
  log.textContent = ''
  offer.hidden = true
  reload = () => loadFile(file)
  applyLibrarySource(useHub.checked ? 'hub' : null)
  write(`loading  ${file.name} (${(file.size / 1024).toFixed(0)} kB, from disk)`)
  startClock()
  urlInput.value = ''
  player.file = file
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  const url = urlInput.value.trim()
  if (url) loadUrl(url, useHub.checked ? 'hub' : null)
})

useHub.addEventListener('change', () => {
  if (useHub.checked) offer.hidden = true
})

document.querySelector('#fetch-libraries').addEventListener('click', () => {
  useHub.checked = true
  offer.hidden = true
  applyLibrarySource('hub')
  write('retrying with libraries from h5p.org')
  reload?.()
})

fileInput.addEventListener('change', () => {
  const [file] = fileInput.files
  if (file) loadFile(file)
})

for (const button of document.querySelectorAll('.samples button')) {
  button.addEventListener('click', () => {
    urlInput.value = button.dataset.src
    // A sample may bring its own library bundle, which is the local stand-in for the hub.
    loadUrl(button.dataset.src, button.dataset.libraries ?? (useHub.checked ? 'hub' : null))
  })
}

// `?src=` makes the page linkable, which is also what the iframe embed in demo/embed.html uses.
const initial = new URLSearchParams(location.search).get('src')
if (initial) {
  urlInput.value = initial
  loadUrl(initial, useHub.checked ? 'hub' : null)
}
