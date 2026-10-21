import { layouts, lineStyles, themeIds } from './types'
import { normalizeIcons } from './icons'
import { normalizeRelativeMarkdownPath } from './links'
import type { MapDocument, MindNode, NodeData, OutlineEntry, ThemeId, Workspace } from './types'

export const STORAGE_KEY = 'xmindmap.workspace.v1'
export const MAX_FILE_SIZE = 5 * 1024 * 1024
const MAX_NODES = 5000
const MAX_DEPTH = 80

export function createNode(text: string, children: MindNode[] = []): MindNode {
  return { data: { uid: crypto.randomUUID(), text, expand: true }, children }
}

export function createDocument(title = '未命名导图', root = createNode('中心主题')): MapDocument {
  const now = new Date().toISOString()
  return { id: crypto.randomUUID(), title, root, layout: 'mindMap', themeId: 'studio', lineStyle: 'curve', createdAt: now, updatedAt: now }
}

export function createExample(): MapDocument {
  return createDocument('产品设计 · 从想法到落地', createNode('产品设计', [
    createNode('发现问题', [
      createNode('用户访谈'), createNode('场景与痛点'), createNode('竞品研究'),
    ]),
    createNode('定义方向', [
      createNode('目标用户'), createNode('核心价值'), createNode('成功指标'),
    ]),
    createNode('设计方案', [
      createNode('信息架构'), createNode('交互原型'), createNode('视觉设计'),
    ]),
    createNode('验证与迭代', [
      createNode('可用性测试'), createNode('收集反馈'), createNode('持续优化'),
    ]),
  ]))
}

export function flattenTree(root: MindNode, visibleOnly = false): OutlineEntry[] {
  const result: OutlineEntry[] = []
  const visit = (node: MindNode, depth: number) => {
    result.push({ node, depth })
    if (!visibleOnly || node.data.expand !== false) node.children.forEach((child) => visit(child, depth + 1))
  }
  visit(root, 0)
  return result
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function safeLink(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    if (['https:', 'http:', 'mailto:'].includes(url.protocol)) return url.href
  } catch { /* Relative paths are validated below. */ }
  try {
    return normalizeRelativeMarkdownPath(trimmed)
  } catch { /* Fall through to the shared rejection. */ }
  throw new Error('链接仅支持完整的 http、https、mailto 地址，或 Markdown 相对路径')
}

function plainText(value: string): string {
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(value, 'text/html')
    doc.querySelectorAll('script, style').forEach((element) => element.remove())
    return doc.body.textContent ?? ''
  }
  return value.replace(/<[^>]*>/g, '')
}

export function validateTree(value: unknown): MindNode {
  let count = 0
  const ids = new Set<string>()
  function visit(input: unknown, depth: number): MindNode {
    if (++count > MAX_NODES) throw new Error(`导图最多支持 ${MAX_NODES} 个节点`)
    if (depth > MAX_DEPTH) throw new Error(`导图层级不能超过 ${MAX_DEPTH} 层`)
    if (!isRecord(input) || !isRecord(input.data) || typeof input.data.text !== 'string') {
      throw new Error('节点格式不正确：每个节点需要 data.text')
    }
    const raw = input.data
    const text = input.data.text
    if (text.length > 20000) throw new Error('单个节点文本过长')
    let uid = typeof raw.uid === 'string' && raw.uid ? raw.uid : crypto.randomUUID()
    if (ids.has(uid)) uid = crypto.randomUUID()
    ids.add(uid)
    const data: NodeData = {
      uid, text: raw.richText ? plainText(text) : text,
      expand: depth === 0 || raw.expand !== false, richText: false,
    }
    for (const key of ['note', 'hyperlinkTitle', 'imageTitle'] as const) {
      if (typeof raw[key] === 'string') data[key] = raw[key].slice(0, 20000)
    }
    if (typeof raw.hyperlink === 'string') {
      try { data.hyperlink = safeLink(raw.hyperlink) } catch { data.hyperlink = '' }
    }
    if (Array.isArray(raw.tag)) data.tag = raw.tag.filter((tag): tag is string => typeof tag === 'string').slice(0, 20)
    if (Array.isArray(raw.icon)) data.icon = normalizeIcons(raw.icon)
    for (const key of ['fillColor', 'color', 'borderColor', 'lineColor'] as const) {
      if (typeof raw[key] === 'string' && /^(#[\da-f]{3,8}|transparent|white|black|rgba?\([\d.,%\s]+\))$/i.test(raw[key])) data[key] = raw[key]
    }
    for (const key of ['borderWidth', 'borderRadius', 'fontSize'] as const) {
      if (typeof raw[key] === 'number' && Number.isFinite(raw[key])) data[key] = Math.max(0, Math.min(raw[key], 100))
    }
    if (raw.fontWeight === 'bold' || raw.fontWeight === 'normal') data.fontWeight = raw.fontWeight
    if (raw.fontStyle === 'italic' || raw.fontStyle === 'normal') data.fontStyle = raw.fontStyle
    if (['rectangle', 'roundedRectangle', 'ellipse', 'diamond'].includes(String(raw.shape))) data.shape = raw.shape as NodeData['shape']
    if (typeof raw.image === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,[a-z\d+/=\s]+$/i.test(raw.image)) {
      data.image = raw.image
      if (isRecord(raw.imageSize) && typeof raw.imageSize.width === 'number' && typeof raw.imageSize.height === 'number') {
        data.imageSize = {
          width: Math.max(1, Math.min(1000, raw.imageSize.width)),
          height: Math.max(1, Math.min(1000, raw.imageSize.height)),
        }
      }
    }
    if (input.children !== undefined && !Array.isArray(input.children)) throw new Error('节点 children 必须是数组')
    return { data, children: (input.children ?? []).map((child: unknown) => visit(child, depth + 1)) }
  }
  return visit(value, 0)
}

export function openMindMapText(text: string, fallbackTitle = '未命名导图'): MapDocument {
  if (!text.trim()) return createDocument(fallbackTitle)
  return parseDocument(JSON.parse(text), fallbackTitle)
}

export function parseDocument(value: unknown, fallbackTitle = '导入的导图'): MapDocument {
  if (!isRecord(value)) throw new Error('文件不是有效的导图对象')
  const root = validateTree(value.root ?? value)
  const title = typeof value.title === 'string' && value.title.trim() ? value.title.trim().slice(0, 100) : fallbackTitle
  const doc = createDocument(title, root)
  if (layouts.some((layout) => layout.value === value.layout)) doc.layout = value.layout as MapDocument['layout']
  if (typeof value.themeId === 'string' && (themeIds as readonly string[]).includes(value.themeId)) doc.themeId = value.themeId as ThemeId
  const upstreamStyle = isRecord(value.theme) && isRecord(value.theme.config) ? value.theme.config.lineStyle : undefined
  const lineStyle = value.lineStyle ?? upstreamStyle
  const validStyle = lineStyles.find((style) => style.value === lineStyle)
  if (validStyle) doc.lineStyle = validStyle.value
  // Theme configuration is app-owned. Imported arbitrary CSS/URLs are deliberately not applied.
  return doc
}

export function serializeDocument(doc: MapDocument): string {
  return JSON.stringify({
    format: 'xmindmap', version: 1, title: doc.title,
    root: doc.root, layout: doc.layout, themeId: doc.themeId, lineStyle: doc.lineStyle,
  }, null, 2)
}

export function loadWorkspace(storage: Pick<Storage, 'getItem'>): Workspace | null {
  const saved = storage.getItem(STORAGE_KEY)
  if (!saved) return null
  const parsed: unknown = JSON.parse(saved)
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.documents) || !parsed.documents.length) {
    throw new Error('本地文档格式损坏，请先备份本地数据')
  }
  const ids = new Set<string>()
  const documents = parsed.documents.map((item: unknown) => {
    if (!isRecord(item) || typeof item.id !== 'string' || ids.has(item.id)) throw new Error('本地文档标识无效')
    ids.add(item.id)
    const doc = parseDocument(item)
    doc.id = item.id
    if (typeof item.createdAt === 'string') doc.createdAt = item.createdAt
    if (typeof item.updatedAt === 'string') doc.updatedAt = item.updatedAt
    return doc
  })
  const activeId = typeof parsed.activeId === 'string' && ids.has(parsed.activeId) ? parsed.activeId : documents[0]!.id
  return { version: 1, activeId, documents }
}

export function saveWorkspace(storage: Pick<Storage, 'setItem'>, workspace: Workspace): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(workspace))
}
