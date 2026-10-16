<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Bot, ChevronDown, ChevronUp, LoaderCircle, Send, Settings2, Sparkles, Trash2, X } from 'lucide-vue-next'
import IconButton from './IconButton.vue'
import AiShortcutSettings from './AiShortcutSettings.vue'
import AiConnectionDialog from './AiConnectionDialog.vue'
import { getAiConnection, requestChat, requestModels, saveAiConnection } from '../ai/connection'
import { isVsCode } from '../platform/vscode'
import { defaultAiSettings, parseChatReply, validateChatInput } from '../domain/ai'
import type { AiChatMessage, AiExpansionTarget, AiSettingsStatus } from '../domain/ai'

const props = defineProps<{
  target: AiExpansionTarget | null
  currentTarget: () => AiExpansionTarget
  apply: (target: AiExpansionTarget, topics: string[]) => AiExpansionTarget
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
  model: string
  state: 'sending' | 'done' | 'failed' | 'cancelled'
  applied: boolean
  error: string
  target: AiExpansionTarget
}
const composer = ref<HTMLTextAreaElement | null>(null)
const log = ref<HTMLElement | null>(null)
const settings = ref<AiSettingsStatus>({ ...defaultAiSettings, hasKey: false })
const models = ref<string[]>([])
const model = ref('')
const manualModel = ref(false)
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
let controller: AbortController | undefined
let modelsController: AbortController | undefined
let disposed = false
let requestId = 0
let modelRequestId = 0
const choices = computed(() => [...new Set([...(settings.value.model ? [settings.value.model] : []), ...models.value])])
const completed = computed(() => turns.value.filter((turn) => turn.state === 'done'))
const destination = computed(() => {
  try { return new URL(settings.value.baseURL).host } catch { return '' }
})
const canSend = computed(() => !!props.target && !!text.value.trim() && !!model.value.trim() && !loading.value && !busy.value && !fetchingModels.value && !connectionBusy.value && !settingsOpen.value && completed.value.length < 10)
function focusInput() {
  composer.value?.focus()
}
defineExpose({ focusInput })
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
    const result = await requestModels(settings.value, modelsController.signal)
    if (disposed || id !== modelRequestId) return
    models.value = result
    if (!model.value) { model.value = result[0]!; manualModel.value = false }
  } catch (reason) {
    if (!disposed && id === modelRequestId && !(reason instanceof Error && reason.name === 'AbortError')) {
      modelError.value = reason instanceof Error ? reason.message : '模型列表获取失败，可手动填写模型'
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
    models.value = []
  }
  settings.value = value
  model.value = value.model
  manualModel.value = false
  modelError.value = ''
  error.value = ''
}
function receivedModels(list: string[], baseURL: string) {
  if (baseURL === settings.value.baseURL) models.value = list
}
async function chooseModel(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (value === '__manual__') { manualModel.value = true; return }
  model.value = value
  manualModel.value = false
  connectionBusy.value = true
  error.value = ''
  try {
    const saved = await saveAiConnection({ baseURL: settings.value.baseURL, model: value }, '')
    if (!disposed) settings.value = saved
  } catch { if (!disposed) error.value = '模型偏好保存失败，本轮仍可使用所选模型' }
  finally { connectionBusy.value = false }
}
function history(): AiChatMessage[] {
  return completed.value.flatMap((turn): AiChatMessage[] => [
    { role: 'user', content: turn.user },
    { role: 'assistant', content: JSON.stringify({ reply: turn.reply, topics: turn.topics }) },
  ])
}
function insert(turn: ChatTurn) {
  if (turn.applied || !turn.topics.length) return
  props.apply(turn.target, turn.topics)
  turn.applied = true
}
async function send() {
  if (!canSend.value) return
  error.value = ''
  let turn: ChatTurn | undefined
  const id = ++requestId
  try {
    const target = props.currentTarget()
    const input = validateChatInput({
      topic: target.topic, existing: target.existing, count: count.value,
      messages: [...history(), { role: 'user', content: text.value.trim() }],
    })
    stopModels()
    controller = new AbortController()
    const shouldInsert = autoExpand.value
    busy.value = true
    turns.value.push({ user: text.value.trim(), reply: '', topics: [], model: model.value.trim(), state: 'sending', applied: false, error: '', target })
    turn = turns.value.at(-1)!
    expanded.value = true
    text.value = ''
    void scrollLog()
    const result = await requestChat({ baseURL: settings.value.baseURL, model: turn.model }, input, controller.signal)
    if (disposed || id !== requestId) return
    const reply = parseChatReply(JSON.stringify(result), input)
    turn.reply = reply.reply
    turn.topics = reply.topics
    turn.state = 'done'
    if (shouldInsert && turn.topics.length) {
      try { insert(turn) } catch (reason) { turn.error = reason instanceof Error ? reason.message : '节点扩展失败' }
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
  try { insert(turn) } catch (reason) { turn.error = reason instanceof Error ? reason.message : '插入失败' }
}
function clearChat() {
  turns.value = []
  error.value = ''
}
watch(expanded, (value) => { if (value) void scrollLog() })
watch(() => props.target ? `${props.target.documentId}:${props.target.uid}` : '', () => {
  cancel()
  turns.value = []
  text.value = ''
  error.value = ''
}, { flush: 'sync' })
onMounted(async () => {
  try {
    const value = await getAiConnection()
    if (disposed) return
    settings.value = value
    model.value = value.model
    // Model discovery never sends node content or starts a completion.
    if (value.hasKey || isVsCode) void refreshModels()
  } catch { if (!disposed) error.value = '无法读取 AI 设置' }
  finally { loading.value = false }
})
onBeforeUnmount(() => { disposed = true; cancel(); stopModels() })
</script>

<template>
  <aside class="ai-chat-panel" :class="{ expanded }" aria-label="AI 对话">
    <div v-show="expanded" class="ai-chat-detail">
      <div class="ai-chat-detail-top">
        <h2><Sparkles :size="15" />AI 对话</h2>
        <div class="ai-chat-target"><span>当前节点</span><strong>{{ target?.topic || '未选中单个节点' }}</strong></div>
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
            <ul v-if="turn.topics.length" class="ai-chat-topics"><li v-for="topic in turn.topics" :key="topic">{{ topic }}</li></ul>
            <span v-if="turn.applied" class="ai-chat-applied">已添加 {{ turn.topics.length }} 个子主题</span>
            <button v-else-if="turn.topics.length" type="button" class="button" :disabled="busy" @click="insertManually(turn)">添加 {{ turn.topics.length }} 个子主题</button>
          </template>
          <p v-if="turn.error" class="field-error" role="alert">{{ turn.error }}</p>
        </article>
      </div>
      <details class="ai-disclosure">
        <summary>发送内容</summary>
        <div><strong>当前节点</strong><p>{{ target?.topic || '无' }}</p><strong>已有直接子主题</strong>
          <ul><li v-for="(topic, index) in target?.existing || []" :key="index">{{ topic }}</li></ul>
          <strong>本次消息</strong><p>{{ text || '无' }}</p><span>包含当前窗口已完成的对话，最多 10 轮；不含其他节点、备注或图片。内容将发送到 {{ destination }}，可能产生服务费用。</span>
        </div>
      </details>
    </div>
    <div v-if="modelError || error || completed.length >= 10" class="ai-chat-notices">
      <p v-if="modelError" class="field-error" role="alert">{{ modelError }}</p>
      <p v-if="error" class="field-error" role="alert">{{ error }}</p>
      <p v-if="completed.length >= 10" class="field-error">本轮对话已达上限，请清空后继续</p>
    </div>
    <form class="ai-chat-bar" @submit.prevent="send">
      <div class="ai-chat-bar-top">
        <IconButton :icon="expanded ? ChevronDown : ChevronUp" :label="expanded ? '收起 AI 回复' : '展开 AI 回复'" @click="expanded = !expanded" />
        <select aria-label="对话模型" :value="manualModel ? '__manual__' : model" :disabled="busy || loading || fetchingModels || connectionBusy" @change="chooseModel">
          <option v-if="!model && !manualModel" value="" disabled>选择模型</option>
          <option v-for="item in choices" :key="item" :value="item">{{ item }}</option>
          <option value="__manual__">手动输入模型…</option>
        </select>
        <input v-if="manualModel" v-model="model" class="ai-manual-model" aria-label="手动对话模型" placeholder="模型名称" maxlength="150" :disabled="busy" />
        <span class="ai-chat-destination" :title="`对话内容将发送到 ${destination}，可能产生服务费用`">{{ destination }} · 可能产生费用</span>
        <IconButton :icon="Settings2" label="AI 连接设置" :disabled="busy || loading || connectionBusy" @click="openSettings" />
      </div>
      <div class="ai-chat-bar-input">
        <textarea ref="composer" v-model="text" aria-label="AI 对话消息" rows="3" maxlength="2000" :placeholder="target ? '描述要扩展的内容…' : '先选择一个节点'" :disabled="busy || !target"></textarea>
        <button v-if="busy" type="button" class="button" @click="cancel"><X :size="15" />停止生成</button>
        <button v-else type="submit" class="button primary" :disabled="!canSend"><Send :size="15" />发送</button>
      </div>
    </form>
    <AiConnectionDialog v-if="settingsOpen" :settings="settings" :known-models="models" @saved="configured" @models="receivedModels" @close="settingsOpen = false">
      <div class="ai-chat-options">
        <label><input v-model="autoExpand" type="checkbox" aria-label="回复后自动扩展当前节点" :disabled="busy" />回复后自动扩展</label>
        <label>最多<input v-model.number="count" type="number" min="1" max="10" aria-label="AI 子主题数量" :disabled="busy" />个子主题</label>
      </div>
      <AiShortcutSettings :value="shortcut" :loading="shortcutLoading" :load-error="shortcutError" :mac="mac" :save="saveShortcut" />
    </AiConnectionDialog>
  </aside>
</template>
