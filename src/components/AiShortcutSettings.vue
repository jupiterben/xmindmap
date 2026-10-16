<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RotateCcw } from 'lucide-vue-next'
import IconButton from './IconButton.vue'
import { DEFAULT_AI_SHORTCUT, shortcutKeys, shortcutLabel } from '../domain/shortcuts'

const props = defineProps<{ value: string; loading: boolean; loadError: string; mac: boolean; save: (value: string) => Promise<void> }>()
const enabled = ref(true)
const shift = ref(false)
const key = ref('KeyA')
const pending = ref(false)
const error = ref('')
const saved = ref(false)
watch(() => props.value, (value) => {
  enabled.value = !!value
  shift.value = value.includes('+Shift+')
  key.value = value.split('+').at(-1) || 'KeyA'
}, { immediate: true })
const draft = computed(() => enabled.value ? `Mod+Alt+${shift.value ? 'Shift+' : ''}${key.value}` : '')
watch(draft, () => { saved.value = false; error.value = '' })
async function persist(value = draft.value) {
  pending.value = true
  saved.value = false
  error.value = ''
  try {
    await props.save(value)
    enabled.value = !!value
    shift.value = value.includes('+Shift+')
    key.value = value.split('+').at(-1) || 'KeyA'
    saved.value = true
  } catch { error.value = '快捷键保存失败，请重试' }
  finally { pending.value = false }
}
</script>

<template>
  <details class="ai-shortcut-settings">
    <summary>快捷键设置 <span>{{ shortcutLabel(value, mac) }}</span></summary>
    <fieldset :disabled="loading || pending">
      <label class="ai-shortcut-enable"><input v-model="enabled" type="checkbox" aria-label="启用 AI 扩展快捷键" />启用快捷键</label>
      <div class="ai-shortcut-fields">
        <label class="field-label">组合键
          <select v-model="shift" aria-label="AI 快捷键组合" :disabled="!enabled">
            <option :value="false">{{ mac ? '⌘ + ⌥' : 'Ctrl + Alt' }}</option>
            <option :value="true">{{ mac ? '⌘ + ⌥ + Shift' : 'Ctrl + Alt + Shift' }}</option>
          </select>
        </label>
        <label class="field-label">按键
          <select v-model="key" aria-label="AI 快捷键按键" :disabled="!enabled">
            <option v-for="code in shortcutKeys" :key="code" :value="code">{{ code.replace(/^(Key|Digit)/, '') }}</option>
          </select>
        </label>
      </div>
      <div class="ai-settings-actions">
        <button type="button" class="button" @click="persist()">保存快捷键</button>
        <IconButton :icon="RotateCcw" label="恢复默认 AI 快捷键" @click="persist(DEFAULT_AI_SHORTCUT)" />
      </div>
    </fieldset>
    <p v-if="error || loadError" class="field-error" role="alert">{{ error || loadError }}</p>
    <p v-else-if="saved" class="ai-shortcut-saved" role="status">快捷键已保存</p>
  </details>
</template>
