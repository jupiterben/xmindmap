<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  ArrowDownToLine, ArrowUpFromLine, Check, ChevronDown, ChevronRight, Copy, Download,
  FilePlus2, FileText, FolderOpen, GitBranch, Keyboard, ListTree, LoaderCircle, Maximize,
  Minus, Moon, Network, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen,
  Plus, Redo2, Save, Search, Settings2, Sparkles, Sun, Trash2, Undo2, Upload, X,
} from 'lucide-vue-next'
import IconButton from './components/IconButton.vue'
import OutlineTree from './components/OutlineTree.vue'
import NodeInspector from './components/NodeInspector.vue'
import MarkdownPreview from './components/MarkdownPreview.vue'
import NodeIconPicker from './components/NodeIconPicker.vue'
import AiChatPanel from './components/AiChatPanel.vue'
import ShortcutSettings from './components/ShortcutSettings.vue'
import type { AiExpansionTarget, AiMapChange, AiMapContext } from './domain/ai'
import { useWorkspace } from './composables/useWorkspace'
import { useMindMap } from './composables/useMindMap'
import { useUiTheme } from './composables/useUiTheme'
import { flattenTree, safeLink, serializeDocument } from './domain/documents'
import { isRelativeMarkdownPath } from './domain/links'
import { downloadText, exportMarkdown, readDocumentFile } from './domain/files'
import { themes } from './domain/themes'
import { layouts, lineStyles, supportsLineStyle } from './domain/types'
import type { Layout, NodeData, ThemeId } from './domain/types'
import { isVsCode, vscode } from './platform/vscode'
import { useAiShortcut } from './composables/useAiShortcut'
import { useCommandShortcuts } from './composables/useCommandShortcuts'
import { shortcutLabel } from './domain/shortcuts'

const store = useWorkspace()
const { active, workspace, error: storageError, saved, loaded } = store
const { theme: uiTheme, toggle: toggleUiTheme } = useUiTheme()
const canvas = ref<HTMLElement | null>(null)
const message = ref('')
const isError = ref(false)
let messageTimer: ReturnType<typeof setTimeout> | undefined
function notify(text: string, error = false) {
  message.value = text
  isError.value = error
  clearTimeout(messageTimer)
  messageTimer = setTimeout(() => { message.value = '' }, error ? 8000 : 3000)
}
const markdownPreview = ref<InstanceType<typeof MarkdownPreview> | null>(null)
function openNodeLink(link: string) {
  if (isRelativeMarkdownPath(link)) {
    void markdownPreview.value?.open(link)
    return
  }
  try {
    const url = safeLink(link)
    if (!/^(https?:|mailto:)/i.test(url)) throw new Error('无法打开链接')
    if (isVsCode) vscode?.postMessage({ type: 'openExternal', url })
    else window.open(url, '_blank', 'noopener,noreferrer')
  } catch (reason) {
    notify(reason instanceof Error ? reason.message : '无法打开链接', true)
  }
}
const map = useMindMap(canvas, active, store.updateRoot, (text) => notify(text, true), openNodeLink)
store.setCapture(map.capture)
const { selection, ready, zoom, canUndo, canRedo } = map
const leftOpen = ref(window.innerWidth > 900)
const rightOpen = ref(false)
const query = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const importInput = ref<HTMLInputElement | null>(null)
const exportMenu = ref<HTMLDetailsElement | null>(null)
const busy = ref(false)
const confirmDialog = ref<HTMLDialogElement | null>(null)
const nodeCount = computed(() => flattenTree(active.value.root).length)
const selectedUid = computed(() => selection.value[0]?.uid)
const isRootSelected = computed(() => selection.value.some((node) => node.uid === active.value.root.data.uid))
const searchResults = computed(() => query.value.trim() ? flattenTree(active.value.root).filter(({ node }) => node.data.text.toLowerCase().includes(query.value.trim().toLowerCase())) : [])
const searchIndex = ref(0)
const aiTarget = ref<AiExpansionTarget | null>(null)
const aiMap = ref<AiMapContext | null>(null)
const aiChatPanel = ref<InstanceType<typeof AiChatPanel> | null>(null)
const aiPanelOpen = ref(true)
function openAi() {
  aiPanelOpen.value = true
  aiChatPanel.value?.focusInput()
}
function toggleAi() {
  aiPanelOpen.value = !aiPanelOpen.value
  if (aiPanelOpen.value) aiChatPanel.value?.focusInput()
}
function applyAi(target: AiExpansionTarget, topics: string[]) {
  if (!aiTarget.value) throw new Error('请选择目标节点')
  const next = map.applyExpansion(target, topics)
  aiTarget.value = next
  notify(`已插入 ${topics.length} 个子主题`)
  return next
}
function applyAiMap(context: AiMapContext, changes: AiMapChange[]) {
  map.applyMapChanges(context, changes)
  if (selection.value.length === 0) aiMap.value = map.mapContext()
  const count = changes.length
  notify(count ? `已修改导图 ${count} 处` : '没有需要应用的修改')
}
function currentAiTarget() {
  if (!aiTarget.value) throw new Error('请选择目标节点')
  return map.expansionTarget(aiTarget.value)
}
function currentAiMap() {
  return map.mapContext()
}
watch([() => active.value.id, ready, () => selection.value.map((node) => node.uid).join(',')], () => {
  if (!ready.value) { aiTarget.value = null; aiMap.value = null; return }
  if (selection.value.length === 1) {
    aiMap.value = null
    try { aiTarget.value = map.expansionTarget() } catch { aiTarget.value = null }
    return
  }
  aiTarget.value = null
  aiMap.value = selection.value.length === 0 ? map.mapContext() : null
}, { flush: 'post' })
const aiShortcut = useAiShortcut(() => ready.value && selection.value.length <= 1 && !busy.value, openAi)
const { shortcut: aiShortcutValue, loading: aiShortcutLoading, error: aiShortcutError } = aiShortcut

function toggleLeft() {
  leftOpen.value = !leftOpen.value
  if (leftOpen.value && window.innerWidth <= 900) rightOpen.value = false
  resizeCanvas()
}
function toggleRight() {
  rightOpen.value = !rightOpen.value
  if (rightOpen.value && window.innerWidth <= 900) leftOpen.value = false
  resizeCanvas()
}
function resizeCanvas() {
  if (window.innerWidth <= 900) return
  void nextTick(() => {
    map.engine.value?.resize()
    if (ready.value) map.fit()
  })
}
function newDocument() {
  map.capture()
  store.add()
  query.value = ''
}
function selectDocument(id: string) {
  if (id === active.value.id) return
  map.capture()
  store.select(id)
  query.value = ''
}
function duplicateDocument() { map.capture(); store.duplicate(); notify('已创建副本') }
function deleteDocument() { confirmDialog.value?.close(); store.remove(); query.value = '' }
function setLayout(event: Event) {
  active.value.layout = (event.target as HTMLSelectElement).value as Layout
  store.touch()
}
const activeTheme = computed(() => themes.find((item) => item.id === active.value.themeId) ?? themes[0]!)
function setTheme(event: Event) {
  const themeId = (event.target as HTMLSelectElement).value as ThemeId
  if (!themes.some((item) => item.id === themeId)) return
  active.value.themeId = themeId
  store.touch()
}
function setLineStyle(event: Event) {
  const style = lineStyles.find((item) => item.value === (event.target as HTMLSelectElement).value)
  if (style) { active.value.lineStyle = style.value; store.touch() }
}
function style(key: keyof NodeData, value: NodeData[keyof NodeData]) { map.style(key, value) }
function save() { map.capture(); store.flush(); if (!storageError.value && !isVsCode) notify('已保存到本机') }
function focusSearch() {
  leftOpen.value = true
  if (window.innerWidth <= 900) rightOpen.value = false
  void nextTick(() => searchInput.value?.focus())
}
const shortcutDialog = ref<InstanceType<typeof ShortcutSettings> | null>(null)
const commandShortcuts = useCommandShortcuts(map.engine, {
  save, search: focusSearch, insert: map.insert, command: map.command, zoomBy: map.zoomBy, fit: map.fit,
}, aiShortcutValue)
function searchNext() {
  if (!searchResults.value.length) return
  const target = searchResults.value[searchIndex.value % searchResults.value.length]
  if (target) map.select(target.node.data.uid)
  searchIndex.value++
}
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  busy.value = true
  try {
    const doc = await readDocumentFile(file)
    map.capture()
    store.importDocument(doc)
    query.value = ''
    if (!isVsCode) notify('导入完成')
  } catch (error) { notify(error instanceof Error ? error.message : '导入失败', true) }
  finally { busy.value = false; input.value = '' }
}
async function exportFile(type: 'json' | 'md' | 'png' | 'svg') {
  if (exportMenu.value) exportMenu.value.open = false
  busy.value = true
  try {
    map.capture()
    let exported: boolean
    if (type === 'json') exported = await downloadText(serializeDocument(active.value), `${active.value.title}.json`)
    else if (type === 'md') exported = await downloadText(exportMarkdown(active.value.root), `${active.value.title}.md`, 'text/markdown')
    else exported = await map.exportImage(type)
    if (exported) notify('已导出')
  } catch (error) { notify(error instanceof Error ? error.message : '导出失败', true) }
  finally { busy.value = false }
}
async function addImage(file: File) {
  const node = map.engine.value?.renderer.activeNodeList[0]
  if (!node) return
  try {
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('仅支持 PNG、JPEG、WebP 和 GIF 图片')
    if (file.size > 1024 * 1024) throw new Error('图片不能超过 1 MB')
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('图片读取失败'))
      reader.readAsDataURL(file)
    })
    const image = new Image()
    image.src = url
    await image.decode()
    const ratio = Math.min(1, 240 / image.naturalWidth, 160 / image.naturalHeight)
    node.setImage({ url, title: file.name, width: Math.round(image.naturalWidth * ratio), height: Math.round(image.naturalHeight * ratio) })
  } catch (error) { notify(error instanceof Error ? error.message : '图片添加失败', true) }
}
function removeImage() {
  map.engine.value?.renderer.activeNodeList[0]?.setImage({ url: '', title: '', width: 0, height: 0 })
}
async function backupRaw() {
  try { await downloadText(store.rawBackup(), 'xmindmap-local-backup.json') } catch { notify('备份失败', true) }
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && exportMenu.value) exportMenu.value.open = false
}
window.addEventListener('keydown', onKeydown)
function onPageHide() { map.capture(); store.flush() }
window.addEventListener('pagehide', onPageHide)
onBeforeUnmount(() => {
  clearTimeout(messageTimer)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('pagehide', onPageHide)
})
</script>

<template>
  <div class="workspace">
    <header class="app-header">
      <div class="brand"><span class="brand-mark"><Network :size="23" :stroke-width="1.8" /></span><span>XMindmap<span class="brand-dot">.</span></span></div>
      <div class="header-divider"></div>
      <div class="document-heading">
        <input :value="active.title" class="document-title" aria-label="文档名称" maxlength="100" @change="store.rename(($event.target as HTMLInputElement).value)" @keydown.enter="($event.target as HTMLInputElement).blur()" />
        <span class="save-state" :class="{ failed: storageError }"><span class="status-dot"></span>{{ storageError ? '保存异常' : saved ? '所有更改已保存' : isVsCode ? '未保存' : '正在保存…' }}</span>
      </div>
      <div class="header-actions">
        <IconButton :icon="Keyboard" label="快捷键" @click="shortcutDialog?.show()" />
        <IconButton :icon="uiTheme === 'dark' ? Sun : Moon" :label="uiTheme === 'dark' ? '切换到浅色' : '切换到深色'" @click="toggleUiTheme" />
        <IconButton :icon="Save" label="保存" @click="save" />
        <button class="button import-button" :disabled="busy" @click="importInput?.click()"><Upload :size="16" /><span>导入</span></button>
        <details ref="exportMenu" class="export-menu">
          <summary class="button primary" :aria-disabled="busy"><Download :size="16" /><span>导出</span><ChevronDown :size="14" /></summary>
          <div class="dropdown">
            <button :disabled="busy" @click="exportFile('json')"><FileText :size="16" />JSON 导图<span>.json</span></button>
            <button :disabled="busy" @click="exportFile('md')"><ListTree :size="16" />Markdown<span>.md</span></button>
            <button :disabled="busy" @click="exportFile('png')"><Download :size="16" />PNG 图片<span>.png</span></button>
            <button :disabled="busy" @click="exportFile('svg')"><Download :size="16" />SVG 矢量图<span>.svg</span></button>
          </div>
        </details>
      </div>
      <input ref="importInput" class="hidden-input" type="file" accept=".json,.smm,.xmm,.mm,.md,.markdown" aria-label="导入文件" @change="importFile" />
    </header>

    <div class="toolbar" aria-label="导图工具栏">
      <div class="toolbar-group">
        <IconButton :icon="leftOpen ? PanelLeftClose : PanelLeftOpen" label="切换左侧栏" :active="leftOpen" @click="toggleLeft" />
        <span class="toolbar-separator"></span>
        <IconButton :icon="Undo2" label="撤销" :disabled="!canUndo" @click="map.command('BACK')" />
        <IconButton :icon="Redo2" label="重做" :disabled="!canRedo" @click="map.command('FORWARD')" />
      </div>
      <span class="toolbar-separator"></span>
      <div class="toolbar-group edit-actions">
        <button class="tool-command" :disabled="!ready" @click="map.insert('child')"><GitBranch :size="17" /><span>子主题</span></button>
        <button class="tool-command" :disabled="!selection.length || isRootSelected" @click="map.insert('sibling')"><Plus :size="17" /><span>同级主题</span></button>
        <IconButton class="insert-parent-button" :icon="ArrowUpFromLine" label="插入父主题" :disabled="!selection.length || isRootSelected" @click="map.insert('parent')" />
        <IconButton :icon="Trash2" label="删除节点" :disabled="!selection.length || isRootSelected" @click="map.command('REMOVE_NODE')" />
        <NodeIconPicker :nodes="selection" @choose="map.setIcon" @clear="map.clearIcons" />
        <IconButton :icon="Sparkles" label="AI 对话" :title="`${aiPanelOpen ? '隐藏' : '显示'} AI 对话 (${shortcutLabel(aiShortcutValue, aiShortcut.mac)})`" :active="aiPanelOpen" :disabled="!ready" @click="toggleAi" />
      </div>
      <span class="toolbar-separator desktop-tool"></span>
      <div class="toolbar-group desktop-tool">
        <IconButton :icon="ArrowUpFromLine" label="上移节点" :disabled="!selection.length || isRootSelected" @click="map.command('UP_NODE')" />
        <IconButton :icon="ArrowDownToLine" label="下移节点" :disabled="!selection.length || isRootSelected" @click="map.command('DOWN_NODE')" />
      </div>
      <div class="toolbar-spacer"></div>
      <div class="toolbar-group toolbar-design">
        <label class="layout-select">
          <span class="theme-mark" :style="{ backgroundColor: activeTheme.colors[0] }"></span>
          <select aria-label="导图主题" :value="active.themeId" @change="setTheme">
            <option v-for="theme in themes" :key="theme.id" :value="theme.id">{{ theme.label }}</option>
          </select>
        </label>
        <span class="toolbar-separator"></span>
        <label class="layout-select">
          <select aria-label="连线样式" :disabled="!supportsLineStyle(active.layout)" :value="supportsLineStyle(active.layout) ? active.lineStyle : 'fixed'" @change="setLineStyle">
            <option v-if="!supportsLineStyle(active.layout)" value="fixed">布局固定</option>
            <option v-for="style in lineStyles" :key="style.value" :value="style.value">{{ style.label }}</option>
          </select>
        </label>
        <span class="toolbar-separator"></span>
        <label class="layout-select"><Network :size="16" /><select aria-label="导图布局" :value="active.layout" @change="setLayout"><option v-for="layout in layouts" :key="layout.value" :value="layout.value">{{ layout.label }}</option></select></label>
      </div>
      <span class="toolbar-separator"></span>
      <IconButton :icon="rightOpen ? PanelRightClose : PanelRightOpen" label="切换属性面板" :active="rightOpen" @click="toggleRight" />
    </div>

    <div v-if="storageError" class="storage-warning" role="alert"><span>{{ storageError }}</span><button @click="backupRaw">备份原始数据</button></div>

    <main v-if="loaded" class="editor-body">
      <aside v-if="leftOpen" class="left-panel">
        <div class="panel-heading"><span><FolderOpen :size="16" />{{ isVsCode ? '当前文件' : '我的导图' }}</span><IconButton :icon="FilePlus2" label="新建导图" @click="newDocument" /></div>
        <div v-if="!isVsCode" class="document-list" aria-label="本地文档">
          <button v-for="doc in workspace.documents" :key="doc.id" class="document-item" :class="{ selected: doc.id === active.id }" @click="selectDocument(doc.id)"><FileText :size="16" /><span>{{ doc.title }}</span><span v-if="doc.id === active.id" class="document-active-dot"></span></button>
        </div>
        <div class="document-tools"><span>{{ isVsCode ? 'VS Code' : `${workspace.documents.length} 个本地文档` }}</span><IconButton :icon="Copy" label="复制当前导图" @click="duplicateDocument" /><IconButton v-if="!isVsCode" :icon="Trash2" label="删除当前导图" @click="confirmDialog?.showModal()" /></div>
        <div class="outline-heading"><span><ListTree :size="16" />大纲</span><div><IconButton :icon="Plus" label="展开全部" @click="map.command('EXPAND_ALL')" /><IconButton :icon="Minus" label="收起全部" @click="map.command('UNEXPAND_ALL')" /></div></div>
        <form class="search-box" @submit.prevent="searchNext"><Search :size="15" /><input ref="searchInput" v-model="query" aria-label="搜索节点" placeholder="搜索节点" @input="searchIndex = 0" /><button v-if="query" type="button" aria-label="清除搜索" @click="query = ''"><X :size="14" /></button></form>
        <div v-if="query" class="search-summary"><span>{{ searchResults.length }} 个匹配结果</span><button :disabled="!searchResults.length" @click="searchNext">下一个<ChevronRight :size="13" /></button></div>
        <OutlineTree :root="active.root" :selected-uid="selectedUid" :query="query" @select="map.select" @toggle="map.toggle" @rename="map.editText" @remove="map.remove" />
        <div class="local-note"><span class="status-dot"></span>{{ isVsCode ? '文件工作空间' : '本地工作空间' }}<span>{{ isVsCode ? 'VSCODE' : 'LOCAL' }}</span></div>
      </aside>

      <section class="canvas-area" aria-label="思维导图编辑区">
        <div class="canvas-caption"><span class="canvas-caption-dot"></span>{{ layouts.find((layout) => layout.value === active.layout)?.label }}<span class="caption-divider">/</span><span>{{ nodeCount }} 个节点</span></div>
        <div ref="canvas" class="map-canvas" data-testid="mind-map-canvas"></div>
        <div v-if="!ready" class="canvas-loading"><LoaderCircle :size="22" class="spin" />正在打开导图</div>
        <div class="canvas-controls">
          <IconButton :icon="Minus" label="缩小" :disabled="zoom <= 20" @click="map.zoomBy(-1)" />
          <button class="zoom-value" title="重置缩放" aria-label="重置缩放" @click="map.resetZoom">{{ zoom }}%</button>
          <IconButton :icon="Plus" label="放大" :disabled="zoom >= 300" @click="map.zoomBy(1)" />
          <span class="toolbar-separator"></span>
          <IconButton :icon="Maximize" label="适应画布" @click="map.fit" />
        </div>
        <AiChatPanel v-show="aiPanelOpen" ref="aiChatPanel" :visible="aiPanelOpen" :target="aiTarget" :map="aiMap" :current-target="currentAiTarget" :current-map="currentAiMap" :apply="applyAi" :apply-map="applyAiMap" :shortcut="aiShortcutValue" :shortcut-loading="aiShortcutLoading" :shortcut-error="aiShortcutError" :mac="aiShortcut.mac" :save-shortcut="aiShortcut.save" />
      </section>

      <aside v-if="rightOpen" class="right-panel">
        <div class="panel-heading"><span><Settings2 :size="16" />节点</span></div>
        <div class="inspector-content">
          <NodeInspector :nodes="selection" @style="style" @properties="map.properties" @image="addImage" @remove-image="removeImage" @preview="openNodeLink" />
        </div>
        <div class="panel-bottom"><span class="status-dot"></span>{{ selection.length ? `已选择 ${selection.length} 个节点` : '未选择节点' }}</div>
      </aside>
    </main>

    <div v-else class="empty-state">{{ storageError || '正在读取 VS Code 文件…' }}</div>
    <footer class="status-bar"><span><span class="status-dot"></span>{{ isVsCode ? 'VS Code 文件' : '本地存储' }}</span><span>{{ active.title }}</span><span class="status-spacer"></span><span>{{ nodeCount }} 个节点</span><span class="footer-brand">XMindmap</span></footer>
    <div v-if="message" class="toast" :class="{ error: isError }" :role="isError ? 'alert' : 'status'"><component :is="isError ? X : Check" :size="17" />{{ message }}<button aria-label="关闭提示" @click="message = ''"><X :size="14" /></button></div>
    <div v-if="busy" class="busy-indicator" role="status"><LoaderCircle :size="16" class="spin" />正在处理文件…</div>

    <MarkdownPreview ref="markdownPreview" />
    <ShortcutSettings ref="shortcutDialog" :shortcuts="commandShortcuts.shortcuts.value" :mac="aiShortcut.mac" :loading="commandShortcuts.loading.value" :load-error="commandShortcuts.error.value" :save="commandShortcuts.update" :reset="commandShortcuts.reset" />
    <dialog ref="confirmDialog" class="confirm-dialog" @click="($event.target === confirmDialog) && confirmDialog?.close()">
      <form method="dialog"><div class="dialog-heading"><h2>删除导图？</h2><IconButton :icon="X" label="取消删除" @click="confirmDialog?.close()" /></div><p>“{{ active.title }}” 将从本机移除，此操作无法撤销。</p><div class="dialog-actions"><button class="button" value="cancel">取消</button><button type="button" class="button danger" @click="deleteDocument">确认删除</button></div></form>
    </dialog>
  </div>
</template>
