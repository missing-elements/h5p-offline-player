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
const offline = document.querySelector('#offline')
const status = document.querySelector('#status')
const stateBadge = document.querySelector('#state')
const fileName = document.querySelector('#file-name')
const message = document.querySelector('#message')
const offer = document.querySelector('#offer')

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
    if (isControlled) setOffline('ready', 'Works offline')
    else setOffline('online-only', 'Online only — reload to enable offline use')
    return isControlled
  },
  (error) => {
    console.warn('[app]', error)
    setOffline('online-only', 'Online only')
    return false
  }
)

/* ---------------------------------------------------------------- opening a file */

let current = null

async function open(file) {
  current = file
  offer.hidden = true
  show('')
  fileName.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`
  fileName.hidden = false
  document.title = `${file.name} — H5P Offline Player`
  await ready
  player.file = file
}

fileInput.addEventListener('change', () => {
  const [file] = fileInput.files
  if (file) void open(file)
  // Cleared, so picking the same file again still fires `change`.
  fileInput.value = ''
})

// A `.h5p` opened from the file manager, once the app is installed: the manifest's
// `file_handlers` route it here, and `launchQueue` hands it over.
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    const [handle] = params.files ?? []
    if (handle) void open(await handle.getFile())
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
  network: 'The libraries could not be fetched. Check the connection, and try again.'
}

player.addEventListener('statechange', (event) => {
  const { state } = event.detail
  stateBadge.textContent = state
  stateBadge.dataset.state = state
  status.dataset.state = state
  if (state !== 'error') show('')
})

player.addEventListener('error', (event) => {
  const { code, message: detail, missingLibraries } = event.detail
  const late = code === 'runtime' && player.state === 'ready'

  // Offline, a package without its own libraries plays only if they were fetched from the hub
  // before; the element uses that copy by itself. Reaching this means there is none.
  if (missingLibraries && !navigator.onLine) {
    show(
      'This package does not carry its own libraries, and they have not been fetched on this ' +
        'device yet. Open it once while online, and it plays offline after that.',
      'error'
    )
    offer.hidden = true
    return
  }

  show(late ? `The content reported an error and kept running: ${detail}` : (EXPLANATIONS[code] ?? detail), late ? 'hint' : 'error')
  // The hub is the one thing that needs a network, so it is asked for, not assumed.
  offer.hidden = !missingLibraries || player.getAttribute('libraries') === 'hub'
})

player.addEventListener('resize', (event) => {
  player.style.height = `${Math.max(event.detail.height, 240)}px`
})

/**
 * Whether this viewer has agreed to fetch missing libraries from h5p.org. Kept, so the next
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
if (remembered()) player.setAttribute('libraries', 'hub')

document.querySelector('#fetch-libraries').addEventListener('click', () => {
  offer.hidden = true
  player.setAttribute('libraries', 'hub')
  try {
    localStorage.setItem(HUB_CONSENT, 'yes')
  } catch {
    // Not kept; the next visit asks again.
  }
  if (current) void open(current)
})

/* ---------------------------------------------------------------- installing */

let deferredPrompt = null

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  deferredPrompt = event
  installButton.hidden = false
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
if (matchMedia('(display-mode: standalone)').matches) void persist()
