/**
 * The installable app's page. The element is the same one every other page uses; what is
 * different is whose worker it finds. `sw.js` in this directory mounts the player's handlers, so
 * once it controls this page the element finds the routes it serves under `/app/h5p/` — the
 * `_ping` check in `findMountedRoutes` — and registers nothing of its own. That is what makes it
 * work offline, and it is why nothing is played until the page is controlled: an element that
 * looked before then would register its own worker at `/h5p/`, which plays online and not off.
 *
 * It is laid out as an app rather than a page: a bar, and under it one of two screens — home, to
 * open a file, with the files opened before listed under it, and the player, from opening one
 * until it is closed. Opening is a step in the window's history, so Back, in the bar, the
 * browser's or Android's, closes the file rather than leaving the app.
 */

import { foreignHost, messageIn, trustPrompt } from '../demo/page-common.js'
import { fillLanguages, offered, preferredLanguage } from '../demo/languages.js'
import { pack } from '@missing-elements/h5p-libraries'
import librariesNotice from '@missing-elements/h5p-libraries/libraries.txt?url'
import { copyOf, fileKey, forget, forgetAll, linkKey, recentFiles, remember } from './recent.js'

const $ = (selector) => document.querySelector(selector)

const player = $('h5p-player')
// The pack's licence list, emitted beside it: the page links it, so a reader finds the notices of what the app carries.
for (const link of document.querySelectorAll('.libraries-notice')) link.href = librariesNotice
const fileInput = $('#file')
const openButton = $('#open')
const dropzone = $('.dropzone')
const home = $('.home')
const stage = $('.stage')
const installButton = $('#install')
const startOver = $('#start-over')
const offline = $('#offline')
const message = $('#message')
const update = $('#update')
const confirmBox = $('#confirm-src')
const backButton = $('#back')
const brand = $('#brand')
const titleText = $('#title')
const loading = $('#loading')
const loadingText = $('#loading-text')
const loadingDetail = $('#loading-detail')
const loadingBar = $('#loading-bar')
const menu = $('#menu')
const menuButton = $('#menu-button')
const aboutDialog = $('#about-dialog')
const recentSection = $('#recent')
const recentList = $('#recent-list')
/** Install, on the home screen and in the menu: each shown only while the browser offers it. */
const installButtons = [installButton, $('#menu-install')]

const show = messageIn(message)
/** The question before a link from another site plays with its own code. */
const trust = trustPrompt(confirmBox, $('#confirm-open'))

/* ---------------------------------------------------------------- the window */

/** The installed app's own window: standalone, or on the desktop with its bar in the title bar. */
const installed = matchMedia('(display-mode: standalone), (display-mode: window-controls-overlay)')

const APP_NAME = 'H5P Offline Player'
/** The page's title in a tab, which search engines show too; an installed window's says the app's name. */
const PAGE_TITLE = document.title
const homeTitle = () => (installed.matches ? APP_NAME : PAGE_TITLE)
if (installed.matches) document.title = APP_NAME

// The window's title bar in the page's colour, whichever theme shows: the head's two
// `theme-color`s cover a theme that follows the system, and one pinned against it needs this.
const themeColors = document.querySelectorAll('meta[name="theme-color"]')
const paintTitleBar = () => {
  const color = getComputedStyle(document.body).backgroundColor
  for (const meta of themeColors) meta.content = color
}
new MutationObserver(paintTitleBar).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintTitleBar)
paintTitleBar()

/* ---------------------------------------------------------------- the two screens */

let screen = 'home'

/**
 * Shows one of the screens, with the bar's left end to match: the app's name at home, the file's
 * name and a way back in the player. Focus left on the screen that goes moves to the one that
 * comes, so a keyboard is not stranded on a hidden button.
 */
function setScreen(next) {
  if (next === screen) return
  const playing = next === 'player'
  const stranded = playing ? home.contains(document.activeElement) : stage.contains(document.activeElement) || document.activeElement === backButton
  screen = next
  document.body.dataset.screen = next
  backButton.hidden = !playing
  titleText.hidden = !playing
  brand.hidden = playing
  if (!playing) {
    document.title = homeTitle()
    startOver.hidden = true
  }
  if (stranded) (playing ? backButton : openButton).focus()
}

/** The bar's and the window's title for the open file. */
function setTitle(name) {
  titleText.textContent = name
  document.title = `${name} — ${APP_NAME}`
}

/** The home screen's step in the window's history. */
const HOME = { screen: 'home' }
/** How long Back in the bar waits for the history to reach home before it closes the file where it is. */
const HOME_WAIT_MS = 1000
/** How long a first visit waits for the worker to claim the page after it has activated. */
const CLAIM_WAIT_MS = 3000

/**
 * How many steps the current one lies above home while a file is open: 1 for the file's own, and
 * one more for each step its content has added since. Content can add steps: the frame shares
 * this page's origin, and Interactive Book writes its chapter into this page's address
 * (`top.location.hash`) at every move, which is a step in the window's history with no state of
 * its own. Each step carries its depth, so Back in the bar goes home past all of them at once.
 */
let depth = 0
const playerStep = (steps) => ({ screen: 'player', depth: steps })

/**
 * Opening a file is a step forward in the window's history — for a link, with its `?src=`, so a
 * reload opens it again. Another file opened while one is open replaces that step instead of
 * adding one, so Back in the bar still leads home in one.
 */
function enterPlayer(url) {
  if (history.state?.screen === 'player') {
    depth = history.state.depth ?? 1
    history.replaceState(playerStep(depth), '', url)
  } else {
    depth = 1
    history.pushState(playerStep(depth), '', url)
  }
  setScreen('player')
}

/** Empties the player and goes home. The content saves where it was as its document goes. */
function closePlayer() {
  opens++
  reopen = null
  lastUrl = null
  current = null
  depth = 0
  if (player.hasAttribute('src')) player.removeAttribute('src')
  else player.file = null
  show('')
  setScreen('home')
}

/** Set while Back in the bar waits for the history to reach home. */
let homeward = null

backButton.addEventListener('click', () => {
  const steps = history.state?.screen === 'player' ? (history.state.depth ?? 1) : 0
  if (!steps) {
    closePlayer()
    return
  }
  // Home's popstate closes the file. Unless home is no longer in the history, which keeps fifty
  // steps in Chrome, so that a long read can push it out: then nothing comes back, and the file
  // is closed here, with this step made home.
  history.go(-steps)
  clearTimeout(homeward)
  homeward = setTimeout(() => {
    homeward = null
    closePlayer()
    history.replaceState(HOME, '', location.pathname)
  }, HOME_WAIT_MS)
})

addEventListener('popstate', (event) => {
  clearTimeout(homeward)
  homeward = null
  const { state } = event
  // A step the content added, which comes with no state and a new fragment: it belongs to the open
  // file, one past the step before it. Marked so, Back walks the content's steps before it closes
  // the file — an Interactive Book turns back its chapters — and a reload knows it as the file's.
  if (state === null && location.hash) {
    if (screen === 'player') history.replaceState(playerStep(++depth), '')
    else history.replaceState(HOME, '')
    return
  }
  // Home, or a step written before steps carried their screen.
  if (state?.screen !== 'player') {
    if (screen === 'player') closePlayer()
    return
  }
  depth = state.depth ?? 1
  // Forward again, onto a file that was closed: a link opens once more; a picked file has gone.
  if (screen === 'player') return
  const src = srcOf(location.href)
  if (src) void openUrl(src)
  else history.replaceState(HOME, '', location.pathname)
})

/* ---------------------------------------------------------------- loading */

/** The states between asking for a package and its content standing: the loading screen's. */
const LOADING = new Set(['probing', 'downloading', 'indexing'])

const megabytes = (bytes) => (bytes / 1024 / 1024).toFixed(1)

/** How far a download has got, along the bar's edge; a sweep while the size is not known. */
function setProgress(fraction) {
  if (fraction === null || fraction === undefined) {
    delete loadingBar.dataset.known
    loadingBar.style.removeProperty('--progress')
  } else {
    loadingBar.dataset.known = ''
    loadingBar.style.setProperty('--progress', `${Math.round(fraction * 100)}%`)
  }
}

function setLoading(busy) {
  loading.hidden = !busy
  loadingBar.hidden = !busy
  if (!busy) {
    setProgress(null)
    loadingDetail.textContent = ''
  }
}

/* ---------------------------------------------------------------- the worker */

const setOffline = (state, text) => {
  offline.dataset.state = state
  offline.textContent = text
}

/** Once the app can start without a network, whether it has one now. */
const describeOffline = () => {
  if (offline.dataset.state !== 'ready') return
  offline.textContent = navigator.onLine ? 'Works offline' : 'Offline: files on this device still open'
}
addEventListener('online', describeOffline)
addEventListener('offline', describeOffline)

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
  return Promise.race([claimed, new Promise((resolve) => setTimeout(() => resolve(false), CLAIM_WAIT_MS))])
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

const workerChecked = controlled().then(
  (isControlled) => {
    if (isControlled) {
      setOffline('ready', 'Works offline')
      describeOffline()
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
  $('#reload').addEventListener('click', () => location.reload())
}

/* ---------------------------------------------------------------- opening a file */

/**
 * Where a package missing its own libraries gets them, and newer versions of those it carries:
 * the pack the app carries — every content type's runtime libraries from the H5P hub,
 * `@missing-elements/h5p-libraries`, one archive per library, emitted by Vite under `assets/` and
 * precached with the app — so a stripped export plays offline. The player copies into its own
 * cache only the archives a package uses. Nothing else is asked: a newer pack arrives with the
 * next version of the app.
 */
const PACK = 'pack'
player.pack = pack

/** Replays the last open with a library source, for Start over. */
let reopen = null
/** The URL last opened, so a launch that repeats it does not load it twice. */
let lastUrl = null
/**
 * The open in progress, put on the list of recent files once its content stands, so that what
 * the list offers is what played: `{ kind: 'file', file, handle, replaces }` or `{ kind: 'link',
 * url }`. `handle` may still be a promise, from a drop.
 */
let current = null
/**
 * Which open is the latest. The first visit's worker takes a moment to install, and an open that
 * was waiting for it gives way to a later open, or to a close: without this, a file closed with
 * Back during that moment opened into the home screen once the worker was ready.
 */
let opens = 0

/**
 * The language of H5P's own strings, from the menu: by default the first of the browser's
 * languages the runtime has, else English, and once the learner picks one, that, remembered on
 * this device. The element reads its `lang` when a load starts, so a change opens the current
 * file again, where the learner was: the content saves its state as its document goes. Set here,
 * before anything opens, a launch's file and a link's `?src=` included.
 */
const LANGUAGE_KEY = 'h5p-app-language'
const languageSelect = $('#language')
{
  let kept = null
  try {
    kept = localStorage.getItem(LANGUAGE_KEY)
  } catch {
    // Storage refused, as in some private windows: the browser's language, every time.
  }
  const browserLanguages = navigator.languages?.length ? navigator.languages : [navigator.language]
  fillLanguages(languageSelect, kept && offered(kept) ? kept : preferredLanguage(browserLanguages))
  player.setAttribute('lang', languageSelect.value)
}
languageSelect.addEventListener('change', () => {
  try {
    localStorage.setItem(LANGUAGE_KEY, languageSelect.value)
  } catch {
    // Not remembered: it holds for this visit.
  }
  player.setAttribute('lang', languageSelect.value)
  void reopen?.(player.getAttribute('libraries'))
})

/** A file's name as a title until the package says its own: without the extension. */
const fileTitle = (name) => name.replace(/\.h5p$/i, '') || name

/** Shows the player for a package being opened, under the name it is known by so far. */
function opening(name, again, url) {
  reopen = again
  show('')
  enterPlayer(url)
  setTitle(fileTitle(name))
  loadingText.textContent = `Opening ${name}…`
  setLoading(true)
}

/**
 * A file, from the picker, a drop, the file manager or the list of recent files. `handle` is
 * how to find it again, where the browser gives one; `title` the package's, when the list knows
 * it; `replaces` the list's entry it was opened from, which a file changed on disk since takes
 * the place of.
 */
async function open(file, { libraries = PACK, handle = null, title = null, replaces = null } = {}) {
  const token = ++opens
  lastUrl = null
  // A file the learner chose answers a pending link's question: they went with the file.
  trust.dismiss()
  current = { kind: 'file', file, handle, replaces }
  opening(title ?? file.name, (source) => open(file, { libraries: source, handle, title, replaces }), location.pathname)
  await workerChecked
  if (token !== opens) return
  player.setAttribute('libraries', libraries)
  player.untrusted = false
  player.file = file
}

/** A link's file name, for a title until the package says its own, or its host when it has none. */
function linkName(url) {
  const last = url.pathname.split('/').pop()
  try {
    return decodeURIComponent(last) || url.host
  } catch {
    return last || url.host
  }
}

/**
 * A package at a URL: `/app/?src=…`, the link a teacher sends. With the app installed, Chrome
 * opens such a link in the app's window — its "supported links" — and when that window is
 * already open, hands it the URL through `launchQueue` instead of loading the page again. One on
 * another site plays untrusted unless the learner said otherwise: see `foreignHost`.
 */
async function openUrl(src, { libraries = PACK, title = null, trusted = !foreignHost(src) } = {}) {
  let url
  try {
    url = new URL(src, location.href)
  } catch {
    show(`That is not a URL: ${src}`, 'error')
    return
  }
  const token = ++opens
  trust.dismiss()
  lastUrl = url.href
  current = { kind: 'link', url: url.href }
  opening(title ?? linkName(url), (source) => openUrl(url.href, { libraries: source, title, trusted }), `${location.pathname}?src=${encodeURIComponent(url.href)}`)
  await workerChecked
  if (token !== opens) return
  player.setAttribute('libraries', libraries)
  player.untrusted = !trusted
  // Removed first, so opening the same link again still counts as a change.
  player.removeAttribute('src')
  player.setAttribute('src', url.href)
}


/** Asks before playing an untrusted link with its own code, which it turned out to need. */
function askToTrust(url) {
  show('')
  trust.ask(foreignHost(url), () => openUrl(url, { trusted: true }))
}

function srcOf(href) {
  try {
    return new URL(href).searchParams.get('src')
  } catch {
    return null
  }
}

/** Whether `src` names the URL that is open; what is not a URL is not, and `openUrl` says so. */
function isOpen(src) {
  try {
    return new URL(src, location.href).href === lastUrl
  } catch {
    return false
  }
}

/**
 * The picker, from whichever button asked: they are buttons, so a keyboard reaches them. Chrome
 * and Edge on the desktop have a picker that hands back a handle as well as the file, which the
 * list of recent files keeps to open the file again from disk; elsewhere the page's own input.
 */
async function choose() {
  if (!('showOpenFilePicker' in window)) {
    fileInput.click()
    return
  }
  let handle
  let file
  try {
    ;[handle] = await window.showOpenFilePicker({ id: 'h5p', types: [{ description: 'H5P content', accept: { 'application/zip': ['.h5p'] } }] })
    file = await handle.getFile()
  } catch (error) {
    // Closed without a choice. Refused for another reason, or a file that went between the
    // choice and the read, the page's own input is the way in.
    if (error?.name !== 'AbortError') fileInput.click()
    return
  }
  void open(file, { handle })
}
openButton.addEventListener('click', choose)
// The whole drop area opens the picker too, a larger target than its button.
dropzone.addEventListener('click', (event) => {
  if (!event.target.closest('button, a')) choose()
})

fileInput.addEventListener('change', () => {
  const [file] = fileInput.files
  if (file) void open(file)
  // Cleared, so picking the same file again still fires `change`.
  fileInput.value = ''
})

// The page's own address first: `/app/?src=…` opened in a tab, or the link that launched the
// app. Home goes first in the history and the package a step ahead of it, so Back from the
// package stays in the app; a reload at that step, or at one its content added, keeps it, since
// its state survives the reload, and the package opens into it again. Any other start is home,
// marked as such: a launch with a file opens at the manifest's action, `/app/`, and a picked file
// does not survive a reload.
const initial = srcOf(location.href)
if (initial && history.state?.screen === 'player') depth = history.state.depth ?? 1
else history.replaceState(HOME, '', location.pathname)
if (initial) void openUrl(initial)

// How an installed app is handed what it was launched with. A `.h5p` opened from the file
// manager arrives as a file handle (the manifest's `file_handlers`); a link to `/app/?src=…`
// clicked while the window is open arrives as the target URL (`launch_handler` keeps the one
// window). The launch that opened this page comes through here too, with this page's address
// as its target, which `openUrl` already has.
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    const [handle] = params.files ?? []
    if (handle) {
      try {
        void open(await handle.getFile(), { handle })
      } catch (error) {
        show(`The file could not be read: ${error instanceof Error ? error.message : String(error)}`, 'error')
      }
      return
    }
    const src = params.targetURL ? srcOf(params.targetURL) : null
    if (src && !isOpen(src)) void openUrl(src)
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
  const item = [...(event.dataTransfer?.items ?? [])].find((candidate) => candidate.kind === 'file' && candidate.getAsFile()?.name.toLowerCase().endsWith('.h5p'))
  if (!item) {
    show('That is not a .h5p file.', 'error')
    return
  }
  // Chrome and Edge hand over a handle for a dropped file too. It has to be asked for while the
  // drop is being handled, and it arrives after; the list of recent files waits for it. One the
  // browser cannot give is no handle, and the file is listed without one, as elsewhere.
  const handle = item.getAsFileSystemHandle?.().catch(() => null) ?? null
  void open(item.getAsFile(), { handle })
})

/* ---------------------------------------------------------------- recent files */

/**
 * Puts what just came up on the list, or moves it to the top: see `recent.js`. A file's handle is
 * kept only in the installed window. Storing a handle in IndexedDB took the whole browser down in
 * a private profile — a context made by the DevTools protocol, the kind Playwright opens, in
 * Chromium 153, with a handle to a file dropped from disk and to one in the origin's own file
 * system alike (2026-10-12) — and an installed app never runs in a private profile, where a tab
 * may be incognito or a guest's. A tab keeps a copy instead, as Safari and Firefox do.
 */
async function rememberCurrent() {
  const opened = current
  if (!opened) return
  const title = player.metadata?.title || null
  if (opened.kind === 'link') {
    const url = new URL(opened.url)
    await remember({ id: linkKey(opened.url), kind: 'link', name: linkName(url), title, size: null, lastModified: null, url: opened.url, handle: null })
  } else {
    const { file, replaces } = opened
    const handle = installed.matches ? await opened.handle : null
    const id = fileKey(file)
    // Opened from the list, but changed on disk since: the entry for the file as it was goes.
    if (replaces && replaces !== id) await forget(replaces)
    await remember({ id, kind: 'file', name: file.name, title, size: file.size, lastModified: file.lastModified, url: null, handle: handle?.kind === 'file' ? handle : null }, file)
  }
  await showRecent()
}

const sizeOf = (bytes) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} kB` : `${megabytes(bytes)} MB`)

const thisYear = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })
const anotherYear = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' })

/** When a file was last opened, as a list says it: today, yesterday, or the date. */
function openedOn(time) {
  const midnight = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const now = new Date()
  const then = new Date(time)
  const days = Math.round((midnight(now) - midnight(then)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return (then.getFullYear() === now.getFullYear() ? thisYear : anotherYear).format(then)
}

/** The line under an entry's title: where it is, when it was opened, and the room its copy takes. */
function describe(entry) {
  const where = entry.kind === 'link' ? new URL(entry.url).host : entry.name
  const kept = entry.copySize ? ` · ${sizeOf(entry.copySize)} on this device` : ''
  return `${where} · ${openedOn(entry.openedAt)}${kept}`
}

const REMOVE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>'

function recentItem(entry) {
  const item = document.createElement('li')
  const opener = document.createElement('button')
  opener.type = 'button'
  opener.className = 'recent-open'
  const title = document.createElement('span')
  title.className = 'recent-title'
  // A package's own words: text, never markup.
  title.textContent = entry.title || fileTitle(entry.name)
  const meta = document.createElement('span')
  meta.className = 'recent-meta'
  meta.textContent = describe(entry)
  opener.append(title, meta)
  opener.addEventListener('click', () => void openRecent(entry))

  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'icon-button recent-remove'
  remove.innerHTML = REMOVE_ICON
  remove.setAttribute('aria-label', `Remove ${title.textContent} from the list`)
  remove.title = entry.copySize ? 'Remove it, and the copy kept on this device' : 'Remove it from the list'
  remove.addEventListener('click', async () => {
    // The keyboard goes on to the entry that takes this one's place, or the one before it when
    // this was the last, or back to the picker when the list is empty.
    const index = [...recentList.children].indexOf(item)
    await forget(entry.id)
    await showRecent()
    const entries = recentList.children
    const target = entries[Math.min(index, entries.length - 1)]?.querySelector('.recent-open')
    ;(target ?? openButton).focus()
  })
  item.append(opener, remove)
  return item
}

/** Draws the list, which shows once there is something on it. */
async function showRecent() {
  const entries = await recentFiles()
  recentList.replaceChildren(...entries.map(recentItem))
  recentSection.hidden = entries.length === 0
}

/**
 * Reads a file from a handle kept for it: `'refused'` when the learner did not allow it, `null`
 * when the file is no longer where the handle points. Chrome asks once a session, and its prompt
 * offers to allow it on every visit.
 */
async function fileFrom(handle) {
  const read = { mode: 'read' }
  try {
    if ((await handle.queryPermission(read)) !== 'granted' && (await handle.requestPermission(read)) !== 'granted') return 'refused'
    return await handle.getFile()
  } catch {
    return null
  }
}

/** Opens an entry of the list again: from disk, from the copy kept, or from its link. */
async function openRecent(entry) {
  if (entry.kind === 'link') {
    // As when it first opened: untrusted if it is on another site, with the question only if it
    // needs its own code.
    void openUrl(entry.url, { title: entry.title })
    return
  }
  const options = { title: entry.title, replaces: entry.id }
  if (entry.handle) {
    const file = await fileFrom(entry.handle)
    if (file === 'refused') {
      show(`To open ${entry.name} from the list, allow the app to read it.`, 'hint')
      return
    }
    if (file) {
      void open(file, { ...options, handle: entry.handle })
      return
    }
  }
  const copy = await copyOf(entry)
  if (copy) {
    void open(copy, options)
    return
  }
  // Moved or deleted on disk, its copy cleared by the browser or never more than a reference to
  // the file, or no room for one: the learner still has the file, and the picker opens for it.
  // The entry goes, since it cannot open anything; choosing the file puts it back, with a copy
  // made afresh, where one kept already would not have been written again.
  show(`${entry.name} could not be opened from the list. Choose it again.`, 'hint')
  void choose()
  await forget(entry.id)
  await showRecent()
  openButton.focus()
}

$('#recent-clear').addEventListener('click', async () => {
  await forgetAll()
  await showRecent()
  openButton.focus()
})

void showRecent()

/* ---------------------------------------------------------------- the player's reports */

const EXPLANATIONS = {
  'no-worker': 'This page needs a Service Worker. Open it over https:// in a current Safari, Chrome, Firefox or Edge.',
  'no-cors':
    'That host does not let other sites read the file. Download the .h5p and open it with "Choose a file".',
  network: 'The package could not be fetched. Check the address and the connection, and try again.'
}

player.addEventListener('statechange', (event) => {
  const { state } = event.detail
  // Follows the state rather than the opening: reopening a link empties the player for a moment.
  setLoading(LOADING.has(state))
  if (state !== 'error') show('')
  startOver.hidden = state !== 'ready'
  // The package's own title, once it has been read, in place of the file's name.
  const title = state === 'ready' ? player.metadata?.title : null
  if (title) setTitle(title)
  if (state === 'ready') void rememberCurrent()
})

player.addEventListener('progress', (event) => {
  // Extraction while the content plays, a video's, is the content's business, not this screen's.
  if (player.state === 'ready') return
  const { fraction, loaded, total, phase } = event.detail
  setProgress(fraction)
  loadingDetail.textContent = phase !== 'extract' && total ? `${megabytes(loaded)} of ${megabytes(total)} MB` : ''
})

// The element keeps the content's saved state on this device (`resume`); this forgets it for
// the open file and opens the file again, from the start.
startOver.addEventListener('click', async () => {
  try {
    await player.clearUserData()
  } catch (error) {
    // Opened again now, the file would come back where it was, which is not what was pressed.
    show(`The saved state could not be cleared: ${error instanceof Error ? error.message : String(error)}`, 'error')
    return
  }
  void reopen?.(player.getAttribute('libraries'))
})

player.addEventListener('error', (event) => {
  const { code, message: detail, missingLibraries } = event.detail
  const late = code === 'runtime' && player.state === 'ready'

  // Played untrusted, a link from another site turned out to need its own copy of a library: the
  // learner decides, naming the host.
  if (missingLibraries?.carried && current?.kind === 'link') {
    askToTrust(current.url)
    return
  }

  // Missing even with the pack attached: the package needs a newer minor than the pack has, or a
  // content type added since. Only a newer version of the app, with a newer pack, can supply it.
  if (missingLibraries) {
    const from = player.getAttribute('libraries')
    show(
      from === PACK
        ? `This package needs a newer version of an H5P library than the app carries (${missingLibraries.folders.join(', ')}). A later version of the app will play it.`
        : detail,
      'error'
    )
    return
  }

  // A package at a URL needs the network to be read, whatever was cached from it before: the
  // probe that finds out how to read it is a request.
  if (!navigator.onLine && (code === 'no-cors' || code === 'network')) {
    show('This package is on the web, and this device is offline. Open a downloaded .h5p with "Choose a file" instead.', 'error')
    return
  }

  show(late ? `The content reported an error and kept running: ${detail}` : (EXPLANATIONS[code] ?? detail), late ? 'hint' : 'error')
})

/* ---------------------------------------------------------------- the menu */

// Under its button, wherever the bar has put it; the stylesheet's place is the fallback.
menu.addEventListener('beforetoggle', (event) => {
  if (event.newState !== 'open') return
  const button = menuButton.getBoundingClientRect()
  menu.style.top = `${button.bottom + 6}px`
  menu.style.right = `${Math.max(8, document.documentElement.clientWidth - button.right)}px`
})

const fromMenu = (action) => () => {
  menu.hidePopover?.()
  action()
}
$('#menu-open').addEventListener('click', fromMenu(choose))
$('#menu-about').addEventListener('click', fromMenu(() => aboutDialog.showModal()))

/* ---------------------------------------------------------------- installing */

let deferredPrompt = null
const offerInstall = (offered) => {
  for (const button of installButtons) button.hidden = !offered
}

// The browser's own install banner is held back, and the app's buttons offer the same instead;
// Chrome notes as much in the console ("Banner not shown"), which is expected.
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  deferredPrompt = event
  // Chrome can still offer the prompt inside the installed window — for another copy installed
  // from a different origin, say — and the offer only makes sense in a tab.
  offerInstall(!installed.matches)
})
installed.addEventListener('change', () => {
  if (installed.matches) offerInstall(false)
  if (screen === 'home') document.title = homeTitle()
})

const install = async () => {
  if (!deferredPrompt) return
  offerInstall(false)
  await deferredPrompt.prompt()
  deferredPrompt = null
}
installButton.addEventListener('click', install)
$('#menu-install').addEventListener('click', fromMenu(install))

/**
 * Asks for storage the browser will not evict under pressure: the shell, whatever the chunk store
 * has extracted, and the copies the list of recent files keeps. Chrome grants it to an installed
 * app without a prompt. Asked once
 * installed, not on every visit to the page, because a site in a tab has not earned it.
 */
// Refused, or not asked for by this browser, reads as not persisted; there is nothing to do about it here.
const persist = () => navigator.storage?.persist?.().catch(() => false)

window.addEventListener('appinstalled', () => {
  offerInstall(false)
  void persist()
})
if (installed.matches) void persist()
