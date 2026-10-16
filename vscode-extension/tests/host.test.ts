import * as vscode from 'vscode'
import * as assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { MindMapEditor } from '../src/extension'
import { exportBytes, newContent, parseEdit } from '../src/document'

async function until(check: () => boolean, label: string): Promise<void> {
  const timeout = Date.now() + 8000
  while (!check()) {
    if (Date.now() > timeout) throw new Error(`Timed out: ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('xmindmap-local.xmindmap')!
  assert.ok(extension)
  await extension.activate()
  const commands = await vscode.commands.getCommands()
  assert.ok(commands.includes('xmindmap.new'))
  assert.ok(commands.includes('xmindmap.open'))
  assert.throws(() => parseEdit({ type: 'edit', version: 1, content: '{}' }))
  assert.throws(() => exportBytes('x', 'utf8', '../bad.exe'))
  assert.equal(Buffer.from(exportBytes('data:image/svg+xml,%3Csvg%3E%3C/svg%3E', 'dataUrl', 'map.svg').bytes).toString(), '<svg></svg>')
  const testRoot = process.env.XMINDMAP_TEST_ROOT ?? tmpdir()
  const directory = await mkdtemp(join(testRoot, 'xmindmap-host-'))
  const file = join(directory, 'test.xmindmap')
  const original = newContent()
  await writeFile(file, original)
  const uri = vscode.Uri.file(file)
  const document = await vscode.workspace.openTextDocument(uri)
  await vscode.window.showTextDocument(document)
  const incoming = new vscode.EventEmitter<unknown>()
  const disposing = new vscode.EventEmitter<void>()
  const messages: Record<string, unknown>[] = []
  let html = ''
  let snapshotContent: string | null = null
  const panel = {
    webview: {
      options: {},
      cspSource: 'https://unit.test',
      asWebviewUri: (resource: vscode.Uri) => resource,
      onDidReceiveMessage: incoming.event,
      postMessage: (message: Record<string, unknown>) => {
        messages.push(message)
        if (message.type === 'snapshot') incoming.fire({ type: 'snapshotResult', id: message.id, content: snapshotContent })
        return Promise.resolve(true)
      },
      get html() { return html },
      set html(value: string) { html = value },
    },
    onDidDispose: disposing.event,
  } as unknown as vscode.WebviewPanel
  const context = { extensionUri: extension.extensionUri } as vscode.ExtensionContext
  try {
    await new MindMapEditor(context).resolveCustomTextEditor(document, panel)
    assert.match(html, /Content-Security-Policy/)
    assert.match(html, /connect-src 'none'/)
    assert.doesNotMatch(html, /localhost|127\.0\.0\.1/)
    incoming.fire({ type: 'ready' })
    await until(() => messages.some((message) => message.type === 'document'), 'initial document')
    assert.equal(document.isDirty, false)
    const changed = JSON.stringify({ ...JSON.parse(original), title: 'Host edited', lineStyle: 'direct' }, null, 2)
    incoming.fire({ type: 'edit', version: document.version, content: changed })
    await until(() => messages.some((message) => message.type === 'ack'), 'edit acknowledgement')
    assert.equal(document.isDirty, true)
    assert.equal(JSON.parse(document.getText()).title, 'Host edited')
    incoming.fire({ type: 'save', id: 1 })
    await until(() => messages.some((message) => message.type === 'result' && message.id === 1), 'save')
    assert.equal(document.isDirty, false)
    assert.equal(JSON.parse(await readFile(file, 'utf8')).lineStyle, 'direct')

    snapshotContent = JSON.stringify({ ...JSON.parse(changed), title: 'Native save snapshot' }, null, 2)
    const dirty = new vscode.WorkspaceEdit()
    dirty.insert(uri, new vscode.Position(0, 0), ' ')
    await vscode.workspace.applyEdit(dirty)
    await document.save()
    assert.equal(JSON.parse(await readFile(file, 'utf8')).title, 'Native save snapshot')
    snapshotContent = null
    const external = new vscode.WorkspaceEdit()
    external.insert(uri, new vscode.Position(0, 0), '\n')
    const before = messages.filter((message) => message.type === 'document').length
    await vscode.workspace.applyEdit(external)
    await until(() => messages.filter((message) => message.type === 'document').length > before, 'external update')
    const preserved = document.getText()
    await vscode.commands.executeCommand('undo')
    await until(() => document.getText() !== preserved, 'native undo')
    await vscode.commands.executeCommand('redo')
    await until(() => document.getText() === preserved, 'native redo')
    incoming.fire({ type: 'edit', version: 0, content: original })
    await until(() => messages.some((message) => message.type === 'error'), 'stale edit rejection')
    assert.equal(document.getText(), preserved)
    await document.save()
    disposing.fire()
    const actualPanel = vscode.window.createWebviewPanel('xmindmap.smoke', 'XMindmap Webview Smoke', vscode.ViewColumn.One, { enableScripts: true })
    const actualMessages: Record<string, unknown>[] = []
    const actualListener = actualPanel.webview.onDidReceiveMessage((message: Record<string, unknown>) => actualMessages.push(message))
    try {
      await new MindMapEditor(context).resolveCustomTextEditor(document, actualPanel)
      await until(() => actualMessages.some((message) => message.type === 'ready'), 'real Webview JavaScript startup')
      let snapshot: Record<string, unknown> | undefined
      const started = Date.now()
      while (!snapshot && Date.now() - started < 15000) {
        await actualPanel.webview.postMessage({ type: 'snapshot', id: -1 })
        await new Promise((resolve) => setTimeout(resolve, 200))
        snapshot = actualMessages.find((message) => message.type === 'snapshotResult' && typeof message.content === 'string')
      }
      assert.ok(snapshot, 'real webview should load document and serialize a snapshot')
      assert.equal(JSON.parse(String(snapshot.content)).title, 'Native save snapshot')
      assert.ok(!actualMessages.some((message) => message.type === 'edit'), 'opening the real Webview must not dirty the document')
    } finally {
      actualListener.dispose()
      actualPanel.dispose()
    }
    await vscode.commands.executeCommand('vscode.openWith', uri, 'xmindmap.editor')
    await until(() => vscode.window.tabGroups.all.some((group) => group.tabs.some((tab) => tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'xmindmap.editor')), 'real custom editor registration')
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    console.log('XMindmap extension host tests passed: activation, document edit/save, native save snapshot, conflicts, exports, real Webview startup/snapshot, custom editor.')
  } finally {
    disposing.fire()
    incoming.dispose()
    disposing.dispose()
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    assert.equal(dirname(resolve(directory)), resolve(testRoot))
    assert.ok(basename(directory).startsWith('xmindmap-host-'))
    // VS Code may hold a Windows file watcher until exit; the runner owns cleanup.
    if (!process.env.XMINDMAP_TEST_ROOT) await rm(directory, { recursive: true, force: true, maxRetries: 12, retryDelay: 500 })
  }
}
