// Runs in the extension host of the VS Code that run.mjs starts: opens the demo's packages in the
// preview and waits on what each page reports through the extension's `onDidChangeState`.
const assert = require('node:assert/strict')
const { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const vscode = require('vscode')

const VIEW_TYPE = 'missingElements.h5pPreview'
const WAIT_MS = 60_000

/**
 * A folder on disk under a scheme of its own, read-only: what a remote or virtual workspace's files
 * are to the extension, a URI that is not `file:`, read through `workspace.fs`.
 * @implements {import('vscode').FileSystemProvider}
 */
class DiskView {
  /** @param {string} root */
  constructor(root) {
    this.root = root
    this.onDidChangeFile = new vscode.EventEmitter().event
  }

  /** @param {import('vscode').Uri} uri */
  file(uri) {
    return path.join(this.root, uri.path)
  }

  watch() {
    return new vscode.Disposable(() => {})
  }

  /** @param {import('vscode').Uri} uri */
  stat(uri) {
    let found
    try {
      found = statSync(this.file(uri))
    } catch {
      throw vscode.FileSystemError.FileNotFound(uri)
    }
    const type = found.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File
    return { type, ctime: found.ctimeMs, mtime: found.mtimeMs, size: found.size }
  }

  /** @param {import('vscode').Uri} uri */
  readDirectory(uri) {
    return readdirSync(this.file(uri), { withFileTypes: true }).map((entry) => [
      entry.name,
      entry.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File
    ])
  }

  /** @param {import('vscode').Uri} uri */
  readFile(uri) {
    try {
      return readFileSync(this.file(uri))
    } catch {
      throw vscode.FileSystemError.FileNotFound(uri)
    }
  }

  /** @param {import('vscode').Uri} uri */
  createDirectory(uri) {
    throw vscode.FileSystemError.NoPermissions(uri)
  }

  /** @param {import('vscode').Uri} uri */
  writeFile(uri) {
    throw vscode.FileSystemError.NoPermissions(uri)
  }

  /** @param {import('vscode').Uri} uri */
  delete(uri) {
    throw vscode.FileSystemError.NoPermissions(uri)
  }

  /** @param {import('vscode').Uri} uri */
  rename(uri) {
    throw vscode.FileSystemError.NoPermissions(uri)
  }
}

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

  await test('a package on another file system is copied to this computer, and plays', async () => {
    const registration = vscode.workspace.registerFileSystemProvider('h5p-test', new DiskView(content.fsPath), { isReadonly: true })
    try {
      const state = await open(vscode.Uri.from({ scheme: 'h5p-test', path: '/quiz.h5p' }))
      assert.equal(state.type, 'ready', state.message)
      assert.equal(state.title, 'Do you know what just happened?')
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      registration.dispose()
    }
  })

  // Brackets and braces are glob syntax, and the file's name is not a pattern.
  await test('a package written again plays again, whatever its name', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'h5p-preview-'))
    try {
      const file = path.join(folder, 'package [v2] {draft}.h5p')
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
