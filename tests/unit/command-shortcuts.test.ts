import { describe, expect, it } from 'vitest'
import { aiShortcutToEngine, defaultShortcuts, eventToShortcut, formatShortcut, matchesShortcut, resolveShortcuts, validateShortcut } from '../../src/domain/commandShortcuts'
import { bindCanvasShortcuts } from '../../src/shortcuts/bind'

const press = { repeat: false, isComposing: false, getModifierState: () => false }

describe('command shortcuts', () => {
  it('keeps the built-in canvas and global bindings', () => {
    expect(validateShortcut('Tab|Insert')).toBe('Tab|Insert')
    expect(validateShortcut('Control+Shift+s')).toBe('Control+Shift+s')
    expect(validateShortcut('')).toBe('')
    expect(formatShortcut('Control+z', false)).toBe('Ctrl+Z')
    expect(formatShortcut('Tab|Insert', true)).toBe('Tab / Insert')
    expect(() => validateShortcut('s')).toThrow(/Ctrl/)
    expect(() => validateShortcut('Control+c')).toThrow(/占用/)
    expect(() => resolveShortcuts({ undo: 'Control+y' })).toThrow(/相同快捷键/)
  })
  it('matches a keyboard event the same way the canvas engine does', () => {
    const event = { ...press, ctrlKey: true, metaKey: false, altKey: false, shiftKey: true, keyCode: 83 }
    expect(matchesShortcut(event, 'Control+Shift+s')).toBe(true)
    expect(matchesShortcut({ ...event, shiftKey: false }, 'Control+Shift+s')).toBe(false)
    expect(matchesShortcut(event, '')).toBe(false)
    expect(eventToShortcut({ ...press, code: 'KeyS', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBe('Control+Shift+s')
    expect(aiShortcutToEngine('Mod+Alt+Shift+KeyB')).toBe('Control+Alt+Shift+b')
  })
  it('replaces canvas bindings without leaving the previous key active', () => {
    const removed: string[] = []
    const added: string[] = []
    const api = {
      addShortcut: (key: string) => { added.push(key) },
      removeShortcut: (key: string) => { removed.push(key) },
    }
    const defaults = defaultShortcuts()
    bindCanvasShortcuts(api, defaults, () => {})
    expect(removed).toContain('Tab|Insert')
    expect(added).toContain('Control+z')
    expect(added).not.toContain('Control+s')
    added.length = 0
    bindCanvasShortcuts(api, { ...defaults, undo: 'Control+b' }, () => {})
    expect(removed).toContain('Control+z')
    expect(added).toContain('Control+b')
    expect(added).not.toContain('Control+z')
  })
})
