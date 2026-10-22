export interface SplitPaneHandle {
  element: HTMLElement
  /** uid of the node under the pointer in this pane, or '' for empty space. */
  targetUidAt(clientX: number, clientY: number): string
  /** Highlight the node that would receive the drop. */
  hover(clientX: number, clientY: number): void
  leave(): void
}

const handles = new Set<SplitPaneHandle>()

export function registerSplitPane(handle: SplitPaneHandle): () => void {
  handles.add(handle)
  return () => { handles.delete(handle) }
}

/**
 * Find the registered pane under the pointer. The source pane is excluded so a
 * drag that starts and ends on the same canvas never leaves the map.
 */
export function findSplitPaneAt(clientX: number, clientY: number, source: HTMLElement): SplitPaneHandle | undefined {
  for (const handle of handles) {
    if (handle.element === source || !handle.element.isConnected) continue
    const rect = handle.element.getBoundingClientRect()
    if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) return handle
  }
  return undefined
}
