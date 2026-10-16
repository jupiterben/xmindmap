export const AI_SHORTCUT_KEY = 'xmindmap.ai.shortcut.v1'
export const DEFAULT_AI_SHORTCUT = 'Mod+Alt+KeyA'
export const shortcutKeys = [
  ...Array.from({ length: 26 }, (_, index) => `Key${String.fromCharCode(65 + index)}`),
  ...Array.from({ length: 10 }, (_, index) => `Digit${index}`),
]

// Restrict combinations to a primary modifier + Alt to avoid the editor's
// save/search/history keys. An empty shortcut means disabled.
export function validateAiShortcut(value: unknown): string {
  if (value === '') return ''
  if (typeof value !== 'string' || !/^Mod\+Alt\+(Shift\+)?(Key[A-Z]|Digit[0-9])$/.test(value)) {
    throw new Error('快捷键需为 Ctrl/Command + Alt，可附加 Shift，再加字母或数字')
  }
  return value
}

export function shortcutLabel(shortcut: string, mac: boolean): string {
  if (!shortcut) return '未启用'
  validateAiShortcut(shortcut)
  return `${mac ? '⌘+⌥' : 'Ctrl+Alt'}${shortcut.includes('+Shift+') ? '+Shift' : ''}+${shortcut.split('+').at(-1)!.replace(/^(Key|Digit)/, '')}`
}

export function matchesAiShortcut(
  event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'repeat' | 'isComposing' | 'getModifierState'>,
  shortcut: string,
  mac: boolean,
): boolean {
  return !!shortcut && !event.repeat && !event.isComposing && !event.getModifierState('AltGraph') &&
    (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) &&
    event.altKey && event.shiftKey === shortcut.includes('+Shift+') && event.code === shortcut.split('+').at(-1)
}
