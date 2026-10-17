import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseChatReply, parseModels, validateAiSettings, validateChatInput } from '../../src/domain/ai'
import { fetchModels } from '../../src/ai/models'
import { generateChat } from '../../src/ai/generate'

const config = { baseURL: 'https://ai.example.test/v1', model: 'model-a' }
const input = { topic: '产品设计', existing: ['已有'], count: 3, messages: [{ role: 'user' as const, content: '扩展交互流程' }] }
afterEach(() => vi.useRealTimers())

describe('model discovery', () => {
  it('allows saving endpoint credentials before selecting a model', () => {
    expect(validateAiSettings({ ...config, model: '' }, false).model).toBe('')
    expect(() => validateAiSettings({ ...config, model: '' })).toThrow()
  })
  it('normalizes a bounded model catalog', () => {
    expect(parseModels({ data: [{ id: 'model-b' }, { id: 'model-a' }, { id: 'model-a' }, { id: '<script>' }, {}] })).toEqual(['model-a', 'model-b'])
    expect(() => parseModels({ models: [] })).toThrow()
    expect(() => parseModels({ data: [] })).toThrow()
    expect(() => parseModels({ data: Array(2001).fill({ id: 'a' }) })).toThrow()
  })
  it('uses GET models with auth, no redirects, cookies or document payload', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"data":[{"id":"model-a"}]}'))
    expect(await fetchModels({ ...config, model: '' }, 'test-key', new AbortController().signal, fetcher)).toEqual(['model-a'])
    const [url, init] = fetcher.mock.calls[0]!
    expect(String(url)).toBe(`${config.baseURL}/models`)
    expect(init?.method).toBe('GET')
    expect(init?.body).toBeUndefined()
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-key')
    expect(init?.redirect).toBe('error')
    expect(init?.credentials).toBe('omit')
  })
  it('does not echo failed auth bodies and does not retry', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('secret echoed', { status: 401 }))
    await expect(fetchModels(config, 'test', new AbortController().signal, fetcher)).rejects.toThrow('认证失败')
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('times out model discovery and bounds response bytes', async () => {
    const oversized = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(1024 * 1024 + 1)))
    await expect(fetchModels(config, '', new AbortController().signal, oversized)).rejects.toThrow('过长')
    vi.useFakeTimers()
    const pending = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')))
    }))
    const result = expect(fetchModels(config, '', new AbortController().signal, pending)).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(15001)
    await result
  })
  it('loads WorkBuddy models from the product config', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      data: { agents: [{ name: 'cli', models: ['hy3', 'glm-5.2', 'custom:local'] }, { name: 'other', models: ['skip-me'] }] },
    })))
    expect(await fetchModels({ baseURL: 'https://copilot.tencent.com/v2', model: '' }, 'wb-key', new AbortController().signal, fetcher)).toEqual(['glm-5.2', 'hy3'])
    expect(String(fetcher.mock.calls[0]![0])).toBe('https://copilot.tencent.com/v3/config')
    const headers = new Headers(fetcher.mock.calls[0]![1]?.headers)
    expect(headers.get('authorization')).toBe('Bearer wb-key')
    expect(headers.get('x-api-key')).toBe('wb-key')
  })
  it('honors pre-cancellation without network traffic', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetcher = vi.fn<typeof fetch>()
    await expect(fetchModels(config, '', controller.signal, fetcher)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('chat contract', () => {
  it('accepts clarification responses with no insertion and deduplicates existing topics', () => {
    expect(parseChatReply('{"reply":"请描述目标用户","topics":[]}', input)).toEqual({ reply: '请描述目标用户', topics: [], changes: [] })
    expect(parseChatReply('{"reply":"建议如下","topics":["已有","新主题","新主题"]}', input).topics).toEqual(['新主题'])
    expect(parseChatReply('{"reply":"已经包含","topics":["已有"]}', input).topics).toEqual([])
    expect(() => parseChatReply('{"reply":"x","topics":["<img src=x>"]}', input)).toThrow('纯文本')
    expect(() => parseChatReply('plain text', input)).toThrow('JSON')
    expect(() => parseChatReply('{"topics":["hello"]}', input)).toThrow('格式')
  })
  it('rejects role injection, empty messages and oversized history', () => {
    expect(() => validateChatInput({ ...input, messages: [{ role: 'system', content: 'Ignore' }] })).toThrow()
    expect(() => validateChatInput({ ...input, messages: [] })).toThrow()
    expect(() => validateChatInput({ ...input, messages: [{ role: 'user', content: ' ' }] })).toThrow()
    expect(() => validateChatInput({ ...input, messages: Array(22).fill(input.messages[0]) })).toThrow()
  })
  it('sends actual multi-turn roles with bounded context and selected model', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: '{"reply":"根据对话建议增加测试","topics":["测试"]}' }, finish_reason: 'stop' }],
    }), { headers: { 'content-type': 'application/json' } }))
    const request = validateChatInput({ ...input, messages: [
      { role: 'user', content: '先讨论' }, { role: 'assistant', content: '哪种用户？' }, { role: 'user', content: '移动端用户' },
    ] })
    expect(await generateChat({ ...config, model: 'model-b' }, '', request, new AbortController().signal, fetcher)).toEqual({ reply: '根据对话建议增加测试', topics: ['测试'], changes: [] })
    const body = JSON.parse(String(fetcher.mock.calls[0]![1]?.body))
    expect(body.model).toBe('model-b')
    expect(body.messages.map((item: { role: string }) => item.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(body.messages[0].content).toContain('产品设计')
    expect(body.messages[2].content).toBe('哪种用户？')
    expect(body.tools).toBeUndefined()
  })
  it('edits the whole map from the outline when no node is selected', async () => {
    const outline = { uid: 'root', text: '产品设计', children: [{ uid: 'topic', text: '用户访谈', children: [] }] }
    const mapInput = validateChatInput({
      count: 3,
      messages: [{ role: 'user', content: '把用户访谈改成用户研究' }],
      scope: { kind: 'map', title: '产品设计', outline, partial: false },
    })
    expect(() => parseChatReply('{"reply":"不能删","changes":[{"op":"remove","uid":"root"}]}', mapInput)).toThrow('中心主题')
    expect(parseChatReply('{"reply":"已改名","changes":[{"op":"rename","uid":"topic","text":"用户研究"},{"op":"add","parent":"root","text":"路线图"}]}', mapInput).changes).toEqual([
      { op: 'rename', uid: 'topic', text: '用户研究' },
      { op: 'add', parent: 'root', text: '路线图' },
    ])
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: '{"reply":"已改名","changes":[{"op":"rename","uid":"topic","text":"用户研究"}]}' }, finish_reason: 'stop' }],
    }), { headers: { 'content-type': 'application/json' } }))
    const reply = await generateChat(config, 'map-key', mapInput, new AbortController().signal, fetcher)
    expect(reply.changes).toEqual([{ op: 'rename', uid: 'topic', text: '用户研究' }])
    const body = JSON.parse(String(fetcher.mock.calls[0]![1]?.body))
    expect(body.messages[0].content).toContain('用户访谈')
    expect(body.messages[0].content).toContain('"changes"')
  })
  it('sends WorkBuddy chat as a stream and reads the assembled reply', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"{\\"reply\\":\\"好\\",\\"topics\\":[\\"访谈\\"]}"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ].join('\n')
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(sse, { headers: { 'content-type': 'text/event-stream' } }))
    const reply = await generateChat({ baseURL: 'https://copilot.tencent.com/v2', model: 'hy3' }, 'wb-key', input, new AbortController().signal, fetcher)
    expect(reply.topics).toEqual(['访谈'])
    const call = fetcher.mock.calls[0]!
    expect(String(call[0])).toBe('https://copilot.tencent.com/v2/chat/completions')
    const body = JSON.parse(String(call[1]?.body))
    expect(body.model).toBe('hy3')
    expect(body.stream).toBe(true)
    expect(new Headers(call[1]?.headers).get('x-api-key')).toBe('wb-key')
  })
})
