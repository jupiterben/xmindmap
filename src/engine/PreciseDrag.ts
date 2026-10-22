import Drag from 'simple-mind-map/src/plugins/Drag.js'
import { findSplitPaneAt } from './splitPanes'
import type { SplitPaneHandle } from './splitPanes'

export default class PreciseDrag extends Drag {
  /** Split-screen pane currently under the pointer, if any. */
  private externalHandle?: SplitPaneHandle

  // Node mouseup handlers call stopPropagation, so releasing over a node in the
  // other pane never reaches the window bubble listener. Capture it first.
  private readonly onCaptureMouseup = (event: MouseEvent) => {
    if (!this.isMousedown) return
    void this.onMouseup(event)
  }

  constructor(opt: ConstructorParameters<typeof Drag>[0]) {
    super(opt)
    window.addEventListener('mouseup', this.onCaptureMouseup, true)
  }

  override beforePluginDestroy(): void {
    window.removeEventListener('mouseup', this.onCaptureMouseup, true)
    super.beforePluginDestroy()
  }

  override beforePluginRemove(): void {
    window.removeEventListener('mouseup', this.onCaptureMouseup, true)
    super.beforePluginRemove()
  }

  override onMousemove(event: MouseEvent): void {
    super.onMousemove(event)
    if (!this.isDragging) {
      this.clearExternal()
      return
    }
    const handle = findSplitPaneAt(event.clientX, event.clientY, this.mindMap.el)
    if (handle !== this.externalHandle) {
      this.externalHandle?.leave()
      this.externalHandle = handle
    }
    handle?.hover(event.clientX, event.clientY)
  }

  override async onMouseup(event: MouseEvent): Promise<void> {
    // Upstream throttles hit testing by 300ms. Resolve the final pointer
    // position before it removes the drag preview and commits the move.
    if (this.isDragging) super.checkOverlapNode()
    const wasDragging = this.isMousedown && this.isDragging
    const draggedNodes = wasDragging ? [...this.beingDragNodeList] : []
    const handle = wasDragging ? findSplitPaneAt(event.clientX, event.clientY, this.mindMap.el) : undefined
    // Both panes render the same document, so dropping across panes is still a
    // move inside one tree: resolve the target node by uid in this engine.
    const targetUid = handle ? handle.targetUidAt(event.clientX, event.clientY) : ''
    if (handle) {
      // Dropping on another pane must never reorder the source view on its own.
      this.overlapNode = null
      this.prevNode = null
      this.nextNode = null
    }
    await super.onMouseup(event)
    this.clearExternal()
    if (!handle || !targetUid || !draggedNodes.length) return
    const target = this.mindMap.renderer.findNodeByUid(targetUid)
    if (!target) return
    // Moving a node into its own subtree would create a cycle.
    if (draggedNodes.some((node) => node.uid === targetUid || node.isAncestor(target))) return
    this.mindMap.execCommand('MOVE_NODE_TO', draggedNodes, target)
  }

  private clearExternal(): void {
    if (!this.externalHandle) return
    this.externalHandle.leave()
    this.externalHandle = undefined
  }
}
