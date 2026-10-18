/*! @missing-elements/h5p-embed. MIT. */
/**
 * The embed page: the element alone, driven by the query string, for a site that puts a player
 * domain of its own in an iframe. `startEmbed()` runs it; the page's `main.js` calls it with what
 * `h5p-embed` was told when it wrote the site, and the demo's `/embed` with the demo's copy of the
 * library pack.
 *
 *   ?src=<package url>[&libraries=pack|<url> …|none][&refresh-libraries=off][&preload=auto]
 *    [&xapi=<parent origin>][&frame][&copyright][&export][&icon][&reporting][&fullscreen=off]
 *    [&activity-id=<IRI>][&custom-css=<stylesheet url>][&lang=<language tag>]
 *
 * Upward it speaks H5P's own resizer protocol — the `hello` / `resize` exchange that h5p.org's
 * embed code and its `h5p-resizer.js` use — so a page that already resizes h5p.org iframes
 * resizes this one without a change, and any other page gets `resizer.js` from this origin. xAPI
 * statements are relayed to the parent only when `xapi=` names the parent's origin, and they are
 * posted to that origin only. Once the content is up the page posts one `report` upward, and a
 * load that fails posts its `error` (see `report` below): what an embedding page that checks a
 * package shows under its preview.
 */

/** Where the element's `libraries="pack"` fetches the library pack from, for a site without its own copy. */
const PACK_CDN_ORIGIN = 'https://cdn.jsdelivr.net'

/**
 * @param {object} [options]
 * @param {string | null} [options.packBase] the folder of this site's copy of the library pack's
 *   parts (`parts/` of `@missing-elements/h5p-libraries`), which `libraries=pack` plays from
 * @param {{ libraries: object[] } | null} [options.pack] the same, as the `pack` export a bundler
 *   resolves; it wins over `packBase`. Without either, `pack` is the element's copy on jsDelivr
 * @param {string | null} [options.librariesPack] the URL of a whole `libraries.h5p` on this site,
 *   for a page written before the pack was split: played as any bundle, with no refresh
 * @param {string[] | null} [options.packages] the origins packages and library bundles may come
 *   from, besides this page's own; `null` plays any, one from another origin `untrusted` when the
 *   storage is this origin's
 * @param {string | null} [options.defaultLibraries] the `libraries` value for an address that has
 *   none — `pack` or URLs, as the parameter — so a snippet without `&libraries=` still plays
 *   an export that carries no libraries; `&libraries=none` turns it off for one address
 * @param {object | null} [options.runtime] the `runtime` export of `@missing-elements/h5p-runtime`,
 *   for a page that bundles the element; without it the element looks for `frame-assets/` beside itself
 * @param {boolean} [options.askInOwnFrame] whether a package from another origin plays `untrusted`,
 *   with a click to play it with its own code when it needs that, when this page is framed by a
 *   page of its own origin, whose storage it shares. A site whose own preview frames the page for
 *   a package the visitor just chose passes `false`
 */
export function startEmbed({ packBase = null, pack = null, librariesPack = null, packages = null, defaultLibraries = null, runtime = null, askInOwnFrame = true } = {}) {
  const params = new URLSearchParams(location.search)
  const player = document.querySelector('h5p-player')
  // Before `src`: the element resolves the runtime's files, and reads where the pack is, when a
  // package is set.
  if (runtime) player.runtime = runtime
  if (pack) player.pack = pack
  else if (packBase) player.setAttribute('pack-base', packBase)
  const ownPack = Boolean(pack || packBase)
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

  /**
   * A message to the page that frames this one: the height in the shape h5p-resizer.js expects,
   * and `report`, `error` and `xapi` in this page's own. To any parent unless a target is named,
   * since nothing in the height is secret; the xAPI relay names the origin that opted in.
   */
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
   * instead, a refusal by this page included (`code: 'refused'`). The shapes are an interface:
   * a site that checks packages builds its preview from them, so they do not change.
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

  /** Asks whether to play an untrusted package with its own code; set when one is played so. */
  let askToTrust = null

  player.addEventListener('error', (event) => {
    const { code, message, missingLibraries } = event.detail
    // Played untrusted, it cannot do without its own copy of a library: a click decides.
    if (missingLibraries?.carried && player.untrusted && askToTrust) {
      askToTrust()
      return
    }
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
   * list of hosts, every bundle's origin has to be on it, jsDelivr's included when the pack comes
   * from there; the CSP that `h5p-embed` wrote says the same, this only says it in words.
   */
  const librarySources = (value) => {
    const sources = []
    if (value === 'none') return { value: '' }
    for (const token of value.split(/\s+/).filter(Boolean)) {
      if (token === 'pack') {
        // This site's copy of the pack, which the element was pointed at above; without one, the
        // element's own `pack`, the copy on jsDelivr, where that may be reached, so a snippet
        // written for `pack` keeps playing after a rebuild with --no-libraries.
        if (ownPack || (!librariesPack && permitted(PACK_CDN_ORIGIN))) sources.push('pack')
        else if (librariesPack) sources.push(librariesPack)
        else return { error: 'This player was set up without the library pack, so libraries=pack is not available here.' }
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
   * that one away, `&refresh-libraries=off` plays a package's own libraries even where the pack
   * has newer ones, `&activity-id=` names the statements' object and `&custom-css=` restyles the
   * content to the embedding site's taste. `&lang=` is the embedding page's language, which this
   * page cannot read across origins: H5P's own buttons and dialogs follow it. Not `custom-js`,
   * `embed-code` or `user`: a script is a capability on this origin that a link should not hand
   * out, the embed is the embed, and a learner's name has no place in a URL.
   */
  const applyOptions = () => {
    for (const name of ['frame', 'copyright', 'export', 'icon', 'reporting']) {
      if (params.has(name) && params.get(name) !== 'off') player.setAttribute(name, '')
    }
    if (params.get('fullscreen') === 'off') player.setAttribute('fullscreen', 'off')
    // The pack's newer versions of the libraries a package carries, unless the embedding page
    // needs the package exactly as exported.
    if (params.get('refresh-libraries') === 'off') player.setAttribute('refresh-libraries', 'off')
    for (const name of ['activity-id', 'custom-css']) {
      const value = params.get(name)?.trim()
      if (value) player.setAttribute(name, value)
    }
    const lang = params.get('lang')?.trim().replaceAll('_', '-')
    if (lang && /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(lang)) player.setAttribute('lang', lang)
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

  // A host on the list was vouched for when the site was set up, and in another site's frame the
  // storage is that site's own: those play as they are.
  if (origin === location.origin || allowed || !sharesOriginStorage()) {
    start(src, sources.value)
    return
  }

  // Anything else from another origin would share this origin's storage. It plays untrusted, as
  // data with the library pack's code and none of its own, and waits for a click that names the
  // host only when it cannot play without its own, or there is no pack to play it with.
  const host = new URL(src, location.href).host || origin
  askToTrust = () => {
    loader.hidden = true
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = 'Open with its own scripts'
    button.addEventListener('click', () => {
      say('')
      loader.hidden = false
      player.untrusted = false
      player.removeAttribute('src')
      start(src, sources.value)
    })
    say(
      `This package from ${host} plays only with its own scripts. They would run on this site and ` +
        'could read what other packages saved in this browser. Open it only if you trust that site.'
    )
    notice.append(' ', button)
  }
  // The address's `libraries=` is the link-writer's as much as its `src`, and a bundle's code runs
  // as the host's own: an untrusted package plays with this site's sources alone, the page's
  // default or its pack, and the address's only once the click has trusted it.
  const own = defaultLibraries?.trim() ? librarySources(defaultLibraries.trim()).value : ''
  const sitesSources = own || librarySources('pack').value
  if (!sitesSources) {
    askToTrust()
    return
  }
  player.untrusted = true
  start(src, sitesSources)
}
