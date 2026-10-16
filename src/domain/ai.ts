import { isRecord } from './documents'

export interface AiSettings {
  baseURL: string
  model: string
}
export interface AiSettingsStatus extends AiSettings {
  hasKey: boolean
}
export interface AiExpansionInput {
  topic: string
  existing: string[]
  instruction: string
  count: number
}
export interface AiExpansionTarget {
  documentId: string
  uid: string
  topic: string
  existing: string[]
  fingerprint: string
}
export const defaultAiSettings: AiSettings = { baseURL: 'https://api.openai.com/v1', model: '' }
export const AI_SETTINGS_KEY = 'xmindmap.ai.connection.v1'

export function validateAiSettings(value: unknown, requireModel = true): AiSettings {
  if (!isRecord(value) || typeof value.baseURL !== 'string' || typeof value.model !== 'string') throw new Error('请填写接口地址和模型名称')
  let url: URL
  try { url = new URL(value.baseURL.trim()) } catch { throw new Error('接口地址格式不正确') }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('接口必须使用 HTTPS，本机 localhost 可使用 HTTP')
  if (url.username || url.password || url.search || url.hash) throw new Error('接口地址不能包含账号、密码、查询参数或片段')
  const baseURL = url.href.replace(/\/+$/, '')
  if (baseURL.length > 500 || /\/chat\/completions$/i.test(url.pathname)) throw new Error('请填写 API 基础地址（例如 /v1），不要包含 /chat/completions')
  const model = value.model.trim()
  if ((requireModel && !model) || model.length > 150 || /[\u0000-\u001f]/.test(model)) throw new Error('请填写有效的模型名称')
  return { baseURL, model }
}

export function validateApiKey(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096 || /[\r\n]/.test(value)) throw new Error('API Key 格式不正确')
  return value.trim()
}

export function validateExpansionInput(value: unknown): AiExpansionInput {
  if (!isRecord(value) || typeof value.topic !== 'string' || !value.topic.trim() || value.topic.length > 2000 ||
      typeof value.instruction !== 'string' || value.instruction.length > 2000 ||
      !Number.isInteger(value.count) || Number(value.count) < 1 || Number(value.count) > 10 ||
      !Array.isArray(value.existing) || value.existing.length > 50 ||
      value.existing.some((text) => typeof text !== 'string' || text.length > 200)) {
    throw new Error('扩展参数无效：主题和要求各限 2000 字，生成数量为 1–10')
  }
  return { topic: value.topic.trim(), existing: value.existing as string[], instruction: value.instruction.trim(), count: Number(value.count) }
}

export function uniqueTopics(values: unknown, existing: readonly string[] = [], max = 10): string[] {
  if (!Array.isArray(values) || !values.length || values.length > 30) throw new Error('AI 未返回有效的子主题列表，请重试')
  const seen = new Set(existing.map((text) => text.trim().toLocaleLowerCase()))
  const result: string[] = []
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim() || value.length > 200 || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
      throw new Error('子主题需为 1–200 字的纯文本，不能包含 HTML')
    }
    const text = value.trim().replace(/\s+/g, ' ')
    const key = text.toLocaleLowerCase()
    if (!seen.has(key)) { result.push(text); seen.add(key) }
  }
  if (!result.length) throw new Error('没有可新增的子主题，结果为空或与已有内容重复')
  if (result.length > max) throw new Error(`返回的子主题超过 ${max} 个，请重试`)
  return result
}

export function parseAiTopics(text: string, input: AiExpansionInput): string[] {
  if (text.length > 20000) throw new Error('AI 返回内容过长')
  const source = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1')
  let value: unknown
  try { value = JSON.parse(source) } catch { throw new Error('AI 返回内容不是有效 JSON，请重试或更换模型') }
  if (!isRecord(value)) throw new Error('AI 返回内容格式不正确')
  return uniqueTopics(value.topics, input.existing, input.count)
}

export function expansionPrompt(input: AiExpansionInput): string {
  return JSON.stringify({
    task: '为主题补充新的直接子主题，不重复已有子主题。使用主题的语言，名称简洁、具体。',
    output: { topics: ['子主题纯文本'] },
    count: input.count,
    topic: input.topic,
    existing: input.existing,
    userRequirement: input.instruction,
  })
}

export interface AiChatMessage {
  role: 'user' | 'assistant'
  content: string
}
export interface AiChatInput {
  topic: string
  existing: string[]
  count: number
  messages: AiChatMessage[]
}
export interface AiChatReply {
  reply: string
  topics: string[]
}

export function validateChatInput(value: unknown): AiChatInput {
  if (!isRecord(value)) throw new Error('对话参数无效')
  const context = validateExpansionInput({ ...value, instruction: '' })
  if (!Array.isArray(value.messages) || !value.messages.length || value.messages.length > 21) throw new Error('对话最多支持 10 轮，请清空对话后继续')
  let length = 0
  const messages = value.messages.map((item, index): AiChatMessage => {
    const role = index % 2 === 0 ? 'user' : 'assistant'
    if (!isRecord(item) || item.role !== role || typeof item.content !== 'string' || !item.content.trim() || item.content.length > (role === 'user' ? 2000 : 8000)) {
      throw new Error('对话消息无效或过长')
    }
    length += item.content.length
    return { role, content: item.content.trim() }
  })
  if (messages.at(-1)?.role !== 'user' || length > 30000) throw new Error('对话过长或最后一条不是用户消息，请清空对话后继续')
  return { topic: context.topic, existing: context.existing, count: context.count, messages }
}

export function parseChatReply(text: string, input: AiChatInput): AiChatReply {
  if (text.length > 20000) throw new Error('AI 返回内容过长')
  let value: unknown
  try { value = JSON.parse(text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1')) } catch {
    throw new Error('AI 返回内容不是有效 JSON，请重试或更换模型')
  }
  if (!isRecord(value) || typeof value.reply !== 'string' || !value.reply.trim() || value.reply.length > 6000 || !Array.isArray(value.topics)) {
    throw new Error('AI 对话结果格式不正确')
  }
  // An empty list means a clarification/discussion response, not an insertion.
  const candidates = value.topics.length ? uniqueTopics(value.topics, [], input.count) : []
  const existing = new Set(input.existing.map((topic) => topic.trim().toLocaleLowerCase()))
  return { reply: value.reply.trim(), topics: candidates.filter((topic) => !existing.has(topic.toLocaleLowerCase())) }
}

export function parseModels(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.data) || value.data.length > 2000) throw new Error('模型列表格式不兼容，请手动填写模型')
  const models = value.data.flatMap((item) =>
    isRecord(item) && typeof item.id === 'string' && item.id.trim() && item.id.length <= 150 && !/[<>\u0000-\u001f]/.test(item.id) ? [item.id.trim()] : [],
  )
  if (!models.length) throw new Error('服务未返回可用模型，请手动填写模型')
  return [...new Set(models)].sort((a, b) => a.localeCompare(b))
}
