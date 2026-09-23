/**
 * The hosted player page's own logic. Everything here is the host's job: the element reports what
 * happened and this decides what to show. That split is the point of the demo — the element has
 * no URL field, no file picker, no progress bar and no "open in another browser" banner.
 */

const player = document.querySelector('h5p-player')
const form = document.querySelector('#load-form')
const urlInput = document.querySelector('#url')
const fileInput = document.querySelector('#file')
const stateBadge = document.querySelector('#state')
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
 * technical get a canned one; `bad-archive` and `runtime` already arrive as a sentence written
 * for a person — often naming the exact library a package is missing — so they are shown as-is.
 */
const EXPLANATIONS = {
  'no-cors':
    'That host does not send CORS headers, so no browser can read the file from this page. ' +
    'Download the .h5p and open it with "Choose file".',
  'no-worker':
    'This page needs a Service Worker. Open it over https:// or localhost in Safari, Chrome, ' +
    'Firefox or Edge — an in-app browser will not do.',
  network: 'The package could not be fetched. Check the URL.',
  quota: 'There is not enough storage left for this package. Clear site data and try again.'
}

player.addEventListener('statechange', (event) => {
  const { state } = event.detail
  stateBadge.textContent = state
  stateBadge.dataset.state = state
  if (state !== 'error') show('')
  bar.hidden = state !== 'downloading'
})

player.addEventListener('progress', (event) => {
  const { fraction, phase, entry } = event.detail
  bar.hidden = false
  if (fraction === null) bar.removeAttribute('value')
  else bar.value = fraction

  if (phase === 'extract') {
    // Deliberately not "playback starts before it finishes": whether it does depends on where
    // the mp4 keeps its index, and a file with it at the end plays nothing until the last byte.
    show(`Extracting ${entry}`)
  }
})

player.addEventListener('ready', () => {
  bar.hidden = true
  write('ready')
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
  show(EXPLANATIONS[code] ?? detail, 'error')
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
