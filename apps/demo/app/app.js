/**
 * The installable app's page. The element is the same one every other page uses; what is
 * different is whose worker it finds. `sw.js` in this directory mounts the player's handlers, so
 * once it controls this page the element finds the routes it serves under `/app/h5p/` — the
 * `_ping` check in `findMountedRoutes` — and registers nothing of its own. That is what makes it
 * work offline, and it is why nothing is played until the page is controlled: an element that
 * looked before then would register its own worker at `/h5p/`, which plays online and not off.
 */

const player = document.querySelector('h5p-player')
const fileInput = document.querySelector('#file')
const installButton = document.querySelector('#install')
const startOver = document.querySelector('#start-over')
const offline = document.querySelector('#offline')
const status = document.querySelector('#status')
const stateBadge = document.querySelector('#state')
const fileName = document.querySelector('#file-name')
const message = document.querySelector('#message')
const offer = document.querySelector('#offer')
const update = document.querySelector('#update')
const confirmBox = document.querySelector('#confirm-src')

const show = (text, kind = 'hint') => {
  message.textContent = text
  message.className = `message ${kind}`
  message.hidden = !text
}

const setOffline = (state, text) => {
  offline.dataset.state = state
  offline.textContent = text
}

/* ---------------------------------------------------------------- the worker */

/**
 * Resolves once this page is controlled by the app's worker, or with `false` when it will not
 * be: no Service Worker support, a failed registration, or a hard reload — which bypasses the
 * worker for that one load even though it is installed. The element then registers its own,
 * which plays while online.
 */
async function controlled() {
  if (!('serviceWorker' in navigator)) return false

  let registration
  try {
    registration = await navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' })
  } catch (error) {
    console.warn('[app] the app worker did not register', error)
    return false
  }
  if (navigator.serviceWorker.controller) return true

  // First visit: the worker installs, precaches the shell and claims this page as it activates.
  const claimed = new Promise((resolve) => {
    navigator.serviceWorker.addEventListener('controllerchange', () => resolve(true), { once: true })
  })
  await activated(registration)
  // Claiming follows activation at once; a page it never claims was loaded with a hard reload.
  return Promise.race([claimed, new Promise((resolve) => setTimeout(() => resolve(false), 3000))])
}

function activated(registration) {
  const worker = registration.installing ?? registration.waiting ?? registration.active
  if (!worker || worker.state === 'activated') return Promise.resolve()
  return new Promise((resolve, reject) => {
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') resolve()
      else if (worker.state === 'redundant') reject(new Error('The app worker became redundant'))
    })
  })
}

const ready = controlled().then(
  (isControlled) => {
    if (isControlled) {
      setOffline('ready', 'Works offline')
      offerNewVersion()
    } else setOffline('online-only', 'Online only — reload to enable offline use')
    return isControlled
  },
  (error) => {
    console.warn('[app]', error)
    setOffline('online-only', 'Online only')
    return false
  }
)

/**
 * A new app worker took over this page. Loading the page checked for one, and `mountH5P` skips
 * waiting, so a deploy reaches an open page about a second after it loads: the new worker deletes
 * the old precache as it activates, while this page still runs the old shell, whose hashed files
 * are then gone for good offline. Offered rather than done, since a reload in the middle of a
 * lesson is the learner's call; with `resume` the content comes back where it was. Listened for
 * only once the page is controlled, because the first visit's claim fires the same event.
 */
function offerNewVersion() {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    update.hidden = false
  })
  document.querySelector('#reload').addEventListener('click', () => location.reload())
}

/* ---------------------------------------------------------------- opening a file */

/**
 * Where a package missing its own libraries gets them: the pack the app carries — every content
 * type's runtime libraries from the H5P hub, precached with the app — so a stripped export plays
 * offline. The hub itself only for what the pack lacks: a newer minor than it was built with, or
 * a content type added since, and only with the viewer's consent.
 */
const PACK = '/app/libraries.h5p'

/** Replays the last open with a library source, for the retry against the hub. */
let reopen = null
/** The URL last opened, so a launch that repeats it does not load it twice. */
let lastUrl = null

const opening = (label, again) => {
  reopen = again
  offer.hidden = true
  show('')
  fileName.textContent = label
  fileName.hidden = false
}

async function open(file, libraries = PACK) {
  lastUrl = null
  // A file the learner chose answers a pending link's question: they went with the file.
  confirmBox.hidden = true
  opening(`${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`, (source) => open(file, source))
  document.title = `${file.name} — H5P Offline Player`
  await ready
  player.setAttribute('libraries', libraries)
  player.file = file
}

/**
 * A package at a URL: `/app/?src=…`, the link a teacher sends. With the app installed, Chrome
 * opens such a link in the app's window — its "supported links" — and when that window is
 * already open, hands it the URL through `launchQueue` instead of loading the page again.
 */
async function openUrl(src, libraries = PACK) {
  let url
  try {
    url = new URL(src, location.href)
  } catch {
    show(`That is not a URL: ${src}`, 'error')
    return
  }
  const name = decodeURIComponent(url.pathname.split('/').pop() || url.host)
  lastUrl = url.href
  opening(url.href, (source) => openUrl(url.href, source))
  document.title = `${name} — H5P Offline Player`
  await ready
  player.setAttribute('libraries', libraries)
  // Removed first, so opening the same link again still counts as a change.
  player.removeAttribute('src')
  player.setAttribute('src', url.href)
}

/**
 * The host of a package on another site, or `null` for this site's own and for what is not a URL
 * (which `openUrl` then reports). A package's libraries are JavaScript and the frame is
 * same-origin by design, so a package runs with this origin's storage — with `resume` on, the
 * saved state of every file opened here, answers included, and the chunk store and the list of
 * what was played. A file the learner picked is their choice; a link is whoever wrote it, so a
 * link to another site waits for a click that names the host.
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

let confirmed = null
const openLink = (src) => {
  confirmBox.hidden = true
  const host = foreignHost(src)
  if (!host) return void openUrl(src)
  confirmBox.querySelector('.host').textContent = host
  confirmBox.hidden = false
  confirmed = () => openUrl(src)
}
document.querySelector('#confirm-open').addEventListener('click', () => {
  confirmBox.hidden = true
  void confirmed?.()
})

const srcOf = (href) => {
  try {
    return new URL(href).searchParams.get('src')
  } catch {
    return null
  }
}

fileInput.addEventListener('change', () => {
  const [file] = fileInput.files
  if (file) void open(file)
  // Cleared, so picking the same file again still fires `change`.
  fileInput.value = ''
})

// The page's own address first: `/app/?src=…` opened in a tab, or the link that launched the
// app. A launch with a file opens at the manifest's action, `/app/`, which has no `src`.
const initial = srcOf(location.href)
if (initial) openLink(initial)

// How an installed app is handed what it was launched with. A `.h5p` opened from the file
// manager arrives as a file handle (the manifest's `file_handlers`); a link to `/app/?src=…`
// clicked while the window is open arrives as the target URL (`launch_handler` keeps the one
// window). The launch that opened this page comes through here too, with this page's address
// as its target, which `openUrl` already has.
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    const [handle] = params.files ?? []
    if (handle) {
      void open(await handle.getFile())
      return
    }
    const src = params.targetURL ? srcOf(params.targetURL) : null
    if (src && new URL(src, location.href).href !== lastUrl) openLink(src)
  })
}

// Dropping a file anywhere on the page.
let dragDepth = 0
document.addEventListener('dragenter', (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return
  dragDepth++
  document.body.classList.add('dragging')
})
document.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) document.body.classList.remove('dragging')
})
document.addEventListener('dragover', (event) => {
  if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
})
document.addEventListener('drop', (event) => {
  event.preventDefault()
  dragDepth = 0
  document.body.classList.remove('dragging')
  const file = [...(event.dataTransfer?.files ?? [])].find((candidate) => candidate.name.toLowerCase().endsWith('.h5p'))
  if (file) void open(file)
  else show('That is not a .h5p file.', 'error')
})

/* ---------------------------------------------------------------- the player's reports */

const EXPLANATIONS = {
  'no-worker': 'This page needs a Service Worker. Open it over https:// in Chrome or Edge.',
  'no-cors':
    'That host does not let other sites read the file. Download the .h5p and open it with "Open file".',
  network: 'The package could not be fetched. Check the address and the connection, and try again.'
}

player.addEventListener('statechange', (event) => {
  const { state } = event.detail
  stateBadge.textContent = state
  stateBadge.dataset.state = state
  status.dataset.state = state
  if (state !== 'error') show('')
  startOver.hidden = state !== 'ready'
})

// The element keeps the content's saved state on this device (`resume`); this forgets it for
// the open file and opens the file again, from the start.
startOver.addEventListener('click', async () => {
  await player.clearUserData()
  void reopen?.(player.getAttribute('libraries'))
})

player.addEventListener('error', (event) => {
  const { code, message: detail, missingLibraries } = event.detail
  const late = code === 'runtime' && player.state === 'ready'

  // Missing even with the pack attached: the package needs a newer minor than the pack was built
  // with, or a content type added since. The hub has it — asked for, not assumed, since it is a
  // request to a third party; once the viewer has agreed, every later case retries on its own,
  // and offline the element then uses a hub bundle downloaded before, if there is one.
  if (missingLibraries) {
    const from = player.getAttribute('libraries')
    if (from === PACK && remembered()) {
      void reopen?.('hub')
      return
    }
    const newer = 'This package needs a newer version of an H5P library than the app carries'
    if (!navigator.onLine) {
      show(`${newer}, and it has not been fetched on this device yet. Open it once while online, and it plays offline after that.`, 'error')
      offer.hidden = true
    } else if (from === PACK) {
      show(`${newer}. It can be fetched from h5p.org.`, 'error')
      offer.hidden = false
    } else {
      show(detail, 'error')
      offer.hidden = true
    }
    return
  }

  // A package at a URL needs the network to be read, whatever was cached from it before: the
  // probe that finds out how to read it is a request.
  if (!navigator.onLine && (code === 'no-cors' || code === 'network')) {
    show('This package is on the web, and this device is offline. Open a downloaded .h5p with "Open file" instead.', 'error')
    offer.hidden = true
    return
  }

  show(late ? `The content reported an error and kept running: ${detail}` : (EXPLANATIONS[code] ?? detail), late ? 'hint' : 'error')
  offer.hidden = true
})

player.addEventListener('resize', (event) => {
  player.style.height = `${Math.max(event.detail.height, 240)}px`
})

/**
 * Whether this viewer has agreed to fetch from h5p.org what the pack lacks. Kept, so the next
 * visit — offline, say — does not ask again: the element then falls back to the bundle it
 * fetched before by itself. A per-viewer convenience, so browser storage, and a page that works
 * without it.
 */
const HUB_CONSENT = 'h5p-app:libraries-from-hub'
const remembered = () => {
  try {
    return localStorage.getItem(HUB_CONSENT) === 'yes'
  } catch {
    return false
  }
}
document.querySelector('#fetch-libraries').addEventListener('click', () => {
  offer.hidden = true
  try {
    localStorage.setItem(HUB_CONSENT, 'yes')
  } catch {
    // Not kept; the next visit asks again.
  }
  void reopen?.('hub')
})

/* ---------------------------------------------------------------- installing */

let deferredPrompt = null

/** True in the installed app's own window, where there is nothing left to install. */
const standalone = matchMedia('(display-mode: standalone)')

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  deferredPrompt = event
  // Chrome can still offer the prompt inside the installed window — for another copy installed
  // from a different origin, say — and the offer only makes sense in a tab.
  installButton.hidden = standalone.matches
})
standalone.addEventListener('change', () => {
  if (standalone.matches) installButton.hidden = true
})

installButton.addEventListener('click', async () => {
  if (!deferredPrompt) return
  installButton.hidden = true
  await deferredPrompt.prompt()
  deferredPrompt = null
})

/**
 * Asks for storage the browser will not evict under pressure: the shell and whatever the chunk
 * store has extracted. Chrome grants it to an installed app without a prompt. Asked once
 * installed, not on every visit to the page, because a site in a tab has not earned it.
 */
const persist = () => navigator.storage?.persist?.().catch(() => false)

window.addEventListener('appinstalled', () => {
  installButton.hidden = true
  void persist()
})
if (standalone.matches) void persist()
