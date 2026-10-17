import { fromMarkdown } from 'mdast-util-from-markdown'
import { createDocument, createNode, MAX_FILE_SIZE, parseDocument, safeLink, validateTree } from './documents'
import type { MapDocument, MindNode } from './types'
import { hostRequest, isVsCode } from '../platform/vscode'

interface MdNode { type: string; value?: string; depth?: number; children?: MdNode[] }

function textOf(node: MdNode): string {
  if (typeof node.value === 'string') return node.type === 'html' ? '' : node.value
  return node.children?.map((child) => textOf(child)).join('') ?? ''
}

export function importMarkdown(source: string, title: string): MapDocument {
  const ast = fromMarkdown(source) as MdNode
  const first = ast.children?.[0]
  const rootHeading = first?.type === 'heading' && first.depth === 1 ? first : null
  const root = createNode(rootHeading ? textOf(rootHeading) : title)
  const stack: { level: number; node: MindNode }[] = [{ level: rootHeading ? 1 : 0, node: root }]
  const appendList = (items: MdNode[], parent: MindNode) => {
    items.forEach((item) => {
      const label = (item.children ?? []).filter((child) => child.type !== 'list').map(textOf).join('\n').trim()
      const node = createNode(label || '新主题')
      parent.children.push(node)
      item.children?.forEach((child) => { if (child.type === 'list' && child.children) appendList(child.children, node) })
    })
  }
  ast.children?.forEach((item) => {
    if (item === rootHeading) return
    if (item.type === 'heading') {
      const depth = item.depth ?? 1
      while (stack.length > 1 && stack[stack.length - 1]!.level >= depth) stack.pop()
      const node = createNode(textOf(item))
      stack[stack.length - 1]!.node.children.push(node)
      stack.push({ level: depth, node })
    } else if (item.type === 'list') {
      if (item.children) appendList(item.children, stack[stack.length - 1]!.node)
    } else if (item.type === 'paragraph') {
      stack[stack.length - 1]!.node.children.push(createNode(textOf(item)))
    }
  })
  return createDocument(title, validateTree(root))
}

interface XmlEl { name: string; attrs: Record<string, string>; content: Array<string | XmlEl> }

function decodeXml(value: string): string {
  return value.replace(/&(#x[\da-fA-F]+|#\d+|lt|gt|amp|quot|apos|nbsp);/g, (entity, token: string) => {
    if (token === 'lt') return '<'
    if (token === 'gt') return '>'
    if (token === 'amp') return '&'
    if (token === 'quot') return '"'
    if (token === 'apos') return "'"
    if (token === 'nbsp') return ' '
    const code = token[1] === 'x' ? Number.parseInt(token.slice(2), 16) : Number.parseInt(token.slice(1), 10)
    if (!Number.isInteger(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return entity
    return String.fromCodePoint(code)
  })
}

function tagEnd(source: string, start: number): number {
  let quote = ''
  for (let index = start; index < source.length; index++) {
    const char = source[index]!
    if (quote) { if (char === quote) quote = ''; continue }
    if (char === '"' || char === "'") quote = char
    else if (char === '>') return index
  }
  return -1
}

function startTag(body: string): XmlEl {
  let index = 0
  while (index < body.length && !/\s/.test(body[index]!) && body[index] !== '/') index++
  const name = body.slice(0, index).toLowerCase()
  if (!/^[a-z_][\w:.-]*$/i.test(name)) throw new Error('FreeMind 文件格式错误')
  const attrs: Record<string, string> = {}
  while (index < body.length) {
    while (index < body.length && /\s/.test(body[index]!)) index++
    if (index >= body.length || body[index] === '/') break
    const keyStart = index
    while (index < body.length && body[index] !== '=' && !/\s/.test(body[index]!)) index++
    const key = body.slice(keyStart, index)
    while (index < body.length && /\s/.test(body[index]!)) index++
    if (body[index] !== '=') throw new Error('FreeMind 文件格式错误')
    index++
    while (index < body.length && /\s/.test(body[index]!)) index++
    const quote = body[index]
    if (quote !== '"' && quote !== "'") throw new Error('FreeMind 文件格式错误')
    const valueStart = ++index
    while (index < body.length && body[index] !== quote) index++
    if (index >= body.length) throw new Error('FreeMind 文件格式错误')
    attrs[key.toUpperCase()] = decodeXml(body.slice(valueStart, index))
    index++
  }
  return { name, attrs, content: [] }
}

function parseFreeMindXml(source: string): XmlEl {
  const roots: XmlEl[] = []
  const stack: XmlEl[] = []
  let index = 0
  let count = 0
  while (index < source.length) {
    if (source[index] !== '<') {
      const start = index
      while (index < source.length && source[index] !== '<') index++
      const text = decodeXml(source.slice(start, index))
      if (text && stack.length) stack[stack.length - 1]!.content.push(text)
      continue
    }
    if (source.startsWith('<!--', index)) {
      const end = source.indexOf('-->', index + 4)
      if (end < 0) throw new Error('FreeMind 文件格式错误')
      index = end + 3
      continue
    }
    if (source.startsWith('<![CDATA[', index)) {
      const end = source.indexOf(']]>', index + 9)
      if (end < 0) throw new Error('FreeMind 文件格式错误')
      if (stack.length) stack[stack.length - 1]!.content.push(source.slice(index + 9, end))
      index = end + 3
      continue
    }
    if (source.startsWith('<?', index) || source.startsWith('<!', index)) {
      const end = source.indexOf('>', index + 2)
      if (end < 0) throw new Error('FreeMind 文件格式错误')
      index = end + 1
      continue
    }
    if (source.startsWith('</', index)) {
      const end = source.indexOf('>', index + 2)
      if (end < 0) throw new Error('FreeMind 文件格式错误')
      const open = stack.pop()
      if (!open || open.name !== source.slice(index + 2, end).trim().toLowerCase()) throw new Error('FreeMind 文件格式错误')
      if (stack.length) stack[stack.length - 1]!.content.push(open)
      else roots.push(open)
      index = end + 1
      continue
    }
    const end = tagEnd(source, index + 1)
    if (end < 0) throw new Error('FreeMind 文件格式错误')
    let body = source.slice(index + 1, end).trimEnd()
    const selfClosing = body.endsWith('/')
    if (selfClosing) body = body.slice(0, -1).trimEnd()
    const element = startTag(body)
    if (++count > 20000 || stack.length > 200) throw new Error('FreeMind 文件格式错误')
    if (selfClosing) {
      if (stack.length) stack[stack.length - 1]!.content.push(element)
      else roots.push(element)
    } else stack.push(element)
    index = end + 1
  }
  if (stack.length) throw new Error('FreeMind 文件格式错误')
  const map = roots.find((item) => item.name === 'map')
  if (!map) throw new Error('FreeMind 文件格式错误')
  return map
}

function elementText(element: XmlEl): string {
  if (element.name === 'script' || element.name === 'style') return ''
  let text = ''
  for (const part of element.content) {
    if (typeof part === 'string') text += part
    else if (part.name === 'br') text += '\n'
    else text += elementText(part)
  }
  if (['p', 'div', 'li', 'tr', 'h1', 'h2', 'h3', 'h4'].includes(element.name)) text += '\n'
  return text
}

function richText(element: XmlEl, type: string): string {
  const block = element.content.find((part): part is XmlEl => typeof part !== 'string' && part.name === 'richcontent' && part.attrs.TYPE?.toUpperCase() === type)
  return block ? elementText(block).replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : ''
}

function freeMindNode(element: XmlEl, fallback: string): MindNode {
  const text = (richText(element, 'NODE') || element.attrs.TEXT || fallback).trim() || fallback
  const children = element.content.filter((part): part is XmlEl => typeof part !== 'string' && part.name === 'node')
  const node = createNode(text, children.map((child) => freeMindNode(child, '新主题')))
  const note = richText(element, 'NOTE')
  if (note) node.data.note = note
  if (element.attrs.LINK) {
    try { node.data.hyperlink = safeLink(element.attrs.LINK) } catch { /* Unsafe links are dropped. */ }
  }
  if (element.attrs.FOLDED?.toLowerCase() === 'true') node.data.expand = false
  return node
}

export function importFreeMind(source: string, title: string): MapDocument {
  const map = parseFreeMindXml(source.replace(/^\uFEFF/, ''))
  const root = map.content.find((part): part is XmlEl => typeof part !== 'string' && part.name === 'node')
  if (!root) throw new Error('FreeMind 文件格式错误')
  return createDocument(title, validateTree(freeMindNode(root, title || '中心主题')))
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
  if (extension === 'mm') return importFreeMind(source, title)
  if (extension !== 'json' && extension !== 'smm' && extension !== 'xmm') throw new Error('请选择 JSON、SMM、XMM、FreeMind 或 Markdown 文件')
  if (!source.trim()) return createDocument(title)
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
