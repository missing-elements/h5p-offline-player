/**
 * The hosted player page's own logic. Everything here is the host's job: the element reports what
 * happened and this decides what to show. That split is the point of the demo — the element has
 * no URL field, no file picker, no progress bar and no "open in another browser" banner.
 */

import { foreignHost, logInto, messageIn, packageUrl, trustPrompt } from './page-common.js'
import { pack } from '@missing-elements/h5p-libraries'

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
const refreshToggle = document.querySelector('#refresh')
const downgradeToggle = document.querySelector('#downgrade')
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
  const refreshed = player.libraryBundle?.refreshed ?? []
  const downgraded = player.downgradedLibraries
  const libraries = (count) => (count === 1 ? 'one library' : `${count} libraries`)
  modeTag.textContent =
    (player.untrusted
      ? "Untrusted · libraries from this site's pack · content checked"
      : refreshed.length > 0
        ? `Trusted · ${libraries(refreshed.length)} at the pack's newer version`
        : player.libraryBundle
          ? "Trusted · its own libraries, the rest from this site's pack"
          : 'Trusted · its own libraries') + (downgraded.length > 0 ? ` · ${libraries(downgraded.length)} older than the content` : '')
  write(`mode  ${modeTag.textContent}`)
  for (const { library, from, to } of refreshed) write(`refreshed  ${library} ${from} → ${to}`)
  for (const { library, from, to } of downgraded) write(`older  ${library} ${to}, made for ${from}`)
  // Made for a version this site's pack has not got yet, and played at its older one: most of the
  // time all of it works, but what the newer version added is not there, so the visitor is told.
  if (downgraded.length > 0) {
    show(
      "Made for newer library versions than this site's pack has, so it plays at older ones: " +
        `${downgraded.map(({ library, from, to }) => `${library} ${from} at ${to}`).join(', ')}. ` +
        'What the newer versions added is left out. Turn off Older if needed to refuse such packages instead.',
      'warning'
    )
  }
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

  // Missing with the pack offered: neither the package nor this site's pack has it — a newer
  // minor than the pack, or a content type it does not serve. The element's own text is written
  // for the developer ("set the libraries attribute").
  if (missingLibraries) {
    show(
      `This package needs ${missingLibraries.folders.join(', ')}, which neither it nor this site's library pack has: ` +
        'a newer version than the pack, or a content type the pack does not serve.',
      'warning'
    )
  }
})

/**
 * The library pack, `@missing-elements/h5p-libraries`, the one the installable app carries: one
 * archive per library, each emitted by Vite as an asset of this site. `libraries="pack"` takes
 * from it the libraries a package lacks, and the newer versions of those it carries; only the
 * archives a package needs are fetched, and nothing for one as new as the pack.
 */
player.pack = pack
player.setAttribute('libraries', 'pack')

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
  trusted: "The package's own scripts run on this site. What it lacks comes from this site's library pack, only the libraries it needs.",
  untrusted:
    "None of the package's own scripts run. Its libraries come from this site's pack, only the ones it needs, " +
    'and every field is checked against its library\'s definition, as the H5P plugins for Moodle, WordPress and Drupal check an upload.'
}
const REFRESH_NOTES = {
  on: ' Where the pack has a newer version of a library the package carries, that version plays.',
  off: ' The libraries the package carries play as exported.'
}
const DOWNGRADE_NOTES = {
  on: ' Content made for a newer version than anything here has plays at the newest older one, without what the newer version added.',
  off: ' Content made for a newer version than anything here has is refused.'
}
const playsUntrusted = () => form.elements.mode.value === 'untrusted'
const describeMode = () => {
  const mode = form.elements.mode.value
  modeNote.textContent =
    NOTES[mode] + (mode === 'trusted' ? REFRESH_NOTES[refreshToggle.checked ? 'on' : 'off'] : '') + DOWNGRADE_NOTES[downgradeToggle.checked ? 'on' : 'off']
  // Untrusted, none of the package's own libraries play, so there is nothing to refresh.
  refreshToggle.disabled = mode === 'untrusted'
}
const setMode = (mode) => {
  form.elements.mode.value = mode
  describeMode()
}
setMode(form.elements.mode.value)

const applyMode = () => {
  const untrusted = playsUntrusted()
  player.untrusted = untrusted
  if (refreshToggle.checked) player.removeAttribute('refresh-libraries')
  else player.setAttribute('refresh-libraries', 'off')
  if (downgradeToggle.checked) player.removeAttribute('downgrade-libraries')
  else player.setAttribute('downgrade-libraries', 'off')
  return (
    (untrusted ? '  (untrusted: none of its own code runs)' : refreshToggle.checked ? '' : '  (libraries as exported)') +
    (downgradeToggle.checked ? '' : '  (no older versions)')
  )
}

/** Plays a package at a URL, in the switch's mode. */
const loadUrl = (url) => {
  const address = packageUrl(url)
  if (!address) {
    show(`That is not an http or https address: ${url}`, 'error')
    return
  }
  log.textContent = ''
  trust.dismiss()
  reload = () => loadUrl(url)
  currentLink = url
  write(`loading  ${url}${applyMode()}`)
  // The embed code is read with the load, like `libraries`, so it goes on before `src`.
  player.setAttribute('embed-code', embedCodeFor(url))
  // Removed first so re-setting the same URL still counts as a change. Removing it empties the
  // player at once, through `idle`, which stops the clock: so the clock starts after it.
  player.removeAttribute('src')
  startClock()
  player.setAttribute('src', address.href)
}

const loadFile = (file) => {
  log.textContent = ''
  trust.dismiss()
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

// And with its libraries as exported, or at the pack's newer versions: an older export's look
// against the current one.
refreshToggle.addEventListener('change', () => {
  describeMode()
  reload?.()
})

// And content made for a newer version than the pack has: played at its older one, or refused.
downgradeToggle.addEventListener('change', () => {
  describeMode()
  reload?.()
})

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
