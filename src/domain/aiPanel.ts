import { isRecord } from './documents'

export interface AiPanelAnchor {
  left: number
  bottom: number
}
export interface AiPanelPrefs {
  autoExpand: boolean
  count: number
  expanded: boolean
  anchor: AiPanelAnchor | null
}
export const AI_PANEL_KEY = 'xmindmap.ai.panel.v1'
export const defaultAiPanel: AiPanelPrefs = { autoExpand: true, count: 5, expanded: false, anchor: null }

function coordinate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 20000) throw new Error('面板位置无效')
  return value
}

export function validateAiPanel(value: unknown): AiPanelPrefs {
  if (!isRecord(value) || typeof value.autoExpand !== 'boolean' || typeof value.expanded !== 'boolean') throw new Error('AI 面板设置无效')
  const count = value.count
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 10) throw new Error('AI 面板设置无效')
  if (value.anchor === null) return { autoExpand: value.autoExpand, count, expanded: value.expanded, anchor: null }
  if (!isRecord(value.anchor)) throw new Error('AI 面板设置无效')
  return {
    autoExpand: value.autoExpand,
    count,
    expanded: value.expanded,
    anchor: { left: coordinate(value.anchor.left), bottom: coordinate(value.anchor.bottom) },
  }
}
