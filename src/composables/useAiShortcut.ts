import { onBeforeUnmount, onMounted, ref } from 'vue'
import { AI_SHORTCUT_KEY, DEFAULT_AI_SHORTCUT, matchesAiShortcut, validateAiShortcut } from '../domain/shortcuts'
import { hostDataRequest, isVsCode } from '../platform/vscode'

export function useAiShortcut(canOpen: () => boolean, open: () => void) {
  const shortcut = ref(DEFAULT_AI_SHORTCUT)
  const loading = ref(true)
  const error = ref('')
  const mac = /Mac|iPhone|iPad/.test(navigator.platform)
  let disposed = false

  async function save(value: string) {
    const validated = validateAiShortcut(value)
    if (isVsCode) await hostDataRequest('ai.shortcut.set', { shortcut: validated })
    else localStorage.setItem(AI_SHORTCUT_KEY, validated)
    if (!disposed) { shortcut.value = validated; error.value = '' }
  }
  onMounted(async () => {
    try {
      const stored = isVsCode ? await hostDataRequest('ai.shortcut.get') : localStorage.getItem(AI_SHORTCUT_KEY)
      if (!disposed) shortcut.value = stored === null ? DEFAULT_AI_SHORTCUT : validateAiShortcut(stored)
    } catch {
      if (!disposed) error.value = '快捷键设置读取失败，可重新保存'
    } finally { if (!disposed) loading.value = false }
  })
  function onKeydown(event: KeyboardEvent) {
    if (loading.value || error.value || event.defaultPrevented || !canOpen() ||
        document.querySelector('dialog[open], [role="dialog"]')) return
    const target = event.target
    if (!(target instanceof Element) || target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return
    if (!matchesAiShortcut(event, shortcut.value, mac)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    open()
  }
  function onStorage(event: StorageEvent) {
    if (event.key !== AI_SHORTCUT_KEY) return
    try { shortcut.value = event.newValue === null ? DEFAULT_AI_SHORTCUT : validateAiShortcut(event.newValue); error.value = '' } catch { /* Ignore invalid external settings. */ }
  }
  window.addEventListener('keydown', onKeydown, true)
  if (!isVsCode) window.addEventListener('storage', onStorage)
  onBeforeUnmount(() => {
    disposed = true
    window.removeEventListener('keydown', onKeydown, true)
    window.removeEventListener('storage', onStorage)
  })
  return { shortcut, loading, error, mac, save }
}
