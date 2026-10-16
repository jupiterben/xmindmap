import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiController } from '../../vscode-extension/src/ai'

function context() {
  const settings = new Map<string, unknown>()
  const secrets = new Map<string, string>()
  const api = {
    globalState: {
      get: (key: string) => settings.get(key),
      update: async (key: string, value: unknown) => { settings.set(key, value) },
    },
    secrets: {
      get: async (key: string) => secrets.get(key),
      store: async (key: string, value: string) => { secrets.set(key, value) },
      delete: async (key: string) => { secrets.delete(key) },
    },
  } as unknown as ConstructorParameters<typeof AiController>[0]
  return { api, settings, secrets }
}
const config = { baseURL: 'https://ai.example.test/v1', model: 'test-model' }
const input = { topic: 'Test', existing: [], count: 2, instruction: '' }
const configure = (apiKey = 'private-test-key', settings = config) => ({ id: 1, type: 'ai.configure', settings, apiKey })
const completion = () => new Response(JSON.stringify({
  choices: [{ message: { role: 'assistant', content: '{"topics":["A","B"]}' }, finish_reason: 'stop' }],
}), { headers: { 'content-type': 'application/json' } })
afterEach(() => vi.unstubAllGlobals())

describe('VS Code AI controller', () => {
  it('discovers models before selection and supports per-chat model overrides on the saved endpoint', async () => {
    const storage = context()
    const host = new AiController(storage.api, () => true)
    const post = vi.fn()
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{"data":[{"id":"chat-a"},{"id":"chat-b"}]}'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '{"reply":"Hello","topics":["A"]}' }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetcher)
    await host.handle(configure('private-test-key', { ...config, model: '' }), post)
    await host.handle({ id: 2, type: 'ai.models', settings: { ...config, model: '' } }, post)
    expect(post.mock.lastCall?.[0].data).toEqual(['chat-a', 'chat-b'])
    await host.handle({ id: 3, type: 'ai.chat', settings: { ...config, model: 'chat-b' }, input: { topic: 'Test', existing: [], count: 2, messages: [{ role: 'user', content: 'expand' }] } }, post)
    expect(post.mock.lastCall?.[0].data).toEqual({ reply: 'Hello', topics: ['A'] })
    expect(JSON.parse(String(fetcher.mock.calls[1]![1]?.body)).model).toBe('chat-b')
    expect(JSON.stringify(post.mock.calls)).not.toContain('private-test-key')
    await host.handle({ id: 4, type: 'ai.models', settings: { ...config, baseURL: 'https://evil.test/v1' } }, post)
    expect(post.mock.lastCall?.[0].error).toContain('连接已改变')
    expect(fetcher).toHaveBeenCalledTimes(2)
    host.dispose()
  })
  it('probes a not yet saved endpoint only with the key typed for it and keeps the stored key bound', async () => {
    const storage = context()
    const host = new AiController(storage.api, () => true)
    const post = vi.fn()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"data":[{"id":"new-a"}]}'))
    vi.stubGlobal('fetch', fetcher)
    await host.handle(configure(), post)
    const unsaved = { baseURL: 'https://other.test/v1', model: '' }
    await host.handle({ id: 2, type: 'ai.models', settings: unsaved, apiKey: 'typed-key' }, post)
    expect(post.mock.lastCall?.[0].data).toEqual(['new-a'])
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer typed-key')
    expect(JSON.stringify([...storage.settings.values()])).not.toContain('other.test')
    expect(JSON.stringify([...storage.secrets.values()])).toContain('private-test-key')
    await host.handle({ id: 3, type: 'ai.models', settings: unsaved }, post)
    expect(post.mock.lastCall?.[0].error).toContain('连接已改变')
    expect(fetcher).toHaveBeenCalledTimes(1)
    host.dispose()
  })
  it('persists shortcut preferences without credentials or a trusted workspace', async () => {
    const storage = context()
    const host = new AiController(storage.api, () => false)
    const post = vi.fn()
    await host.handle({ id: 1, type: 'ai.shortcut.get' }, post)
    expect(post.mock.lastCall?.[0].data).toBe('Mod+Alt+KeyA')
    await host.handle({ id: 2, type: 'ai.shortcut.set', shortcut: 'Mod+Alt+Shift+KeyB' }, post)
    const next = new AiController(storage.api, () => false)
    await next.handle({ id: 3, type: 'ai.shortcut.get' }, post)
    expect(post.mock.lastCall?.[0].data).toBe('Mod+Alt+Shift+KeyB')
    await host.handle({ id: 4, type: 'ai.shortcut.set', shortcut: 'Ctrl+S' }, post)
    expect(post.mock.lastCall?.[0].error).toContain('快捷键')
    await host.handle({ id: 5, type: 'ai.shortcut.set', shortcut: '' }, post)
    await next.handle({ id: 6, type: 'ai.shortcut.get' }, post)
    expect(post.mock.lastCall?.[0].data).toBe('')
    expect(storage.secrets.size).toBe(0)
    host.dispose()
    next.dispose()
  })
  it('stores keys only in SecretStorage, never returns them, and binds them to the exact endpoint', async () => {
    const storage = context()
    const host = new AiController(storage.api, () => true)
    const post = vi.fn()
    await host.handle(configure(), post)
    expect(JSON.stringify([...storage.settings.values()])).not.toContain('private-test-key')
    expect(JSON.stringify([...storage.secrets.values()])).toContain('private-test-key')
    expect(JSON.stringify(post.mock.calls)).not.toContain('private-test-key')
    expect((await host.status()).hasKey).toBe(true)
    await host.handle(configure('', { ...config, baseURL: 'https://other.test/v1' }), post)
    expect((await host.status()).hasKey).toBe(false)
    expect(storage.secrets.size).toBe(0)
    host.dispose()
  })
  it('forgets credentials and blocks untrusted workspaces', async () => {
    const storage = context()
    const host = new AiController(storage.api, () => true)
    const post = vi.fn()
    await host.handle(configure(), post)
    await host.handle({ ...configure(''), forget: true }, post)
    expect(storage.secrets.size).toBe(0)
    host.dispose()
    const untrusted = new AiController(storage.api, () => false)
    await untrusted.handle(configure(), post)
    expect(post.mock.lastCall?.[0].error).toContain('信任')
    expect(storage.secrets.size).toBe(0)
    untrusted.dispose()
  })
  it('generates through host fetch and rejects a request using changed connection settings', async () => {
    const storage = context()
    const host = new AiController(storage.api, () => true)
    const post = vi.fn()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completion())
    vi.stubGlobal('fetch', fetcher)
    await host.handle(configure(), post)
    await host.handle({ id: 2, type: 'ai.generate', settings: config, input }, post)
    expect(post.mock.lastCall?.[0]).toEqual({ type: 'result', id: 2, data: ['A', 'B'] })
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer private-test-key')
    await host.handle({ id: 3, type: 'ai.generate', settings: { ...config, baseURL: 'https://evil.test/v1' }, input }, post)
    expect(post.mock.lastCall?.[0].error).toContain('连接已改变')
    expect(fetcher).toHaveBeenCalledTimes(1)
    host.dispose()
  })
  it('cancels requests without waiting for the document message queue', async () => {
    const host = new AiController(context().api, () => true)
    const post = vi.fn()
    let aborted = false
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('Aborted', 'AbortError')) })
    }))
    vi.stubGlobal('fetch', fetcher)
    await host.handle(configure(), post)
    const pending = host.handle({ id: 9, type: 'ai.generate', settings: config, input }, post)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    await host.handle({ type: 'ai.cancel', id: 9 }, post)
    await pending
    expect(aborted).toBe(true)
    expect(post.mock.lastCall?.[0].error).toContain('取消')
    host.dispose()
  })
})
