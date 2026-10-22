<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Bot, ChevronDown, ChevronUp, GripHorizontal, LoaderCircle, Send, Settings2, Sparkles, Trash2, X } from 'lucide-vue-next'
import IconButton from './IconButton.vue'
import ProviderIcon from './ProviderIcon.vue'
import AiShortcutSettings from './AiShortcutSettings.vue'
import AiConnectionDialog from './AiConnectionDialog.vue'
import { getAiConnection, requestCatalog, requestChat, saveAiConnection } from '../ai/connection'
import { readAiPanel, writeAiPanel } from '../ai/panel'
import { isVsCode } from '../platform/vscode'
import { AI_PROVIDERS, parseChatReply, presentAiStatus, validateChatInput } from '../domain/ai'
import type { AiCatalogModel, AiChatMessage, AiExpansionTarget, AiMapChange, AiMapContext, AiOutlineNode, AiSettingsStatus } from '../domain/ai'

const props = defineProps<{
  visible?: boolean
  target: AiExpansionTarget | null
  map: AiMapContext | null
  currentTarget: () => AiExpansionTarget
  currentMap: () => AiMapContext
  apply: (target: AiExpansionTarget, topics: string[]) => AiExpansionTarget
  applyMap: (context: AiMapContext, changes: AiMapChange[]) => void
  shortcut: string
  shortcutLoading: boolean
  shortcutError: string
  mac: boolean
  saveShortcut: (value: string) => Promise<void>
}>()
interface ChatTurn {
  user: string
  reply: string
  topics: string[]
  changes: AiMapChange[]
  model: string
  state: 'sending' | 'done' | 'failed' | 'cancelled'
  applied: boolean
  error: string
  target: AiExpansionTarget | null
  map: AiMapContext | null
}
const composer = ref<HTMLTextAreaElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const log = ref<HTMLElement | null>(null)
const anchor = ref<{ left: number; bottom: number } | null>(null)
const view = ref<{ left: number; bottom: number } | null>(null)
const dragging = ref(false)
const snapping = ref(false)
const panelStyle = computed(() => view.value ? { left: `${view.value.left}px`, bottom: `${view.value.bottom}px`, top: 'auto', right: 'auto', transform: 'none' } : undefined)
let stopDrag: (() => void) | undefined
let resizeObserver: ResizeObserver | undefined
let lastClickAt = 0
let lastClickX = 0
let lastClickY = 0
const settings = ref<AiSettingsStatus>(presentAiStatus({}))
const catalog = ref<AiCatalogModel[]>([])
const model = ref('')
const settingsOpen = ref(false)
const loading = ref(true)
const fetchingModels = ref(false)
const modelError = ref('')
const error = ref('')
const text = ref('')
const count = ref(5)
const autoExpand = ref(true)
const turns = ref<ChatTurn[]>([])
const expanded = ref(false)
const busy = ref(false)
const connectionBusy = ref(false)
let panelTimer: ReturnType<typeof setTimeout> | undefined
let panelReady = false
let controller: AbortController | undefined
let modelsController: AbortController | undefined
let disposed = false
let requestId = 0
let modelRequestId = 0
const choices = computed(() => {
  const counts = new Map<string, number>()
  for (const item of catalog.value) counts.set(item.model, (counts.get(item.model) || 0) + 1)
  return catalog.value.map((item) => ({ ...item, value: (counts.get(item.model) || 0) > 1 ? `${item.baseURL}\n${item.model}` : item.model }))
})
const modelGroups = computed(() => {
  const groups = new Map<string, { provider: string; items: typeof choices.value }>()
  for (const item of choices.value) {
    const group = groups.get(item.baseURL) || { provider: item.provider, items: [] }
    group.items.push(item)
    groups.set(item.baseURL, group)
  }
  return [...groups.values()]
})
const activeProviderId = computed(() => AI_PROVIDERS.find((provider) => provider.baseURL === settings.value.baseURL)?.id || '')
const selectValue = computed(() => choices.value.find((item) => item.model === model.value && item.baseURL === settings.value.baseURL)?.value || model.value)
const completed = computed(() => turns.value.filter((turn) => turn.state === 'done'))
const destination = computed(() => {
  try { return new URL(settings.value.baseURL).host } catch { return '' }
})
const canSend = computed(() => (!!props.target || !!props.map) && !!text.value.trim() && !!model.value.trim() && !loading.value && !busy.value && !fetchingModels.value && !connectionBusy.value && !settingsOpen.value && completed.value.length < 10)
function brief(text: string) {
  const value = text.replace(/\s+/g, ' ').trim()
  return value.length > 28 ? `${value.slice(0, 28)}…` : value
}
const replyHint = computed(() => {
  const turn = turns.value.at(-1)
  if (!turn || expanded.value) return ''
  if (turn.state === 'sending') return '正在回复…'
  if (turn.state === 'cancelled') return '已停止，点击查看'
  if (turn.state === 'failed') return `${brief(turn.error || '回复失败')}，点击查看`
  if (turn.applied && turn.changes.length) return `已修改 ${turn.changes.length} 处，点击查看`
  if (turn.applied && turn.topics.length) return `已添加 ${turn.topics.length} 个子主题，点击查看`
  if (turn.changes.length) return `${turn.changes.length} 处修改待应用，点击查看`
  if (turn.topics.length) return `${turn.topics.length} 个建议待添加，点击查看`
  return turn.reply ? `${brief(turn.reply)}，点击查看` : '回复已完成，点击查看'
})
function focusInput() {
  void nextTick(() => composer.value?.focus())
}
function clamp(el: HTMLElement, parent: HTMLElement, left: number, bottom: number) {
  return {
    left: Math.min(Math.max(0, parent.clientWidth - el.offsetWidth), Math.max(0, left)),
    bottom: Math.min(Math.max(0, parent.clientHeight - el.offsetHeight), Math.max(0, bottom)),
  }
}
function place(left: number, bottom: number, commit: boolean) {
  const el = panel.value
  const parent = el?.offsetParent
  if (!el || !(parent instanceof HTMLElement)) return
  const fitted = clamp(el, parent, left, bottom)
  view.value = fitted
  if (commit) anchor.value = fitted
}
function reclamp() {
  if (!anchor.value) return
  place(anchor.value.left, anchor.value.bottom, false)
}
function cssPx(parent: HTMLElement, name: string, fallback: number) {
  const parsed = Number.parseFloat(getComputedStyle(parent).getPropertyValue(name))
  return Number.isFinite(parsed) ? parsed : fallback
}
function nearDock(el: HTMLElement, parent: HTMLElement, left: number, bottom: number) {
  const dockLeft = Math.max(0, (parent.clientWidth - el.offsetWidth) / 2)
  const centerDelta = Math.abs(left + el.offsetWidth / 2 - (dockLeft + el.offsetWidth / 2))
  return centerDelta < 96 && Math.abs(bottom - cssPx(parent, '--ai-panel-dock', 16)) < 56
}
function syncClearance() {
  const el = panel.value
  const parent = el?.offsetParent instanceof HTMLElement ? el.offsetParent : el?.parentElement
  if (!(parent instanceof HTMLElement) || !el) return
  // Split view renders one controls block per pane; clear every one the panel covers.
  const controls = [...parent.querySelectorAll<HTMLElement>('.canvas-controls')]
  if (!controls.length || dragging.value || el.offsetHeight === 0) {
    if (!dragging.value) parent.style.removeProperty('--ai-dock-clearance')
    return
  }
  const parentRect = parent.getBoundingClientRect()
  const panelRect = el.getBoundingClientRect()
  const rest = cssPx(parent, '--ai-controls-rest', 24)
  const hit = controls.some((control) => {
    const right = Number.parseFloat(getComputedStyle(control).right) || 24
    const left = parentRect.right - right - control.offsetWidth
    const top = parentRect.bottom - rest - control.offsetHeight
    return panelRect.left < left + control.offsetWidth && panelRect.right > left && panelRect.top < top + control.offsetHeight && panelRect.bottom > top
  })
  if (!hit) {
    parent.style.removeProperty('--ai-dock-clearance')
    return
  }
  parent.style.setProperty('--ai-dock-clearance', `${Math.ceil(parentRect.bottom - panelRect.top + 12)}px`)
}
function redock() {
  stopDrag?.()
  snapping.value = false
  anchor.value = null
  view.value = null
  void nextTick(syncClearance)
}
function nudge(event: KeyboardEvent) {
  const el = panel.value
  const parent = el?.offsetParent
  if (!el || !(parent instanceof HTMLElement)) return
  const step = event.shiftKey ? 24 : 8
  const deltas: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
  const delta = deltas[event.key]
  if (!delta) return
  event.preventDefault()
  const rect = el.getBoundingClientRect()
  const parentRect = parent.getBoundingClientRect()
  const left = (anchor.value?.left ?? rect.left - parentRect.left) + delta[0]
  const bottom = (anchor.value?.bottom ?? parentRect.bottom - rect.bottom) + delta[1]
  place(left, bottom, true)
}
function startDrag(event: PointerEvent) {
  if (event.button !== 0 || !panel.value) return
  const target = event.target
  if (target instanceof Element && target.closest('button, a, input, select, textarea, summary')) return
  const el = panel.value
  const parent = el.offsetParent
  if (!(parent instanceof HTMLElement)) return
  if (Date.now() - lastClickAt < 350 && Math.hypot(event.clientX - lastClickX, event.clientY - lastClickY) < 8) {
    lastClickAt = 0
    redock()
    return
  }
  event.preventDefault()
  const parentRect = parent.getBoundingClientRect()
  const rect = el.getBoundingClientRect()
  const origin = { x: event.clientX, y: event.clientY, left: rect.left - parentRect.left, bottom: parentRect.bottom - rect.bottom }
  stopDrag?.()
  place(origin.left, origin.bottom, true)
  dragging.value = true
  el.setPointerCapture(event.pointerId)
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== event.pointerId) return
    const next = clamp(el, parent, origin.left + ev.clientX - origin.x, origin.bottom - (ev.clientY - origin.y))
    anchor.value = next
    view.value = next
    snapping.value = nearDock(el, parent, next.left, next.bottom)
  }
  const end = (ev: PointerEvent) => {
    if (ev.pointerId !== event.pointerId) return
    if (Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) < 8) {
      lastClickAt = Date.now()
      lastClickX = ev.clientX
      lastClickY = ev.clientY
    }
    if (anchor.value && nearDock(el, parent, anchor.value.left, anchor.value.bottom)) redock()
    snapping.value = false
    stopDrag?.()
    void nextTick(syncClearance)
  }
  stopDrag = () => {
    dragging.value = false
    snapping.value = false
    stopDrag = undefined
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', end)
    el.removeEventListener('pointercancel', end)
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', end)
  el.addEventListener('pointercancel', end)
}
defineExpose({ focusInput })
function currentPanel() {
  return { autoExpand: autoExpand.value, count: count.value, expanded: expanded.value, anchor: anchor.value }
}
function persistPanel() {
  if (!panelReady) return
  clearTimeout(panelTimer)
  panelTimer = setTimeout(() => { panelTimer = undefined; void writeAiPanel(currentPanel()).catch(() => { /* Keep the current panel if storage rejects this value. */ }) }, 200)
}
watch([autoExpand, count, expanded, anchor], persistPanel, { flush: 'sync' })
async function scrollLog() {
  await nextTick()
  if (log.value) log.value.scrollTop = log.value.scrollHeight
}
function cancel() {
  requestId++
  controller?.abort()
  controller = undefined
  busy.value = false
  const pending = turns.value.find((turn) => turn.state === 'sending')
  if (pending) { pending.state = 'cancelled'; text.value = pending.user }
}
function stopModels() {
  modelRequestId++
  modelsController?.abort()
  fetchingModels.value = false
}
async function refreshModels() {
  stopModels()
  const id = modelRequestId
  modelsController = new AbortController()
  fetchingModels.value = true
  modelError.value = ''
  try {
    const result = await requestCatalog(modelsController.signal)
    if (disposed || id !== modelRequestId) return
    catalog.value = result
    if (!model.value && result[0]) { model.value = result[0].model; settings.value = { ...settings.value, baseURL: result[0].baseURL, model: result[0].model } }
  } catch (reason) {
    if (!disposed && id === modelRequestId && !(reason instanceof Error && reason.name === 'AbortError')) {
      modelError.value = reason instanceof Error ? reason.message : '模型列表获取失败'
    }
  } finally { if (!disposed && id === modelRequestId) fetchingModels.value = false }
}
function openSettings() {
  stopModels()
  settingsOpen.value = true
}
function configured(value: AiSettingsStatus) {
  stopModels()
  if (settings.value.baseURL !== value.baseURL) {
    turns.value = []
    catalog.value = []
  }
  settings.value = presentAiStatus(value)
  model.value = settings.value.model
  modelError.value = ''
  error.value = ''
  if (settings.value.providers.some((provider) => provider.hasKey) || settings.value.hasKey || isVsCode) void refreshModels()
}
async function chooseModel(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  const picked = choices.value.find((item) => item.value === value)
  if (!picked) return
  model.value = picked.model
  settings.value = { ...settings.value, baseURL: picked.baseURL, model: picked.model }
  connectionBusy.value = true
  error.value = ''
  try {
    const saved = await saveAiConnection({ baseURL: settings.value.baseURL, model: model.value }, '')
    if (!disposed) settings.value = presentAiStatus(saved)
  } catch { if (!disposed) error.value = '模型偏好保存失败，本轮仍可使用所选模型' }
  finally { connectionBusy.value = false }
}
function history(): AiChatMessage[] {
  return completed.value.flatMap((turn): AiChatMessage[] => [
    { role: 'user', content: turn.user },
    { role: 'assistant', content: JSON.stringify(turn.map ? { reply: turn.reply, changes: turn.changes } : { reply: turn.reply, topics: turn.topics }) },
  ])
}
function findOutline(node: AiOutlineNode, uid: string): AiOutlineNode | undefined {
  if (node.uid === uid) return node
  for (const child of node.children) {
    const found = findOutline(child, uid)
    if (found) return found
  }
}
function describeChange(turn: ChatTurn, change: AiMapChange) {
  const outline = turn.map?.outline
  if (!outline) return change.op
  if (change.op === 'add') return `在「${findOutline(outline, change.parent)?.text || '节点'}」下新增「${change.text}」`
  if (change.op === 'rename') return `「${findOutline(outline, change.uid)?.text || '节点'}」改为「${change.text}」`
  return `删除「${findOutline(outline, change.uid)?.text || '节点'}」`
}
function insert(turn: ChatTurn) {
  if (turn.applied) return
  if (turn.map && turn.changes.length) props.applyMap(turn.map, turn.changes)
  else if (turn.target && turn.topics.length) props.apply(turn.target, turn.topics)
  else return
  turn.applied = true
}
async function send() {
  if (!canSend.value) return
  error.value = ''
  let turn: ChatTurn | undefined
  const id = ++requestId
  try {
    const mapMode = !props.target
    const target = mapMode ? null : props.currentTarget()
    const map = mapMode ? props.currentMap() : null
    const input = validateChatInput(map
      ? { count: count.value, messages: [...history(), { role: 'user', content: text.value.trim() }], scope: { kind: 'map', title: map.title, outline: map.outline, partial: map.partial } }
      : { topic: target!.topic, existing: target!.existing, count: count.value, messages: [...history(), { role: 'user', content: text.value.trim() }] })
    stopModels()
    controller = new AbortController()
    const shouldInsert = autoExpand.value
    busy.value = true
    turns.value.push({ user: text.value.trim(), reply: '', topics: [], changes: [], model: model.value.trim(), state: 'sending', applied: false, error: '', target, map })
    turn = turns.value.at(-1)!
    text.value = ''
    void scrollLog()
    const result = await requestChat({ baseURL: settings.value.baseURL, model: turn.model }, input, controller.signal)
    if (disposed || id !== requestId) return
    const reply = parseChatReply(JSON.stringify(result), input)
    turn.reply = reply.reply
    turn.topics = reply.topics
    turn.changes = reply.changes
    turn.state = 'done'
    if (shouldInsert && (turn.topics.length || turn.changes.length)) {
      try { insert(turn) } catch (reason) { turn.error = reason instanceof Error ? reason.message : mapMode ? '导图修改失败' : '节点扩展失败' }
    }
    void scrollLog()
  } catch (reason) {
    if (disposed || id !== requestId) return
    const message = reason instanceof Error ? reason.message : '对话请求失败'
    if (turn) { turn.state = 'failed'; turn.error = message; text.value = turn.user }
    else error.value = message
  } finally { if (!disposed && id === requestId) busy.value = false }
}
function insertManually(turn: ChatTurn) {
  turn.error = ''
  try { insert(turn) } catch (reason) { turn.error = reason instanceof Error ? reason.message : turn.map ? '导图修改失败' : '插入失败' }
}
function clearChat() {
  turns.value = []
  error.value = ''
}
watch(() => props.visible, async (value) => {
  if (value === false) settingsOpen.value = false
  await nextTick()
  syncClearance()
})
watch(expanded, async (value) => {
  if (value) void scrollLog()
  await nextTick()
  reclamp()
  syncClearance()
})
watch(() => props.target ? `node:${props.target.documentId}:${props.target.uid}` : props.map ? `map:${props.map.documentId}` : '', () => {
  cancel()
  turns.value = []
  text.value = ''
  error.value = ''
}, { flush: 'sync' })
onMounted(async () => {
  const parent = panel.value?.offsetParent
  if (parent instanceof HTMLElement) {
    resizeObserver = new ResizeObserver(() => { reclamp(); syncClearance() })
    resizeObserver.observe(parent)
    resizeObserver.observe(panel.value!)
  }
  try {
    const value = await getAiConnection()
    if (disposed) return
    settings.value = presentAiStatus(value)
    model.value = settings.value.model
    // Model discovery never sends node content or starts a completion.
    if (settings.value.hasKey || settings.value.providers.some((provider) => provider.hasKey) || isVsCode) void refreshModels()
  } catch { if (!disposed) error.value = '无法读取 AI 设置' }
  finally { loading.value = false }
})
onMounted(async () => {
  const prefs = await readAiPanel()
  if (disposed) return
  autoExpand.value = prefs.autoExpand
  count.value = prefs.count
  expanded.value = prefs.expanded
  anchor.value = prefs.anchor
  await nextTick()
  if (prefs.anchor) place(prefs.anchor.left, prefs.anchor.bottom, false)
  syncClearance()
  if (!disposed) panelReady = true
})
onBeforeUnmount(() => {
  disposed = true
  const parent = panel.value?.offsetParent instanceof HTMLElement ? panel.value.offsetParent : panel.value?.parentElement
  if (parent instanceof HTMLElement) parent.style.removeProperty('--ai-dock-clearance')
  stopDrag?.()
  resizeObserver?.disconnect()
  cancel()
  stopModels()
  if (!panelTimer) return
  clearTimeout(panelTimer)
  panelTimer = undefined
  void writeAiPanel(currentPanel()).catch(() => { /* The panel is already going away. */ })
})
</script>

<template>
  <aside ref="panel" class="ai-chat-panel" :class="{ expanded, dragging, snapping, floating: !!anchor }" :style="panelStyle" aria-label="AI 对话">
    <div class="ai-chat-drag" role="button" tabindex="0" aria-label="拖动 AI 输入框" title="拖动面板，双击回到底部居中" @pointerdown="startDrag" @dblclick="redock" @keydown="nudge"><GripHorizontal :size="16" :stroke-width="1.7" aria-hidden="true" /></div>
    <div v-show="expanded" class="ai-chat-detail">
      <div class="ai-chat-detail-top" @pointerdown="startDrag">
        <h2><Sparkles :size="15" />AI 对话</h2>
        <div class="ai-chat-target"><span>{{ target ? '当前节点' : '修改范围' }}</span><strong>{{ target?.topic || (map ? '整张导图' : '请只选择一个节点') }}</strong></div>
        <span class="ai-auto-state">{{ autoExpand ? '回复后自动扩展' : '仅对话' }}</span>
        <div class="ai-model-status"><span>{{ destination }}</span><span v-if="fetchingModels"><LoaderCircle :size="12" class="spin" />获取模型中…</span></div>
        <IconButton :icon="Trash2" label="清空 AI 对话" :disabled="busy || !turns.length" @click="clearChat" />
      </div>
      <div ref="log" class="ai-chat-log" role="log" aria-label="AI 对话记录" aria-live="polite">
        <div v-if="!turns.length" class="ai-chat-empty"><Bot :size="30" /><span>开始对话</span></div>
        <article v-for="(turn, index) in turns" :key="index" class="ai-chat-turn">
          <div class="ai-chat-author">你</div><p class="ai-chat-text user-message">{{ turn.user }}</p>
          <div class="ai-chat-author">AI <span>{{ turn.model }}</span></div>
          <p v-if="turn.state === 'sending'" class="ai-progress"><LoaderCircle :size="15" class="spin" />正在回复…</p>
          <p v-else-if="turn.state === 'cancelled'" class="ai-model-status">已停止</p>
          <template v-else-if="turn.state === 'done'">
            <p class="ai-chat-text">{{ turn.reply }}</p>
            <ul v-if="turn.changes.length" class="ai-chat-topics"><li v-for="(change, changeIndex) in turn.changes" :key="changeIndex">{{ describeChange(turn, change) }}</li></ul>
            <ul v-else-if="turn.topics.length" class="ai-chat-topics"><li v-for="topic in turn.topics" :key="topic">{{ topic }}</li></ul>
            <span v-if="turn.applied && turn.changes.length" class="ai-chat-applied">已修改 {{ turn.changes.length }} 处</span>
            <span v-else-if="turn.applied" class="ai-chat-applied">已添加 {{ turn.topics.length }} 个子主题</span>
            <button v-else-if="turn.changes.length" type="button" class="button" :disabled="busy" @click="insertManually(turn)">应用 {{ turn.changes.length }} 处修改</button>
            <button v-else-if="turn.topics.length" type="button" class="button" :disabled="busy" @click="insertManually(turn)">添加 {{ turn.topics.length }} 个子主题</button>
          </template>
          <p v-if="turn.error" class="field-error" role="alert">{{ turn.error }}</p>
        </article>
      </div>
      <details class="ai-disclosure">
        <summary>发送内容</summary>
        <div v-if="target"><strong>当前节点</strong><p>{{ target.topic }}</p><strong>已有直接子主题</strong>
          <ul><li v-for="(topic, index) in target.existing" :key="index">{{ topic }}</li></ul>
          <strong>本次消息</strong><p>{{ text || '无' }}</p><span>包含当前窗口已完成的对话，最多 10 轮；不含其他节点、备注或图片。内容将发送到 {{ destination }}，可能产生服务费用。</span>
        </div>
        <div v-else-if="map"><strong>整张导图</strong><p>{{ map.title }}</p><strong>一级分支</strong>
          <ul><li v-for="child in map.outline.children" :key="child.uid">{{ child.text }}</li></ul>
          <strong>本次消息</strong><p>{{ text || '无' }}</p><span>包含当前导图的节点文字和层级{{ map.partial ? '（仅前 80 个节点）' : '' }}，以及本窗口已完成的对话。不含备注、图标或图片。内容将发送到 {{ destination }}，可能产生服务费用。</span>
        </div>
      </details>
    </div>
    <div v-if="modelError || error || completed.length >= 10" class="ai-chat-notices">
      <p v-if="modelError" class="field-error" role="alert">{{ modelError }}</p>
      <p v-if="error" class="field-error" role="alert">{{ error }}</p>
      <p v-if="completed.length >= 10" class="field-error">本轮对话已达上限，请清空后继续</p>
    </div>
    <button v-if="replyHint" type="button" class="ai-reply-hint" aria-label="查看 AI 回复" @click="expanded = true">{{ replyHint }}</button>
    <form class="ai-chat-bar" @submit.prevent="send">
      <div class="ai-chat-bar-top">
        <IconButton :icon="expanded ? ChevronDown : ChevronUp" :label="expanded ? '收起 AI 回复' : '展开 AI 回复'" @click="expanded = !expanded" />
        <ProviderIcon v-if="activeProviderId" :id="activeProviderId" />
        <select aria-label="对话模型" :value="selectValue" :disabled="busy || loading || fetchingModels || connectionBusy" @change="chooseModel">
          <option v-if="!model" value="" disabled>选择模型</option>
          <option v-if="model && !choices.some((item) => item.model === model && item.baseURL === settings.baseURL)" :value="model">{{ model }}</option>
          <optgroup v-for="group in modelGroups" :key="group.provider" :label="group.provider">
            <option v-for="item in group.items" :key="item.value" :value="item.value">{{ item.model }}</option>
          </optgroup>
        </select>
        <IconButton class="ai-chat-settings" :icon="Settings2" label="AI 连接设置" :disabled="busy || loading || connectionBusy" @click="openSettings" />
      </div>
      <div class="ai-chat-bar-input">
        <textarea ref="composer" v-model="text" aria-label="AI 对话消息" rows="3" maxlength="2000" :placeholder="target ? '描述要扩展的内容…' : map ? '描述要如何修改导图…' : '先选择一个节点'" :disabled="busy || (!target && !map)"></textarea>
        <button v-if="busy" type="button" class="button" @click="cancel"><X :size="15" />停止生成</button>
        <button v-else type="submit" class="button primary" :disabled="!canSend"><Send :size="15" />发送</button>
      </div>
    </form>
    <AiConnectionDialog v-if="settingsOpen" :settings="settings" :known-models="catalog" @saved="configured" @close="settingsOpen = false">
      <div class="ai-chat-options">
        <label><input v-model="autoExpand" type="checkbox" aria-label="回复后自动扩展当前节点" :disabled="busy" />回复后自动扩展</label>
        <label>最多<input v-model.number="count" type="number" min="1" max="10" aria-label="AI 子主题数量" :disabled="busy" />项</label>
      </div>
      <AiShortcutSettings :value="shortcut" :loading="shortcutLoading" :load-error="shortcutError" :mac="mac" :save="saveShortcut" />
    </AiConnectionDialog>
  </aside>
</template>
