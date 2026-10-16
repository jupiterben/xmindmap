import { AI_SETTINGS_KEY, defaultAiSettings, validateAiSettings, validateApiKey } from '../domain/ai'
import type { AiChatInput, AiChatReply, AiExpansionInput, AiSettings, AiSettingsStatus } from '../domain/ai'
import { hostDataRequest, isVsCode } from '../platform/vscode'

let sessionKey = ''
let keyEndpoint = ''

export async function getAiConnection(): Promise<AiSettingsStatus> {
  if (isVsCode) return await hostDataRequest('ai.settings') as AiSettingsStatus
  let settings = defaultAiSettings
  try {
    const saved = localStorage.getItem(AI_SETTINGS_KEY)
    if (saved) settings = validateAiSettings(JSON.parse(saved), false)
  } catch { /* Missing or obsolete settings are edited in the connection form. */ }
  return { ...settings, hasKey: keyEndpoint === settings.baseURL && !!sessionKey }
}

export async function saveAiConnection(settings: AiSettings, apiKey: string, forget = false): Promise<AiSettingsStatus> {
  const validated = validateAiSettings(settings, false)
  const key = validateApiKey(apiKey)
  if (isVsCode) return await hostDataRequest('ai.configure', { settings: validated, apiKey: key, forget }) as AiSettingsStatus
  localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(validated))
  if (forget || validated.baseURL !== keyEndpoint) sessionKey = ''
  if (key && !forget) sessionKey = key
  keyEndpoint = validated.baseURL
  return { ...validated, hasKey: !!sessionKey }
}

export async function requestExpansion(settings: AiSettings, input: AiExpansionInput, signal: AbortSignal): Promise<string[]> {
  if (isVsCode) return await hostDataRequest('ai.generate', { settings, input }, signal) as string[]
  const config = validateAiSettings(settings)
  const { generateTopics } = await import('./generate')
  signal.throwIfAborted()
  return generateTopics(config, keyEndpoint === config.baseURL ? sessionKey : '', input, signal)
}

export async function requestModels(settings: AiSettings, signal: AbortSignal): Promise<string[]> {
  return await probeModels(settings, '', signal)
}

/**
 * Discovers models for a connection that has not been saved yet, so the settings form can fetch as
 * soon as an address and key are typed. The key is only used for this request and is never stored
 * here; an empty key falls back to the key already saved for the same address.
 */
export async function probeModels(settings: AiSettings, apiKey: string, signal: AbortSignal): Promise<string[]> {
  const config = validateAiSettings(settings, false)
  const key = validateApiKey(apiKey)
  if (isVsCode) return await hostDataRequest('ai.models', { settings: config, apiKey: key }, signal) as string[]
  const { fetchModels } = await import('./models')
  signal.throwIfAborted()
  return fetchModels(config, key || (keyEndpoint === config.baseURL ? sessionKey : ''), signal)
}

export async function requestChat(settings: AiSettings, input: AiChatInput, signal: AbortSignal): Promise<AiChatReply> {
  const config = validateAiSettings(settings)
  if (isVsCode) return await hostDataRequest('ai.chat', { settings: config, input }, signal) as AiChatReply
  const { generateChat } = await import('./generate')
  signal.throwIfAborted()
  return generateChat(config, keyEndpoint === config.baseURL ? sessionKey : '', input, signal)
}
