/**
 * The page a preview's webview frames: the element, set as the preview's mode says, telling the
 * webview what it reached. It is told to the webview and nothing else — the first of the page's
 * ancestor origins — and the webview takes it only from this page's origin.
 * @param {object} settings
 * @param {string} settings.name the file's name
 * @param {string} settings.src the package's address on the server, a path
 * @param {string | null} settings.packBase where the server serves the library pack
 * @param {boolean} settings.untrusted
 * @param {boolean} settings.newest with the pack's newer libraries
 * @param {string | null} settings.lang for a package that names no language
 */
export function viewPage(settings) {
  // `<` as an escape, so that no file name can end the script block it is written into.
  const json = JSON.stringify(settings).replaceAll('<', '\\u003c')
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Preview</title>
    <script type="module" src="/h5p-player.js"></script>
    <style>
      body { margin: 0; background: #fff; }
      h5p-player { display: block; min-height: 240px; }
    </style>
  </head>
  <body>
    <h5p-player></h5p-player>
    <script type="application/json" id="settings">${json}</script>
    <script>
      const settings = JSON.parse(document.getElementById('settings').textContent)
      const player = document.querySelector('h5p-player')
      document.title = settings.name
      const webview = location.ancestorOrigins && location.ancestorOrigins.length > 0 ? location.ancestorOrigins[0] : null
      const tell = (message) => {
        if (webview) parent.postMessage({ source: 'h5p-preview', ...message }, webview)
      }

      // The library pack the extension carries, for what a package lacks and, unless turned off,
      // for newer versions of what it carries.
      player.setAttribute('libraries', 'pack')
      if (settings.packBase) player.setAttribute('pack-base', settings.packBase)
      if (!settings.newest) player.setAttribute('refresh-libraries', 'off')
      if (settings.lang) player.setAttribute('lang', settings.lang)
      // An attribute, as the rest: this runs before the module defines the element, and a property
      // set now would stay on it, in front of the element's own, which reads the attribute.
      if (settings.untrusted) player.setAttribute('untrusted', '')

      // The media VS Code does not play in full, as its kinds: \`mp4\` (the picture without sound),
      // \`webm\`, \`aac\` (M4A audio) and \`youtube\`, which do not play at all. Measured in VS Code 1.143
      // on macOS: its media stack opens no WebM and decodes no AAC, and YouTube's player never
      // starts, while it says yes to every type it is asked about. MP3 plays. Read from the content's
      // parameters, so a video on a slide or tab not yet shown counts.
      function unplayableMedia() {
        let contents = null
        try {
          const frame = player.shadowRoot && player.shadowRoot.querySelector('iframe')
          const integration = frame && frame.contentWindow && frame.contentWindow.H5PIntegration
          contents = integration && integration.contents
        } catch {}
        const kinds = new Set()
        const visit = (value) => {
          if (Array.isArray(value)) value.forEach(visit)
          else if (value && typeof value === 'object') {
            if (typeof value.path === 'string') {
              const path = value.path.replace(/[?#].*$/, '')
              const mime = typeof value.mime === 'string' ? value.mime.toLowerCase() : ''
              if (/^https?:\\/\\/([a-z0-9-]+\\.)?(youtube\\.com|youtube-nocookie\\.com|youtu\\.be)\\//i.test(path) || mime === 'video/youtube') kinds.add('youtube')
              else if (/\\.webm$/i.test(path) || /^(video|audio)\\/webm/.test(mime)) kinds.add('webm')
              else if (/\\.(m4a|aac)$/i.test(path) || /^audio\\/(mp4|aac|x-m4a)/.test(mime)) kinds.add('aac')
              else if (/\\.(mp4|m4v)$/i.test(path) || /^video\\/mp4/.test(mime)) kinds.add('mp4')
            }
            Object.values(value).forEach(visit)
          }
        }
        for (const content of Object.values(contents || {})) {
          try {
            visit(JSON.parse(content.jsonContent))
          } catch {}
        }
        return ['mp4', 'webm', 'aac', 'youtube'].filter((kind) => kinds.has(kind))
      }

      player.addEventListener('statechange', (event) => tell({ type: 'state', state: event.detail.state }))
      player.addEventListener('ready', (event) => {
        const { metadata, libraryBundle, downgradedLibraries } = event.detail
        tell({
          type: 'ready',
          title: (metadata && metadata.title) || null,
          mainLibrary: (metadata && metadata.mainLibrary) || null,
          // \`U\` is H5P's "Undisclosed", which says nothing.
          license: metadata && metadata.license && metadata.license !== 'U' ? [metadata.license, metadata.licenseVersion].filter(Boolean).join(' ') : null,
          refreshed: (libraryBundle && libraryBundle.refreshed) || [],
          // Made for a newer version than the pack the extension carries, and played at an older one.
          downgraded: downgradedLibraries || [],
          media: unplayableMedia(),
          // The attribute, which is what the element plays by.
          untrusted: player.hasAttribute('untrusted')
        })
      })
      player.addEventListener('error', (event) => {
        const { code, message, missingLibraries } = event.detail
        tell({
          type: 'error',
          code,
          message,
          // An error once the content is up leaves it running; before that, the package did not open.
          afterReady: player.state === 'ready',
          missing: missingLibraries ? missingLibraries.folders : [],
          carried: Boolean(missingLibraries && missingLibraries.carried)
        })
      })

      // Only a web address becomes \`src\`, parsed: never a \`javascript:\` or \`data:\` URL.
      try {
        const src = new URL(settings.src, window.location.href)
        if (src.protocol === 'http:' || src.protocol === 'https:') player.setAttribute('src', src.href)
        else tell({ type: 'error', code: 'bad-archive', message: 'Invalid preview source.', afterReady: false, missing: [], carried: false })
      } catch {
        tell({ type: 'error', code: 'bad-archive', message: 'Invalid preview source.', afterReady: false, missing: [], carried: false })
      }
    </script>
  </body>
</html>
`
}
