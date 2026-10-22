import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  createDocument, createExample, loadWorkspace, sameTree, saveWorkspace, serializeDocument, STORAGE_KEY, validateTree,
} from '../domain/documents'
import type { MapDocument, MindNode, Workspace } from '../domain/types'
import { isVsCode } from '../platform/vscode'
import { isDesktop, pickDesktopSavePath, writeDesktopTextFile } from '../platform/desktop'
import { useVsCodeWorkspace } from './useVsCodeWorkspace'

export function useWorkspace() {
  if (isVsCode) return useVsCodeWorkspace()
  const storageError = ref('')
  const fileError = ref('')
  const error = computed(() => storageError.value || fileError.value)
  const saved = ref(true)
  let blocked = false
  let initial: Workspace | null = null
  try { initial = loadWorkspace(localStorage) } catch {
    blocked = true
    storageError.value = '本地数据无法读取，自动保存已暂停。请导出当前文档，并备份原始数据。'
  }
  const example = createExample()
  const workspace = ref<Workspace>(initial ?? { version: 1, activeId: example.id, documents: [example] })
  const active = computed(() => workspace.value.documents.find((doc) => doc.id === workspace.value.activeId)!)
  let timer: ReturnType<typeof setTimeout> | undefined
  let fileQueue: Promise<void> = Promise.resolve()
  // Only documents edited in this session are written back, so opening a file never
  // normalizes or rewrites it behind the user's back.
  const dirtyFiles = new Set<string>()
  // Documents edited since the last successful write to their bound file. Unbound
  // documents stay here until the user picks a path, so "新建" can offer to save them.
  const unsavedIds = ref<ReadonlySet<string>>(new Set<string>())
  function markUnsaved(id: string) {
    if (unsavedIds.value.has(id)) return
    unsavedIds.value = new Set(unsavedIds.value).add(id)
  }
  function markSaved(id: string) {
    if (!unsavedIds.value.has(id)) return
    const next = new Set(unsavedIds.value)
    next.delete(id)
    unsavedIds.value = next
  }
  /** True when a document has edits that are not yet in its file (desktop only). */
  function hasUnsavedChanges(id = active.value.id) {
    return isDesktop && unsavedIds.value.has(id)
  }

  function queueFileWrites() {
    if (!isDesktop || blocked) return
    for (const doc of workspace.value.documents) {
      const path = doc.filePath
      if (!path || !dirtyFiles.has(doc.id)) continue
      dirtyFiles.delete(doc.id)
      const content = serializeDocument(doc)
      fileQueue = fileQueue.then(async () => {
        try {
          await writeDesktopTextFile(path, content)
          // Do not clear edits made while this write was in flight.
          if (serializeDocument(doc) === content) markSaved(doc.id)
          fileError.value = ''
        } catch (reason) {
          if (doc.filePath === path) doc.filePath = undefined
          fileError.value = `无法写入关联文件，已改为仅保存到本机：${reason instanceof Error ? reason.message : String(reason)}`
          saved.value = false
        }
      })
    }
  }

  function flush() {
    clearTimeout(timer)
    if (blocked) return
    try {
      saveWorkspace(localStorage, workspace.value)
      saved.value = true
      storageError.value = ''
    } catch {
      saved.value = false
      storageError.value = '本地保存失败，存储空间可能已满。请立即导出 JSON 备份。'
    }
    queueFileWrites()
  }

  /** Saves the active document to its bound file, asking for a path when unbound. */
  async function saveToFile(): Promise<boolean> {
    if (!isDesktop) return false
    const doc = active.value
    if (!doc.filePath) {
      const path = await pickDesktopSavePath(`${doc.title}.xmm`)
      if (!path) return false
      doc.filePath = path
    }
    const path = doc.filePath
    // Normalize before binding so later engine render events compare equal and are not
    // mistaken for edits.
    doc.root = validateTree(doc.root)
    try {
      await writeDesktopTextFile(path, serializeDocument(doc))
      dirtyFiles.delete(doc.id)
      markSaved(doc.id)
      fileError.value = ''
    } catch (reason) {
      if (doc.filePath === path) doc.filePath = undefined
      throw new Error(`文件保存失败：${reason instanceof Error ? reason.message : String(reason)}`)
    }
    flush()
    return true
  }

  watch(workspace, () => {
    saved.value = false
    clearTimeout(timer)
    timer = setTimeout(flush, 350)
  }, { deep: true })

  function touch() {
    active.value.updatedAt = new Date().toISOString()
    dirtyFiles.add(active.value.id)
    markUnsaved(active.value.id)
  }
  function updateRoot(root: MindNode) {
    // Undo events share the engine's live tree; keep renderer caches out of saved data.
    const next = validateTree(root)
    // Rendering and history setup also emit data_change; identical trees are not edits.
    if (sameTree(next, active.value.root)) return
    active.value.root = next
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
    const removedId = active.value.id
    markSaved(removedId)
    dirtyFiles.delete(removedId)
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
  function importDocument(doc: MapDocument) { fileError.value = ''; add(doc) }
  function rawBackup(): string { return localStorage.getItem(STORAGE_KEY) ?? '' }

  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      blocked = true
      saved.value = false
      storageError.value = '其他标签页修改了文档，已暂停本页自动保存。请导出本页修改后刷新。'
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

  return { workspace, active, saved, error, loaded: ref(true), updateRoot, add, duplicate, remove, select, rename, importDocument, touch, flush, saveToFile, hasUnsavedChanges, rawBackup, setCapture: (_callback: () => void) => {} }
}
