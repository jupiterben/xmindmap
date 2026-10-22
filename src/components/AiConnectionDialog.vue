<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Settings2, X } from 'lucide-vue-next'
import IconButton from './IconButton.vue'
import ProviderIcon from './ProviderIcon.vue'
import { probeModels, saveAiConnection, saveProviderKey } from '../ai/connection'
import { AI_PROVIDERS, endpointLabel, validateAiSettings } from '../domain/ai'
import type { AiCatalogModel, AiProvider, AiSettingsStatus } from '../domain/ai'
import { isVsCode, vscode } from '../platform/vscode'
import { openExternalUrl } from '../platform/desktop'

const props = defineProps<{ settings: AiSettingsStatus; knownModels?: AiCatalogModel[] }>()
const emit = defineEmits<{
  close: []
  saved: [settings: AiSettingsStatus]
}>()
const dialog = ref<HTMLDialogElement | null>(null)
const model = ref(props.settings.model)
const catalog = ref<AiCatalogModel[]>([...(props.knownModels || [])])
const providerStatus = ref(props.settings.providers?.length ? props.settings.providers : AI_PROVIDERS.map((provider) => ({ ...provider, hasKey: false })))
const providerKeys = ref<Record<string, string>>({})
const draftProvider = ref('')
const draftKey = ref('')
const draftURL = ref('')
const pickerOpen = ref(false)
const pickerRoot = ref<HTMLElement | null>(null)
const providerAttempts = new Map<string, string>()
const providerControllers = new Map<string, AbortController>()
const busy = ref(false)
const error = ref('')
const status = ref('')
let disposed = false

const addedProviders = computed(() => providerStatus.value.filter((provider) => provider.hasKey))
const availableProviders = computed(() => providerStatus.value.filter((provider) => !provider.hasKey))
const selectedProvider = computed(() => draftProvider.value === 'custom'
  ? { id: 'custom', label: '自定义', baseURL: '', keyURL: '' }
  : providerStatus.value.find((provider) => provider.id === draftProvider.value))
const keyLink = computed(() => selectedProvider.value?.keyURL || '')
function providerModels(baseURL: string) {
  return catalog.value.filter((item) => item.baseURL === baseURL).map((item) => item.model)
}
function iconId(id: string) {
  return id.startsWith('custom:') ? 'custom' : id
}
function closePicker(event: PointerEvent) {
  if (!pickerRoot.value?.contains(event.target as Node)) pickerOpen.value = false
}
function chooseProvider(id: string) {
  draftProvider.value = id
  pickerOpen.value = false
}
function openKeyPage(event: MouseEvent) {
  if (!keyLink.value) return
  event.preventDefault()
  if (isVsCode) vscode?.postMessage({ type: 'openExternal', url: keyLink.value })
  else openExternalUrl(keyLink.value)
}
function mergeCatalog(baseURL: string, list: string[]) {
  const provider = endpointLabel(baseURL)
  catalog.value = [...catalog.value.filter((item) => item.baseURL !== baseURL), ...list.map((model) => ({ baseURL, provider, model }))]
}
async function addProvider() {
  const key = draftKey.value.trim()
  error.value = ''
  if (!draftProvider.value) { error.value = '请选择服务商'; return }
  if (!key) { error.value = '请填写 API Key'; return }
  let provider: AiProvider | undefined
  if (draftProvider.value === 'custom') {
    let url = ''
    try { url = validateAiSettings({ baseURL: draftURL.value, model: '' }, false).baseURL } catch (reason) {
      error.value = reason instanceof Error ? reason.message : '接口地址格式不正确'
      return
    }
    if (providerStatus.value.some((item) => item.baseURL === url && item.hasKey)) { error.value = '该服务商已添加'; return }
    provider = { id: `custom:${url}`, label: endpointLabel(url), baseURL: url }
  } else provider = availableProviders.value.find((item) => item.id === draftProvider.value)
  if (!provider) { error.value = '请选择服务商'; return }
  providerKeys.value = { ...providerKeys.value, [provider.id]: key }
  await connectProvider(provider)
  if (providerStatus.value.some((item) => item.baseURL === provider.baseURL && item.hasKey)) {
    draftProvider.value = ''
    draftKey.value = ''
    draftURL.value = ''
  }
}
async function connectProvider(provider: AiProvider) {
  const key = (providerKeys.value[provider.id] || '').trim()
  if (disposed || busy.value || !key) return
  const signature = `${provider.baseURL}\n${key}`
  if (providerAttempts.get(provider.id) === signature) return
  providerAttempts.set(provider.id, signature)
  providerControllers.get(provider.id)?.abort()
  const probe = new AbortController()
  providerControllers.set(provider.id, probe)
  error.value = ''
  status.value = `正在获取 ${provider.label} 模型…`
  try {
    const list = await probeModels({ baseURL: provider.baseURL, model: '' }, key, probe.signal)
    if (disposed || providerControllers.get(provider.id) !== probe) return
    const saved = await saveProviderKey(provider.baseURL, key)
    if (disposed || providerControllers.get(provider.id) !== probe) return
    providerKeys.value = { ...providerKeys.value, [provider.id]: '' }
    providerStatus.value = saved.providers
    mergeCatalog(provider.baseURL, list)
    if (!model.value && list[0]) await persist('', provider.baseURL, list[0])
    else emit('saved', saved)
    if (disposed || providerControllers.get(provider.id) !== probe) return
    status.value = `${provider.label} 已保存，已获取 ${list.length} 个模型`
  } catch (reason) {
    if (providerControllers.get(provider.id) === probe) providerAttempts.delete(provider.id)
    if (disposed || providerControllers.get(provider.id) !== probe || (reason instanceof Error && reason.name === 'AbortError')) return
    error.value = reason instanceof Error ? reason.message : '模型列表获取失败'
  } finally { if (providerControllers.get(provider.id) === probe) providerControllers.delete(provider.id) }
}
async function forgetProvider(provider: AiProvider) {
  busy.value = true
  error.value = ''
  try {
    const saved = await saveProviderKey(provider.baseURL, '', true)
    if (disposed) return
    providerStatus.value = saved.providers
    providerKeys.value = { ...providerKeys.value, [provider.id]: '' }
    providerAttempts.delete(provider.id)
    catalog.value = catalog.value.filter((item) => item.baseURL !== provider.baseURL)
    emit('saved', saved)
    status.value = `${provider.label} 密钥已清除`
  } catch (reason) {
    if (!disposed) error.value = reason instanceof Error ? reason.message : '密钥清除失败'
  } finally { busy.value = false }
}
async function persist(key: string, target: string, selected: string) {
  const saved = await saveAiConnection({ baseURL: target, model: selected }, key)
  if (disposed) return
  providerStatus.value = saved.providers
  model.value = saved.model
  emit('saved', saved)
}
onMounted(() => { dialog.value?.showModal(); document.addEventListener('pointerdown', closePicker) })
onBeforeUnmount(() => { disposed = true; document.removeEventListener('pointerdown', closePicker); for (const probe of providerControllers.values()) probe.abort() })
</script>

<template>
  <dialog ref="dialog" class="ai-connection-dialog" aria-labelledby="ai-settings-title" @cancel.prevent="emit('close')">
    <div class="dialog-heading">
      <h2 id="ai-settings-title"><Settings2 :size="18" />AI 设置</h2>
      <IconButton :icon="X" label="关闭 AI 设置" @click="emit('close')" />
    </div>
    <div class="ai-connection-body">
    <form @submit.prevent="addProvider">
      <div class="section-label">服务商<span>选择后添加</span></div>
      <ul v-if="addedProviders.length" class="ai-provider-list">
        <li v-for="provider in addedProviders" :key="provider.id" class="ai-provider">
          <div class="ai-provider-head"><strong><ProviderIcon :id="iconId(provider.id)" />{{ provider.label }}</strong><span>已添加</span><button type="button" class="text-button" :disabled="busy" @click="forgetProvider(provider)">移除 {{ provider.label }}</button></div>
          <ul v-if="providerModels(provider.baseURL).length" class="ai-provider-models" :aria-label="`${provider.label} 可用模型`"><li v-for="name in providerModels(provider.baseURL)" :key="name">{{ name }}</li></ul>
        </li>
      </ul>
      <div class="ai-provider-add">
        <div ref="pickerRoot" class="field-label ai-provider-picker">服务商
          <button type="button" class="ai-provider-trigger" aria-label="添加服务商" aria-haspopup="listbox" :aria-expanded="pickerOpen" :disabled="busy" @click="pickerOpen = !pickerOpen">
            <ProviderIcon v-if="selectedProvider" :id="selectedProvider.id" />
            <span>{{ selectedProvider?.label || '选择服务商' }}</span>
          </button>
          <ul v-if="pickerOpen" class="ai-provider-options" role="listbox" aria-label="服务商列表">
            <li v-for="provider in availableProviders" :key="provider.id">
              <button type="button" role="option" :aria-selected="provider.id === draftProvider" @click="chooseProvider(provider.id)"><ProviderIcon :id="provider.id" />{{ provider.label }}</button>
            </li>
            <li>
              <button type="button" role="option" :aria-selected="draftProvider === 'custom'" @click="chooseProvider('custom')"><ProviderIcon id="custom" />自定义</button>
            </li>
          </ul>
        </div>
        <label v-if="draftProvider === 'custom'" class="field-label">API 基础地址<input v-model="draftURL" aria-label="AI API 基础地址" type="url" maxlength="500" autocomplete="off" placeholder="https://api.example.com/v1" :disabled="busy" /></label>
        <label class="field-label"><span class="ai-key-heading"><a v-if="keyLink" class="ai-key-link" :href="keyLink" target="_blank" rel="noopener noreferrer" @click.stop="openKeyPage">申请</a>API Key{{ isVsCode ? '（VS Code 密钥存储）' : '（仅当前会话）' }}</span><input v-model="draftKey" aria-label="服务商 API Key" type="password" maxlength="4096" autocomplete="new-password" placeholder="输入 API Key" :disabled="busy" /></label>
        <button class="button" type="submit" :disabled="busy">添加</button>
      </div>
    </form>
    <slot />
    <p v-if="status" class="ai-shortcut-saved" role="status">{{ status }}</p>
    <p v-if="error" class="field-error ai-error" role="alert">{{ error }}</p>
    </div>
    <div class="dialog-actions">
      <button class="button" type="button" :disabled="busy" @click="emit('close')">取消</button>
      <button class="button primary" type="button" :disabled="busy" @click="emit('close')">确定</button>
    </div>
  </dialog>
</template>
