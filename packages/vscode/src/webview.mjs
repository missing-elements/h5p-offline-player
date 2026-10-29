/**
 * What a preview's webview is told when it is made.
 * @typedef {object} WebviewConfig
 * @property {string} origin the preview server's origin, which the frame loads from
 * @property {string} id the package's id on the server
 * @property {string} name the file's name
 * @property {boolean} untrusted the mode a new preview starts in
 * @property {boolean} newest with the pack's newer libraries
 * @property {boolean} restricted the workspace is in Restricted Mode: untrusted, and no switching
 * @property {string | null} lang VS Code's language, for a package that names none
 */

/**
 * The webview of a preview: a bar with what the package reached and the two switches, and the
 * frame that plays it. Everything inline, under a nonce; the frame may load from the server's
 * origin alone.
 *
 * Messages are taken from two places only. The frame's, by its window and the server's origin:
 * what the element reached — a state, `ready`, an error — which goes on to the extension, and
 * nothing else. The extension's, by the webview's own origin: reload, a change of trust or of the
 * settings. A package's own code runs in a frame below the page, on the server's origin. What it
 * posts itself is from neither place; played trusted, though, it shares the page's origin and can
 * post as the page, so the most it can do is misreport its own state.
 * @param {object} options
 * @param {string} options.nonce
 * @param {WebviewConfig} options.config
 */
export function webviewHtml({ nonce, config }) {
  const json = JSON.stringify(config).replaceAll('<', '\\u003c')
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${config.origin}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style nonce="${nonce}">
      html, body { height: 100%; }
      body {
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
      }
      header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 16px;
        padding: 6px 12px;
        border-bottom: 1px solid var(--vscode-panel-border, transparent);
      }
      #status { flex: 1 1 20em; min-width: 0; overflow-wrap: anywhere; }
      #status .detail { color: var(--vscode-descriptionForeground); }
      #status.error { color: var(--vscode-errorForeground); }
      #status .warning { color: var(--vscode-editorWarning-foreground); }
      .switches { display: inline-flex; gap: 16px; }
      label { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; cursor: pointer; }
      label:has(input:disabled) { cursor: default; opacity: 0.7; }
      input:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
      iframe { flex: 1; width: 100%; border: 0; background: #fff; }
    </style>
  </head>
  <body>
    <header>
      <span id="status" role="status">Opening…</span>
      <span class="switches">
        <label id="untrusted-label"><input type="checkbox" id="untrusted" /> Untrusted</label>
        <label title="Play the library pack's newer version of a library the package carries, as a site with the pack does."><input type="checkbox" id="newest" /> Newest libraries</label>
      </span>
    </header>
    <iframe id="frame" title="H5P content" allow="fullscreen; autoplay; microphone; camera"></iframe>
    <script type="application/json" id="config">${json}</script>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi()
      const config = JSON.parse(document.getElementById('config').textContent)
      const frame = document.getElementById('frame')
      const status = document.getElementById('status')
      const untrustedBox = document.getElementById('untrusted')
      const untrustedLabel = document.getElementById('untrusted-label')
      const newestBox = document.getElementById('newest')
      // A switch set in this preview outlives VS Code hiding and showing it again.
      const mode = Object.assign({ untrusted: config.untrusted, newest: config.newest }, vscode.getState())
      let ready = null

      function play() {
        if (config.restricted) mode.untrusted = true
        untrustedBox.checked = mode.untrusted
        untrustedBox.disabled = config.restricted
        untrustedLabel.title = config.restricted
          ? 'Restricted Mode plays every package untrusted. Trust this workspace to play a package with its own code.'
          : 'Play it as a site plays a package it did not make: none of its own code runs, its libraries come from the pack, and its content is checked.'
        newestBox.checked = mode.newest
        vscode.setState(mode)
        vscode.postMessage({ type: 'mode', untrusted: mode.untrusted, newest: mode.newest })
        const url = new URL('/view/' + config.id, config.origin)
        if (mode.untrusted) url.searchParams.set('untrusted', '1')
        if (!mode.newest) url.searchParams.set('newest', '0')
        if (config.lang) url.searchParams.set('lang', config.lang)
        ready = null
        say('Opening…')
        frame.src = url.href
      }

      function say(text, kind) {
        status.className = kind || ''
        status.title = ''
        status.replaceChildren(text)
      }

      function showReady(message) {
        ready = message
        const name = document.createElement('strong')
        name.textContent = message.title || config.name
        const parts = [message.mainLibrary, message.license, message.untrusted ? 'untrusted' : null]
        const libraries = (count) => (count === 1 ? 'one library' : count + ' libraries')
        const downgraded = message.downgraded || []
        if (message.refreshed.length > 0) parts.push(libraries(message.refreshed.length) + " at the pack's newer version")
        if (downgraded.length > 0) parts.push(libraries(downgraded.length) + ' older than the content')
        const detail = document.createElement('span')
        detail.className = 'detail'
        detail.textContent = parts.filter(Boolean).map((part) => ' · ' + part).join('')
        status.className = ''
        status.replaceChildren(name, detail)
        status.title = [
          ...message.refreshed.map((library) => library.library + ' ' + library.from + ' → ' + library.to),
          ...downgraded.map((library) => library.library + ' made for ' + library.from + ', played at ' + library.to)
        ].join('\\n')
      }

      function showError(message) {
        if (message.afterReady && ready) {
          // The content is up and goes on running: a note beside it, not a failure.
          const note = document.createElement('span')
          note.className = 'warning'
          note.textContent = ' · the content reported an error'
          note.title = message.message
          status.append(note)
          return
        }
        let hint = ''
        if (message.carried) {
          hint = config.restricted
            ? ' Its own copy of these libraries would play it: trust this workspace to let its code run.'
            : ' Its own copy of these libraries would play it: switch Untrusted off to let its code run.'
        } else if (message.code === 'no-worker') {
          hint = ' Open it in the browser instead.'
        }
        say(message.message + hint, 'error')
      }

      untrustedBox.addEventListener('change', () => {
        mode.untrusted = untrustedBox.checked
        play()
      })
      newestBox.addEventListener('change', () => {
        mode.newest = newestBox.checked
        play()
      })

      window.addEventListener('message', (event) => {
        if (event.source === frame.contentWindow) {
          const message = event.data
          if (event.origin !== config.origin || !message || message.source !== 'h5p-preview') return
          if (message.type === 'ready') showReady(message)
          else if (message.type === 'error') showError(message)
          else if (message.type === 'state') {
            if (message.state !== 'ready' && message.state !== 'error' && !ready) say('Opening…')
          }
          // Anything else is not the page's to say: a mode, a reload, the settings.
          else return
          vscode.postMessage(message)
          return
        }
        if (event.origin !== window.origin) return
        const message = event.data
        if (!message) return
        if (message.type === 'reload') play()
        else if (message.type === 'settings') {
          config.restricted = message.restricted
          mode.untrusted = message.untrusted
          mode.newest = message.newest
          play()
        }
      })

      play()
    </script>
  </body>
</html>
`
}
