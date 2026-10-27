import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import * as vscode from 'vscode'
import { previewPackage } from '../../verify/lib/preview.mjs'
import { startServer } from './server.mjs'
import { webviewHtml } from './webview.mjs'

/** @import { PreviewServer } from './server.mjs' */

/** The custom editor's view type, as `contributes.customEditors` names it. */
export const VIEW_TYPE = 'missingElements.h5pPreview'

/** How long a file has to stay unchanged before its previews play it again. */
const SETTLE_MS = 500

/**
 * What a preview reports: the page's message — `state`, `ready` or `error` — and the package's URI.
 * @typedef {{ uri: vscode.Uri, type: string, [key: string]: unknown }} PreviewState
 */

/**
 * One editor showing a package.
 * @typedef {object} Preview
 * @property {H5PDocument} document
 * @property {vscode.WebviewPanel} panel
 * @property {string | null} id the package's id on the server, once it is served
 * @property {{ untrusted: boolean, newest: boolean }} mode as the editor's switches stand
 */

/**
 * The mode a preview starts in: the settings, except that Restricted Mode plays everything
 * untrusted.
 */
function defaults() {
  const settings = vscode.workspace.getConfiguration('h5pPreview')
  const restricted = !vscode.workspace.isTrusted
  return {
    restricted,
    untrusted: restricted || settings.get('untrusted', false),
    newest: settings.get('newestLibraries', true)
  }
}

/**
 * A copy on this computer of a package that is not, from a remote or virtual workspace: the
 * server runs here, beside the webview, and reads from disk.
 * @param {vscode.Uri} uri
 */
async function localCopy(uri) {
  const folder = await mkdtemp(join(tmpdir(), 'h5p-preview-'))
  const file = join(folder, basename(uri.path))
  await writeFile(file, await vscode.workspace.fs.readFile(uri))
  return { folder, file }
}

/**
 * A `.h5p` open in one or more previews, and where the server reads it from.
 * @implements {vscode.CustomDocument}
 */
class H5PDocument {
  /**
   * @param {vscode.Uri} uri
   * @param {string} file
   * @param {string | null} folder the temporary folder of a copy, removed with the document
   */
  constructor(uri, file, folder) {
    this.uri = uri
    this.file = file
    this.folder = folder
    this.name = basename(uri.path)
    /** @type {vscode.Disposable[]} */
    this.disposables = []
  }

  dispose() {
    for (const disposable of this.disposables) disposable.dispose()
    if (this.folder) rm(this.folder, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * The previews of a window and the one server they share: started with the first, stopped with
 * the last.
 * @implements {vscode.CustomReadonlyEditorProvider<H5PDocument>}
 */
export class Previews {
  /** @param {vscode.ExtensionContext} context */
  constructor(context) {
    const assets = context.asAbsolutePath('assets')
    this.roots = { dist: join(assets, 'player'), runtime: join(assets, 'runtime') }
    this.packDir = join(assets, 'libraries')
    /** @type {Promise<PreviewServer> | null} */
    this.server = null
    /** @type {Set<Preview>} */
    this.previews = new Set()
    /** @type {Preview | null} */
    this.active = null
    /** Open in Browser's previews, by the function that ends each. @type {Set<() => void>} */
    this.browsers = new Set()
    /** @type {vscode.EventEmitter<PreviewState>} */
    this.states = new vscode.EventEmitter()
    this.onDidChangeState = this.states.event
  }

  /** @param {vscode.Uri} uri */
  async openCustomDocument(uri) {
    const copy = uri.scheme === 'file' ? null : await localCopy(uri)
    const document = new H5PDocument(uri, copy ? copy.file : uri.fsPath, copy ? copy.folder : null)
    // A package written again — by hand, by a build, by an agent — plays again once it has settled.
    // The folder is watched and the name compared: a name as the pattern is a glob, and brackets or
    // braces in it, `quiz [v2].h5p`, would match other names and never its own.
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.joinPath(uri, '..'), '*'))
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer
    /** @param {vscode.Uri} changedUri */
    const changed = (changedUri) => {
      if (basename(changedUri.path) !== document.name) return
      clearTimeout(timer)
      timer = setTimeout(async () => {
        if (document.folder) await writeFile(document.file, await vscode.workspace.fs.readFile(uri)).catch(() => {})
        for (const preview of this.previews) {
          if (preview.document === document) preview.panel.webview.postMessage({ type: 'reload' })
        }
      }, SETTLE_MS)
    }
    document.disposables.push(watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed), { dispose: () => clearTimeout(timer) })
    return document
  }

  /**
   * @param {H5PDocument} document
   * @param {vscode.WebviewPanel} panel
   */
  async resolveCustomEditor(document, panel) {
    const { restricted, untrusted, newest } = defaults()
    /** @type {Preview} */
    const preview = { document, panel, id: null, mode: { untrusted, newest } }
    // Counted before the server is waited for, so that no other preview's closing stops it meanwhile.
    this.previews.add(preview)
    this.active = preview
    let closed = false
    panel.onDidDispose(() => {
      closed = true
      this.previews.delete(preview)
      if (this.active === preview) this.active = null
      if (preview.id) this.server?.then((server) => preview.id && server.remove(preview.id))
      if (this.previews.size === 0) this.stopServer()
    })
    panel.onDidChangeViewState(() => {
      if (panel.active) this.active = preview
    })
    panel.webview.onDidReceiveMessage((message) => {
      if (!message || typeof message !== 'object') return
      // What the page reported, which the webview relays: a state, `ready` or an error. Never a mode,
      // whatever its type says: a package's own code can post as the page.
      if (message.source === 'h5p-preview') this.states.fire({ ...message, uri: document.uri })
      // The webview's own: its switches as they stand.
      else if (message.type === 'mode') preview.mode = { untrusted: Boolean(message.untrusted), newest: Boolean(message.newest) }
    })

    let server
    try {
      server = await this.serverReady()
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      vscode.window.showErrorMessage(`H5P Preview could not start its server: ${reason}`)
      return
    }
    if (closed) return
    preview.id = server.add(document.file, document.name, document.uri.toString())
    panel.webview.options = { enableScripts: true, localResourceRoots: [] }
    panel.webview.html = webviewHtml({
      nonce: randomBytes(16).toString('base64'),
      config: { origin: server.url, id: preview.id, name: document.name, untrusted, newest, restricted, lang: vscode.env.language }
    })
  }

  /** The server, started if no preview has it running. A failed start is not kept: the next preview tries again. */
  serverReady() {
    if (!this.server) {
      const starting = startServer({ roots: this.roots, packDir: this.packDir })
      this.server = starting
      starting.catch(() => {
        if (this.server === starting) this.server = null
      })
    }
    return this.server
  }

  stopServer() {
    const server = this.server
    this.server = null
    server?.then((running) => running.close(), () => {})
  }

  /** Plays the active preview's package again. */
  reload() {
    this.active?.panel.webview.postMessage({ type: 'reload' })
  }

  /**
   * The package in the default browser, by the command's own preview: as the editor plays it,
   * or as the settings say for a package no editor shows. It ends when its last tab has closed.
   * @param {vscode.Uri} [uri] from the explorer; the active preview's package otherwise
   */
  async openInBrowser(uri) {
    const target = uri ?? this.active?.document.uri
    if (!target) return
    const shown = [...this.previews].find((preview) => preview.document.uri.toString() === target.toString())
    const { restricted, untrusted, newest } = defaults()
    const mode = shown ? shown.mode : { untrusted, newest }
    // Its own copy, which outlives the editor that may have one.
    const copy = target.scheme === 'file' ? null : await localCopy(target)
    const removeCopy = () => copy && rm(copy.folder, { recursive: true, force: true }).catch(() => {})
    try {
      const preview = await previewPackage({
        file: copy ? copy.file : target.fsPath,
        roots: this.roots,
        libraries: this.packDir,
        untrusted: restricted || mode.untrusted,
        refreshLibraries: mode.newest
      })
      this.browsers.add(preview.close)
      preview.closed.then(() => {
        this.browsers.delete(preview.close)
        removeCopy()
      })
      await vscode.env.openExternal(vscode.Uri.parse(`${preview.url}/`))
    } catch (error) {
      removeCopy()
      vscode.window.showErrorMessage(`H5P Preview could not open the package in the browser: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** The settings, or the workspace's trust, changed: every preview plays as they now say. */
  applySettings() {
    const { restricted, untrusted, newest } = defaults()
    for (const preview of this.previews) {
      preview.mode = { untrusted, newest }
      preview.panel.webview.postMessage({ type: 'settings', restricted, untrusted, newest })
    }
  }

  dispose() {
    this.stopServer()
    for (const close of this.browsers) close()
    this.states.dispose()
  }
}
