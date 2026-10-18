/**
 * Runs inside the frame. It boots h5p-standalone against the virtual file server, forwards xAPI
 * to the element and relays the worker's job requests — the Service Worker can only message a
 * client, and the element is the one that owns the Jobs worker.
 *
 * Built by `scripts/build.mjs` to `dist/frame-boot.js`, a classic script the player's Service
 * Worker names with `<script nonce src>` in the document it synthesizes (`frame-document.ts` in
 * the player). The configuration comes from a JSON block in that document, `#h5p-boot-config`,
 * so the script is the same bytes for every package. That block, and the messages posted to the
 * parent, are the contract between the two packages: a change to either here is a change to the
 * player's `frame-document.ts` and `h5p-offline-player.ts` with it.
 *
 * It lives in this package, under the GPL with the core, rather than in the MIT player, because
 * it is the one script that runs in the H5P document and calls the core's API directly.
 */

import { checkContent, checkContentMetadata, libraryKey, librariesIn, parseLibrary, type LibraryName, type SemanticField } from './content-check'
import { upgradeContent, type ServedLibrary, type UpgradeSource, type UpgradeTable } from './content-upgrade'
import { isResult } from './finished'
import { coreTranslations } from './l10n'

/** How long a read of one of the package's JSON files may take before it counts as failed. */
var LIBRARY_READ_TIMEOUT_MS = 20000;

/** A fetch that gives up after `LIBRARY_READ_TIMEOUT_MS`, where the browser can be told to. */
var boundedFetch = function (url: string): Promise<Response> {
  var signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(LIBRARY_READ_TIMEOUT_MS) : undefined;
  return fetch(url, { signal: signal });
};

/** An error's message, or the thing thrown when it is not an error. */
var errorText = function (error: unknown): string {
  return String((error && (error as Error).message) || error);
};

/** The one content h5p-standalone registered with the runtime, once it has. */
var registeredContent = function () {
  var contents = window.H5PIntegration && window.H5PIntegration.contents;
  var key = contents ? Object.keys(contents)[0] : undefined;
  return contents && key ? contents[key] : undefined;
};

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
  /** The library folders, reachable from this package, that carry an `upgrades.js`. Absent from a worker older than the list. */
  upgrades?: string[]
  /**
   * The element's language, which H5P's own strings follow, when the worker named `l10n.js`. Not
   * the document's `lang`: that is the content's, as H5P writes it.
   */
  language?: string
  /**
   * Played as data: the package's own code is withheld, and this script checks its content against
   * the semantics of the libraries served before the runtime reads it. Absent from a worker older
   * than the check, which never plays a package so.
   */
  untrusted?: boolean
}

/**
 * The header the content is asked for with when it is to be checked. The worker serves an
 * untrusted package's `content.json` only to a request that carries it, so a boot script older
 * than the check — which would play the content as written — gets no content at all.
 */
var CONTENT_CHECK_HEADER = 'X-H5P-Content-Check';

/** The one content h5p-standalone puts in `H5PIntegration.contents`, as far as the upgrade touches it. */
interface IntegrationContent {
  library: string
  jsonContent: string
  metadata?: unknown
  /** The content's folder, `<virtual root>/content`, as h5p-standalone sets it. */
  contentUrl?: string
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
      getContentPath?: (contentId: unknown) => string
      /** The top-level instance of each content `H5P.init` created. */
      instances?: unknown[]
      trigger?: (instance: unknown, eventType: string) => void
    }
    H5PIntegration?: { saveFreq?: number | false; contents?: Record<string, IntegrationContent> }
    H5PUpgrades?: Record<string, UpgradeTable | undefined>
    /** Left by `l10n.js`, which the frame document names before this script unless its language is English. */
    H5PRuntimeL10n?: unknown
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
  // first, and it comes from the element. Read with care: h5p-standalone's flag is inverted —
  // undefined or truthy, and it calls `H5P.init()` itself; `false`, and it leaves it to us.
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

// h5p-standalone fetches `h5p.json`, each `library.json` and `content.json` with these.
if (config.untrusted) {
  options.assetsRequestFetchOptions = { credentials: 'same-origin', headers: { [CONTENT_CHECK_HEADER]: 'semantics' } };
}

// The package's own account of itself. h5p-standalone takes `metadata` as an option and, given
// none, makes one up — `{ title, license: 'U' }`, "Undisclosed" — for every package, whatever
// its manifest says; the runtime then hides the copyright button, and names no activity in the
// statements' object. The worker read it off `h5p.json`.
if (config.title) options.title = config.title;
if (config.metadata) options.metadata = config.metadata;

// The core's own strings in the element's language, when this package has them: the worker names
// `l10n.js` ahead of this script for any language but English, and the strings for the language
// the configuration names are picked from it. h5p-standalone lays `translations` over its English
// defaults key by key, so a string a language lacks stays English, and it does so before the
// core's ready handler builds the licence names from them.
var translations = coreTranslations(window.H5PRuntimeL10n, config.language);
if (translations) options.translations = translations;

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

/**
 * Where the upgrade learns what runs. A library's `library.json`, asked for under the version the
 * content names, says which version answered: the worker serves a newer minor when the exact one
 * is absent, and the bare folder name is tried after the versioned one, as h5p-standalone does.
 * Its `upgrades.js` is fetched only from a folder the worker listed, so nothing is asked for that
 * is not there; a worker from before the list gets asked anyway, and a 404 then means no steps.
 */
var librarySource = function (base: string, listed: string[] | undefined): UpgradeSource & { semantics(folder: string): Promise<SemanticField[] | null> } {
  var served: Record<string, Promise<ServedLibrary | null>> = {};
  var steps: Record<string, Promise<UpgradeTable | null>> = {};
  var semantics: Record<string, Promise<SemanticField[] | null>> = {};

  var readLibrary = function (folder: string, machineName: string): Promise<ServedLibrary | null> {
    // Bounded, and a read that runs out fails the upgrade rather than passing for "not served":
    // on a host without `Range` a miss waits until the download proves the entry absent, and a
    // library the content names but nothing carries would hold the boot back that long.
    return boundedFetch(base + '/' + folder + '/library.json')
      .then(function (response) {
        // Not JSON is not a library; the runtime fails on it in its own way.
        return response.ok ? response.json().catch(function () { return null; }) : null;
      })
      .then(function (library: { machineName?: unknown; majorVersion?: unknown; minorVersion?: unknown } | null) {
        if (!library || library.machineName !== machineName) return null;
        var major = Number(library.majorVersion);
        var minor = Number(library.minorVersion);
        if (!Number.isInteger(major) || !Number.isInteger(minor)) return null;
        // A versioned name is answered from the folder of the version served, which is where its
        // `upgrades.js` is; a bare one is a folder of its own.
        return { major: major, minor: minor, folder: folder === machineName ? folder : machineName + '-' + major + '.' + minor };
      });
  };

  return {
    semantics: function (folder: string): Promise<SemanticField[] | null> {
      if (!semantics[folder]) {
        // Bounded like a library.json, and nothing, rather than an error, for one that is not
        // there: the check removes sub-content it cannot check, and refuses a main library.
        semantics[folder] = boundedFetch(base + '/' + folder + '/semantics.json')
          .then(function (response) { return response.ok ? response.json() : null; })
          .then(function (fields: unknown) { return Array.isArray(fields) ? (fields as SemanticField[]) : null; })
          .catch(function () { return null; });
      }
      return semantics[folder];
    },
    served: function (machineName, wanted) {
      var versioned = machineName + '-' + wanted.major + '.' + wanted.minor;
      if (!served[versioned]) {
        served[versioned] = readLibrary(versioned, machineName).then(function (found) {
          return found || readLibrary(machineName, machineName);
        });
      }
      return served[versioned];
    },
    steps: function (machineName, library) {
      if (listed && listed.indexOf(library.folder) < 0) return Promise.resolve(null);
      var url = base + '/' + library.folder + '/upgrades.js';
      if (!steps[url]) {
        steps[url] = boundedFetch(url).then(function (response) {
          if (!response.ok) {
            if (listed) throw new Error('could not load ' + library.folder + '/upgrades.js (' + response.status + ')');
            return null;
          }
          return response.text().then(function (code) {
            // Evaluated, not added as a script: the platforms' upgrade worker loads these with
            // `importScripts` inside a try, so one that throws as it loads fails the upgrade
            // rather than the content. An uncaught error here would reach the listener below,
            // which reports it as the boot failing. The script declares `H5PUpgrades` itself as
            // a rule; one that only assigns to it still finds it.
            window.H5PUpgrades = window.H5PUpgrades || {};
            (0, eval)(code + '\n//# sourceURL=' + url);
            return window.H5PUpgrades[machineName] || null;
          });
        });
      }
      return steps[url];
    }
  };
};

/** Where the upgrade and the check learn what is served, shared so a library is asked for once. */
var libraries = librarySource(config.h5pJsonPath, config.upgrades);

interface Manifest {
  mainLibrary?: unknown
  preloadedDependencies?: { machineName?: unknown; majorVersion?: unknown; minorVersion?: unknown }[]
}

var manifestRead: Promise<Manifest> | undefined;
var readManifest = function (): Promise<Manifest> {
  if (!manifestRead) manifestRead = fetch(config.h5pJsonPath + '/h5p.json').then(function (response) { return response.json(); });
  return manifestRead;
};

/**
 * The main library as the content was written for it, from `h5p.json`: its name held to the shape
 * a library string has, since it goes into URLs and a source name. `null` for a manifest without one.
 */
var writtenFor = function (manifest: Manifest): LibraryName | null {
  var main = (manifest.preloadedDependencies || []).filter(function (each) { return each.machineName === manifest.mainLibrary; })[0];
  if (!main || typeof main.machineName !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(main.machineName)) return null;
  var major = Number(main.majorVersion);
  var minor = Number(main.minorVersion);
  if (!Number.isInteger(major) || !Number.isInteger(minor)) return null;
  return { machineName: main.machineName, major: major, minor: minor };
};

/**
 * Brings the content's parameters up to the library versions served, before the runtime reads
 * them, the way the platforms upgrade content when they install a newer minor. A failure leaves
 * them as written, which is how every package played before this ran, and says so in the console.
 */
var upgradeToServed = function (): Promise<void> {
  // `const`, so the check below still holds inside the callbacks that follow.
  const content = registeredContent();
  if (!content) return Promise.resolve();

  return readManifest()
    .then(function (manifest) {
      // The version the content was written for. The one `H5PIntegration` names is the version
      // served, read off the library.json that answered.
      var main = writtenFor(manifest);
      if (!main) return;

      // Copies, both: a step may change what it is handed in place before a later one fails, and
      // a failure has to leave the content exactly as written.
      return upgradeContent(
        { machineName: main.machineName, version: { major: main.major, minor: main.minor } },
        JSON.parse(content.jsonContent),
        content.metadata === undefined ? undefined : JSON.parse(JSON.stringify(content.metadata)),
        libraries
      ).then(function (result) {
        // In full. h5p-standalone builds the name from library.json and leaves out a major or a
        // minor that is 0 — "H5P.Accordion 1" — which the core turns into the folder
        // `H5P.Accordion-1.undefined`, the category every statement then carries.
        if (result.library) content.library = result.library;
        if (result.changed) {
          content.jsonContent = JSON.stringify(result.params);
          if (result.metadata) content.metadata = result.metadata;
        }
      });
    })
    .catch(function (error: unknown) {
      console.error('<h5p-player>: the content could not be brought up to the library versions served, and plays as written:', error);
    });
};

/**
 * For a package played `untrusted`: its content checked against the semantics of the libraries
 * served, as the H5P platforms check an author's content before showing it (`content-check.ts`).
 * After the upgrade, so the parameters are the shape the served versions' semantics describe, and
 * before `H5P.init`, which is the first thing to read them. Content that cannot be checked does not
 * play: the main library's semantics are required, and sub-content without any is removed.
 */
var checkUntrusted = function (): Promise<void> {
  if (!config.untrusted) return Promise.resolve();
  // `const`, so the check below still holds inside the callbacks that follow.
  const content = registeredContent();
  if (!content) return Promise.reject(new Error('the runtime holds no content to check'));

  return readManifest()
    .then(function (manifest) {
      var main = writtenFor(manifest);
      if (!main) throw new Error('h5p.json names no main library');
      return libraries.served(main.machineName, { major: main.major, minor: main.minor }).then(function (served) {
        if (!served) throw new Error('the library sources do not serve ' + main!.machineName);
        var library = main!.machineName + ' ' + served.major + '.' + served.minor;
        var params: unknown = JSON.parse(content.jsonContent);
        var wanted = [parseLibrary(library)!].concat(librariesIn(params));
        return Promise.all(
          wanted.map(function (name) {
            return libraries.served(name.machineName, { major: name.major, minor: name.minor }).then(function (found) {
              return found ? libraries.semantics(found.folder) : null;
            }).then(function (fields) { return [libraryKey(name), fields] as const; });
          })
        ).then(function (entries) {
          var checked = checkContent(library, params, new Map(entries));
          var metadata = checkContentMetadata(content.metadata);
          content.jsonContent = JSON.stringify(checked.params);
          content.metadata = metadata.metadata;
          content.library = library;
          var messages = checked.messages.concat(metadata.messages);
          if (messages.length) {
            console.warn("<h5p-player>: the content was checked against its libraries' semantics, as the H5P platforms check it, and changed:\n- " + messages.join('\n- '));
          }
        });
      });
    })
    .catch(function (error: unknown) {
      throw new Error("The content could not be checked against its libraries' semantics, so it does not play untrusted: " + errorText(error));
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
  // The scripts are in and the content's parameters are in `H5PIntegration`, not yet read.
  .then(upgradeToServed)
  .then(checkUntrusted)
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
    // The core builds a content's folder as `H5PIntegration.url + '/content/' + id`, as on a
    // site, where `url` is the site's H5P folder; h5p-standalone sets `url` to the content id,
    // so the path pointed nowhere. Its own `H5P.getPath` reads the content's `contentUrl` first,
    // which h5p-standalone does set, and so does this. IFrame Embedder is the one content type
    // that asks, for a page the package carries — which, played untrusted, is not served.
    var getContentPath = H5P.getContentPath;
    if (typeof getContentPath === 'function') {
      H5P.getContentPath = function (contentId) {
        var contents = window.H5PIntegration && window.H5PIntegration.contents;
        var content = contents && contents['cid-' + contentId];
        return content && content.contentUrl ? content.contentUrl : getContentPath!.call(H5P, contentId);
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
        // H5P's own rule for a result: `completed` or `answered`, from the content itself.
        if (isResult(statement)) {
          post({ type: 'finished', statement: statement });
        }
      });
    }
    // Sizing is H5P's own: it talks the resizer protocol to the element over postMessage,
    // driven by the resize events content types raise when they actually change. Watching the
    // DOM from here would miss those and fire on changes that are not resizes.
    //
    // A font arriving is the one change no content raises one for. The frame's faces load once
    // text asks for them, and H5P's first measurement can run before they have: text laid out
    // in the fallback face wraps differently in its own, and the frame kept the earlier height
    // with the overflow hidden. In Chrome a Column of text played after another package lost
    // its bottom 47 px, its action bar, every time. So once the faces in flight have arrived,
    // every instance is asked to resize, and H5P measures and reports as it always does. On
    // `loading` rather than `loadingdone`, which WebKit never fires, and two frames after
    // `ready`, which WebKit resolves before its layout has taken the face.
    var fonts = document.fonts;
    if (fonts && typeof H5P.trigger === 'function') {
      var afterFonts = function () {
        fonts.ready.then(function () {
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              (H5P.instances || []).forEach(function (instance) {
                H5P.trigger!(instance, 'resize');
              });
            });
          });
        });
      };
      fonts.addEventListener('loading', afterFonts);
      if (fonts.status === 'loading') afterFonts();
    }
    post({ type: 'ready' });
  })
  .catch(function (error: unknown) {
    post({ type: 'error', message: errorText(error) });
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
