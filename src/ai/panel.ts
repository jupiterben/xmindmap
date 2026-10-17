import { AI_PANEL_KEY, defaultAiPanel, validateAiPanel } from '../domain/aiPanel'
import type { AiPanelPrefs } from '../domain/aiPanel'
import { hostDataRequest, isVsCode } from '../platform/vscode'

export async function readAiPanel(): Promise<AiPanelPrefs> {
  try {
    if (isVsCode) return validateAiPanel(await hostDataRequest('ai.panel.get'))
    const saved = localStorage.getItem(AI_PANEL_KEY)
    if (saved === null) return { ...defaultAiPanel }
    return validateAiPanel(JSON.parse(saved))
  } catch {
    return { ...defaultAiPanel }
  }
}

export async function writeAiPanel(prefs: AiPanelPrefs): Promise<void> {
  const validated = validateAiPanel(prefs)
  if (isVsCode) {
    await hostDataRequest('ai.panel.set', { panel: validated })
    return
  }
  localStorage.setItem(AI_PANEL_KEY, JSON.stringify(validated))
}
