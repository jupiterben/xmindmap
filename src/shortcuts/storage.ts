import { COMMAND_SHORTCUT_KEY, resolveShortcuts, validateShortcutMap } from '../domain/commandShortcuts'
import type { ShortcutMap } from '../domain/commandShortcuts'
import { hostDataRequest, isVsCode } from '../platform/vscode'

export async function readCommandShortcuts(): Promise<ShortcutMap> {
  try {
    if (isVsCode) return resolveShortcuts(await hostDataRequest('shortcuts.get'))
    const saved = localStorage.getItem(COMMAND_SHORTCUT_KEY)
    return resolveShortcuts(saved === null ? undefined : JSON.parse(saved))
  } catch {
    return resolveShortcuts(undefined)
  }
}

export async function writeCommandShortcuts(shortcuts: Partial<ShortcutMap>): Promise<ShortcutMap> {
  const stored = validateShortcutMap(shortcuts)
  const resolved = resolveShortcuts(stored)
  if (isVsCode) {
    await hostDataRequest('shortcuts.set', { shortcuts: stored })
    return resolved
  }
  if (Object.keys(stored).length) localStorage.setItem(COMMAND_SHORTCUT_KEY, JSON.stringify(stored))
  else localStorage.removeItem(COMMAND_SHORTCUT_KEY)
  return resolved
}
