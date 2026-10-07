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
  /** `h5p.json`'s title, and its licence, authors and the rest, in the shape `H5P.buildMetadataCopyrights` reads. */
  title?: string
  metadata?: Record<string, unknown>
  /** What the host asked for; the same shape as `FrameOptions` in shared/protocol.ts. */
  options?: FrameOptions
}

interface FrameOptions {
  frame?: boolean
  copyright?: boolean
  export?: boolean
  icon?: boolean
  embed?: boolean
  fullScreen?: boolean
  downloadUrl?: string
  embedCode?: string
  resizeCode?: string
  customCss?: string[]
  customJs?: string[]
  reportingIsEnabled?: boolean
  activityId?: string
}

interface UserDataEntry {
  dataType: string
  subContentId: string
  data: string | null
}

interface UserDataPreload {
  channel: 'h5p-player'
  type: 'user-data'
  session: string
  saveInterval: number
  entries: UserDataEntry[]
  user?: { name: string; mail: string }
}

type UserDataDone = (error?: unknown, data?: unknown) => void

declare global {
  interface Window {
    H5PStandalone: { H5P: new (root: HTMLElement, options: object) => Promise<unknown> }
    H5P?: {
      externalDispatcher?: { on(name: string, handler: (event: { data?: { statement?: XapiStatement } }) => void): void }
      init?: () => void
      preventInit?: boolean
      jQuery?: (target: Document) => { ready(handler: () => void): void }
      newRunnable?: (library: unknown, contentId: unknown, attachTo?: unknown, skipResize?: boolean, extras?: RunnableExtras) => unknown
      getUserData?: (contentId: unknown, dataType: string, done: UserDataDone, subContentId?: unknown) => void
      setUserData?: (contentId: unknown, dataType: string, data: unknown, options?: { subContentId?: unknown; errorCallback?: (error: unknown) => void }) => void
      deleteUserData?: (contentId: unknown, dataType: string, subContentId?: unknown) => void
    }
    H5PIntegration?: { saveFreq?: number | false }
  }
}

interface XapiStatement {
  verb?: { id?: string }
}

/** What `H5P.newRunnable` hands a content type's constructor as its third argument. */
interface RunnableExtras {
  standalone?: boolean
  isReportingEnabled?: boolean
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

var options: Record<string, unknown> = {
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
  // No result endpoint exists here. xAPI leaves as events; nothing is posted.
  postUserStatistics: false,
  // Off unless the element says otherwise below, before the runtime loads. A number, and the
  // runtime hands the saved state to the content, asks it for its state that often, and saves as
  // the document goes away — that last handler it registers as it loads, on the value it sees
  // then, which is why the element is asked first.
  saveFreq: false as number | false,
  // The runtime is initialised here, not by h5p-standalone: the saved state has to be in place
  // first, and it comes from the element.
  preventH5PInit: false
};

// What the host asked for, by h5p-standalone's names; the defaults above stand where it said
// nothing. A button whose target is missing stays off: an export button with no file to download
// and an embed button with no code to offer would both be broken buttons.
var custom: FrameOptions = config.options || {};
var flags = ['frame', 'copyright', 'icon', 'fullScreen', 'reportingIsEnabled'] as const;
for (var f = 0; f < flags.length; f++) {
  if (typeof custom[flags[f]] === 'boolean') options[flags[f]] = custom[flags[f]];
}
if (custom.downloadUrl) {
  options.downloadUrl = custom.downloadUrl;
  if (typeof custom.export === 'boolean') options.export = custom.export;
}
if (custom.embedCode) {
  options.embedCode = custom.embedCode;
  if (custom.resizeCode) options.resizeCode = custom.resizeCode;
  if (typeof custom.embed === 'boolean') options.embed = custom.embed;
}
if (custom.customCss && custom.customCss.length) options.customCss = custom.customCss;
if (custom.customJs && custom.customJs.length) options.customJs = custom.customJs;
if (custom.activityId) options.xAPIObjectIRI = custom.activityId;

// The package's own account of itself. h5p-standalone takes `metadata` as an option and, given
// none, makes one up — `{ title, license: 'U' }`, "Undisclosed" — for every package, whatever
// its manifest says; the runtime then hides the copyright button, and names no activity in the
// statements' object. The worker read it off `h5p.json`.
if (config.title) options.title = config.title;
if (config.metadata) options.metadata = config.metadata;

/**
 * Whether the element opened this frame with `resume`. In the URL rather than in the boot
 * configuration so that an element older than the worker, which never sets it, boots as before,
 * and a worker older than the element, whose boot script does not know it, ignores it.
 */
var resume = /[?&]resume=1(?:&|$)/.test(location.search);
/** Whether the element has a learner to name; the same reply carries it, so the frame asks for it the same way. */
var wantsUser = /[?&]user=1(?:&|$)/.test(location.search);

/**
 * The saved state lives with the element, which either keeps it on this device or takes it from
 * the host page; the runtime asks for it through `H5P.getUserData` and saves it through
 * `H5P.setUserData`. Those normally reach a site's `contentUserData` endpoint by AJAX, and refuse
 * to run at all without a signed-in `H5PIntegration.user` — which would also rewrite the actor of
 * every xAPI statement. So the three are replaced with versions that talk to the element instead,
 * keeping the semantics the runtime relies on: a value is handed over synchronously, a save goes
 * out only when it differs from the last, and `null` in a preload means "saved against another
 * build", which the runtime answers with its own "starting over" dialog.
 */
var installUserData = function (preload: UserDataPreload) {
  var H5P = window.H5P!;
  var known: Record<string, string | null> = {};
  for (var i = 0; i < preload.entries.length; i++) {
    var entry = preload.entries[i];
    known[entry.dataType + '/' + entry.subContentId] = entry.data;
  }
  var keyOf = function (dataType: string, subContentId: unknown) {
    return dataType + '/' + String(subContentId || 0);
  };
  var save = function (dataType: string, subContentId: unknown, data: string | null) {
    post({ type: 'user-data', session: preload.session, dataType: dataType, subContentId: String(subContentId || 0), data: data });
  };

  H5P.getUserData = function (_contentId, dataType, done, subContentId) {
    var value = known[keyOf(dataType, subContentId)];
    if (value === undefined) return done();
    if (value === null) return done(undefined, null);
    try { done(undefined, JSON.parse(value)); } catch (error) { done(error); }
  };
  H5P.setUserData = function (_contentId, dataType, data, userOptions) {
    var opts = userOptions || {};
    var json: string;
    try { json = JSON.stringify(data); } catch (error) { if (opts.errorCallback) opts.errorCallback(error); return; }
    var key = keyOf(dataType, opts.subContentId);
    if (json === known[key]) return;
    known[key] = json;
    save(dataType, opts.subContentId, json);
  };
  H5P.deleteUserData = function (_contentId, dataType, subContentId) {
    delete known[keyOf(dataType, subContentId)];
    save(dataType, subContentId, null);
  };
};

/** Asks the element for the saved state and waits for it; nothing to wait for without `resume`. */
var askForUserData = function (): Promise<UserDataPreload | null> {
  if (!resume && !wantsUser) return Promise.resolve(null);
  return new Promise(function (resolve) {
    var onMessage = function (event: MessageEvent) {
      var data = event.data as UserDataPreload | undefined;
      if (event.origin !== location.origin || event.source !== parent) return;
      if (!data || data.channel !== 'h5p-player' || data.type !== 'user-data') return;
      window.removeEventListener('message', onMessage);
      resolve(data);
    };
    window.addEventListener('message', onMessage);
    post({ type: 'need-user-data' });
  });
};

askForUserData()
  .then(function (preload) {
    if (preload && preload.user) options.user = preload.user;
    if (preload && resume) options.saveFreq = preload.saveInterval;
    return new window.H5PStandalone.H5P(root, options).then(function () {
      // Whenever the element answered, not only under `resume`: with a user set, the runtime
      // takes itself to be on a site and sends every user-data call to an AJAX URL that does not
      // exist here, and the boot died on it. Without `resume` the shim holds nothing and saves
      // reach an element that keeps none; the actor is what the user was for.
      if (preload) installUserData(preload);
    });
  })
  .then(function (): Promise<void> {
    // Behind the runtime's own ready handler, not merely after its scripts have loaded. The core
    // registers that handler as it loads and the frame's document is often still `interactive`
    // then — its own scripts and styles delay `load` — so jQuery runs it at `load`, which can
    // fall after h5p-standalone resolves. The handler builds `H5P.copyrightLicenses`, which
    // `H5P.init` reads for the copyright button of any package whose licence is not
    // "Undisclosed"; initialised before it, such a package died on `copyrightLicenses['MIT']`.
    // Queued behind it, the init below runs once it has; preventInit keeps it from initialising.
    var H5P = window.H5P!;
    return new Promise(function (resolve) {
      if (H5P.jQuery) H5P.jQuery(document).ready(function () { resolve(); });
      else resolve();
    });
  })
  .then(function () {
    // What h5p-standalone would have done itself but for `preventH5PInit`.
    var H5P = window.H5P!;
    // `reportingIsEnabled` reaches a content type as `extras.isReportingEnabled` on h5p.com,
    // whose core sets it; this core never does, and of the hub's content types only Interactive
    // Book and Documentation Tool read the integration flag themselves. Question Set, Interactive
    // Video, Course Presentation and Game Map read the extras, so the top-level instance — the
    // one `H5P.init` creates, marked `standalone` — gets it here.
    if (options.reportingIsEnabled && typeof H5P.newRunnable === 'function') {
      var newRunnable = H5P.newRunnable;
      H5P.newRunnable = function (library, contentId, attachTo, skipResize, extras) {
        if (extras && extras.standalone) extras.isReportingEnabled = true;
        return newRunnable.call(H5P, library, contentId, attachTo, skipResize, extras);
      };
    }
    if (typeof H5P.init === 'function') H5P.init();
    H5P.preventInit = false;

    var dispatcher = H5P.externalDispatcher;
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
