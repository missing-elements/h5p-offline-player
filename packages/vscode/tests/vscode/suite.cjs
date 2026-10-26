// Runs in the extension host of the VS Code that run.mjs starts: opens the demo's packages in the
// preview and waits on what each page reports through the extension's `onDidChangeState`.
const assert = require('node:assert/strict')
const { copyFileSync, mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const vscode = require('vscode')

const VIEW_TYPE = 'missingElements.h5pPreview'
const WAIT_MS = 60_000

exports.run = async function run() {
  const content = vscode.workspace.workspaceFolders[0].uri
  const extension = vscode.extensions.getExtension('missing-elements.h5p-preview')
  const api = await extension.activate()
  const failures = []

  async function test(name, body) {
    try {
      await body()
      console.log(`  ✓ ${name}`)
    } catch (error) {
      failures.push(name)
      console.error(`  ✗ ${name}\n    ${error && error.stack ? error.stack : error}`)
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    }
  }

  /** The next state the preview of `uri` reports that `accept` takes. */
  function next(uri, accept) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        listener.dispose()
        reject(new Error(`no state for ${uri.path} within ${WAIT_MS / 1000} s`))
      }, WAIT_MS)
      const listener = api.onDidChangeState((state) => {
        if (state.uri.toString() !== uri.toString() || !accept(state)) return
        clearTimeout(timer)
        listener.dispose()
        resolve(state)
      })
    })
  }

  /** Where a load ends: `ready`, or an error before it. */
  const ended = (state) => state.type === 'ready' || (state.type === 'error' && !state.afterReady)

  async function open(uri) {
    const outcome = next(uri, ended)
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE)
    return outcome
  }

  await test('a package plays: the demo quiz reaches ready, with its title, trusted', async () => {
    const state = await open(vscode.Uri.joinPath(content, 'quiz.h5p'))
    assert.equal(state.type, 'ready', state.message)
    assert.equal(state.title, 'Do you know what just happened?')
    assert.equal(state.mainLibrary, 'H5P.QuestionSet')
    assert.equal(state.untrusted, false)
  })

  await test('an Interactive Video plays', async () => {
    const state = await open(vscode.Uri.joinPath(content, 'video.h5p'))
    assert.equal(state.type, 'ready', state.message)
    assert.equal(state.mainLibrary, 'H5P.InteractiveVideo')
  })

  await test('an export without its libraries plays from the pack the extension carries', async () => {
    const state = await open(vscode.Uri.joinPath(content, 'formulas.h5p'))
    assert.equal(state.type, 'ready', state.message)
    assert.equal(state.title, 'Formulas, from a content-only export')
  })

  await test('Reload plays the package again', async () => {
    const uri = vscode.Uri.joinPath(content, 'quiz.h5p')
    assert.equal((await open(uri)).type, 'ready')
    const again = next(uri, ended)
    await vscode.commands.executeCommand('h5pPreview.reload')
    assert.equal((await again).type, 'ready')
  })

  await test('with h5pPreview.untrusted on, a package plays untrusted', async () => {
    const settings = vscode.workspace.getConfiguration('h5pPreview')
    await settings.update('untrusted', true, vscode.ConfigurationTarget.Global)
    try {
      const state = await open(vscode.Uri.joinPath(content, 'markup.h5p'))
      assert.equal(state.type, 'ready', state.message)
      assert.equal(state.untrusted, true)
    } finally {
      await settings.update('untrusted', undefined, vscode.ConfigurationTarget.Global)
    }
  })

  await test('turning the setting on plays an open preview again, untrusted', async () => {
    const uri = vscode.Uri.joinPath(content, 'quiz.h5p')
    assert.equal((await open(uri)).untrusted, false)
    const again = next(uri, (state) => state.type === 'ready')
    const settings = vscode.workspace.getConfiguration('h5pPreview')
    await settings.update('untrusted', true, vscode.ConfigurationTarget.Global)
    try {
      assert.equal((await again).untrusted, true)
    } finally {
      await settings.update('untrusted', undefined, vscode.ConfigurationTarget.Global)
    }
  })

  await test('a package written again plays again', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'h5p-preview-'))
    try {
      const file = path.join(folder, 'package.h5p')
      copyFileSync(path.join(content.fsPath, 'quiz.h5p'), file)
      const uri = vscode.Uri.file(file)
      assert.equal((await open(uri)).title, 'Do you know what just happened?')
      const again = next(uri, (state) => state.type === 'ready')
      copyFileSync(path.join(content.fsPath, 'glossary.h5p'), file)
      assert.equal((await again).title, 'Words this player uses')
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })

  if (failures.length > 0) throw new Error(`${failures.length} failed: ${failures.join('; ')}`)
}
