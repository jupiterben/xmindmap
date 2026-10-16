<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { LoaderCircle, Settings2, Trash2, X } from 'lucide-vue-next'
import IconButton from './IconButton.vue'
import { probeModels, requestModels, saveAiConnection } from '../ai/connection'
import { validateAiSettings } from '../domain/ai'
import type { AiSettingsStatus } from '../domain/ai'
import { isVsCode } from '../platform/vscode'

const props = defineProps<{ settings: AiSettingsStatus; knownModels?: string[] }>()
const emit = defineEmits<{
  close: []
  saved: [settings: AiSettingsStatus]
  models: [models: string[], baseURL: string]
}>()
const dialog = ref<HTMLDialogElement | null>(null)
const baseURL = ref(props.settings.baseURL)
const model = ref(props.settings.model)
const apiKey = ref('')
const hasKey = ref(props.settings.hasKey)
const savedEndpoint = ref(props.settings.baseURL)
const models = ref<string[]>([...(props.knownModels || [])])
const touchedEndpoint = ref(false)
const busy = ref(false)
const fetching = ref(false)
const error = ref('')
const status = ref('')
let disposed = false
let controller: AbortController | undefined
let requestId = 0
let timer: ReturnType<typeof setTimeout> | undefined
let modelTimer: ReturnType<typeof setTimeout> | undefined
let attempted = ''
let savedModel = props.settings.model

function endpoint(): string {
  try { return validateAiSettings({ baseURL: baseURL.value, model: '' }, false).baseURL } catch { return '' }
}
// 地址与密钥已保存且当前填写的地址与之相符时，可以直接改写模型名称。
const connected = computed(() => hasKey.value && !!endpoint() && endpoint() === savedEndpoint.value)
function stopTimers() {
  clearTimeout(timer)
  timer = undefined
  clearTimeout(modelTimer)
  modelTimer = undefined
}
function startRequest(): number {
  requestId++
  controller?.abort()
  controller = new AbortController()
  return requestId
}
async function persist(key: string, target: string, selected: string) {
  const saved = await saveAiConnection({ baseURL: target, model: selected }, key)
  if (disposed) return
  hasKey.value = saved.hasKey
  savedEndpoint.value = saved.baseURL
  baseURL.value = saved.baseURL
  model.value = saved.model
  savedModel = saved.model
  emit('saved', saved)
  emit('models', models.value, saved.baseURL)
}
async function saveModel(value: string) {
  error.value = ''
  try {
    const saved = await saveAiConnection({ baseURL: savedEndpoint.value, model: value }, '')
    if (disposed) return
    savedModel = saved.model
    model.value = saved.model
    emit('saved', saved)
  } catch { if (!disposed) error.value = '模型偏好保存失败，本轮仍可使用所选模型' }
}
// 地址和密钥都填好后自动获取模型，不再要求先点一次“保存连接并获取模型”。
async function discover() {
  const target = endpoint()
  const key = apiKey.value.trim()
  if (disposed || busy.value || !target || !key) return
  // 只在地址被改过、或为已保存的地址换密钥时自动请求，避免打开设置就产生请求。
  if (!touchedEndpoint.value && !(hasKey.value && target === savedEndpoint.value)) return
  const signature = `${target}\n${key}`
  if (signature === attempted) return
  attempted = signature
  const id = startRequest()
  fetching.value = true
  error.value = ''
  status.value = ''
  try {
    const list = await probeModels({ baseURL: target, model: model.value }, key, controller!.signal)
    if (disposed || id !== requestId) return
    models.value = list
    await persist(key, target, model.value || list[0]!)
    if (disposed || id !== requestId) return
    status.value = '连接已保存，已获取模型列表'
  } catch (reason) {
    if (disposed || id !== requestId || (reason instanceof Error && reason.name === 'AbortError')) return
    models.value = []
    error.value = reason instanceof Error ? reason.message : '模型列表获取失败，可手动填写模型'
  } finally { if (id === requestId) fetching.value = false }
}
async function save(forget = false) {
  busy.value = true
  error.value = ''
  status.value = ''
  stopTimers()
  try {
    const settings = await saveAiConnection({ baseURL: baseURL.value, model: model.value }, apiKey.value, forget)
    if (disposed) return
    apiKey.value = ''
    hasKey.value = settings.hasKey
    savedEndpoint.value = settings.baseURL
    baseURL.value = settings.baseURL
    model.value = settings.model
    savedModel = settings.model
    if (forget) models.value = []
    emit('saved', settings)
    emit('models', [], settings.baseURL)
    status.value = forget ? '密钥已清除' : '连接已保存'
    if (forget) return
    const id = startRequest()
    fetching.value = true
    try {
      const list = await requestModels(settings, controller!.signal)
      if (disposed || id !== requestId) return
      models.value = list
      if (!settings.model) await persist('', settings.baseURL, list[0]!)
      if (disposed || id !== requestId) return
      emit('models', list, settings.baseURL)
      emit('close')
    } catch (reason) {
      if (!disposed && id === requestId && !(reason instanceof Error && reason.name === 'AbortError')) {
        error.value = reason instanceof Error ? reason.message : '模型列表获取失败，可手动填写模型'
      }
    } finally { if (id === requestId) fetching.value = false }
  } catch (reason) {
    if (!disposed) error.value = reason instanceof Error ? reason.message : '连接保存失败'
  } finally { busy.value = false }
}
function pick(item: string) {
  clearTimeout(modelTimer)
  modelTimer = undefined
  model.value = item
  if (disposed || !connected.value || item === savedModel) return
  void saveModel(item)
}
watch([baseURL, apiKey], () => {
  clearTimeout(timer)
  timer = setTimeout(() => { timer = undefined; void discover() }, 700)
})
watch(baseURL, () => { if (endpoint() !== savedEndpoint.value) models.value = [] }, { flush: 'sync' })
watch(model, () => {
  clearTimeout(modelTimer)
  modelTimer = setTimeout(() => {
    modelTimer = undefined
    const value = model.value.trim()
    if (disposed || busy.value || fetching.value || !connected.value || value === savedModel) return
    void saveModel(value)
  }, 700)
})
onMounted(() => dialog.value?.showModal())
onBeforeUnmount(() => { disposed = true; stopTimers(); controller?.abort() })
</script>

<template>
  <dialog ref="dialog" class="ai-connection-dialog" aria-labelledby="ai-settings-title" @cancel.prevent="emit('close')">
    <div class="dialog-heading">
      <h2 id="ai-settings-title"><Settings2 :size="18" />AI 设置</h2>
      <IconButton :icon="X" label="关闭 AI 设置" @click="emit('close')" />
    </div>
    <form @submit.prevent="save()">
      <label class="field-label">API 基础地址<input v-model="baseURL" aria-label="AI API 基础地址" type="url" required maxlength="500" autocomplete="off" :disabled="busy" @input="touchedEndpoint = true" /></label>
      <label class="field-label">API Key{{ isVsCode ? '（VS Code 密钥存储）' : '（仅当前会话）' }}
        <input v-model="apiKey" aria-label="AI API Key" type="password" maxlength="4096" autocomplete="new-password" :placeholder="hasKey && baseURL === savedEndpoint ? '已配置，留空保留' : '无鉴权本地服务可留空'" :disabled="busy" />
      </label>
      <label class="field-label">模型（可选）<input v-model="model" aria-label="AI 模型" maxlength="150" autocomplete="off" placeholder="留空则选用列表首项" :disabled="busy" /></label>
      <div v-if="fetching || models.length" class="ai-model-picker">
        <p v-if="fetching" class="ai-model-hint"><LoaderCircle :size="12" class="spin" />正在获取模型…</p>
        <template v-else>
          <p class="ai-model-hint">已获取 {{ models.length }} 个模型，点击选用</p>
          <div class="ai-model-list" role="group" aria-label="可选模型">
            <button v-for="item in models" :key="item" type="button" class="ai-model-choice" :class="{ active: item === model }" :aria-pressed="item === model" :disabled="busy" @click="pick(item)">{{ item }}</button>
          </div>
        </template>
      </div>
      <div class="ai-settings-actions">
        <button class="button primary" type="submit" :disabled="busy || fetching"><LoaderCircle v-if="busy || fetching" :size="15" class="spin" />{{ fetching ? '获取模型中…' : '保存连接并获取模型' }}</button>
        <button class="text-button" type="button" :disabled="!hasKey || busy" @click="save(true)"><Trash2 :size="14" />忘记密钥</button>
      </div>
    </form>
    <slot />
    <p v-if="status" class="ai-shortcut-saved" role="status">{{ status }}</p>
    <p v-if="error" class="field-error ai-error" role="alert">{{ error }}</p>
    <div class="dialog-actions"><button class="button" type="button" @click="emit('close')">返回对话</button></div>
  </dialog>
</template>
