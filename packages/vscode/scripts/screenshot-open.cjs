// Runs in the extension host of the VS Code that screenshot.mjs starts, as the suite does: opens the
// quiz in the preview, where VS Code has the extension's editor registered, and keeps the window
// open, since VS Code closes it once this returns; the script closes it when it has the picture.
const vscode = require('vscode')

exports.run = async function run() {
  const [folder] = vscode.workspace.workspaceFolders ?? []
  await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.joinPath(folder.uri, 'quiz.h5p'), 'missingElements.h5pPreview')
  await new Promise(() => {})
}
