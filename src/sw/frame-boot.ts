/**
 * Runs inside the frame. It boots h5p-standalone against the virtual file server, forwards xAPI
 * to the element and relays the worker's job requests — the Service Worker can only message a
 * client, and the element is the one that owns the Jobs worker.
 *
 * This is not imported by anything: `frame-document.ts` gets it as a string, bundled and minified
 * by esbuild behind `virtual:h5p-frame-boot`, and inlines it in the document it synthesizes under
 * the per-response nonce. The configuration comes from a JSON block in the same document, so the
 * script itself is the same bytes for every package.
 */

interface BootConfig {
  pkgId: string
  h5pJsonPath: string
  frameJs: string
  frameCss: string
}

declare global {
  interface Window {
    H5PStandalone: { H5P: new (root: HTMLElement, options: object) => Promise<unknown> }
    H5P?: { externalDispatcher?: { on(name: string, handler: (event: { data?: { statement?: XapiStatement } }) => void): void } }
  }
}

interface XapiStatement {
  verb?: { id?: string }
}

const config = JSON.parse(document.getElementById('h5p-boot-config')!.textContent!) as BootConfig

// To this document's own origin, never '*'. The element's page is same-origin by construction
// (the worker script must be, and this frame lives under its scope), so nothing legitimate is
// lost — but package ids are derived from the URL and therefore guessable, and a third-party
// page that framed this URL directly would otherwise be handed every xAPI statement.
var post = function (message: object) {
  try { parent.postMessage(Object.assign({ channel: 'h5p-player', pkgId: config.pkgId }, message), location.origin); }
  catch (error) { /* a detached parent is not worth reporting */ }
};

// The worker cannot start a long job itself, so it asks this client and the element obliges.
if (navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener('message', function (event: MessageEvent) {
    var data = event.data;
    if (data && (data.type === 'need-job' || data.type === 'need-file')) {
      post({ type: 'relay', payload: data });
    }
  });
}

var root = document.getElementById('h5p-root')!;

var options = {
  h5pJsonPath: config.h5pJsonPath,
  frameJs: config.frameJs,
  frameCss: config.frameCss,
  // Div embedding, not the default iframe: with 'iframe' H5P core writes the content into an
  // inner about:blank frame, and whether such a child inherits this document's Service Worker
  // controller differs between browsers. With 'div' this document is the H5P document.
  embedType: 'div',
  frame: false,
  copyright: false,
  export: false,
  icon: false,
  fullScreen: true,
  // No result endpoints exist here. xAPI leaves as events; nothing is posted or stored.
  postUserStatistics: false,
  saveFreq: false
};

new window.H5PStandalone.H5P(root, options)
  .then(function () {
    var dispatcher = window.H5P && window.H5P.externalDispatcher;
    if (dispatcher) {
      dispatcher.on('xAPI', function (event) {
        var statement = event && event.data ? event.data.statement : undefined;
        var verb = statement && statement.verb ? statement.verb.id : undefined;
        post({ type: 'xapi', statement: statement, verb: verb });
        if (verb === 'http://adlnet.gov/expapi/verbs/completed') {
          post({ type: 'finished', statement: statement });
        }
      });
    }
    // Sizing is H5P's own: it talks the resizer protocol to the element over postMessage,
    // driven by the resize events content types raise when they actually change. Watching the
    // DOM from here would miss those and fire on changes that are not resizes.
    post({ type: 'ready' });
  })
  .catch(function (error: unknown) {
    post({ type: 'error', message: String((error && (error as Error).message) || error) });
  });

// Capture phase, because a resource that fails to load fires 'error' on its own element and
// never bubbles: the runtime's script loader waits on 'load' alone, so a library script the
// server could not deliver would otherwise leave the boot hanging without a word. Only the
// tags the runtime injected itself count (it marks them data-h5p); a content image that 404s,
// or an optional script a content type reaches for, is the content's business, not a failure
// of the player.
window.addEventListener('error', function (event: Event) {
  var target = event.target as (HTMLElement & { src?: string; href?: string }) | null;
  if (target && target !== (window as unknown)) {
    if (!(target.dataset && target.dataset.h5p)) return;
    var url = String(target.src || target.href || '').replace(location.origin, '');
    var root = String(config.h5pJsonPath).replace(location.origin, '') + '/';
    var shown = url.indexOf(root) === 0 ? url.slice(root.length) : url;
    post({ type: 'error', message: 'Could not load ' + shown });
    return;
  }
  post({ type: 'error', message: String((event as ErrorEvent).message || 'Script error in H5P content') });
}, true);

export {}
