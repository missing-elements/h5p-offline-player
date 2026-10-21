/**
 * Runs inside the frame. It boots the H5P core against the virtual file server, forwards xAPI to
 * the element and relays the worker's job requests — the Service Worker can only message a client,
 * and the element is the one that owns the Jobs worker.
 *
 * Booting is what a site's H5P plugin does for its iframe: it writes the core's settings,
 * `H5PIntegration`, loads the core's scripts and stylesheets and then each library's, and calls
 * `H5P.init`. What to load comes from the worker's `boot` route, which has walked the libraries
 * (`LibraryLoad` in the player); until the core was vendored (#37) h5p-standalone did all of it
 * here, and the settings are built as it built them, field for field, so content sees no change.
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
// The core's own English strings, from `getLocalization()` at the vendored commit: the defaults a
// language's strings are laid over, and what a frame in English shows.
import ENGLISH from '../vendor/h5p-core/strings.json'

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

/** The one content this frame registers with the runtime, once it has. */
var registeredContent = function () {
  var contents = window.H5PIntegration && window.H5PIntegration.contents;
  var key = contents ? Object.keys(contents)[0] : undefined;
  return contents && key ? contents[key] : undefined;
};

interface BootConfig {
  pkgId: string
  /** The package's root on the virtual file server, without a trailing slash. */
  h5pJsonPath: string
  /**
   * The worker's `boot` route for this load, which answers what to load (`LibraryLoad`). Absent
   * from a worker of a player that pairs with runtime 0.2, which wrote the document for
   * h5p-standalone's loader.
   */
  boot?: string
  frameJs: string
  frameCss: string
  /** `h5p.json`'s title, and its licence, authors and the rest, in the shape `H5P.buildMetadataCopyrights` reads. */
  title?: string
  metadata?: Record<string, unknown>
  /** What the host asked for; the same shape as `FrameOptions` in shared/protocol.ts. */
  options?: FrameOptions
  /**
   * The frame's language, which H5P's own strings follow, when the worker named `l10n.js`: the
   * content's, as `h5p.json` names it, or the element's for a package that names none. The same
   * tag as the document's `lang`.
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

/** What the worker's `boot` route answers: `LibraryLoad` in the player's `shared/protocol.ts`. */
interface LibraryLoad {
  library: string
  scripts: string[]
  styles: string[]
  directories: Record<string, string>
  upgrades: string[]
}

/** The one content in `H5PIntegration.contents`, as far as this script touches it. */
interface IntegrationContent {
  library: string
  jsonContent: string
  metadata?: unknown
  /** The content's folder, `<virtual root>/content`. */
  contentUrl?: string
}

/** The core's settings, `H5PIntegration`, in the shape a site's H5P plugin writes them. */
interface Integration {
  baseUrl: string
  url: string
  urlLibraries: string
  libraryDirectories: Record<string, string>
  contents: Record<string, IntegrationContent & Record<string, unknown>>
  saveFreq: number | false
  postUserStatistics: boolean
  reportingIsEnabled: boolean
  ajax: Record<string, string>
  l10n: { H5P: Record<string, string> }
  core: { scripts: string[]; styles: string[] }
  user?: { name: string; mail: string }
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
    H5PIntegration?: Integration
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

// What the host asked for. A button whose target is missing stays off: an export button with no
// file to download and an embed button with no code to offer would both be broken buttons.
var custom: FrameOptions = config.options || {};
var flag = function (value: boolean | undefined, otherwise: boolean) {
  return typeof value === 'boolean' ? value : otherwise;
};

// The core's own strings in the frame's language, when this package has them: the worker names
// `l10n.js` ahead of this script for any language but English, and the strings for the language
// the configuration names are picked from it. They are laid over the core's English key by key,
// so a string a language lacks stays English, and before the core's ready handler builds the
// licence names from them.
var translations = coreTranslations(window.H5PRuntimeL10n, config.language);

/**
 * The core's settings for this one content, as a site's H5P plugin writes them and as
 * h5p-standalone wrote them here before the core was vendored. A random content id, as it gave.
 * `url` is the package's root rather than that id: the core joins it with `/content/<id>` only
 * where a content's own `contentUrl` is missing, and `H5P.getContentPath`, which joins it always,
 * is answered from `contentUrl` below.
 */
var integrationFor = function (load: LibraryLoad, jsonContent: string, preload: UserDataPreload | null): Integration {
  var contentId = Math.random().toString(36).substring(2, 9);
  var base = config.h5pJsonPath;
  var file = function (path: string) { return base + '/' + path; };
  var content: IntegrationContent & Record<string, unknown> = {
    library: load.library,
    title: config.title || '',
    // The statements' object id. The element sets the package URL unless the host named another;
    // a picked file has none, and keeps the package's root on the virtual server.
    url: custom.activityId || base,
    contentUrl: base + '/content',
    jsonContent: jsonContent,
    // The host's stylesheets and scripts after the libraries', so that they can override them.
    styles: load.styles.map(file).concat(custom.customCss || []),
    scripts: load.scripts.map(file).concat(custom.customJs || []),
    fullScreen: flag(custom.fullScreen, true),
    exportUrl: custom.downloadUrl,
    embedCode: custom.embedCode || '',
    resizeCode: (custom.embedCode && custom.resizeCode) || '',
    displayOptions: {
      frame: flag(custom.frame, false),
      copyright: flag(custom.copyright, false),
      icon: flag(custom.icon, false),
      export: Boolean(custom.downloadUrl) && flag(custom.export, false),
      embed: Boolean(custom.embedCode) && flag(custom.embed, false),
      copy: false
    },
    // The package's own account of itself, which the worker read off `h5p.json`; one that has
    // none is "Undisclosed", as a platform saves content without a licence.
    metadata: config.metadata || { title: config.title || '', license: 'U' }
  };
  var integration: Integration = {
    baseUrl: location.origin,
    url: base,
    urlLibraries: base,
    libraryDirectories: load.directories || {},
    contents: {},
    // A number, and the runtime hands the saved state to the content, asks it for its state that
    // often, and saves as the document goes away — that last handler it registers as its ready
    // handler runs, on the value it sees then, which is why the element is asked first.
    saveFreq: preload && resume && preload.saveInterval ? preload.saveInterval : false,
    // No result endpoint exists here. xAPI leaves as events; nothing is posted.
    postUserStatistics: false,
    reportingIsEnabled: flag(custom.reportingIsEnabled, false),
    ajax: {},
    l10n: { H5P: Object.assign({}, ENGLISH, translations ? translations.H5P : {}) },
    core: { scripts: [config.frameJs], styles: [config.frameCss] }
  };
  if (preload && preload.user) integration.user = preload.user;
  integration.contents['cid-' + contentId] = content;
  return integration;
};

/**
 * The content for the element the core initialises: a `.h5p-content` naming the content, in a
 * `.h5p-iframe` wrapper, as a plugin writes it for content embedded as a div rather than an inner
 * frame. Div, not iframe: with an inner frame the core writes the content into an `about:blank`
 * document, and whether such a child inherits this document's Service Worker controller differs
 * between browsers. With a div this document is the H5P document.
 */
var mountContent = function (integration: Integration) {
  var wrapper = document.createElement('div');
  wrapper.className = 'h5p-iframe';
  var content = document.createElement('div');
  content.className = 'h5p-content';
  content.setAttribute('data-content-id', Object.keys(integration.contents)[0].slice('cid-'.length));
  wrapper.appendChild(content);
  root.appendChild(wrapper);
};

/** Stylesheets, added in order and not waited for, each marked as the core's own. */
var addStyles = function (urls: string[]) {
  urls.forEach(function (url) {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.dataset.h5p = url;
    document.head.appendChild(link);
  });
};

/**
 * Scripts, run in order and waited for: not async, so the browser runs them as they were added
 * while it fetches them all at once. Each is marked, so the listener at the end of this file
 * reports one that does not load; until then nothing would end the wait.
 */
var addScripts = function (urls: string[]): Promise<void> {
  return Promise.all(
    urls.map(function (url) {
      var script = document.createElement('script');
      script.src = url;
      script.async = false;
      script.dataset.h5p = url;
      var loaded = new Promise<void>(function (resolve) {
        script.onload = function () { resolve(); };
      });
      document.head.appendChild(script);
      return loaded;
    })
  ).then(function () { return undefined; });
};

/** What to load, from the worker; its refusal, which names what is missing, as the error. */
var readLoad = function (): Promise<LibraryLoad> {
  return fetch(config.boot!).then(function (response) {
    if (response.ok) return response.json() as Promise<LibraryLoad>;
    return response.text().then(function (reason) {
      throw new Error(reason || 'The player could not say what to load (' + response.status + ')');
    });
  });
};

/**
 * The content's parameters, as the core takes them: a string. For a package played `untrusted`
 * asked for with `CONTENT_CHECK_HEADER`, without which the worker serves none.
 */
var readContent = function (): Promise<string> {
  var init: RequestInit = { credentials: 'same-origin' };
  if (config.untrusted) init.headers = { [CONTENT_CHECK_HEADER]: 'semantics' };
  return fetch(config.h5pJsonPath + '/content/content.json', init)
    .then(function (response) {
      if (!response.ok) throw new Error('content/content.json could not be read (' + response.status + ')');
      return response.json();
    })
    .then(function (params: unknown) { return JSON.stringify(params); });
};

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
 * is absent, and the bare folder name is tried after the versioned one, as the worker tries them.
 * Its `upgrades.js` is fetched only from a folder the worker listed, so nothing is asked for that
 * is not there.
 */
var librarySource = function (base: string, listed: string[]): UpgradeSource & { semantics(folder: string): Promise<SemanticField[] | null> } {
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
      if (listed.indexOf(library.folder) < 0) return Promise.resolve(null);
      var url = base + '/' + library.folder + '/upgrades.js';
      if (!steps[url]) {
        steps[url] = boundedFetch(url).then(function (response) {
          if (!response.ok) throw new Error('could not load ' + library.folder + '/upgrades.js (' + response.status + ')');
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

/**
 * Where the upgrade and the check learn what is served, shared so a library is asked for once; set
 * once the worker has said which folders carry an `upgrades.js`.
 */
var libraries: ReturnType<typeof librarySource>;

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
        // The version served, in full: a name that leaves out a major or a minor of 0 —
        // "H5P.Accordion 1", as h5p-standalone wrote it — the core turns into the folder
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

/**
 * The core and the content's libraries, in place: the settings written, the content's element
 * mounted, the stylesheets added and the scripts run, the core's first. `preventInit` is set
 * before the core loads, since its ready handler initialises everything unless told not to, and
 * the saved state has to be in place first.
 */
var bootCore = function (preload: UserDataPreload | null): Promise<void> {
  if (!config.boot) {
    return Promise.reject(new Error("The player's Service Worker is older than this runtime: it pairs with @missing-elements/h5p-runtime 0.2. Update the player, its element and h5p-sw.js together, to the release that names this runtime."));
  }
  return Promise.all([readLoad(), readContent()]).then(function (answers) {
    var load = answers[0];
    libraries = librarySource(config.h5pJsonPath, load.upgrades);
    var integration = integrationFor(load, answers[1], preload);
    window.H5PIntegration = integration;
    window.H5P = window.H5P || {};
    window.H5P.preventInit = true;
    mountContent(integration);
    var content = integration.contents[Object.keys(integration.contents)[0]];
    addStyles(integration.core.styles.concat(content.styles as string[]));
    return addScripts(integration.core.scripts.concat(content.scripts as string[]));
  });
};

askForUserData()
  .then(function (preload) {
    return bootCore(preload).then(function () {
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
    // fall after the scripts above have run. The handler builds `H5P.copyrightLicenses`, which
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
    // The core's own start, which `preventInit` held back.
    var H5P = window.H5P!;
    // `reportingIsEnabled` reaches a content type as `extras.isReportingEnabled` on h5p.com,
    // whose core sets it; this core never does, and of the hub's content types only Interactive
    // Book and Documentation Tool read the integration flag themselves. Question Set, Interactive
    // Video, Course Presentation and Game Map read the extras, so the top-level instance — the
    // one `H5P.init` creates, marked `standalone` — gets it here.
    if (window.H5PIntegration!.reportingIsEnabled && typeof H5P.newRunnable === 'function') {
      var newRunnable = H5P.newRunnable;
      H5P.newRunnable = function (library, contentId, attachTo, skipResize, extras) {
        if (extras && extras.standalone) extras.isReportingEnabled = true;
        return newRunnable.call(H5P, library, contentId, attachTo, skipResize, extras);
      };
    }
    // The core builds a content's folder as `H5PIntegration.url + '/content/' + id`, as on a
    // site, where `url` is the site's H5P folder and each content has a folder below it; here the
    // content is the package's own `content/`, one level below `url`. The core's own
    // `H5P.getPath` reads the content's `contentUrl` first, which is set above, and so does this.
    // IFrame Embedder is the one content type that asks, for a page the package carries — which,
    // played untrusted, is not served.
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
