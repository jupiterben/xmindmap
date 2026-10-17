import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ShallowRef } from 'vue'
import { COMMANDS, aiShortcutToEngine, defaultShortcuts, diffShortcuts, matchesShortcut, validateShortcut } from '../domain/commandShortcuts'
import type { CommandId, ShortcutMap } from '../domain/commandShortcuts'
import type { KeyCommandApi } from '../shortcuts/bind'
import { bindCanvasShortcuts } from '../shortcuts/bind'
import { readCommandShortcuts, writeCommandShortcuts } from '../shortcuts/storage'

export function useCommandShortcuts(
  engine: ShallowRef<{ keyCommand: KeyCommandApi } | null>,
  actions: {
    save: () => void
    search: () => void
    insert: (kind: 'child' | 'sibling' | 'parent') => void
    command: (command: 'BACK' | 'FORWARD' | 'REMOVE_NODE' | 'UP_NODE' | 'DOWN_NODE') => void
    zoomBy: (direction: 1 | -1) => void
    fit: () => void
  },
  aiShortcut: ShallowRef<string> | { value: string },
) {
  const shortcuts = ref<ShortcutMap>(defaultShortcuts())
  const loading = ref(true)
  const error = ref('')
  let disposed = false

  function run(id: CommandId) {
    if (id === 'save') actions.save()
    else if (id === 'search') actions.search()
    else if (id === 'insertChild') actions.insert('child')
    else if (id === 'insertSibling') actions.insert('sibling')
    else if (id === 'insertParent') actions.insert('parent')
    else if (id === 'remove') actions.command('REMOVE_NODE')
    else if (id === 'undo') actions.command('BACK')
    else if (id === 'redo') actions.command('FORWARD')
    else if (id === 'moveUp') actions.command('UP_NODE')
    else if (id === 'moveDown') actions.command('DOWN_NODE')
    else if (id === 'zoomIn') actions.zoomBy(1)
    else if (id === 'zoomOut') actions.zoomBy(-1)
    else actions.fit()
  }
  function apply() {
    const map = engine.value
    if (map) bindCanvasShortcuts(map.keyCommand, shortcuts.value, run)
  }
  async function persist(next: ShortcutMap) {
    const saved = await writeCommandShortcuts(diffShortcuts(next))
    if (!disposed) { shortcuts.value = saved; error.value = '' }
  }
  async function update(id: CommandId, value: string) {
    const shortcut = validateShortcut(value)
    const aiKey = aiShortcutToEngine(aiShortcut.value)
    if (aiKey && shortcut.split('|').includes(aiKey)) throw new Error('与 AI 快捷键冲突')
    await persist({ ...shortcuts.value, [id]: shortcut })
  }
  async function reset() { await persist(defaultShortcuts()) }
  function onKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented) return
    const target = event.target
    const typing = target instanceof Element && !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
    for (const command of COMMANDS) {
      if (command.scope !== 'global' || !matchesShortcut(event, shortcuts.value[command.id])) continue
      if (typing && !event.ctrlKey && !event.metaKey && !event.altKey) continue
      event.preventDefault()
      run(command.id)
      return
    }
  }
  watch(engine, apply)
  watch(shortcuts, apply)
  window.addEventListener('keydown', onKeydown)
  onMounted(async () => {
    try {
      const stored = await readCommandShortcuts()
      if (!disposed) shortcuts.value = stored
    } catch {
      if (!disposed) error.value = '快捷键读取失败，当前使用默认值'
    } finally { if (!disposed) loading.value = false }
  })
  onBeforeUnmount(() => { disposed = true; window.removeEventListener('keydown', onKeydown) })
  return { shortcuts, loading, error, update, reset }
}
