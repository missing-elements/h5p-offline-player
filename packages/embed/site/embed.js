/*! @missing-elements/h5p-embed. MIT. */
/**
 * The embed page: the element alone, driven by the query string, for a site that puts a player
 * domain of its own in an iframe. `startEmbed()` runs it; the page's `main.js` calls it with what
 * `h5p-embed` was told when it wrote the site, and the demo's `/embed` with the demo's copy of the
 * library pack.
 *
 *   ?src=<package url>[&libraries=pack|hub|<url> …|none][&preload=auto][&xapi=<parent origin>]
 *    [&frame][&copyright][&export][&icon][&reporting][&fullscreen=off]
 *    [&activity-id=<IRI>][&custom-css=<stylesheet url>]
 *
 * Upward it speaks H5P's own resizer protocol — the `hello` / `resize` exchange that h5p.org's
 * embed code and its `h5p-resizer.js` use — so a page that already resizes h5p.org iframes
 * resizes this one without a change, and any other page gets `resizer.js` from this origin. xAPI
 * statements are relayed to the parent only when `xapi=` names the parent's origin, and they are
 * posted to that origin only. Once the content is up the page posts one `report` upward, and a
 * load that fails posts its `error` (see `report` below): what an embedding page that checks a
 * package — Embed My's preview — shows.
 */

/** Where `libraries=hub` fetches from: the one hub host that sends CORS headers (see the player). */
const HUB_ORIGIN = 'https://api.h5p.org'

/**
 * @param {object} [options]
 * @param {string | null} [options.librariesPack] the URL of a copy of `@missing-elements/h5p-libraries`
 *   on this site, which `libraries=pack` names; without one, `pack` means the hub where allowed
 * @param {string[] | null} [options.packages] the origins packages and library bundles may come
 *   from, besides this page's own; `null` plays any, asking first when the storage is this origin's
 * @param {string | null} [options.defaultLibraries] the `libraries` value for an address that has
 *   none — `pack`, `hub`, URLs, as the parameter — so a snippet without `&libraries=` still plays
 *   an export that carries no libraries; `&libraries=none` turns it off for one address
 * @param {object | null} [options.runtime] the `runtime` export of `@missing-elements/h5p-runtime`,
 *   for a page that bundles the element; without it the element looks for `frame-assets/` beside itself
 * @param {boolean} [options.askInOwnFrame] whether a package from another origin waits for a click
 *   when this page is framed by a page of its own origin, whose storage it shares. A site whose
 *   own preview frames the page for a package the visitor just chose passes `false`
 */
export function startEmbed({ librariesPack = null, packages = null, defaultLibraries = null, runtime = null, askInOwnFrame = true } = {}) {
  const params = new URLSearchParams(location.search)
  const player = document.querySelector('h5p-player')
  // Before `src`: the element resolves the runtime's files when a package is set.
  if (runtime) player.runtime = runtime
  const notice = document.querySelector('#notice')
  const loader = document.querySelector('#loader')
  const framed = window.parent !== window

  /* ---------------------------------------------------------------- notices */

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

  const refuse = (text, code = 'refused') => {
    loader.hidden = true
    say(text, 'error')
    post({ context: 'h5p-offline-player', action: 'error', code, message: text })
  }

  /* ---------------------------------------------------------------- sizing, upward */

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

  /* ---------------------------------------------------------------- the report, upward */

  /**
   * What the player learnt about the package, for the embedding page to show: whether the host
   * streamed it or made the browser download it whole (`source.type`), how big it is, what it
   * says it is (`metadata`), where libraries it did not carry came from (`libraryBundle`, `null`
   * when it carried its own), and how long it took here. Posted once, when the content is up:
   *
   *   { context: 'h5p-offline-player', action: 'report', source, metadata, libraryBundle, elapsedMs }
   *
   * and to any parent, like the heights: the parent named the package, and the manifest's strings
   * are the package's own to tell. A parent treats them as text. A load that fails before the
   * content is up posts `{ context: 'h5p-offline-player', action: 'error', code, message }`
   * instead, a refusal by this page included (`code: 'refused'`). The shapes are Embed My's,
   * whose preview is built from them.
   */
  let startedAt = 0

  player.addEventListener('ready', (event) => {
    const { source, metadata, libraryBundle } = event.detail
    post({
      context: 'h5p-offline-player',
      action: 'report',
      source: source && { type: source.type, size: source.size },
      metadata: metadata && {
        title: metadata.title,
        license: metadata.license,
        licenseVersion: metadata.licenseVersion,
        authors: metadata.authors?.map(({ name }) => name),
        mainLibrary: metadata.mainLibrary
      },
      libraryBundle,
      elapsedMs: Math.round(performance.now() - startedAt)
    })
  })

  /* ---------------------------------------------------------------- xAPI, relayed on request */

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

  /* ---------------------------------------------------------------- errors, and Safari */

  player.addEventListener('error', (event) => {
    const { code, message } = event.detail
    if (code === 'no-worker' && framed) {
      // Detected, not sniffed: a browser, an in-app one or a page that is not https may give a
      // frame no Service Worker, and the player cannot run without one. Safari does allow it.
      say("This browser does not run the player inside another site's page.", 'error', {
        href: location.href,
        text: 'Open it on its own'
      })
      post({ context: 'h5p-offline-player', action: 'error', code, message })
      return
    }
    // Once the content is up, a runtime error inside it is the content's business: it keeps
    // running, and a red notice over a working video would say otherwise.
    if (code === 'runtime' && player.state === 'ready') {
      console.warn(`h5p-player: the content reported an error and kept running: ${message}`)
      return
    }
    say(message || code, 'error')
    post({ context: 'h5p-offline-player', action: 'error', code, message })
  })

  player.addEventListener('statechange', (event) => {
    const { state } = event.detail
    if (state !== 'error') say('')
    // Shown from the HTML on, until the content is up or the load has failed.
    loader.hidden = state === 'ready' || state === 'error' || state === 'idle'
    requestAnimationFrame(announce)
  })

  /* ---------------------------------------------------------------- which hosts */

  /** The origin of a URL as this page resolves it, or `null` for what is not one. */
  const urlOrigin = (value) => {
    try {
      const url = new URL(value, location.href)
      // A `data:` or `blob:` URL has an opaque origin: name its scheme, so it is never "ours".
      return url.origin === 'null' ? url.protocol : url.origin
    } catch {
      return null
    }
  }

  const allowed = packages ? new Set(packages) : null
  /** Whether this player was told it may fetch from `origin`. Always true without a list. */
  const permitted = (origin) => origin === location.origin || !allowed || allowed.has(origin)

  /**
   * The `libraries` value with `pack` resolved to this site's copy, or an error to show. With a
   * list of hosts, every bundle's origin has to be on it, the hub's included; the CSP that
   * `h5p-embed` wrote says the same, this only says it in words.
   */
  const librarySources = (value) => {
    const sources = []
    if (value === 'none') return { value: '' }
    for (const token of value.split(/\s+/).filter(Boolean)) {
      if (token === 'pack') {
        // The pack, with the hub behind it for what it lacks, where the hub may be reached: an
        // export without its libraries then plays with no request to h5p.org in the common case.
        // A site set up without the pack falls back to the hub alone, so a snippet written for
        // `pack` keeps playing after a rebuild with --no-libraries.
        if (librariesPack) sources.push(librariesPack)
        if (permitted(HUB_ORIGIN)) sources.push('hub')
        else if (!librariesPack) return { error: 'This player was set up without the library pack, so libraries=pack is not available here.' }
      } else if (token === 'hub') {
        if (!permitted(HUB_ORIGIN)) return { error: 'This player does not fetch libraries from the H5P hub.' }
        sources.push(token)
      } else {
        const origin = urlOrigin(token)
        if (!origin || !permitted(origin)) return { error: `This player does not fetch libraries from ${origin ?? token}.` }
        sources.push(token)
      }
    }
    return { value: [...new Set(sources)].join(' ') }
  }

  /**
   * The element's display options, by their attribute names, for the embedding page to ask for:
   * `&frame&copyright&export` shows H5P's action bar with those buttons, `&fullscreen=off` takes
   * that one away, `&activity-id=` names the statements' object and `&custom-css=` restyles the
   * content to the embedding site's taste. Not `custom-js`, `embed-code` or `user`: a script is
   * a capability on this origin that a link should not hand out, the embed is the embed, and a
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

  const start = (value, libraries) => {
    if (libraries) player.setAttribute('libraries', libraries)
    if (params.get('preload') === 'auto') player.setAttribute('preload', 'auto')
    applyOptions()
    startedAt = performance.now()
    player.setAttribute('src', value)
  }

  /**
   * Whether this document's storage is this origin's own: top level, or framed by this origin. A
   * package's scripts run with the storage of the origin it plays on. In another site's frame
   * that storage is partitioned by the embedding site, so a page can only ever reach what was
   * played under its own embed; opened on its own, a link to a package from elsewhere waits for
   * a click.
   */
  const sharesOriginStorage = () => {
    if (!framed) return true
    // Treated as another site's frame: the page around it chose this package, so no click.
    if (!askInOwnFrame) return false
    try {
      return window.parent.location.origin === location.origin
    } catch {
      return false // Another origin's frame: reading its location throws, and the storage is partitioned.
    }
  }

  /* ---------------------------------------------------------------- load */

  const src = params.get('src')?.trim()
  if (!src) {
    refuse('No package given. Add ?src=<url of a .h5p file> to the address.', 'no-src')
    return
  }
  const origin = urlOrigin(src)
  if (!origin) {
    refuse('The package address is not a URL.')
    return
  }
  if (!permitted(origin)) {
    refuse(`This player does not play packages from ${origin}.`)
    return
  }
  // The address's own value wins, `none` included; an address without one gets the page's default.
  const libraries = params.get('libraries')?.trim() || defaultLibraries?.trim()
  const sources = libraries ? librarySources(libraries) : { value: '' }
  if (sources.error) {
    refuse(sources.error)
    return
  }

  // A host on the list was vouched for when the site was set up; anything else from another
  // origin waits for a click when it would share this origin's storage.
  if (origin === location.origin || allowed || !sharesOriginStorage()) {
    start(src, sources.value)
    return
  }
  loader.hidden = true
  const host = new URL(src, location.href).host || origin
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = 'Open the package'
  button.addEventListener('click', () => {
    say('')
    loader.hidden = false
    start(src, sources.value)
  })
  say(
    `This link opens a package from ${host}. A package runs its own scripts on this site, and they ` +
      'can read what other packages saved in this browser. Open it only if you trust that site.'
  )
  notice.append(' ', button)
}
