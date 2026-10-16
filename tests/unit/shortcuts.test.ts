import { describe, expect, it } from 'vitest'
import { DEFAULT_AI_SHORTCUT, matchesAiShortcut, shortcutLabel, validateAiShortcut } from '../../src/domain/shortcuts'

const event = {
  code: 'KeyA', ctrlKey: true, altKey: true, shiftKey: false, metaKey: false,
  repeat: false, isComposing: false, getModifierState: () => false,
}

describe('AI shortcut', () => {
  it('validates safe supported combinations and disabled state', () => {
    expect(validateAiShortcut('')).toBe('')
    expect(validateAiShortcut('Mod+Alt+Shift+Digit3')).toBe('Mod+Alt+Shift+Digit3')
    for (const value of ['Ctrl+S', 'Mod+KeyZ', 'Mod+Alt+Delete', 'Mod+Alt+KeyAA', null, {}]) {
      expect(() => validateAiShortcut(value)).toThrow()
    }
  })
  it('matches exact modifiers on Windows and Mac', () => {
    expect(matchesAiShortcut(event, DEFAULT_AI_SHORTCUT, false)).toBe(true)
    expect(matchesAiShortcut({ ...event, ctrlKey: false, metaKey: true }, DEFAULT_AI_SHORTCUT, true)).toBe(true)
    expect(matchesAiShortcut(event, DEFAULT_AI_SHORTCUT, true)).toBe(false)
    expect(matchesAiShortcut({ ...event, shiftKey: true }, DEFAULT_AI_SHORTCUT, false)).toBe(false)
    expect(matchesAiShortcut({ ...event, code: 'KeyB' }, DEFAULT_AI_SHORTCUT, false)).toBe(false)
    expect(matchesAiShortcut(event, '', false)).toBe(false)
  })
  it('ignores repeats, IME and AltGraph', () => {
    expect(matchesAiShortcut({ ...event, repeat: true }, DEFAULT_AI_SHORTCUT, false)).toBe(false)
    expect(matchesAiShortcut({ ...event, isComposing: true }, DEFAULT_AI_SHORTCUT, false)).toBe(false)
    expect(matchesAiShortcut({ ...event, getModifierState: () => true }, DEFAULT_AI_SHORTCUT, false)).toBe(false)
  })
  it('formats platform-specific labels', () => {
    expect(shortcutLabel(DEFAULT_AI_SHORTCUT, false)).toBe('Ctrl+Alt+A')
    expect(shortcutLabel('Mod+Alt+Shift+KeyB', true)).toBe('⌘+⌥+Shift+B')
    expect(shortcutLabel('', false)).toBe('未启用')
  })
})
