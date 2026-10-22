// Narrow, checked contract for the upstream JavaScript modules used by this app.
// Keep this boundary aligned with simple-mind-map 0.14.0-fix.3.
declare module 'simple-mind-map/index.js' {
  type EngineEvents = import('./types').EngineEvents
  type EngineNode = import('./types').EngineNode
  type EngineOptions = import('./types').EngineOptions
  type SimpleCommand = import('./types').SimpleCommand
  type Layout = import('../domain/types').Layout
  type MindNode = import('../domain/types').MindNode
  type ThemeConfig = import('../domain/types').ThemeConfig

  export default class MindMap {
    constructor(options: EngineOptions)
    static usePlugin(plugin: unknown): typeof MindMap
    /** Container element the map was mounted into. */
    el: HTMLElement
    on<K extends keyof EngineEvents>(event: K, callback: (...args: EngineEvents[K]) => void): void
    off<K extends keyof EngineEvents>(event: K, callback: (...args: EngineEvents[K]) => void): void
    execCommand(command: SimpleCommand): void
    execCommand(command: 'REMOVE_NODE', nodes: EngineNode[]): void
    execCommand(command: 'INSERT_MULTI_CHILD_NODE', nodes: EngineNode[], children: MindNode[]): void
    execCommand(command: 'INSERT_NODE' | 'INSERT_CHILD_NODE' | 'INSERT_PARENT_NODE', edit: boolean, nodes: EngineNode[], data?: { text: string }): void
    execCommand(command: 'SET_NODE_EXPAND', node: EngineNode, expanded: boolean): void
    execCommand(command: 'MOVE_NODE_TO', nodes: EngineNode[], target: EngineNode): void
    getData(): MindNode
    /** Replace the rendered tree while keeping history/view. */
    updateData(data: MindNode): void
    getConfig(key: 'createNewNodeBehavior'): string
    updateConfig(options: { createNewNodeBehavior: string }): void
    setLayout(layout: Layout): void
    setThemeConfig(config: ThemeConfig): void
    resize(): void
    destroy(): void
    export(type: 'png' | 'svg', download: boolean, name: string): Promise<string | undefined>
    view: {
      scale: number
      fit(): void
      enlarge(): void
      narrow(): void
      setScale(scale: number): void
    }
    keyCommand: {
      addShortcut(key: string, fn: () => void): void
      removeShortcut(key: string, fn?: () => void): void
      /** Suspend/resume this map's keyboard shortcuts. */
      pause(): void
      recovery(): void
    }
    renderer: {
      root: EngineNode | null
      activeNodeList: EngineNode[]
      goTargetNode(uid: string): void
      findNodeByUid(uid: string): EngineNode | null
      /** Clear the active list without emitting node_active. */
      clearActiveNodeList(): void
      /** Re-activate several nodes and emit one node_active event. */
      activeMultiNode(nodes: EngineNode[]): void
      textEdit: { hideEditTextBox(): void }
    }
    /** Drag plugin instance, present because the app always enables it. */
    drag?: { isDragging: boolean }
  }
}

declare module 'simple-mind-map/src/plugins/Drag.js' {
  type EngineNode = import('./types').EngineNode
  type MindMapInstance = import('simple-mind-map/index.js').default
  export default class Drag {
    static instanceName: string
    constructor(opt: { mindMap: MindMapInstance; pluginOpt?: unknown })
    mindMap: MindMapInstance
    isDragging: boolean
    isMousedown: boolean
    beingDragNodeList: EngineNode[]
    overlapNode: EngineNode | null
    prevNode: EngineNode | null
    nextNode: EngineNode | null
    checkOverlapNode(): void
    onMouseup(event: MouseEvent): Promise<void>
    onMousemove(event: MouseEvent): void
    beforePluginRemove(): void
    beforePluginDestroy(): void
  }
}
declare module 'simple-mind-map/src/plugins/Export.js' { const plugin: unknown; export default plugin }
declare module 'simple-mind-map/src/plugins/Select.js' { const plugin: unknown; export default plugin }
declare module 'simple-mind-map/src/plugins/KeyboardNavigation.js' { const plugin: unknown; export default plugin }
declare module 'simple-mind-map/src/plugins/TouchEvent.js' { const plugin: unknown; export default plugin }

declare module 'simple-mind-map/src/svg/icons.js' {
  export const nodeIconList: { type: string; name: string; list: { name: string; icon: string }[] }[]
}
