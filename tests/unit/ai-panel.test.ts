import { describe, expect, it } from 'vitest'
import { defaultAiPanel, validateAiPanel } from '../../src/domain/aiPanel'

describe('AI panel preferences', () => {
  it('accepts saved layout and generation options', () => {
    expect(validateAiPanel({ autoExpand: false, count: 3, expanded: true, anchor: { left: 12.5, bottom: 40 } })).toEqual({
      autoExpand: false, count: 3, expanded: true, anchor: { left: 12.5, bottom: 40 },
    })
    expect(validateAiPanel({ ...defaultAiPanel, anchor: null })).toEqual(defaultAiPanel)
  })
  it('rejects counts, positions, and shapes outside the panel controls', () => {
    for (const value of [
      null,
      { ...defaultAiPanel, count: 0 },
      { ...defaultAiPanel, count: 11 },
      { ...defaultAiPanel, autoExpand: 'yes' },
      { ...defaultAiPanel, anchor: { left: -1, bottom: 0 } },
      { ...defaultAiPanel, anchor: { left: Number.POSITIVE_INFINITY, bottom: 0 } },
      { ...defaultAiPanel, anchor: { left: 1 } },
    ]) {
      expect(() => validateAiPanel(value)).toThrow()
    }
  })
})
