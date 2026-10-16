import { parseModels, validateAiSettings, validateApiKey } from '../domain/ai'
import type { AiSettings } from '../domain/ai'
import { boundedFetch } from './http'

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
    const response = await boundedFetch(fetchImpl, 1024 * 1024)(`${config.baseURL}/models`, {
      method: 'GET', signal: controller.signal,
      headers: key ? { Authorization: `Bearer ${key}` } : {},
    })
    if (response.status === 401 || response.status === 403) throw new Error('模型列表认证失败，请检查 API Key')
    if (!response.ok) throw new Error(`模型列表获取失败（HTTP ${response.status}），可手动填写模型`)
    let data: unknown
    try { data = await response.json() } catch { throw new Error('模型列表不是有效 JSON，可手动填写模型') }
    return parseModels(data)
  } catch (error) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    if (timedOut) throw new Error('获取模型列表超时，可重试或手动填写模型')
    if (error instanceof Error && /^(模型列表|服务未|AI 返回)/.test(error.message)) throw error
    throw new Error('无法获取模型列表，请检查网络和 CORS，或手动填写模型')
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}
