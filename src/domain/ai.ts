import { isRecord } from './documents'
import type { MindNode } from './types'

export interface AiSettings {
  baseURL: string
  model: string
}
export interface AiProvider {
  id: string
  label: string
  baseURL: string
  keyURL?: string
}
export interface AiProviderStatus extends AiProvider {
  hasKey: boolean
}
export interface AiSettingsStatus extends AiSettings {
  hasKey: boolean
  providers: AiProviderStatus[]
}
export interface AiCatalogModel {
  baseURL: string
  provider: string
  model: string
}
export const AI_PROVIDERS: readonly AiProvider[] = [
  { id: 'openai', label: 'OpenAI', baseURL: 'https://api.openai.com/v1', keyURL: 'https://platform.openai.com/api-keys' },
  { id: 'deepseek', label: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', keyURL: 'https://platform.deepseek.com/api_keys' },
  { id: 'qwen', label: '通义千问', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', keyURL: 'https://bailian.console.aliyun.com/?tab=model#/api-key' },
  { id: 'kimi', label: 'Kimi', baseURL: 'https://api.moonshot.cn/v1', keyURL: 'https://platform.moonshot.cn/console/api-keys' },
  { id: 'zhipu', label: '智谱', baseURL: 'https://open.bigmodel.cn/api/paas/v4', keyURL: 'https://open.bigmodel.cn/usercenter/apikeys' },
  { id: 'minimax', label: 'MiniMax', baseURL: 'https://api.minimax.cn/v1', keyURL: 'https://platform.minimaxi.com/user-center/basic-information/interface-key' },
  { id: 'workbuddy', label: 'WorkBuddy', baseURL: 'https://copilot.tencent.com/v2', keyURL: 'https://copilot.tencent.com/profile/' },
  { id: 'openrouter', label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', keyURL: 'https://openrouter.ai/settings/keys' },
  { id: 'groq', label: 'Groq', baseURL: 'https://api.groq.com/openai/v1', keyURL: 'https://console.groq.com/keys' },
  { id: 'siliconflow', label: '硅基流动', baseURL: 'https://api.siliconflow.cn/v1', keyURL: 'https://cloud.siliconflow.cn/account/ak' },
]
export function isWorkBuddy(baseURL: string) {
  return baseURL === 'https://copilot.tencent.com/v2'
}
export function endpointLabel(baseURL: string): string {
  return AI_PROVIDERS.find((provider) => provider.baseURL === baseURL)?.label || (() => { try { return new URL(baseURL).host } catch { return '自定义' } })()
}
export function presentAiStatus(value: unknown): AiSettingsStatus {
  const record = isRecord(value) ? value : {}
  let settings = { ...defaultAiSettings }
  try { if (isRecord(value)) settings = validateAiSettings(value, false) } catch { /* Keep the default endpoint when stored settings are unusable. */ }
  const keyed = new Set<string>()
  if (Array.isArray(record.providers)) {
    for (const item of record.providers) {
      if (!isRecord(item) || item.hasKey !== true || typeof item.baseURL !== 'string') continue
      try { keyed.add(validateAiSettings({ baseURL: item.baseURL, model: '' }, false).baseURL) } catch { /* Ignore provider entries that are not usable endpoints. */ }
    }
  }
  const providers = [
    ...AI_PROVIDERS.map((provider) => ({ ...provider, hasKey: keyed.has(provider.baseURL) })),
    ...[...keyed].filter((baseURL) => !AI_PROVIDERS.some((provider) => provider.baseURL === baseURL)).map((baseURL) => ({ id: `custom:${baseURL}`, label: endpointLabel(baseURL), baseURL, hasKey: true })),
  ]
  const current = providers.find((provider) => provider.baseURL === settings.baseURL)
  return { ...settings, providers, hasKey: current ? current.hasKey : record.hasKey === true }
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
export interface AiOutlineNode {
  uid: string
  text: string
  children: AiOutlineNode[]
}
export interface AiMapContext {
  documentId: string
  title: string
  outline: AiOutlineNode
  partial: boolean
  fingerprint: string
}
export type AiMapChange =
  | { op: 'add'; parent: string; text: string }
  | { op: 'rename'; uid: string; text: string }
  | { op: 'remove'; uid: string }
export interface AiChatInput {
  topic: string
  existing: string[]
  count: number
  messages: AiChatMessage[]
  scope?: { kind: 'map'; title: string; outline: AiOutlineNode; partial: boolean }
}
export interface AiChatReply {
  reply: string
  topics: string[]
  changes: AiMapChange[]
}

const MAX_OUTLINE_NODES = 80
function plainLabel(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new Error('节点文字需为 1–200 字的纯文本，不能包含 HTML')
  }
  return value.trim().replace(/\s+/g, ' ')
}
function mapFingerprint(root: MindNode): string {
  const rows: string[] = []
  const visit = (node: MindNode) => {
    rows.push(`${node.data.uid}\t${node.data.text}`)
    if (rows.length > 5000) throw new Error('导图过大')
    node.children.forEach(visit)
  }
  visit(root)
  return rows.join('\n')
}
export function buildMapOutline(root: MindNode): Pick<AiMapContext, 'outline' | 'partial' | 'fingerprint'> {
  let count = 0
  let partial = false
  const visit = (node: MindNode): AiOutlineNode | null => {
    if (count >= MAX_OUTLINE_NODES) { partial = true; return null }
    count += 1
    const children: AiOutlineNode[] = []
    for (const child of node.children) {
      const next = visit(child)
      if (next) children.push(next)
      else break
    }
    return { uid: node.data.uid, text: node.data.text.replace(/\s+/g, ' ').trim().slice(0, 80) || '未命名', children }
  }
  const outline = visit(root)
  if (!outline) throw new Error('导图为空')
  return { outline, partial, fingerprint: mapFingerprint(root) }
}
function validateOutline(value: unknown, budget: { n: number }, depth = 0): AiOutlineNode {
  if (depth > 80 || !isRecord(value) || typeof value.uid !== 'string' || value.uid.length < 1 || value.uid.length > 80 || /[\u0000-\u001f]/.test(value.uid) || !Array.isArray(value.children)) {
    throw new Error('导图结构无效')
  }
  budget.n += 1
  if (budget.n > MAX_OUTLINE_NODES) throw new Error('导图内容过多')
  return { uid: value.uid, text: plainLabel(typeof value.text === 'string' ? value.text.slice(0, 80) : value.text), children: value.children.map((child) => validateOutline(child, budget, depth + 1)) }
}
function outlineIndex(outline: AiOutlineNode) {
  const nodes = new Map<string, { text: string; parent: string }>()
  const visit = (node: AiOutlineNode, parent: string) => {
    nodes.set(node.uid, { text: node.text, parent })
    node.children.forEach((child) => visit(child, node.uid))
  }
  visit(outline, '')
  return nodes
}
function chatMessages(value: Record<string, unknown>): AiChatMessage[] {
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
  return messages
}
export function validateChatInput(value: unknown): AiChatInput {
  if (!isRecord(value)) throw new Error('对话参数无效')
  const messages = chatMessages(value)
  if (isRecord(value.scope) && value.scope.kind === 'map') {
    if (!Number.isInteger(value.count) || Number(value.count) < 1 || Number(value.count) > 10) throw new Error('修改数量为 1–10')
    if (typeof value.scope.title !== 'string' || !value.scope.title.trim() || value.scope.title.length > 100) throw new Error('导图标题无效')
    const outline = validateOutline(value.scope.outline, { n: 0 })
    return {
      topic: outline.text, existing: [], count: Number(value.count), messages,
      scope: { kind: 'map', title: value.scope.title.trim(), outline, partial: value.scope.partial === true },
    }
  }
  const context = validateExpansionInput({ ...value, instruction: '' })
  return { topic: context.topic, existing: context.existing, count: context.count, messages }
}

export function parseChatReply(text: string, input: AiChatInput): AiChatReply {
  if (text.length > 20000) throw new Error('AI 返回内容过长')
  let value: unknown
  try { value = JSON.parse(text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1')) } catch {
    throw new Error('AI 返回内容不是有效 JSON，请重试或更换模型')
  }
  if (!isRecord(value) || typeof value.reply !== 'string' || !value.reply.trim() || value.reply.length > 6000) throw new Error('AI 对话结果格式不正确')
  const reply = value.reply.trim()
  if (input.scope?.kind === 'map') return { reply, topics: [], changes: parseMapChanges(value.changes, input.scope.outline, input.count) }
  if (!Array.isArray(value.topics)) throw new Error('AI 对话结果格式不正确')
  // An empty list means a clarification/discussion response, not an insertion.
  const candidates = value.topics.length ? uniqueTopics(value.topics, [], input.count) : []
  const existing = new Set(input.existing.map((topic) => topic.trim().toLocaleLowerCase()))
  return { reply, topics: candidates.filter((topic) => !existing.has(topic.toLocaleLowerCase())), changes: [] }
}
function parseMapChanges(value: unknown, outline: AiOutlineNode, max: number): AiMapChange[] {
  if (!Array.isArray(value) || value.length > max) throw new Error('导图修改格式不正确')
  const nodes = outlineIndex(outline)
  const removed = new Set<string>()
  const changes: AiMapChange[] = []
  for (const item of value) {
    if (!isRecord(item)) throw new Error('导图修改格式不正确')
    if (item.op === 'remove') {
      if (typeof item.uid !== 'string' || !nodes.has(item.uid)) throw new Error('修改指向了导图中不存在的节点')
      if (item.uid === outline.uid) throw new Error('不能删除中心主题')
      let parent = nodes.get(item.uid)?.parent
      while (parent) { if (removed.has(parent)) break; parent = nodes.get(parent)?.parent }
      if (parent && removed.has(parent)) continue
      removed.add(item.uid)
      changes.push({ op: 'remove', uid: item.uid })
    } else if (item.op === 'rename') {
      if (typeof item.uid !== 'string' || !nodes.has(item.uid)) throw new Error('修改指向了导图中不存在的节点')
      changes.push({ op: 'rename', uid: item.uid, text: plainLabel(item.text) })
    } else if (item.op === 'add') {
      if (typeof item.parent !== 'string' || !nodes.has(item.parent)) throw new Error('修改指向了导图中不存在的节点')
      changes.push({ op: 'add', parent: item.parent, text: plainLabel(item.text) })
    } else throw new Error('导图修改格式不正确')
  }
  const ancestorRemoved = (uid: string) => {
    let parent = nodes.get(uid)?.parent
    while (parent) {
      if (removed.has(parent)) return true
      parent = nodes.get(parent)?.parent
    }
    return false
  }
  if (changes.some((change) => change.op !== 'remove' && (removed.has(change.op === 'rename' ? change.uid : change.parent) || ancestorRemoved(change.op === 'rename' ? change.uid : change.parent)))) {
    throw new Error('不能同时删除节点并修改它')
  }
  return changes.filter((change) => change.op !== 'remove' || !ancestorRemoved(change.uid))
}

export function parseModels(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.data) || value.data.length > 2000) throw new Error('模型列表格式不兼容')
  const models = value.data.flatMap((item) =>
    isRecord(item) && typeof item.id === 'string' && item.id.trim() && item.id.length <= 150 && !/[<>\u0000-\u001f]/.test(item.id) ? [item.id.trim()] : [],
  )
  if (!models.length) throw new Error('服务未返回可用模型')
  return [...new Set(models)].sort((a, b) => a.localeCompare(b))
}
