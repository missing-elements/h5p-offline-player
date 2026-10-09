/**
 * The hosted player page's own logic. Everything here is the host's job: the element reports what
 * happened and this decides what to show. That split is the point of the demo — the element has
 * no URL field, no file picker, no progress bar and no "open in another browser" banner.
 */

import librariesPack from '@missing-elements/h5p-libraries/libraries.h5p?url'

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
const offer = document.querySelector('#offer')
const useBundle = document.querySelector('#use-bundle')
const useHub = document.querySelector('#use-hub')
const confirmBox = document.querySelector('#confirm-src')

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
  // The build every statement will name in `context.revision`. On a host without Range the frame
  // can boot before the index that yields it, and the statements wait for it instead.
  if (player.revision) write(`revision  ${player.revision}`)
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

  // The element reports what a package is missing; where to get it is the host's call, and here
  // the visitor's: this site's bundle, or h5p.org, which is a request to a third party. Only the
  // sources not tried yet are offered — the bundle is built from the hub, so after the hub has
  // failed it would not help either.
  const tried = player.getAttribute('libraries')
  // The element's own text is written for the developer ("set the libraries attribute"); the
  // visitor gets the buttons instead.
  if (missingLibraries && !tried) {
    show(
      `This package was exported without its H5P libraries, as h5p.com and h5p.org do by default. Missing: ${missingLibraries.folders.join(', ')}.`,
      'warning'
    )
  }
  useBundle.hidden = tried === BUNDLE || tried === 'hub'
  useHub.hidden = tried === 'hub'
  offer.hidden = !missingLibraries || (useBundle.hidden && useHub.hidden)
})

player.addEventListener('resize', (event) => {
  player.style.height = `${Math.max(event.detail.height, 240)}px`
})

/**
 * The same bundle the installable app carries: every H5P hub content type's runtime libraries,
 * `@missing-elements/h5p-libraries`, emitted by Vite as an asset. Fetched only once a visitor
 * picks it for a package that lacks its own — the player page stays light, and nothing is
 * downloaded for packages that carry their libraries.
 */
const BUNDLE = librariesPack

/** Where missing libraries come from: `null` until the visitor has chosen, then for every load. */
let librarySource = null

/** `libraries` has to be set before `src`: it is read when a load discovers it needs it. */
const applyLibrarySource = () => {
  if (librarySource) player.setAttribute('libraries', librarySource)
  else player.removeAttribute('libraries')
}

/**
 * Replays the last load. Kept as a closure rather than a URL because a package picked from disk
 * has no URL to re-set — and picking one is exactly the case where the retry is wanted.
 */
let reload = null

/**
 * Where the embed snippets point: Embed My, the embedding service built on this player, which
 * serves the same page as this site's `/embed` at `/h5p` and the sizing script beside it. Its
 * GitHub Pages address rather than embed-my.org, as its own snippets have it: the project keeps
 * that address for as long as it is on GitHub, which forwards it to the domain.
 */
const EMBED_ORIGIN = 'https://embed-my.github.io'

/**
 * What the H5P embed button offers: the Embed setup, Embed My's page around the package, with H5P's own
 * `:w` and `:h` standing for the size the dialog lets the visitor pick. Set per load, since it
 * names the package; a picked file has no URL to embed, and the button stays off.
 */
const embedCodeFor = (url) =>
  `<iframe src="${EMBED_ORIGIN}/h5p?src=${encodeURIComponent(new URL(url, location.href).href)}" width=":w" height=":h" allow="fullscreen" style="border: 0"></iframe>`

// The sizing script the embed dialog offers under "advanced": the page speaks H5P's resizer
// protocol upward, and `h5p-resizer.js` beside it is the page-side half (`/resizer.js` here is
// the same script), so the embedding page sends nothing to h5p.org, whose own `h5p-resizer.js`
// speaks the same protocol and would do too.
player.setAttribute('resize-code', `<script src="${EMBED_ORIGIN}/h5p-resizer.js"></script>`)

const loadUrl = (url) => {
  log.textContent = ''
  confirmBox.hidden = true
  offer.hidden = true
  reload = () => loadUrl(url)
  applyLibrarySource()
  write(`loading  ${url}`)
  startClock()
  // The embed code is read with the load, like `libraries`, so it goes on before `src`.
  player.setAttribute('embed-code', embedCodeFor(url))
  // Removed first so re-setting the same URL still counts as a change.
  player.removeAttribute('src')
  player.setAttribute('src', url)
}

const loadFile = (file) => {
  log.textContent = ''
  confirmBox.hidden = true
  offer.hidden = true
  reload = () => loadFile(file)
  applyLibrarySource()
  write(`loading  ${file.name} (${(file.size / 1024).toFixed(0)} kB, from disk)`)
  startClock()
  urlInput.value = ''
  player.removeAttribute('embed-code')
  player.file = file
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  const url = urlInput.value.trim()
  if (url) loadUrl(url)
})

const retryWith = (source, label) => {
  librarySource = source
  offer.hidden = true
  write(`retrying with libraries from ${label}`)
  reload?.()
}
useBundle.addEventListener('click', () => retryWith(BUNDLE, "this site's bundle"))
useHub.addEventListener('click', () => retryWith('hub', 'h5p.org'))

fileInput.addEventListener('change', () => {
  const [file] = fileInput.files
  if (file) loadFile(file)
})

for (const button of document.querySelectorAll('.samples button')) {
  button.addEventListener('click', () => {
    urlInput.value = button.dataset.src
    loadUrl(button.dataset.src)
  })
}

/**
 * The host of a package on another site, or `null` for this site's own and for what is not a URL
 * (which `loadUrl` then reports). A package's libraries are JavaScript and the frame is
 * same-origin by design, so a package runs with this origin's storage: the app's saved states,
 * the chunk store, the list of what was played. Typed into the field is the visitor's choice; a
 * link's `?src=` is whoever wrote the link's, so it waits for a click that names the host.
 */
const foreignHost = (src) => {
  try {
    const url = new URL(src, location.href)
    // A `data:` URL has no host and an opaque origin: name its scheme, so it still waits.
    return url.origin === location.origin ? null : url.host || url.protocol
  } catch {
    return null
  }
}

/** What the pending link would load; any other load (`loadUrl`, `loadFile`) hides the question. */
let pendingOpen = null
const askBeforeOpening = (host, go) => {
  confirmBox.querySelector('.host').textContent = host
  confirmBox.hidden = false
  pendingOpen = go
}
document.querySelector('#confirm-open').addEventListener('click', () => {
  confirmBox.hidden = true
  pendingOpen?.()
  pendingOpen = null
})

// `?src=` makes the page linkable, which is also what the iframe embed in demo/embed.html uses.
const initial = new URLSearchParams(location.search).get('src')
if (initial) {
  urlInput.value = initial
  const host = foreignHost(initial)
  if (host) askBeforeOpening(host, () => loadUrl(initial))
  else loadUrl(initial)
}
