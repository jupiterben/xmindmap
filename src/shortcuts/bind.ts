import { COMMANDS } from '../domain/commandShortcuts'
import type { CommandId, ShortcutMap } from '../domain/commandShortcuts'

export interface KeyCommandApi {
  addShortcut(key: string, fn: () => void): void
  removeShortcut(key: string, fn?: () => void): void
}

const applied = new WeakMap<KeyCommandApi, string[]>()

export function bindCanvasShortcuts(keyCommand: KeyCommandApi, shortcuts: ShortcutMap, run: (id: CommandId) => void): void {
  const previous = applied.get(keyCommand) ?? []
  const clearing = new Set<string>(previous)
  for (const command of COMMANDS) {
    if (command.scope !== 'canvas') continue
    clearing.add(command.default)
    if (shortcuts[command.id]) clearing.add(shortcuts[command.id])
  }
  for (const key of clearing) keyCommand.removeShortcut(key)
  const next: string[] = []
  for (const command of COMMANDS) {
    if (command.scope !== 'canvas' || !shortcuts[command.id]) continue
    keyCommand.addShortcut(shortcuts[command.id], () => run(command.id))
    next.push(shortcuts[command.id])
  }
  applied.set(keyCommand, next)
}
