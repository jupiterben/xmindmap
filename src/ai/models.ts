import { isWorkBuddy, parseModels, validateAiSettings, validateApiKey } from '../domain/ai'
import type { AiSettings } from '../domain/ai'
import { boundedFetch } from './http'

function parseWorkBuddyModels(value: unknown): string[] {
  const data = value && typeof value === 'object' && 'data' in value ? (value as { data?: unknown }).data : undefined
  const record = data && typeof data === 'object' ? data as { agents?: unknown; models?: unknown } : {}
  const agents = Array.isArray(record.agents) ? record.agents : []
  const cli = agents.find((agent) => agent && typeof agent === 'object' && (agent as { name?: unknown }).name === 'cli' && Array.isArray((agent as { models?: unknown }).models))
  const chosen = cli ?? agents.find((agent) => agent && typeof agent === 'object' && Array.isArray((agent as { models?: unknown }).models))
  const listed = chosen && typeof chosen === 'object' && Array.isArray((chosen as { models?: unknown }).models)
    ? (chosen as { models: unknown[] }).models
    : Array.isArray(record.models) ? record.models : []
  return parseModels({
    data: listed.flatMap((item) => {
      const id = typeof item === 'string' ? item : item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string' ? (item as { id: string }).id : ''
      return id && !id.startsWith('custom:') ? [{ id }] : []
    }),
  })
}
export async function fetchModels(settings: AiSettings, apiKey: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const config = validateAiSettings(settings, false)
  const key = validateApiKey(apiKey)
  const controller = new AbortController()
  const abort = () => controller.abort()
  let timedOut = false
  if (signal.aborted) abort()
  signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, 15000)
  try {
    controller.signal.throwIfAborted()
    const workbuddy = isWorkBuddy(config.baseURL)
    const headers: Record<string, string> = {}
    if (key) headers.Authorization = `Bearer ${key}`
    if (workbuddy && key) {
      headers['X-API-Key'] = key
      headers['User-Agent'] = 'CLI/2.126.0 CodeBuddy/2.126.0'
    }
    const response = await boundedFetch(fetchImpl, 1024 * 1024)(workbuddy ? 'https://copilot.tencent.com/v3/config' : `${config.baseURL}/models`, {
      method: 'GET', signal: controller.signal, headers,
    })
    if (response.status === 401 || response.status === 403) throw new Error('模型列表认证失败，请检查 API Key')
    if (!response.ok) throw new Error(`模型列表获取失败（HTTP ${response.status}）`)
    let data: unknown
    try { data = await response.json() } catch { throw new Error('模型列表不是有效 JSON') }
    return workbuddy ? parseWorkBuddyModels(data) : parseModels(data)
  } catch (error) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    if (timedOut) throw new Error('获取模型列表超时，可重试')
    if (error instanceof Error && /^(模型列表|服务未|AI 返回)/.test(error.message)) throw error
    throw new Error('无法获取模型列表，请检查网络和 CORS')
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}
