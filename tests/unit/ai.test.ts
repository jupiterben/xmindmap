import { afterEach, describe, expect, it, vi } from 'vitest'
import { expansionPrompt, parseAiTopics, uniqueTopics, validateAiSettings, validateExpansionInput } from '../../src/domain/ai'
import { generateTopics } from '../../src/ai/generate'

const settings = { baseURL: 'https://ai.example.test/v1', model: 'test-model' }
const input = { topic: '产品设计', existing: ['用户访谈'], instruction: '关注移动端', count: 3 }
function response(topics: string[]) {
  return new Response(JSON.stringify({
    id: 'test', object: 'chat.completion', created: 1, model: 'test-model',
    choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ topics }) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  }), { headers: { 'content-type': 'application/json' } })
}
afterEach(() => vi.useRealTimers())

describe('AI boundaries', () => {
  it('validates HTTPS endpoints and allows only loopback HTTP', () => {
    expect(validateAiSettings({ ...settings, baseURL: 'https://ai.example.test/v1/' }).baseURL).toBe(settings.baseURL)
    expect(validateAiSettings({ ...settings, baseURL: 'http://127.0.0.1:11434/v1' }).baseURL).toContain('127.0.0.1')
    for (const baseURL of ['http://remote.test/v1', 'file:///test', 'https://u:p@ai.test', 'https://ai.test?key=secret', 'https://ai.test/#x', 'https://ai.test/v1/chat/completions']) {
      expect(() => validateAiSettings({ ...settings, baseURL })).toThrow()
    }
    expect(() => validateAiSettings({ ...settings, model: '' })).toThrow('模型')
  })
  it('limits prompt context and builds explicit data-only input', () => {
    expect(() => validateExpansionInput({ ...input, count: 11 })).toThrow()
    expect(() => validateExpansionInput({ ...input, topic: 'x'.repeat(2001) })).toThrow()
    expect(() => validateExpansionInput({ ...input, existing: Array(51).fill('topic') })).toThrow()
    const prompt = JSON.parse(expansionPrompt(input))
    expect(prompt.topic).toBe('产品设计')
    expect(prompt.existing).toEqual(['用户访谈'])
    expect(prompt.userRequirement).toBe('关注移动端')
    expect(prompt.root).toBeUndefined()
  })
  it('accepts only plain-text topics, strips fences and removes duplicates', () => {
    expect(parseAiTopics('```json\n{"topics":["用户访谈","交互设计","交互设计","视觉设计"]}\n```', input)).toEqual(['交互设计', '视觉设计'])
    for (const topics of [['<script>alert(1)</script>'], [null], [''], ['x'.repeat(201)]]) {
      expect(() => uniqueTopics(topics)).toThrow()
    }
    expect(() => parseAiTopics('not JSON', input)).toThrow('JSON')
    expect(() => parseAiTopics('{"topics":["用户访谈"]}', input)).toThrow('重复')
    expect(() => parseAiTopics('{"topics":["a","b","c","d"]}', input)).toThrow('超过')
  })
})

describe('AI provider adapter', () => {
  it('uses the configured model, endpoint and key, without redirects or cookies', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(['交互设计', '视觉设计']))
    const topics = await generateTopics(settings, 'test-key', input, new AbortController().signal, fetcher)
    expect(topics).toEqual(['交互设计', '视觉设计'])
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, options] = fetcher.mock.calls[0]!
    expect(String(url)).toBe('https://ai.example.test/v1/chat/completions')
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer test-key')
    expect(options?.redirect).toBe('error')
    expect(options?.credentials).toBe('omit')
    const body = JSON.parse(String(options?.body))
    expect(body.model).toBe('test-model')
    expect(body.messages).toHaveLength(2)
    expect(body.tools).toBeUndefined()
  })
  it('does not retry rate limits or echo provider errors containing secrets', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'secret-key and private prompt' } }), { status: 429, headers: { 'content-type': 'application/json' } }))
    await expect(generateTopics(settings, 'secret-key', input, new AbortController().signal, fetcher)).rejects.toThrow('受限')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('maps auth, missing model and malformed responses to safe errors', async () => {
    for (const [status, message] of [[401, '认证'], [404, '不存在'], [500, 'HTTP 500']] as const) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status, headers: { 'content-type': 'application/json' } }))
      await expect(generateTopics(settings, '', input, new AbortController().signal, fetcher)).rejects.toThrow(message)
    }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"invalid":"response"}', { headers: { 'content-type': 'application/json' } }))
    await expect(generateTopics(settings, '', input, new AbortController().signal, fetcher)).rejects.toThrow('格式不兼容')
  })
  it('bounds response bytes', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(256 * 1024 + 1)))
    await expect(generateTopics(settings, '', input, new AbortController().signal, fetcher)).rejects.toThrow()
  })
  it('aborts an in-flight request', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    const result = generateTopics(settings, '', input, controller.signal, fetcher)
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    controller.abort()
    await rejected
  })
  it('times out after 60 seconds', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    const result = generateTopics(settings, '', input, new AbortController().signal, fetcher)
    const rejected = expect(result).rejects.toThrow('60 秒')
    await vi.advanceTimersByTimeAsync(60001)
    await rejected
  })
})
