import * as vscode from 'vscode'
import { isRecord, safeLink } from '../../src/domain/documents'
import { exportBytes, newContent, parseEdit, validateContent } from './document'
import { readWorkspaceMarkdown } from './markdownFile'
import { webviewHtml } from './webview'
import { AiController } from './ai'

const VIEW_TYPE = 'xmindmap.editor'

export class MindMapEditor implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    const root = vscode.Uri.joinPath(this.context.extensionUri, 'webview')
    panel.webview.options = { enableScripts: true, localResourceRoots: [root] }
    let applying = false
    let disposed = false
    let queue = Promise.resolve()
    let snapshotId = 0
    let snapshotResolve: ((content: string | null) => void) | undefined
    let snapshotTimer: ReturnType<typeof setTimeout> | undefined
    let expectedSave: string | null = null

    const post = (message: unknown) => { if (!disposed) void panel.webview.postMessage(message) }
    const ai = new AiController(this.context, () => vscode.workspace.isTrusted)
    const ack = (content?: string) => post({ type: 'ack', version: document.version, dirty: document.isDirty, content })
    const error = (reason: unknown) => post({ type: 'error', message: reason instanceof Error ? reason.message : String(reason) })
    const sendDocument = () => {
      try {
        const text = validateContent(document.getText())
        post({ type: 'document', text, version: document.version, dirty: document.isDirty })
      } catch (reason) { error(reason) }
    }
    const fullRange = () => new vscode.Range(0, 0, document.lineAt(document.lineCount - 1).range.end.line, document.lineAt(document.lineCount - 1).range.end.character)

    const subscriptions: vscode.Disposable[] = []
    subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== document.uri.toString() || !event.contentChanges.length) return
      if (expectedSave !== null && document.getText() === expectedSave) {
        ack(expectedSave)
        expectedSave = null
      } else if (!applying) sendDocument()
    }))
    subscriptions.push(vscode.workspace.onDidSaveTextDocument((saved) => {
      if (saved.uri.toString() === document.uri.toString()) {
        if (expectedSave !== null) {
          expectedSave = null
          post({ type: 'snapshotCancelled', id: snapshotId })
        }
        post({ type: 'saved' })
      }
    }))
    subscriptions.push(vscode.workspace.onWillSaveTextDocument((event) => {
      if (event.document.uri.toString() !== document.uri.toString() || applying || disposed) return
      const originalVersion = document.version
      const id = ++snapshotId
      const snapshot = new Promise<string | null>((resolve) => {
        snapshotResolve = resolve
        snapshotTimer = setTimeout(() => {
          snapshotResolve = undefined
          post({ type: 'snapshotCancelled', id })
          resolve(null)
        }, 800)
        post({ type: 'snapshot', id })
      })
      event.waitUntil(snapshot.then((content) => {
        if (content === null || disposed) return []
        try {
          validateContent(content)
          if (document.version !== originalVersion) {
            error(new Error('保存时文件发生变化，请导出当前修改后重新打开文件。'))
            return []
          }
          if (content === document.getText()) { ack(content); return [] }
          expectedSave = content
          return [vscode.TextEdit.replace(fullRange(), content)]
        } catch (reason) { error(reason); return [] }
      }))
    }))

    subscriptions.push(panel.webview.onDidReceiveMessage((message: unknown) => {
      if (!isRecord(message)) return
      if (message.type === 'openExternal' && typeof message.url === 'string') {
        try {
          const url = safeLink(message.url)
          if (/^(https?:|mailto:)/i.test(url)) void vscode.env.openExternal(vscode.Uri.parse(url))
        } catch { /* Unsafe links are ignored. */ }
        return
      }
      if (message.type === 'file.read' && typeof message.id === 'number') {
        void readWorkspaceMarkdown(document, message.path).then(
          (content) => post({ type: 'result', id: message.id, data: content }),
          (reason) => post({ type: 'result', id: message.id, error: reason instanceof Error ? reason.message : String(reason) }),
        )
        return
      }
      // Network requests must not block document saves or cancellation messages.
      if (typeof message.type === 'string' && (message.type.startsWith('ai.') || message.type.startsWith('shortcuts.'))) {
        void ai.handle(message, post)
        return
      }
      if (message.type === 'snapshotResult' && message.id === snapshotId) {
        clearTimeout(snapshotTimer)
        snapshotResolve?.(typeof message.content === 'string' ? message.content : null)
        snapshotResolve = undefined
        return
      }
      queue = queue.then(async () => {
        if (disposed) return
        if (message.type === 'ready') { sendDocument(); return }
        if (message.type === 'edit') {
          try {
            const edit = parseEdit(message)
            if (edit.version !== document.version) throw new Error('文件版本已变化。已暂停同步，请导出当前修改后重新打开文件。')
            applying = true
            if (document.getText() !== edit.content) {
              const workspaceEdit = new vscode.WorkspaceEdit()
              workspaceEdit.replace(document.uri, fullRange(), edit.content)
              if (!await vscode.workspace.applyEdit(workspaceEdit)) throw new Error('VS Code 未能应用修改，请导出备份后重试')
            }
            ack(edit.content)
          } catch (reason) { error(reason) }
          finally { applying = false }
          return
        }
        if (typeof message.id !== 'number') return
        try {
          let ok = false
          if (message.type === 'save') ok = await document.save()
          else if (message.type === 'create') ok = await createFile(validateContent(message.content))
          else if (message.type === 'export') {
            const { bytes, name } = exportBytes(message.content, message.encoding, message.filename)
            const folder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri
            const target = await vscode.window.showSaveDialog({
              defaultUri: folder ? vscode.Uri.joinPath(folder, name) : vscode.Uri.file(name),
              saveLabel: '导出',
            })
            if (target) { await vscode.workspace.fs.writeFile(target, bytes); ok = true }
          }
          post({ type: 'result', id: message.id, ok })
        } catch (reason) {
          post({ type: 'result', id: message.id, error: reason instanceof Error ? reason.message : String(reason) })
        }
      }).catch(error)
    }))
    panel.onDidDispose(() => {
      disposed = true
      ai.dispose()
      clearTimeout(snapshotTimer)
      snapshotResolve?.(null)
      subscriptions.forEach((subscription) => subscription.dispose())
    })
    panel.webview.html = await webviewHtml(panel.webview, root)
  }
}

async function createFile(content = newContent()): Promise<boolean> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri
  const target = await vscode.window.showSaveDialog({
    defaultUri: folder ? vscode.Uri.joinPath(folder, '未命名导图.xmm') : undefined,
    filters: { 'XMindmap 思维导图': ['xmm'] },
    saveLabel: '创建导图',
  })
  if (!target) return false
  await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf8'))
  await vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE)
  return true
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, new MindMapEditor(context), {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
    vscode.commands.registerCommand('xmindmap.new', () => createFile()),
    vscode.commands.registerCommand('xmindmap.open', async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri ?? (await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { '思维导图': ['xmm', 'smm', 'json'] },
      }))?.[0]
      if (target) await vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE)
    }),
  )
}
