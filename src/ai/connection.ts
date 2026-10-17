import { AI_SETTINGS_KEY, defaultAiSettings, endpointLabel, presentAiStatus, validateAiSettings, validateApiKey } from '../domain/ai'
import type { AiCatalogModel, AiChatInput, AiChatReply, AiExpansionInput, AiSettings, AiSettingsStatus } from '../domain/ai'
import { hostDataRequest, isVsCode } from '../platform/vscode'

const sessionKeys = new Map<string, string>()

function readStored(): AiSettings {
  try {
    const saved = localStorage.getItem(AI_SETTINGS_KEY)
    if (saved) return validateAiSettings(JSON.parse(saved), false)
  } catch { /* Missing or obsolete settings are edited in the connection form. */ }
  return { ...defaultAiSettings }
}
function webStatus(settings: AiSettings): AiSettingsStatus {
  return presentAiStatus({
    ...settings,
    hasKey: !!sessionKeys.get(settings.baseURL),
    providers: [...sessionKeys.keys()].map((baseURL) => ({ baseURL, hasKey: true })),
  })
}
async function hostStatus(data: unknown): Promise<AiSettingsStatus> {
  return presentAiStatus(data)
}

export async function getAiConnection(): Promise<AiSettingsStatus> {
  if (isVsCode) return hostStatus(await hostDataRequest('ai.settings'))
  return webStatus(readStored())
}

export async function saveAiConnection(settings: AiSettings, apiKey: string, forget = false): Promise<AiSettingsStatus> {
  const validated = validateAiSettings(settings, false)
  const key = validateApiKey(apiKey)
  if (isVsCode) return hostStatus(await hostDataRequest('ai.configure', { settings: validated, apiKey: key, forget }))
  localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(validated))
  if (forget) sessionKeys.delete(validated.baseURL)
  else if (key) sessionKeys.set(validated.baseURL, key)
  return webStatus(validated)
}

export async function saveProviderKey(baseURL: string, apiKey: string, forget = false): Promise<AiSettingsStatus> {
  const endpoint = validateAiSettings({ baseURL, model: '' }, false).baseURL
  const key = validateApiKey(apiKey)
  if (!forget && !key) throw new Error('请填写 API Key')
  if (isVsCode) return hostStatus(await hostDataRequest('ai.configure', { settings: { baseURL: endpoint, model: '' }, apiKey: key, forget, keyOnly: true }))
  if (forget) sessionKeys.delete(endpoint)
  else sessionKeys.set(endpoint, key)
  return webStatus(readStored())
}

export async function requestExpansion(settings: AiSettings, input: AiExpansionInput, signal: AbortSignal): Promise<string[]> {
  if (isVsCode) return await hostDataRequest('ai.generate', { settings, input }, signal) as string[]
  const config = validateAiSettings(settings)
  const { generateTopics } = await import('./generate')
  signal.throwIfAborted()
  return generateTopics(config, sessionKeys.get(config.baseURL) || '', input, signal)
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
  return fetchModels(config, key || sessionKeys.get(config.baseURL) || '', signal)
}

export async function requestCatalog(signal: AbortSignal): Promise<AiCatalogModel[]> {
  const status = await getAiConnection()
  const targets = status.providers.filter((provider) => provider.hasKey).map((provider) => ({ baseURL: provider.baseURL, provider: provider.label }))
  if ((status.hasKey || isVsCode) && !targets.some((target) => target.baseURL === status.baseURL)) {
    targets.push({ baseURL: status.baseURL, provider: endpointLabel(status.baseURL) })
  }
  const groups = await Promise.all(targets.map(async (target) => {
    try {
      const models = await requestModels({ baseURL: target.baseURL, model: '' }, signal)
      return { models: models.map((model): AiCatalogModel => ({ ...target, model })) }
    } catch (error) {
      return { models: [] as AiCatalogModel[], error: error instanceof Error ? error.message : '模型列表获取失败' }
    }
  }))
  const models = groups.flatMap((group) => group.models)
  const failure = groups.find((group) => group.error)
  if (!models.length && failure?.error) throw new Error(failure.error)
  return models
}

export async function requestChat(settings: AiSettings, input: AiChatInput, signal: AbortSignal): Promise<AiChatReply> {
  const config = validateAiSettings(settings)
  if (isVsCode) return await hostDataRequest('ai.chat', { settings: config, input }, signal) as AiChatReply
  const { generateChat } = await import('./generate')
  signal.throwIfAborted()
  return generateChat(config, sessionKeys.get(config.baseURL) || '', input, signal)
}
