import { markRaw, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'
import MindMap from 'simple-mind-map/index.js'
import Drag from '../engine/PreciseDrag'
import { keepSelectionOnPan } from '../engine/keepSelectionOnPan'
import Export from 'simple-mind-map/src/plugins/Export.js'
import Select from 'simple-mind-map/src/plugins/Select.js'
import KeyboardNavigation from 'simple-mind-map/src/plugins/KeyboardNavigation.js'
import TouchEvent from 'simple-mind-map/src/plugins/TouchEvent.js'
import type { MapDocument, MindNode, NodeData } from '../domain/types'
import type { EngineNode, SimpleCommand } from '../engine/types'
import { getDocumentTheme } from '../domain/themes'
import { hostRequest, isVsCode } from '../platform/vscode'
import { isDesktop, saveDesktopDataUrl } from '../platform/desktop'
import { isNodeIcon, normalizeIcons, replaceIcon } from '../domain/icons'
import type { NodeIcon } from '../domain/icons'
import { createNode, flattenTree, MAX_FILE_SIZE, sameTree, serializeDocument, validateTree } from '../domain/documents'
import { nodeStyleKeys } from '../domain/nodeStyles'
import type { NodeStyleValues, SelectedNodeData } from '../domain/nodeStyles'
import { buildMapOutline, uniqueTopics } from '../domain/ai'
import type { AiExpansionTarget, AiMapChange, AiMapContext } from '../domain/ai'

MindMap.usePlugin(Drag).usePlugin(Export).usePlugin(Select).usePlugin(KeyboardNavigation).usePlugin(TouchEvent)

export function useMindMap(
  container: Ref<HTMLElement | null>,
  doc: Ref<MapDocument>,
  update: (root: MindNode) => void,
  reportError: (message: string) => void,
  openLink: (link: string) => void,
) {
  const engine = shallowRef<MindMap | null>(null)
  const selection = ref<SelectedNodeData[]>([])
  const zoom = ref(100)
  const canUndo = ref(false)
  const canRedo = ref(false)
  const ready = ref(false)
  let observer: ResizeObserver | undefined
  let resizeFrame = 0
  let disposed = false
  let engineDocumentId = ''
  // Selection to restore after this pane receives a change from the other split pane.
  let pendingActiveUids: string[] | null = null
  // Last tree applied from the peer, used to ignore its delayed data_change echo.
  let lastExternalRoot: MindNode | null = null
  // Peer change received while this engine was not ready or was dragging.
  let pendingExternalRoot: MindNode | null = null
  function isSameExternal(root: MindNode, expected: MindNode): boolean {
    try { return sameTree(validateTree(root), expected) } catch { return false }
  }

  function refreshSelection(nodes: EngineNode[]) {
    selection.value = nodes.map((node) => {
      const data = node.getData()
      // Keep the node's own style overrides separate from the merged values the
      // theme contributes; the inspector needs both to show and reset templates.
      const overrides: NodeStyleValues = {}
      for (const key of nodeStyleKeys) {
        const value = data[key]
        if (value !== undefined) (overrides as Record<string, unknown>)[key] = value
      }
      return {
        ...data,
        fontSize: node.style.merge('fontSize'),
        fontWeight: node.style.merge('fontWeight'),
        fontStyle: node.style.merge('fontStyle'),
        fillColor: node.style.merge('fillColor'),
        color: node.style.merge('color'),
        shape: node.style.merge('shape'),
        borderColor: node.style.merge('borderColor'),
        borderWidth: node.style.merge('borderWidth'),
        borderRadius: node.style.merge('borderRadius'),
        styleOverrides: overrides,
      }
    })
  }
  function capture() {
    const map = engine.value
    if (!map || !ready.value) return
    map.renderer.textEdit.hideEditTextBox()
    update(map.getData())
  }
  function destroy() {
    cancelAnimationFrame(resizeFrame)
    observer?.disconnect()
    const previous = engine.value
    engine.value = null
    engineDocumentId = ''
    ready.value = false
    previous?.destroy()
  }

  watch([container, () => doc.value.id], ([element]) => {
    destroy()
    pendingActiveUids = null
    lastExternalRoot = null
    pendingExternalRoot = null
    if (!element || disposed) return
    selection.value = []
    canUndo.value = false
    canRedo.value = false
    const map = markRaw(new MindMap({
      el: element,
      data: JSON.parse(JSON.stringify(doc.value.root)) as MindNode,
      layout: doc.value.layout,
      themeConfig: getDocumentTheme(doc.value),
      fit: false,
      fitPadding: 48,
      addHistoryTime: 100,
      maxHistoryCount: 100,
      minZoomRatio: 20,
      maxZoomRatio: 300,
      mousewheelAction: 'zoom',
      // The page hosts a single map; tie shortcuts to focus instead of mouse position so
      // Insert/Tab still work after selecting a node from the outline or toolbar.
      enableShortcutOnlyWhenMouseInSvg: false,
      defaultInsertSecondLevelNodeText: '分支主题',
      defaultInsertBelowSecondLevelNodeText: '新主题',
      enableAutoEnterTextEditWhenKeydown: false,
      enableFreeDrag: false,
      resetScaleOnMoveNodeToCenter: false,
      customHyperlinkJump(link) { openLink(link) },
      customCheckEnableShortcut(event) {
        const target = event.target
        if (!(target instanceof Element)) return false
        if (document.querySelector('dialog[open]')) return false
        return target === document.body || !!target.closest('.smm-mind-map-container, .smm-node-edit-wrap')
      },
      errorHandler(code, error) {
        console.error(`Mind map: ${code}`, error)
        reportError('导图操作失败，请重试或导出 JSON 备份')
      },
    }))
    keepSelectionOnPan(map)
    engine.value = map
    engineDocumentId = doc.value.id
    const documentId = doc.value.id
    // Upstream rendering/history is deferred and can finish after destroy().
    const isCurrent = () => !disposed && engine.value === map && doc.value.id === documentId
    map.on('node_active', (_node, nodes) => { if (isCurrent()) refreshSelection(nodes) })
    map.on('data_change', (root) => {
      if (!isCurrent()) return
      // updateData records history asynchronously; ignore that echo so a stale
      // mirrored tree can never overwrite a newer edit in this pane.
      if (root && lastExternalRoot && isSameExternal(root, lastExternalRoot)) {
        lastExternalRoot = null
      } else if (root) {
        update(root)
      }
      refreshSelection(map.renderer.activeNodeList)
    })
    map.on('back_forward', (index, length) => {
      if (!isCurrent()) return
      canUndo.value = index > 0
      canRedo.value = index < length - 1
    })
    map.on('scale', (scale) => { if (isCurrent()) zoom.value = Math.round(scale * 100) })
    map.on('node_tree_render_end', () => {
      if (!isCurrent() || !element.isConnected) return
      if (!ready.value) {
        ready.value = true
        map.view.fit()
        map.renderer.root?.active()
      }
      if (pendingActiveUids) {
        const uids = pendingActiveUids
        pendingActiveUids = null
        const nodes = uids.flatMap((uid) => {
          const node = map.renderer.findNodeByUid(uid)
          return node ? [node] : []
        })
        if (nodes.length) map.renderer.activeMultiNode(nodes)
      }
      refreshSelection(map.renderer.activeNodeList)
      // A change arrived while this pane was still loading or dragging.
      if (pendingExternalRoot && !map.drag?.isDragging) {
        const root = pendingExternalRoot
        pendingExternalRoot = null
        applyExternal(root)
      }
    })
    observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame)
      resizeFrame = requestAnimationFrame(() => { if (engine.value === map) map.resize() })
    })
    observer.observe(element)
  }, { flush: 'post' })

  watch(() => doc.value.layout, (layout) => {
    if (engineDocumentId === doc.value.id) engine.value?.setLayout(layout)
  })
  watch([() => doc.value.themeId, () => doc.value.lineStyle], () => {
    if (engineDocumentId === doc.value.id) engine.value?.setThemeConfig(getDocumentTheme(doc.value))
  })
  onBeforeUnmount(() => { disposed = true; destroy() })

  function command(command: SimpleCommand) {
    engine.value?.execCommand(command)
  }
  function insert(kind: 'child' | 'sibling' | 'parent') {
    const map = engine.value
    if (!map) return
    const nodes = map.renderer.activeNodeList.length ? map.renderer.activeNodeList : map.renderer.root ? [map.renderer.root] : []
    const cmd = kind === 'child' ? 'INSERT_CHILD_NODE' : kind === 'parent' ? 'INSERT_PARENT_NODE' : 'INSERT_NODE'
    // Open the inline text editor on the new node, matching the keyboard shortcuts.
    map.execCommand(cmd, true, nodes)
  }
  function select(uid: string) { engine.value?.renderer.goTargetNode(uid) }
  function expansionTarget(previous?: AiExpansionTarget): AiExpansionTarget {
    if (previous && previous.documentId !== doc.value.id) throw new Error('文档已切换，请重新打开对话')
    const uid = previous?.uid ?? selection.value[0]?.uid
    if (!uid || (!previous && selection.value.length !== 1)) throw new Error('请选择一个节点进行 AI 扩展')
    const node = flattenTree(validateTree(engine.value?.getData() ?? doc.value.root)).find((item) => item.node.data.uid === uid)?.node
    if (!node) throw new Error('节点不存在')
    return {
      documentId: doc.value.id,
      uid,
      topic: node.data.text,
      existing: node.children.slice(0, 50).map((child) => child.data.text.slice(0, 200)),
      fingerprint: JSON.stringify([node.data.text, node.children.map((child) => [child.data.uid, child.data.text])]),
    }
  }
  function applyExpansion(target: AiExpansionTarget, topics: string[]) {
    const map = engine.value
    if (!map || target.documentId !== doc.value.id) throw new Error('文档已切换，请重新生成')
    const root = validateTree(map.getData())
    const node = flattenTree(root).find((item) => item.node.data.uid === target.uid)?.node
    const engineNode = map.renderer.findNodeByUid(target.uid)
    if (!node || !engineNode) throw new Error('目标节点不存在，请重新选择')
    const fingerprint = JSON.stringify([node.data.text, node.children.map((child) => [child.data.uid, child.data.text])])
    if (fingerprint !== target.fingerprint) throw new Error('目标节点已发生变化，请重新生成')
    const children = uniqueTopics(topics, node.children.map((child) => child.data.text)).map((text) => createNode(text))
    node.children.push(...children)
    validateTree(root)
    if (new TextEncoder().encode(serializeDocument({ ...doc.value, root })).byteLength > MAX_FILE_SIZE) throw new Error('插入后文档超过 5 MB，请减少内容')
    // Keep the conversation on its source node rather than selecting generated children.
    const behavior = map.getConfig('createNewNodeBehavior')
    try {
      map.updateConfig({ createNewNodeBehavior: 'notActive' })
      map.execCommand('INSERT_MULTI_CHILD_NODE', [engineNode], children)
    } finally { map.updateConfig({ createNewNodeBehavior: behavior }) }
    return {
      ...target,
      existing: node.children.slice(0, 50).map((child) => child.data.text.slice(0, 200)),
      fingerprint: JSON.stringify([node.data.text, node.children.map((child) => [child.data.uid, child.data.text])]),
    }
  }
  function mapContext(): AiMapContext {
    const root = validateTree(engine.value?.getData() ?? doc.value.root)
    return { documentId: doc.value.id, title: doc.value.title.slice(0, 100), ...buildMapOutline(root) }
  }
  function applyMapChanges(context: AiMapContext, changes: AiMapChange[]) {
    const map = engine.value
    if (!map || context.documentId !== doc.value.id) throw new Error('文档已切换，请重新生成')
    const root = validateTree(map.getData())
    if (buildMapOutline(root).fingerprint !== context.fingerprint) throw new Error('导图已发生变化，请重新生成')
    const located = new Map<string, { node: MindNode; parent: MindNode | null }>()
    const walk = (node: MindNode, parent: MindNode | null) => {
      located.set(node.data.uid, { node, parent })
      node.children.forEach((child) => walk(child, node))
    }
    walk(root, null)
    const removed = new Set(changes.filter((change) => change.op === 'remove').map((change) => change.uid))
    const topRemoved = [...removed].filter((uid) => {
      let parent = located.get(uid)?.parent
      while (parent) {
        if (removed.has(parent.data.uid)) return false
        parent = located.get(parent.data.uid)?.parent ?? null
      }
      return true
    })
    const grouped = new Map<string, string[]>()
    const draft = JSON.parse(JSON.stringify(root)) as MindNode
    const draftNodes = new Map<string, MindNode>()
    const walkDraft = (node: MindNode) => { draftNodes.set(node.data.uid, node); node.children.forEach(walkDraft) }
    walkDraft(draft)
    for (const uid of removed) {
      const current = draftNodes.get(uid)
      const parent = current && [...draftNodes.values()].find((item) => item.children.includes(current))
      if (!current || !parent) throw new Error('要删除的节点不存在')
      parent.children = parent.children.filter((child) => child !== current)
    }
    for (const change of changes) {
      if (change.op === 'rename') {
        const current = draftNodes.get(change.uid)
        if (!current || removed.has(change.uid)) throw new Error('要改名的节点不存在')
        current.data.text = change.text
      }
      if (change.op === 'add') {
        const parent = draftNodes.get(change.parent)
        if (!parent || removed.has(change.parent)) throw new Error('要新增到的节点不存在')
        if (parent.children.some((child) => child.data.text.trim().toLocaleLowerCase() === change.text.toLocaleLowerCase())) continue
        parent.children.push(createNode(change.text))
        grouped.set(change.parent, [...(grouped.get(change.parent) ?? []), change.text])
      }
    }
    validateTree(draft)
    if (new TextEncoder().encode(serializeDocument({ ...doc.value, root: draft })).byteLength > MAX_FILE_SIZE) throw new Error('修改后文档超过 5 MB，请减少内容')
    const removeNodes = topRemoved.flatMap((uid) => {
      const engineNode = map.renderer.findNodeByUid(uid)
      return engineNode && !engineNode.isRoot ? [engineNode] : []
    })
    if (removeNodes.length) map.execCommand('REMOVE_NODE', removeNodes)
    for (const change of changes) {
      if (change.op !== 'rename' || removed.has(change.uid)) continue
      map.renderer.findNodeByUid(change.uid)?.setText(change.text)
    }
    const behavior = map.getConfig('createNewNodeBehavior')
    try {
      map.updateConfig({ createNewNodeBehavior: 'notActive' })
      for (const [uid, texts] of grouped) {
        const engineNode = map.renderer.findNodeByUid(uid)
        if (!engineNode) throw new Error('要新增到的节点不存在')
        map.execCommand('INSERT_MULTI_CHILD_NODE', [engineNode], uniqueTopics(texts).map((text) => createNode(text)))
      }
    } finally { map.updateConfig({ createNewNodeBehavior: behavior }) }
  }
  function setIcon(icon: NodeIcon) {
    if (!isNodeIcon(icon)) return
    const nodes = [...(engine.value?.renderer.activeNodeList ?? [])]
    const remove = nodes.every((node) => node.getData('icon')?.includes(icon))
    nodes.forEach((node) => node.setIcon(replaceIcon(normalizeIcons(node.getData('icon')), icon, remove)))
    refreshSelection(nodes)
  }
  function clearIcons() {
    const nodes = [...(engine.value?.renderer.activeNodeList ?? [])]
    nodes.forEach((node) => node.setIcon([]))
    refreshSelection(nodes)
  }
  function remove(uid: string) {
    const node = engine.value?.renderer.findNodeByUid(uid)
    if (node && !node.isRoot) engine.value?.execCommand('REMOVE_NODE', [node])
  }
  function toggle(uid: string) {
    const node = engine.value?.renderer.findNodeByUid(uid)
    if (node) engine.value?.execCommand('SET_NODE_EXPAND', node, node.getData('expand') === false)
  }
  function editText(uid: string, text: string) {
    if (text.trim()) engine.value?.renderer.findNodeByUid(uid)?.setText(text.trim())
  }
  function style<K extends keyof NodeData>(key: K, value: NodeData[K]) {
    engine.value?.renderer.activeNodeList.forEach((node) => node.setStyle(key, value))
    if (engine.value) refreshSelection(engine.value.renderer.activeNodeList)
  }
  function applyStyles(styles: Partial<NodeData>) {
    const nodes = [...(engine.value?.renderer.activeNodeList ?? [])]
    if (!nodes.length) return
    nodes.forEach((node) => node.setStyles(styles))
    refreshSelection(nodes)
  }
  function properties(values: { text: string; note: string; hyperlink: string; tags: string[] }) {
    const map = engine.value
    if (!map) return
    // A newly inserted node opens the inline editor. Close it first so its text
    // commit cannot land after (and overwrite) the values from this form.
    map.renderer.textEdit.hideEditTextBox()
    const node = map.renderer.activeNodeList[0]
    if (!node) return
    if (values.text.trim()) node.setText(values.text.trim())
    node.setNote(values.note)
    node.setHyperlink(values.hyperlink, values.hyperlink)
    node.setTag(values.tags)
  }
  function zoomBy(direction: 1 | -1) {
    if (direction === 1) engine.value?.view.enlarge()
    else engine.value?.view.narrow()
  }
  function fit() { engine.value?.view.fit() }
  function resetZoom() { engine.value?.view.setScale(1) }

  // Split view. Both panes render the same document; the second pane is another
  // viewport onto the same tree. It only needs hit testing for drop targets,
  // while all mutations go through this engine's normal commands.
  function findNodeAt(clientX: number, clientY: number): EngineNode | null {
    const root = engine.value?.renderer.root
    if (!root) return null
    let found: EngineNode | null = null
    // Children are laid out beside their parent, not inside its box, so every
    // rendered node has to be tested; the deepest hit wins.
    const visit = (node: EngineNode) => {
      const rect = node.getRect()
      if (rect && clientX >= rect.x && clientX <= rect.x + rect.width && clientY >= rect.y && clientY <= rect.y + rect.height) {
        found = node
      }
      node.children.forEach(visit)
    }
    visit(root)
    return found
  }
  function targetUidAt(clientX: number, clientY: number): string {
    if (!ready.value) return ''
    return findNodeAt(clientX, clientY)?.getData('uid') ?? ''
  }
  let highlighted: EngineNode | null = null
  function highlight(node: EngineNode | null) {
    if (highlighted === node) return
    highlighted?.group?.removeClass('split-drop-target')
    highlighted = node
    highlighted?.group?.addClass('split-drop-target')
  }
  function dropHover(clientX: number, clientY: number) {
    if (!ready.value) return
    highlight(findNodeAt(clientX, clientY))
  }
  function clearDropHover() { highlight(null) }
  /**
   * Apply a change made in the other split pane. `updateData` keeps this pane's
   * pan/zoom and records the change in its history; the active nodes are
   * restored by uid after the render because document data carries no selection.
   */
  function applyExternal(root: MindNode) {
    const map = engine.value
    if (!map) return
    // Never replace the tree under an in-flight drag or before the first render;
    // the next render end applies the latest queued tree.
    if (!ready.value || map.drag?.isDragging) {
      pendingExternalRoot = root
      return
    }
    pendingExternalRoot = null
    pendingActiveUids = map.renderer.activeNodeList.map((node) => node.getData('uid'))
    lastExternalRoot = root
    map.renderer.clearActiveNodeList()
    map.updateData(root)
  }
  function setShortcutsEnabled(enabled: boolean) {
    const keyCommand = engine.value?.keyCommand
    if (!keyCommand) return
    if (enabled) keyCommand.recovery()
    else keyCommand.pause()
  }

  async function exportImage(type: 'svg' | 'png') {
    capture()
    const result = await engine.value?.export(type, !isVsCode && !isDesktop, doc.value.title)
    if (!result) throw new Error('图片导出失败，请重试')
    if (isVsCode) return hostRequest('export', { content: result, filename: `${doc.value.title}.${type}`, encoding: 'dataUrl' })
    if (isDesktop) return saveDesktopDataUrl(result, `${doc.value.title}.${type}`)
    return true
  }
  return {
    engine, selection, zoom, canUndo, canRedo, ready, command, insert, select, expansionTarget, applyExpansion,
    mapContext, applyMapChanges, setIcon, clearIcons, remove, toggle, editText, style, applyStyles, properties, zoomBy, fit,
    resetZoom, capture, exportImage, targetUidAt, dropHover, clearDropHover, applyExternal, setShortcutsEnabled,
  }
}
