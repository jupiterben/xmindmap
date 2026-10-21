import type MindMap from 'simple-mind-map/index.js'

interface CanvasPanMap {
  opt: { isDisableDrag?: boolean }
  event: {
    mousedownPos: { x: number; y: number }
    emit(event: string, ...args: unknown[]): boolean
  }
  execCommand(command: string, ...args: unknown[]): void
  renderer: {
    clearActiveNodeListOnDrawClick(event: MouseEvent, eventType: string): void
  }
}

export function keepSelectionOnPan(map: MindMap) {
  const pan = map as unknown as CanvasPanMap
  // Upstream clears the active node on the first canvas drag, then again
  // on the click that a completed pan still emits.
  let ignoreCanvasClear = false
  const emit = pan.event.emit.bind(pan.event)
  pan.event.emit = (event, ...args) => {
    const pointer = args[0]
    const panning = event === 'drag'
      && pointer instanceof MouseEvent
      && !pointer.ctrlKey
      && !pointer.metaKey
      && !pan.opt.isDisableDrag
    if (panning) ignoreCanvasClear = true
    try {
      return emit(event, ...args)
    } finally {
      ignoreCanvasClear = false
    }
  }

  const exec = pan.execCommand.bind(pan)
  pan.execCommand = (command, ...args) => {
    if (command === 'CLEAR_ACTIVE_NODE' && ignoreCanvasClear) return
    exec(command, ...args)
  }

  const clearOnClick = pan.renderer.clearActiveNodeListOnDrawClick.bind(pan.renderer)
  pan.renderer.clearActiveNodeListOnDrawClick = (event, eventType) => {
    if (eventType === 'click') {
      const start = pan.event.mousedownPos
      if (Math.abs(event.clientX - start.x) > 5 || Math.abs(event.clientY - start.y) > 5) return
    }
    clearOnClick(event, eventType)
  }
}
