import Drag from 'simple-mind-map/src/plugins/Drag.js'

export default class PreciseDrag extends Drag {
  override onMouseup(event: MouseEvent): Promise<void> {
    // Upstream throttles hit testing by 300ms. Resolve the final pointer
    // position before it removes the drag preview and commits the move.
    if (this.isDragging) super.checkOverlapNode()
    return super.onMouseup(event)
  }
}
