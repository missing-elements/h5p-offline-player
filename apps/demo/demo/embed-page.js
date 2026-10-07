/**
 * The embeddable player page, `/embed`: the element alone, driven by the query string, for a
 * site that cannot host a file of its own and puts this page in an iframe.
 *
 *   /embed?src=<package url>[&libraries=hub|<url>][&preload=auto][&xapi=<parent origin>]
 *         [&frame][&copyright][&export][&icon][&reporting][&fullscreen=off]
 *         [&activity-id=<IRI>][&custom-css=<stylesheet url>]
 *
 * Upward it speaks H5P's own resizer protocol — the `hello` / `resize` exchange that h5p.org's
 * embed code and its `h5p-resizer.js` use — so a page that already resizes h5p.org iframes
 * resizes this one without a change, and any other page gets `/resizer.js` from this origin. xAPI statements are relayed to the parent only when `xapi=`
 * names the parent's origin, and they are posted to that origin only.
 */

const params = new URLSearchParams(location.search)
const player = document.querySelector('h5p-player')
const notice = document.querySelector('#notice')
const loader = document.querySelector('#loader')
const framed = window.parent !== window

/* ------------------------------------------------------------------ notices */

const say = (text, kind = '', link = null) => {
  notice.replaceChildren()
  if (text) {
    notice.append(text)
    if (link) {
      const anchor = document.createElement('a')
      anchor.href = link.href
      anchor.target = '_top'
      anchor.rel = 'noopener'
      anchor.textContent = link.text
      notice.append(' ', anchor, '.')
    }
  }
  notice.className = `notice ${kind}`.trim()
  notice.hidden = !text
  requestAnimationFrame(announce)
}

/* ------------------------------------------------------------------ sizing, upward */

/** The parent hears about the height in the shape h5p-resizer.js expects. Nothing in it is secret. */
const post = (message, target = '*') => {
  if (framed) window.parent.postMessage(message, target)
}

// The body's own height rather than the document's scrollHeight: the latter can never report
// less than the frame, so a shrink would never be seen.
const contentHeight = () => Math.ceil(document.body.getBoundingClientRect().height)

const announce = () => post({ context: 'h5p', action: 'resize', scrollHeight: contentHeight() })

window.addEventListener('message', (event) => {
  if (event.source !== window.parent || !event.data || event.data.context !== 'h5p') return
  switch (event.data.action) {
    case 'ready':
      // h5p-resizer.js announces itself once it is on the page; it expects a `hello` back.
      post({ context: 'h5p', action: 'hello' })
      break
    case 'hello':
      announce()
      break
    case 'resizePrepared':
      announce()
      break
  }
})

post({ context: 'h5p', action: 'hello' })

// The element dispatches `resize` before it applies the height to itself; measure after layout.
player.addEventListener('resize', () => requestAnimationFrame(announce))
player.addEventListener('ready', () => requestAnimationFrame(announce))

/* ------------------------------------------------------------------ xAPI, relayed on request */

/** An origin, or nothing: the parameter has to be exactly what `event.origin` will read. */
const originOf = (value) => {
  if (!value) return null
  try {
    const origin = new URL(value).origin
    return origin !== 'null' && origin === value.replace(/\/$/, '') ? origin : null
  } catch {
    return null
  }
}

const relayTo = originOf(params.get('xapi'))
if (relayTo && framed) {
  for (const type of ['xapi', 'finished']) {
    player.addEventListener(type, (event) => {
      post({ context: 'h5p-offline-player', action: type, ...event.detail }, relayTo)
    })
  }
}

/* ------------------------------------------------------------------ errors, and Safari */

player.addEventListener('error', (event) => {
  const { code, message } = event.detail
  if (code === 'no-worker' && framed) {
    // Detected, not sniffed: a browser, an in-app one or a page that is not https may give a frame
    // no Service Worker, and the player cannot run without one. Safari does allow it, as of 26.
    say("This browser does not run the player inside another site's page.", 'error', {
      href: location.href,
      text: 'Open it on its own'
    })
    return
  }
  // Once the content is up, a runtime error inside it is the content's business: it keeps
  // running, and a red notice over a working video would say otherwise.
  if (code === 'runtime' && player.state === 'ready') {
    console.warn(`h5p-player: the content reported an error and kept running: ${message}`)
    return
  }
  say(message || code, 'error')
})

player.addEventListener('statechange', (event) => {
  const { state } = event.detail
  if (state !== 'error') say('')
  // Shown from the HTML on, until the content is up or the load has failed.
  loader.hidden = state === 'ready' || state === 'error' || state === 'idle'
  requestAnimationFrame(announce)
})

/* ------------------------------------------------------------------ load */

/**
 * The host of a package on another site, or `null` for this site's own and for what is not a URL.
 * A package's scripts run with the storage of the origin it plays on. In another site's frame
 * that storage is partitioned by the embedding site, so a page can only ever reach what was played
 * under its own embed; opened on its own, or framed by a page of this site, `/embed` shares this
 * origin's storage with the player page and the app, and a link to it waits for a click, as
 * theirs do.
 */
const foreignHost = (value) => {
  try {
    const url = new URL(value, location.href)
    // A `data:` URL has no host and an opaque origin: name its scheme, so it still waits.
    return url.origin === location.origin ? null : url.host || url.protocol
  } catch {
    return null
  }
}

/**
 * The element's display options, by their attribute names, for the embedding page to ask for:
 * `&frame&copyright&export` shows H5P's action bar with those buttons, `&fullscreen=off` takes
 * that one away, `&activity-id=` names the statements' object and `&custom-css=` restyles the
 * content to the embedding site's taste. Not `custom-js`, `embed-code` or `user`: a script is a
 * capability on this origin that a link should not hand out, the embed is the embed, and a
 * learner's name has no place in a URL.
 */
const applyOptions = () => {
  for (const name of ['frame', 'copyright', 'export', 'icon', 'reporting']) {
    if (params.has(name) && params.get(name) !== 'off') player.setAttribute(name, '')
  }
  if (params.get('fullscreen') === 'off') player.setAttribute('fullscreen', 'off')
  for (const name of ['activity-id', 'custom-css']) {
    const value = params.get(name)?.trim()
    if (value) player.setAttribute(name, value)
  }
}

const start = (value) => {
  const libraries = params.get('libraries')?.trim()
  if (libraries) player.setAttribute('libraries', libraries)
  if (params.get('preload') === 'auto') player.setAttribute('preload', 'auto')
  applyOptions()
  player.setAttribute('src', value)
}

/** Whether this document's storage is the demo origin's own: top level, or framed by this origin. */
const sharesOriginStorage = () => {
  if (!framed) return true
  try {
    return window.parent.location.origin === location.origin
  } catch {
    return false // Another origin's frame: reading its location throws, and the storage is partitioned.
  }
}

const src = params.get('src')?.trim()
const host = src && sharesOriginStorage() ? foreignHost(src) : null
if (!src) {
  loader.hidden = true
  say('No package given. Add ?src=<url of a .h5p file> to the address.', 'error')
} else if (host) {
  loader.hidden = true
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = 'Open the package'
  button.addEventListener('click', () => {
    say('')
    loader.hidden = false
    start(src)
  })
  say(
    `This link opens a package from ${host}. A package runs its own scripts on this site, and they ` +
      'can read what other packages saved in this browser. Open it only if you trust that site.'
  )
  notice.append(' ', button)
} else {
  start(src)
}
