import { realpath } from 'node:fs/promises'
import { dirname } from 'node:path'
import * as vscode from 'vscode'
import { isPathInside, resolveRelativeMarkdown } from '../../src/domain/links'

const MAX_MARKDOWN_BYTES = 512 * 1024

export async function readWorkspaceMarkdown(document: vscode.TextDocument, relative: unknown): Promise<string> {
  if (typeof relative !== 'string') throw new Error('路径无效')
  const documentDir = dirname(document.uri.fsPath)
  const workspaceDir = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ?? documentDir
  const target = resolveRelativeMarkdown(documentDir, workspaceDir, relative)
  const realRoot = await realpath(workspaceDir).catch(() => { throw new Error('无法确认工作区路径') })
  const realTarget = await realpath(target).catch(() => { throw new Error('找不到文件') })
  if (!isPathInside(realRoot, realTarget)) throw new Error('路径超出工作区')
  const uri = vscode.Uri.file(realTarget)
  const stat = await vscode.workspace.fs.stat(uri)
  if (stat.type !== vscode.FileType.File) throw new Error('不是文件')
  if (stat.size > MAX_MARKDOWN_BYTES) throw new Error('Markdown 文件超过 512 KB')
  const bytes = await vscode.workspace.fs.readFile(uri)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('文件不是 UTF-8 文本')
  }
}
