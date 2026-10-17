/**
 * The hosted player page's own logic. Everything here is the host's job: the element reports what
 * happened and this decides what to show. That split is the point of the demo — the element has
 * no URL field, no file picker, no progress bar and no "open in another browser" banner.
 */

import { foreignHost, logInto, messageIn, trustPrompt } from './page-common.js'
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
const confirmBox = document.querySelector('#confirm-src')
const modeNote = document.querySelector('#mode-note')
const modeTag = document.querySelector('#mode-tag')

const write = logInto(log)
const show = messageIn(message)
/** The question before a link from another site plays with its own code; any other load dismisses it. */
const trust = trustPrompt(confirmBox, document.querySelector('#confirm-open'))

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
  modeTag.hidden = state !== 'ready'

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
  modeTag.textContent = player.untrusted
    ? "Untrusted · this site's library pack · content checked"
    : player.libraryBundle
      ? "Trusted · its own libraries, the rest from this site's pack"
      : 'Trusted · its own libraries'
  write(`mode  ${modeTag.textContent}`)
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
  // Played untrusted, the package turned out to need its own copy of a library. From another
  // site, the visitor decides, naming the host; this site's own or a picked file was played
  // untrusted because the visitor chose it, and the switch is the way back.
  if (missingLibraries?.carried && player.untrusted) {
    write(`refused  its own code: ${missingLibraries.folders.join(', ')}`)
    const host = currentLink && foreignHost(currentLink)
    if (host) {
      const link = currentLink
      show('')
      askBeforeOpening(host, () => {
        setMode('trusted')
        loadUrl(link)
      })
    } else {
      show(
        `Played untrusted, this package is refused: it needs its own copy of ${missingLibraries.folders.join(', ')}, ` +
          "newer than this site's library pack. Switch to Trusted to play it with its own scripts.",
        'warning'
      )
    }
    return
  }
  // A runtime error once the content is up does not stop it — content types throw non-fatal
  // exceptions routinely — so it is shown as a note, not as the player failing.
  const late = code === 'runtime' && player.state === 'ready'
  show(late ? `The content reported an error and kept running: ${detail}` : (EXPLANATIONS[code] ?? detail), late ? 'hint' : 'error')
  write(`error  ${code}: ${detail}`)

  // The element reports what a package is missing; where to get it is the host's call, and here
  // the visitor's: this site's bundle, about 14 MB, offered rather than fetched unasked. Once it
  // has been tried there is nothing else to offer.
  const tried = player.getAttribute('libraries')
  // The element's own text is written for the developer ("set the libraries attribute"); the
  // visitor gets the buttons instead.
  if (missingLibraries && !tried) {
    show(
      missingLibraries.all
        ? `This package was exported without its H5P libraries, as h5p.com and h5p.org do by default. Missing: ${missingLibraries.folders.join(', ')}.`
        : `This package does not carry every H5P library it needs. Missing: ${missingLibraries.folders.join(', ')}.`,
      'warning'
    )
  }
  offer.hidden = !missingLibraries || tried === BUNDLE
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
 * Where the embed snippets point: this site's own `/embed` and `/resizer.js`, the page a host
 * serves from a player domain of its own, never a third-party service: a snippet offered here
 * gets pasted into live pages, and those should send learners nowhere but the host's own domain.
 */
const EMBED_ORIGIN = location.origin

/**
 * What the H5P embed button offers: the Embed setup, this site's page around the package, with H5P's own
 * `:w` and `:h` standing for the size the dialog lets the visitor pick. Set per load, since it
 * names the package; a picked file has no URL to embed, and the button stays off.
 */
const embedCodeFor = (url) =>
  `<iframe src="${EMBED_ORIGIN}/embed?src=${encodeURIComponent(new URL(url, location.href).href)}" width=":w" height=":h" allow="fullscreen; microphone; camera" style="border: 0"></iframe>`

// The sizing script the embed dialog offers under "advanced": the page speaks H5P's resizer
// protocol upward, and `/resizer.js` is the page-side half, so the embedding page sends nothing
// to h5p.org, whose own `h5p-resizer.js` speaks the same protocol and would do too.
player.setAttribute('resize-code', `<script src="${EMBED_ORIGIN}/resizer.js"></script>`)

/** The link being played, for the question a refusal of its own code asks. */
let currentLink = null

/**
 * The element's two modes, as the switch in the form sets them: Trusted plays a package with its
 * own libraries, Untrusted as data, none of its own code running, its libraries from this site's
 * bundle, which it cannot play without, and its content checked against their semantics. The
 * switch is the visitor's and holds for whatever plays next. Three things set it for them, so
 * that it always shows the mode playing: a `?src=` link from another site and the content-only
 * sample, which play untrusted, and the click that lets a refused link run its own code.
 */
const NOTES = {
  trusted: 'The package plays with its own libraries, as on the site that made it: its own scripts run on this site.',
  untrusted:
    "None of the package's own scripts run. Its libraries come from this site's pack, about 14 MB, fetched once, " +
    'and every field is checked against its library\'s definition, as the H5P plugins for Moodle, WordPress and Drupal check an upload.'
}
const playsUntrusted = () => form.elements.mode.value === 'untrusted'
const setMode = (mode) => {
  form.elements.mode.value = mode
  modeNote.textContent = NOTES[mode]
}
setMode(form.elements.mode.value)

/** Untrusted needs the bundle, whatever the visitor has chosen for missing libraries. */
const applyMode = () => {
  applyLibrarySource()
  const untrusted = playsUntrusted()
  if (untrusted) player.setAttribute('libraries', librarySource ?? BUNDLE)
  player.untrusted = untrusted
  return untrusted ? '  (untrusted: none of its own code runs)' : ''
}

/** Plays a package at a URL, in the switch's mode. */
const loadUrl = (url) => {
  log.textContent = ''
  trust.dismiss()
  offer.hidden = true
  reload = () => loadUrl(url)
  currentLink = url
  write(`loading  ${url}${applyMode()}`)
  startClock()
  // The embed code is read with the load, like `libraries`, so it goes on before `src`.
  player.setAttribute('embed-code', embedCodeFor(url))
  // Removed first so re-setting the same URL still counts as a change.
  player.removeAttribute('src')
  player.setAttribute('src', url)
}

const loadFile = (file) => {
  log.textContent = ''
  trust.dismiss()
  offer.hidden = true
  reload = () => loadFile(file)
  currentLink = null
  write(`loading  ${file.name} (${(file.size / 1024).toFixed(0)} kB, from disk)${applyMode()}`)
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

fileInput.addEventListener('change', () => {
  const [file] = fileInput.files
  if (file) loadFile(file)
})

// The same package again in the other mode, which is the quickest way to see the difference.
for (const input of form.elements.mode) {
  input.addEventListener('change', () => {
    setMode(input.value)
    reload?.()
  })
}

// A sample marked `data-untrusted` plays as data against this site's bundle: a content-only
// export, as h5p.com and h5p.org make them, the way a site plays a package it did not make. The
// others play in whichever mode the switch is in.
for (const button of document.querySelectorAll('.samples button')) {
  button.addEventListener('click', () => {
    urlInput.value = button.dataset.src
    if ('untrusted' in button.dataset) setMode('untrusted')
    loadUrl(button.dataset.src)
  })
}

const askBeforeOpening = trust.ask

// `?src=` makes the page linkable.
const initial = new URLSearchParams(location.search).get('src')
if (initial) {
  urlInput.value = initial
  if (foreignHost(initial)) setMode('untrusted')
  loadUrl(initial)
}
