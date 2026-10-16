import * as vscode from 'vscode'
import { randomBytes } from 'node:crypto'

interface ManifestEntry { file: string; css?: string[]; isEntry?: boolean }

function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function webviewHtml(webview: vscode.Webview, root: vscode.Uri): Promise<string> {
  const manifestUri = vscode.Uri.joinPath(root, '.vite', 'manifest.json')
  const manifest = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(manifestUri)).toString('utf8')) as Record<string, ManifestEntry>
  const entry = Object.values(manifest).find((item) => item.isEntry)
  if (!entry) throw new Error('缺少 Webview 构建产物，请运行 npm run build')
  const uri = (file: string) => escape(webview.asWebviewUri(vscode.Uri.joinPath(root, file)).toString())
  const nonce = randomBytes(24).toString('base64')
  const csp = `default-src 'none'; script-src 'nonce-${nonce}' ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data: blob:; font-src ${webview.cspSource} data:; connect-src 'none';`
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${escape(csp)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${(entry.css ?? []).map((file) => `<link rel="stylesheet" href="${uri(file)}">`).join('\n')}
<title>XMindmap</title></head><body><div id="app"></div>
<script type="module" nonce="${nonce}" src="${uri(entry.file)}"></script></body></html>`
}
