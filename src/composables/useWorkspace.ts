import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  createDocument, createExample, loadWorkspace, saveWorkspace, STORAGE_KEY, validateTree,
} from '../domain/documents'
import type { MapDocument, MindNode, Workspace } from '../domain/types'
import { isVsCode } from '../platform/vscode'
import { useVsCodeWorkspace } from './useVsCodeWorkspace'

export function useWorkspace() {
  if (isVsCode) return useVsCodeWorkspace()
  const error = ref('')
  const saved = ref(true)
  let blocked = false
  let initial: Workspace | null = null
  try { initial = loadWorkspace(localStorage) } catch {
    blocked = true
    error.value = '本地数据无法读取，自动保存已暂停。请导出当前文档，并备份原始数据。'
  }
  const example = createExample()
  const workspace = ref<Workspace>(initial ?? { version: 1, activeId: example.id, documents: [example] })
  const active = computed(() => workspace.value.documents.find((doc) => doc.id === workspace.value.activeId)!)
  let timer: ReturnType<typeof setTimeout> | undefined

  function flush() {
    clearTimeout(timer)
    if (blocked) return
    try {
      saveWorkspace(localStorage, workspace.value)
      saved.value = true
      error.value = ''
    } catch {
      saved.value = false
      error.value = '本地保存失败，存储空间可能已满。请立即导出 JSON 备份。'
    }
  }

  watch(workspace, () => {
    saved.value = false
    clearTimeout(timer)
    timer = setTimeout(flush, 350)
  }, { deep: true })

  function touch() { active.value.updatedAt = new Date().toISOString() }
  function updateRoot(root: MindNode) {
    // Undo events share the engine's live tree; keep renderer caches out of saved data.
    active.value.root = validateTree(root)
    touch()
  }
  function add(doc = createDocument()) {
    workspace.value.documents.unshift(doc)
    workspace.value.activeId = doc.id
    flush()
  }
  function duplicate() {
    const copy = createDocument(`${active.value.title} 副本`, structuredClone(JSON.parse(JSON.stringify(active.value.root)) as MindNode))
    copy.layout = active.value.layout
    copy.themeId = active.value.themeId
    copy.lineStyle = active.value.lineStyle
    add(copy)
  }
  function remove() {
    workspace.value.documents = workspace.value.documents.filter((doc) => doc.id !== active.value.id)
    if (!workspace.value.documents.length) workspace.value.documents.push(createDocument())
    workspace.value.activeId = workspace.value.documents[0]!.id
    flush()
  }
  function select(id: string) {
    if (workspace.value.documents.some((doc) => doc.id === id)) workspace.value.activeId = id
    flush()
  }
  function rename(title: string) { active.value.title = title.trim().slice(0, 100) || '未命名导图'; touch() }
  function importDocument(doc: MapDocument) { add(doc) }
  function rawBackup(): string { return localStorage.getItem(STORAGE_KEY) ?? '' }

  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      blocked = true
      saved.value = false
      error.value = '其他标签页修改了文档，已暂停本页自动保存。请导出本页修改后刷新。'
    }
  }
  const onVisibility = () => { if (document.visibilityState === 'hidden') flush() }
  window.addEventListener('pagehide', flush)
  window.addEventListener('storage', onStorage)
  document.addEventListener('visibilitychange', onVisibility)
  onBeforeUnmount(() => {
    flush()
    window.removeEventListener('pagehide', flush)
    window.removeEventListener('storage', onStorage)
    document.removeEventListener('visibilitychange', onVisibility)
  })

  return { workspace, active, saved, error, loaded: ref(true), updateRoot, add, duplicate, remove, select, rename, importDocument, touch, flush, rawBackup, setCapture: (_callback: () => void) => {} }
}
