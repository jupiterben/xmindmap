import type { Layout, MindNode, NodeData, ThemeConfig } from '../domain/types'
import type { NodeIcon } from '../domain/icons'

export interface EngineNode {
  isRoot: boolean
  children: EngineNode[]
  style: { merge<K extends keyof NodeData>(key: K): NodeData[K] }
  getData(): NodeData
  getData<K extends keyof NodeData>(key: K): NodeData[K]
  active(): void
  setText(text: string): void
  setNote(note: string): void
  setHyperlink(link: string, title: string): void
  setTag(tags: string[]): void
  setIcon(icons: NodeIcon[]): void
  setImage(data: { url: string; title: string; width: number; height: number }): void
  setStyle<K extends keyof NodeData>(property: K, value: NodeData[K]): void
}

export interface EngineEvents {
  node_active: [node: EngineNode | null, nodes: EngineNode[]]
  data_change: [root: MindNode]
  back_forward: [index: number, length: number]
  scale: [scale: number]
  node_tree_render_end: []
}

export interface EngineOptions {
  el: HTMLElement
  data: MindNode
  layout: Layout
  themeConfig: ThemeConfig
  fit: boolean
  fitPadding: number
  addHistoryTime: number
  maxHistoryCount: number
  minZoomRatio: number
  maxZoomRatio: number
  mousewheelAction: 'move' | 'zoom'
  defaultInsertSecondLevelNodeText: string
  defaultInsertBelowSecondLevelNodeText: string
  enableAutoEnterTextEditWhenKeydown: boolean
  enableFreeDrag: boolean
  resetScaleOnMoveNodeToCenter: boolean
  customCheckEnableShortcut: (event: KeyboardEvent) => boolean
  customHyperlinkJump: (link: string) => void
  errorHandler: (code: string, error: unknown) => void
}

export type SimpleCommand =
  | 'BACK' | 'FORWARD' | 'REMOVE_NODE' | 'EXPAND_ALL' | 'UNEXPAND_ALL'
  | 'UP_NODE' | 'DOWN_NODE' | 'MOVE_UP_ONE_LEVEL'
