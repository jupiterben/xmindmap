<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { Keyboard, RotateCcw, X } from 'lucide-vue-next'
import IconButton from './IconButton.vue'
import { COMMANDS, eventToShortcut, formatShortcut } from '../domain/commandShortcuts'
import type { CommandId, ShortcutMap } from '../domain/commandShortcuts'

const props = defineProps<{
  shortcuts: ShortcutMap
  mac: boolean
  loading: boolean
  loadError: string
  save: (id: CommandId, shortcut: string) => Promise<void>
  reset: () => Promise<void>
}>()
const dialog = ref<HTMLDialogElement | null>(null)
const capturing = ref<CommandId | ''>('')
const pending = ref(false)
const error = ref('')

function show() { error.value = ''; dialog.value?.showModal() }
function close() { stopCapture(); dialog.value?.close() }
function stopCapture() {
  capturing.value = ''
  window.removeEventListener('keydown', onCapture, true)
}
function startCapture(id: CommandId) {
  error.value = ''
  capturing.value = id
  window.addEventListener('keydown', onCapture, true)
}
function onCapture(event: KeyboardEvent) {
  if (!capturing.value) return
  event.preventDefault()
  event.stopPropagation()
  if (event.key === 'Escape') { stopCapture(); return }
  const shortcut = eventToShortcut(event)
  if (!shortcut) return
  const id = capturing.value
  stopCapture()
  void commit(id, shortcut)
}
async function restore() {
  pending.value = true
  error.value = ''
  try { await props.reset() }
  catch (reason) { error.value = reason instanceof Error ? reason.message : '快捷键恢复失败' }
  finally { pending.value = false }
}
async function commit(id: CommandId, shortcut: string) {
  pending.value = true
  error.value = ''
  try { await props.save(id, shortcut) }
  catch (reason) { error.value = reason instanceof Error ? reason.message : '快捷键保存失败' }
  finally { pending.value = false }
}
defineExpose({ show })
onBeforeUnmount(stopCapture)
</script>

<template>
  <dialog ref="dialog" class="shortcut-dialog" aria-labelledby="shortcut-title" @cancel.prevent="close" @close="stopCapture">
    <div class="dialog-heading">
      <h2 id="shortcut-title"><Keyboard :size="18" />快捷键</h2>
      <IconButton :icon="X" label="关闭快捷键设置" @click="close" />
    </div>
    <p class="shortcut-note">画布操作在输入文字时不会触发。保存和搜索在任何位置都有效。字母和数字需要搭配 Ctrl 或 Alt。</p>
    <ul class="shortcut-list">
      <li v-for="command in COMMANDS" :key="command.id" class="shortcut-row">
        <span>{{ command.label }}</span>
        <kbd>{{ formatShortcut(shortcuts[command.id], mac) }}</kbd>
        <button type="button" class="button" :aria-label="`修改${command.label}快捷键`" :disabled="loading || pending" @click="startCapture(command.id)">{{ capturing === command.id ? '请按键…' : '修改' }}</button>
        <button type="button" class="text-button" :disabled="loading || pending || !shortcuts[command.id]" @click="commit(command.id, '')">禁用</button>
      </li>
    </ul>
    <p v-if="error || loadError" class="field-error" role="alert">{{ error || loadError }}</p>
    <div class="dialog-actions">
      <button type="button" class="button" :disabled="loading || pending" @click="restore()"><RotateCcw :size="14" />恢复默认</button>
      <button type="button" class="button primary" @click="close">完成</button>
    </div>
  </dialog>
</template>
