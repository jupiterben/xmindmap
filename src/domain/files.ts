import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Content, PhrasingContent, ListItem } from 'mdast'
import { createDocument, createNode, MAX_FILE_SIZE, parseDocument, validateTree } from './documents'
import type { MapDocument, MindNode } from './types'
import { hostRequest, isVsCode } from '../platform/vscode'

function textOf(node: Content | PhrasingContent | ListItem): string {
  if ('value' in node) return node.type === 'html' ? '' : node.value
  if ('children' in node) return node.children.map((child) => textOf(child)).join('')
  return ''
}

export function importMarkdown(source: string, title: string): MapDocument {
  const ast = fromMarkdown(source)
  const first = ast.children[0]
  const rootHeading = first?.type === 'heading' && first.depth === 1 ? first : null
  const root = createNode(rootHeading ? textOf(rootHeading) : title)
  const stack: { level: number; node: MindNode }[] = [{ level: rootHeading ? 1 : 0, node: root }]
  const appendList = (items: ListItem[], parent: MindNode) => {
    items.forEach((item) => {
      const label = item.children.filter((child) => child.type !== 'list').map(textOf).join('\n').trim()
      const node = createNode(label || '新主题')
      parent.children.push(node)
      item.children.forEach((child) => { if (child.type === 'list') appendList(child.children, node) })
    })
  }
  ast.children.forEach((item) => {
    if (item === rootHeading) return
    if (item.type === 'heading') {
      while (stack.length > 1 && stack[stack.length - 1]!.level >= item.depth) stack.pop()
      const node = createNode(textOf(item))
      stack[stack.length - 1]!.node.children.push(node)
      stack.push({ level: item.depth, node })
    } else if (item.type === 'list') {
      appendList(item.children, stack[stack.length - 1]!.node)
    } else if (item.type === 'paragraph') {
      stack[stack.length - 1]!.node.children.push(createNode(textOf(item)))
    }
  })
  return createDocument(title, validateTree(root))
}

export function exportMarkdown(root: MindNode): string {
  const escape = (text: string) => text.replace(/\\/g, '\\\\').replace(/([`*_[\]<>#])/g, '\\$1').replace(/\r?\n/g, ' ')
  const lines = [`# ${escape(root.data.text)}`, '']
  const visit = (node: MindNode, depth: number) => {
    lines.push(`${'  '.repeat(depth)}- ${escape(node.data.text)}`)
    node.children.forEach((child) => visit(child, depth + 1))
  }
  root.children.forEach((node) => visit(node, 0))
  return `${lines.join('\n')}\n`
}

export async function readDocumentFile(file: File): Promise<MapDocument> {
  if (file.size > MAX_FILE_SIZE) throw new Error('文件不能超过 5 MB')
  const extension = file.name.split('.').pop()?.toLowerCase()
  const title = file.name.replace(/\.[^.]+$/, '')
  const source = await file.text()
  if (extension === 'md' || extension === 'markdown') return importMarkdown(source, title)
  if (extension !== 'json' && extension !== 'smm' && extension !== 'xmindmap') throw new Error('请选择 JSON、SMM、XMindmap 或 Markdown 文件')
  let parsed: unknown
  try { parsed = JSON.parse(source) } catch { throw new Error('JSON 语法错误，文件未导入') }
  return parseDocument(parsed, title)
}

export async function downloadText(content: string, filename: string, mime = 'application/json'): Promise<boolean> {
  if (isVsCode) return hostRequest('export', { content, filename, encoding: 'utf8' })
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}
