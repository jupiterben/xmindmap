import type { MapTheme } from './themes'
import type { NodeData, NodeShape } from './types'

/** Node properties a style template is allowed to touch. */
export const nodeStyleKeys = [
  'fillColor', 'color', 'borderColor', 'borderWidth', 'borderRadius',
  'fontSize', 'fontWeight', 'fontStyle', 'shape', 'lineColor',
] as const

export type NodeStyleKey = (typeof nodeStyleKeys)[number]
export type NodeStyleValues = Partial<Pick<NodeData, NodeStyleKey>>

/**
 * Selection data enriched with the styles stored on the node itself. An empty
 * `styleOverrides` means every visual property falls back to the document theme.
 */
export interface SelectedNodeData extends NodeData {
  styleOverrides?: NodeStyleValues
}

interface TemplatePreview {
  fillColor: string
  color: string
  borderColor: string
  borderWidth: number
  borderRadius: number
  fontWeight: string
  fontStyle: string
  shape: NodeShape
}

export interface NodeStyleTemplate {
  id: string
  label: string
  /** Applied as a whole; `undefined` clears a property back to the document theme. */
  style: NodeStyleValues
  preview: TemplatePreview
  /** Drops every node-level override so the node follows its theme layer again. */
  reset?: boolean
}

function preview(fillColor: string, color: string, borderColor: string, borderWidth: number, borderRadius: number, shape: NodeShape, fontWeight = 'normal', fontStyle = 'normal'): TemplatePreview {
  return { fillColor, color, borderColor, borderWidth, borderRadius, fontWeight, fontStyle, shape }
}

function resetStyle(): NodeStyleValues {
  return Object.fromEntries(nodeStyleKeys.map((key) => [key, undefined])) as NodeStyleValues
}

/**
 * Built-in node templates. Theme families (emphasis, soft, outline, title, pill) are
 * derived from the active document theme so they always match the map; the
 * semantic ones (note, alert, night) carry a fixed palette.
 */
export function nodeStyleTemplates(theme: MapTheme): NodeStyleTemplate[] {
  const [accent, light, line] = theme.colors
  return [
    {
      id: 'theme', label: '跟随主题', reset: true,
      style: resetStyle(),
      preview: preview(light, accent, line, 1, 6, 'roundedRectangle'),
    },
    {
      id: 'accent', label: '强调',
      style: { fillColor: accent, color: '#ffffff', borderColor: accent, borderWidth: 0, borderRadius: 6, fontSize: undefined, fontWeight: 'bold', fontStyle: 'normal', shape: 'roundedRectangle' },
      preview: preview(accent, '#ffffff', accent, 0, 6, 'roundedRectangle', 'bold'),
    },
    {
      id: 'soft', label: '浅底',
      style: { fillColor: light, color: accent, borderColor: line, borderWidth: 1, borderRadius: 6, fontSize: undefined, fontWeight: 'normal', fontStyle: 'normal', shape: 'roundedRectangle' },
      preview: preview(light, accent, line, 1, 6, 'roundedRectangle'),
    },
    {
      id: 'outline', label: '轮廓',
      style: { fillColor: '#ffffff', color: accent, borderColor: accent, borderWidth: 2, borderRadius: 6, fontSize: undefined, fontWeight: 'bold', fontStyle: 'normal', shape: 'roundedRectangle' },
      preview: preview('#ffffff', accent, accent, 2, 6, 'roundedRectangle', 'bold'),
    },
    {
      id: 'title', label: '标题',
      style: { fillColor: light, color: accent, borderColor: light, borderWidth: 0, borderRadius: 0, fontSize: 18, fontWeight: 'bold', fontStyle: 'normal', shape: 'rectangle' },
      preview: preview(light, accent, light, 0, 0, 'rectangle', 'bold'),
    },
    {
      id: 'pill', label: '胶囊',
      style: { fillColor: light, color: accent, borderColor: line, borderWidth: 1, borderRadius: 999, fontSize: undefined, fontWeight: 'normal', fontStyle: 'normal', shape: 'ellipse' },
      preview: preview(light, accent, line, 1, 999, 'ellipse'),
    },
    {
      id: 'note', label: '便签',
      style: { fillColor: '#fff4cf', color: '#6f5411', borderColor: '#ecd9a4', borderWidth: 1, borderRadius: 4, fontSize: undefined, fontWeight: 'normal', fontStyle: 'normal', shape: 'rectangle' },
      preview: preview('#fff4cf', '#6f5411', '#ecd9a4', 1, 4, 'rectangle'),
    },
    {
      id: 'alert', label: '警示',
      style: { fillColor: '#fdecea', color: '#a02c26', borderColor: '#efb4ae', borderWidth: 1, borderRadius: 6, fontSize: undefined, fontWeight: 'bold', fontStyle: 'normal', shape: 'roundedRectangle' },
      preview: preview('#fdecea', '#a02c26', '#efb4ae', 1, 6, 'roundedRectangle', 'bold'),
    },
    {
      id: 'night', label: '夜幕',
      style: { fillColor: '#2c3444', color: '#eef1f7', borderColor: '#2c3444', borderWidth: 0, borderRadius: 6, fontSize: undefined, fontWeight: 'normal', fontStyle: 'normal', shape: 'roundedRectangle' },
      preview: preview('#2c3444', '#eef1f7', '#2c3444', 0, 6, 'roundedRectangle'),
    },
  ]
}
