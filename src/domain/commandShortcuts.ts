import { isRecord } from './documents'

export const COMMAND_SHORTCUT_KEY = 'xmindmap.command-shortcuts.v1'

export const COMMANDS = [
  { id: 'insertChild', label: '子主题', default: 'Tab|Insert', scope: 'canvas' },
  { id: 'insertSibling', label: '同级主题', default: 'Enter', scope: 'canvas' },
  { id: 'insertParent', label: '插入父主题', default: 'Shift+Tab', scope: 'canvas' },
  { id: 'remove', label: '删除节点', default: 'Del|Backspace', scope: 'canvas' },
  { id: 'undo', label: '撤销', default: 'Control+z', scope: 'canvas' },
  { id: 'redo', label: '重做', default: 'Control+y', scope: 'canvas' },
  { id: 'moveUp', label: '上移节点', default: 'Control+Up', scope: 'canvas' },
  { id: 'moveDown', label: '下移节点', default: 'Control+Down', scope: 'canvas' },
  { id: 'zoomIn', label: '放大', default: 'Control+=', scope: 'canvas' },
  { id: 'zoomOut', label: '缩小', default: 'Control+-', scope: 'canvas' },
  { id: 'fit', label: '适应画布', default: 'Control+i', scope: 'canvas' },
  { id: 'save', label: '保存', default: 'Control+s', scope: 'global' },
  { id: 'search', label: '搜索', default: 'Control+f', scope: 'global' },
] as const

export type CommandId = (typeof COMMANDS)[number]['id']
export type ShortcutMap = Record<CommandId, string>

const MODIFIERS = ['Control', 'Alt', 'Shift'] as const
const KEY_CODES: Record<string, number> = {
  Backspace: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Alt: 18,
  Left: 37, Up: 38, Right: 39, Down: 40, Insert: 45, Del: 46,
  '=': 187, '-': 189, '/': 191,
}
for (let index = 0; index <= 9; index++) KEY_CODES[String(index)] = index + 48
for (let index = 0; index < 26; index++) KEY_CODES[String.fromCharCode(97 + index)] = index + 65

const PLAIN_KEYS = new Set(['Tab', 'Enter', 'Backspace', 'Del', 'Insert', 'Left', 'Up', 'Right', 'Down'])
const RESERVED = new Set(['Control+a', 'Control+c', 'Control+x', 'Control+v', 'Control+l', 'Control+g', 'Control+Enter', '/'])

export function defaultShortcuts(): ShortcutMap {
  return Object.fromEntries(COMMANDS.map((command) => [command.id, command.default])) as ShortcutMap
}

export function formatShortcut(shortcut: string, mac: boolean): string {
  if (!shortcut) return '未设置'
  return shortcut.split('|').map((part) => part.split('+').map((piece) => {
    if (piece === 'Control') return mac ? '⌘' : 'Ctrl'
    if (piece === 'Alt') return mac ? '⌥' : 'Alt'
    if (piece === 'Shift') return mac ? '⇧' : 'Shift'
    if (piece === 'Del') return 'Delete'
    if (/^[a-z]$/.test(piece)) return piece.toUpperCase()
    return piece
  }).join('+')).join(' / ')
}

export function eventToShortcut(event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'repeat' | 'isComposing' | 'getModifierState'>): string {
  if (event.repeat || event.isComposing || event.getModifierState('AltGraph')) return ''
  const key = codeToKey(event.code)
  if (!key) return ''
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('Control')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

function codeToKey(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase()
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  const named: Record<string, string> = {
    Tab: 'Tab', Enter: 'Enter', Backspace: 'Backspace', Delete: 'Del', Insert: 'Insert',
    ArrowLeft: 'Left', ArrowUp: 'Up', ArrowRight: 'Right', ArrowDown: 'Down',
    Equal: '=', Minus: '-', Slash: '/',
  }
  return named[code] || ''
}

export function validateShortcut(value: unknown): string {
  if (value === '') return ''
  if (typeof value !== 'string' || value.length > 80) throw new Error('快捷键无效')
  const alternatives = value.split('|').map((part) => normalizeAlternative(part))
  if (!alternatives.length || new Set(alternatives).size !== alternatives.length) throw new Error('快捷键无效')
  for (const alternative of alternatives) {
    if (RESERVED.has(alternative)) throw new Error('该快捷键已被复制、粘贴等系统操作占用')
    const parts = alternative.split('+')
    const key = parts.at(-1) || ''
    const hasCommand = parts.includes('Control') || parts.includes('Alt')
    if (!PLAIN_KEYS.has(key) && !hasCommand) throw new Error('字母、数字和符号需要搭配 Ctrl 或 Alt')
  }
  return alternatives.join('|')
}

function normalizeAlternative(part: string): string {
  const pieces = part.trim().split('+').filter(Boolean).map((piece) => piece === 'Delete' ? 'Del' : /^[A-Z]$/.test(piece) ? piece.toLowerCase() : piece)
  const modifiers = MODIFIERS.filter((modifier) => pieces.includes(modifier))
  const keys = pieces.filter((piece) => !MODIFIERS.includes(piece as typeof MODIFIERS[number]))
  if (keys.length !== 1 || KEY_CODES[keys[0]!] === undefined || modifiers.length !== pieces.length - 1) throw new Error('快捷键无效')
  return [...modifiers, keys[0]].join('+')
}

export function codes(shortcut: string): number[][] {
  if (!shortcut) return []
  return shortcut.split('|').map((part) => normalizeAlternative(part).split('+').map((piece) => KEY_CODES[piece]!))
}

export function matchesShortcut(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'keyCode' | 'repeat' | 'isComposing'>, shortcut: string): boolean {
  if (!shortcut || event.repeat || event.isComposing) return false
  const pressed = new Set<number>()
  if (event.ctrlKey || event.metaKey) pressed.add(KEY_CODES.Control!)
  if (event.altKey) pressed.add(KEY_CODES.Alt!)
  if (event.shiftKey) pressed.add(KEY_CODES.Shift!)
  if (!pressed.has(event.keyCode)) pressed.add(event.keyCode)
  return codes(shortcut).some((combo) => combo.length === pressed.size && combo.every((code) => pressed.has(code)))
}

function parseShortcutMap(value: unknown): Partial<ShortcutMap> {
  if (!isRecord(value)) throw new Error('快捷键设置无效')
  if (Object.keys(value).some((key) => !COMMANDS.some((command) => command.id === key))) throw new Error('快捷键设置无效')
  const stored: Partial<ShortcutMap> = {}
  for (const command of COMMANDS) {
    if (!(command.id in value)) continue
    stored[command.id] = validateShortcut(value[command.id])
  }
  return stored
}

export function resolveShortcuts(value: unknown): ShortcutMap {
  const stored = value == null ? {} : parseShortcutMap(value)
  const resolved = defaultShortcuts()
  for (const command of COMMANDS) {
    const shortcut = stored[command.id]
    if (shortcut !== undefined) resolved[command.id] = shortcut
  }
  assertNoConflicts(resolved)
  return resolved
}

export function validateShortcutMap(value: unknown): Partial<ShortcutMap> {
  const stored = parseShortcutMap(value)
  resolveShortcuts(stored)
  return stored
}

export function diffShortcuts(shortcuts: ShortcutMap): Partial<ShortcutMap> {
  const defaults = defaultShortcuts()
  const diff: Partial<ShortcutMap> = {}
  for (const command of COMMANDS) {
    if (shortcuts[command.id] !== defaults[command.id]) diff[command.id] = shortcuts[command.id]
  }
  return diff
}

export function assertNoConflicts(shortcuts: ShortcutMap): void {
  const seen = new Map<string, string>()
  for (const command of COMMANDS) {
    for (const alternative of shortcuts[command.id] ? shortcuts[command.id].split('|') : []) {
      const owner = seen.get(alternative)
      if (owner) throw new Error(`「${owner}」和「${command.label}」使用了相同快捷键`)
      seen.set(alternative, command.label)
    }
  }
}

export function aiShortcutToEngine(shortcut: string): string {
  if (!shortcut) return ''
  const code = shortcut.split('+').at(-1) || ''
  const key = code.startsWith('Key') ? code.slice(3).toLowerCase() : code.startsWith('Digit') ? code.slice(5) : ''
  if (!key) return ''
  return `Control+Alt+${shortcut.includes('+Shift+') ? 'Shift+' : ''}${key}`
}

