import type { NodeIcon } from './icons'

export const layouts = [
  { value: 'mindMap', label: '思维导图' },
  { value: 'logicalStructure', label: '向右逻辑图' },
  { value: 'logicalStructureLeft', label: '向左逻辑图' },
  { value: 'organizationStructure', label: '组织结构图' },
  { value: 'catalogOrganization', label: '目录组织图' },
  { value: 'timeline', label: '横向时间轴' },
  { value: 'verticalTimeline', label: '竖向时间轴' },
  { value: 'fishbone', label: '鱼骨图' },
] as const

export type Layout = (typeof layouts)[number]['value']
export const lineStyles = [
  { value: 'curve', label: '曲线' },
  { value: 'straight', label: '折线' },
  { value: 'direct', label: '直线' },
] as const
export type LineStyle = (typeof lineStyles)[number]['value']

export function supportsLineStyle(layout: Layout): boolean {
  return ['mindMap', 'logicalStructure', 'logicalStructureLeft', 'organizationStructure', 'verticalTimeline'].includes(layout)
}

export const themeIds = ['studio', 'forest', 'rose', 'mono', 'amber', 'sea', 'dusk', 'ember', 'olive', 'night'] as const
export type ThemeId = (typeof themeIds)[number]
export type NodeShape = 'rectangle' | 'roundedRectangle' | 'ellipse' | 'diamond'

export interface NodeData {
  uid: string
  text: string
  expand?: boolean
  note?: string
  hyperlink?: string
  hyperlinkTitle?: string
  tag?: string[]
  icon?: NodeIcon[]
  image?: string
  imageTitle?: string
  imageSize?: { width: number; height: number }
  richText?: false
  fillColor?: string
  color?: string
  borderColor?: string
  borderWidth?: number
  borderRadius?: number
  fontSize?: number
  fontWeight?: string
  fontStyle?: string
  shape?: NodeShape
  lineColor?: string
}

export interface MindNode {
  data: NodeData
  children: MindNode[]
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
export type ThemeConfig = { [key: string]: JsonValue }

export interface MapDocument {
  id: string
  title: string
  root: MindNode
  layout: Layout
  themeId: ThemeId
  lineStyle: LineStyle
  themeConfig?: ThemeConfig
  createdAt: string
  updatedAt: string
}

export interface Workspace {
  version: 1
  activeId: string
  documents: MapDocument[]
}

export interface OutlineEntry {
  node: MindNode
  depth: number
}
