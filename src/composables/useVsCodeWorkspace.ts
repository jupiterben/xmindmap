import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { createDocument, openMindMapText, parseDocument, serializeDocument, validateTree } from '../domain/documents'
import type { MindNode, Workspace } from '../domain/types'
import { hostRequest, vscode } from '../platform/vscode'

export function useVsCodeWorkspace() {
  const placeholder = createDocument('正在打开文件')
  const workspace = ref<Workspace>({ version: 1, activeId: placeholder.id, documents: [placeholder] })
  const active = computed(() => workspace.value.documents[0]!)
  const error = ref('')
  const saved = ref(true)
  const loaded = ref(false)
  let version = 0
  let acknowledged = ''
  let inFlight: string | null = null
  let snapshotRequest: unknown = null
  let applying = false
  let blocked = false
  let saveRequested = false
  let capture: (() => void) | undefined

  function pump() {
    if (!loaded.value || blocked || applying || inFlight !== null) return
    const content = serializeDocument(active.value)
    if (content !== acknowledged) {
      inFlight = content
      saved.value = false
      vscode?.postMessage({ type: 'edit', version, content })
    } else if (saveRequested) {
      saveRequested = false
      void hostRequest('save').catch((reason: unknown) => { error.value = String(reason) })
    }
  }

  // Coalesce synchronous field changes but send edits without a persistence delay.
  watch(() => serializeDocument(active.value), () => pump(), { flush: 'post' })

  function onMessage(event: MessageEvent<unknown>) {
    const message = event.data
    if (!message || typeof message !== 'object' || !('type' in message)) return
    if (message.type === 'snapshotCancelled' && 'id' in message && message.id === snapshotRequest) {
      snapshotRequest = null
      inFlight = null
      pump()
      return
    }
    if (message.type === 'snapshot' && 'id' in message) {
      if (blocked || !loaded.value || inFlight !== null) {
        vscode?.postMessage({ type: 'snapshotResult', id: message.id, content: null })
        return
      }
      applying = true
      capture?.()
      applying = false
      snapshotRequest = message.id
      inFlight = serializeDocument(active.value)
      vscode?.postMessage({ type: 'snapshotResult', id: message.id, content: inFlight })
      return
    }
    if (message.type === 'error' && 'message' in message && typeof message.message === 'string') {
      blocked = true
      saved.value = false
      error.value = message.message
      return
    }
    if (message.type === 'ack' && 'version' in message && typeof message.version === 'number') {
      version = message.version
      acknowledged = 'content' in message && typeof message.content === 'string' ? message.content : inFlight ?? acknowledged
      inFlight = null
      snapshotRequest = null
      saved.value = 'dirty' in message && !message.dirty
      pump()
      return
    }
    if (message.type === 'saved') {
      if (!inFlight && serializeDocument(active.value) === acknowledged) saved.value = true
      return
    }
    if (message.type !== 'document' || !('text' in message) || typeof message.text !== 'string' || !('version' in message) || typeof message.version !== 'number') return
    if (loaded.value && (inFlight !== null || serializeDocument(active.value) !== acknowledged)) {
      blocked = true
      error.value = '文件已被其他编辑器修改。已暂停同步，请导出当前修改后重新打开文件。'
      saved.value = false
      return
    }
    try {
      const doc = openMindMapText(message.text, '导图')
      applying = true
      acknowledged = serializeDocument(doc)
      version = message.version
      workspace.value = { version: 1, activeId: doc.id, documents: [doc] }
      loaded.value = true
      saved.value = 'dirty' in message && !message.dirty
      blocked = false
      error.value = ''
    } catch {
      error.value = '文件不是有效导图，请使用 VS Code 文本编辑器修复 JSON 后重新打开。'
      blocked = true
    } finally { applying = false }
  }
  window.addEventListener('message', onMessage)
  vscode?.postMessage({ type: 'ready' })
  onBeforeUnmount(() => window.removeEventListener('message', onMessage))

  function touch() { active.value.updatedAt = new Date().toISOString() }
  function updateRoot(root: MindNode) { active.value.root = validateTree(root); touch() }
  function flush() { saveRequested = true; pump() }
  function add(doc = createDocument()) {
    void hostRequest('create', { content: serializeDocument(doc) }).catch((reason: unknown) => { error.value = String(reason) })
  }
  function duplicate() {
    const copy = parseDocument(JSON.parse(serializeDocument(active.value)))
    copy.title += ' 副本'
    add(copy)
  }
  function rename(title: string) { active.value.title = title.trim().slice(0, 100) || '未命名导图'; touch() }

  return {
    workspace, active, error, saved, loaded, updateRoot, touch, flush, add, duplicate, rename,
    importDocument: add,
    select: (_id: string) => {},
    remove: () => {},
    rawBackup: () => serializeDocument(active.value),
    setCapture: (callback: () => void) => { capture = callback },
  }
}
