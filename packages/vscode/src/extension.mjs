import * as vscode from 'vscode'
import { Previews, VIEW_TYPE } from './previews.mjs'

/**
 * H5P Preview by Missing Elements: a `.h5p` opens in a read-only editor that plays it in the real
 * player, served from this computer. See AGENTS.md, *The VS Code extension*.
 * @param {vscode.ExtensionContext} context
 */
export function activate(context) {
  const previews = new Previews(context)
  context.subscriptions.push(
    previews,
    // Kept while hidden: a quiz half answered, a video half watched, stays as it was.
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, previews, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true
    }),
    vscode.commands.registerCommand('h5pPreview.reload', () => previews.reload()),
    vscode.commands.registerCommand('h5pPreview.openInBrowser', (/** @type {unknown} */ uri) =>
      previews.openInBrowser(uri instanceof vscode.Uri ? uri : undefined)
    ),
    vscode.workspace.onDidGrantWorkspaceTrust(() => previews.applySettings()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('h5pPreview')) previews.applySettings()
    })
  )
  // What the integration tests read: each preview's state as its page reports it.
  return { onDidChangeState: previews.onDidChangeState }
}

export function deactivate() {}
