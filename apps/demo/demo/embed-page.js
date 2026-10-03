/**
 * The embeddable player page, `/embed`: the element alone, driven by the query string, for a
 * site that cannot host a file of its own and puts this page in an iframe.
 *
 *   /embed?src=<package url>[&libraries=hub|<url>][&preload=auto][&xapi=<parent origin>]
 *
 * Upward it speaks H5P's own resizer protocol — the `hello` / `resize` exchange that h5p.org's
 * embed code and its `h5p-resizer.js` use — so a page that already resizes h5p.org iframes
 * resizes this one without a change. xAPI statements are relayed to the parent only when `xapi=`
 * names the parent's origin, and they are posted to that origin only.
 */

const params = new URLSearchParams(location.search)
const player = document.querySelector('h5p-player')
const notice = document.querySelector('#notice')
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
    // Detected, not sniffed: a cross-origin iframe in Safari gets no Service Worker, and the
    // player cannot run without one. The same page on its own works, so that is what the link is.
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
  if (event.detail.state !== 'error') say('')
})

/* ------------------------------------------------------------------ load */

const src = params.get('src')?.trim()
if (!src) {
  say('No package given. Add ?src=<url of a .h5p file> to the address.', 'error')
} else {
  const libraries = params.get('libraries')?.trim()
  if (libraries) player.setAttribute('libraries', libraries)
  if (params.get('preload') === 'auto') player.setAttribute('preload', 'auto')
  player.setAttribute('src', src)
}
