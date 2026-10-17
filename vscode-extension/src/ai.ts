import type * as vscode from 'vscode'
import { isRecord } from '../../src/domain/documents'
import { AI_PROVIDERS, defaultAiSettings, endpointLabel, validateAiSettings, validateApiKey, validateChatInput, validateExpansionInput } from '../../src/domain/ai'
import type { AiSettings, AiSettingsStatus } from '../../src/domain/ai'
import { AI_PANEL_KEY, defaultAiPanel, validateAiPanel } from '../../src/domain/aiPanel'
import { COMMAND_SHORTCUT_KEY, validateShortcutMap } from '../../src/domain/commandShortcuts'
import { AI_SHORTCUT_KEY, DEFAULT_AI_SHORTCUT, validateAiShortcut } from '../../src/domain/shortcuts'

const SETTINGS_KEY = 'ai.connection.v1'
const SECRET_KEY = 'xmindmap.ai.api-key.v1'

export class AiController {
  private running: { id: number; controller: AbortController } | undefined
  private disposed = false
  private configuration = Promise.resolve()

  constructor(
    private readonly context: Pick<vscode.ExtensionContext, 'globalState' | 'secrets'>,
    private readonly trusted: () => boolean,
  ) {}

  dispose(): void {
    this.disposed = true
    this.running?.controller.abort()
  }

  private readSettings(): AiSettings {
    const stored = this.context.globalState.get<unknown>(SETTINGS_KEY)
    try { return validateAiSettings(stored, false) } catch { return { ...defaultAiSettings } }
  }

  private async readKeys(): Promise<Record<string, string>> {
    const secret = await this.context.secrets.get(SECRET_KEY)
    if (!secret) return {}
    try {
      const value: unknown = JSON.parse(secret)
      if (!isRecord(value)) return {}
      const entries = isRecord(value.keys) ? Object.entries(value.keys) : typeof value.baseURL === 'string' && typeof value.key === 'string' ? [[value.baseURL, value.key]] : []
      const keys: Record<string, string> = {}
      for (const [baseURL, key] of entries) {
        try {
          const endpoint = validateAiSettings({ baseURL, model: '' }, false).baseURL
          const parsed = validateApiKey(key)
          if (parsed) keys[endpoint] = parsed
        } catch { /* Skip a malformed credential instead of attaching it to another host. */ }
      }
      return keys
    } catch { return {} }
  }

  private async readKey(baseURL: string): Promise<string> {
    return (await this.readKeys())[baseURL] || ''
  }

  async status(): Promise<AiSettingsStatus> {
    const settings = this.readSettings()
    const keys = await this.readKeys()
    const providers = [
      ...AI_PROVIDERS.map((provider) => ({ ...provider, hasKey: !!keys[provider.baseURL] })),
      ...Object.keys(keys).filter((baseURL) => !AI_PROVIDERS.some((provider) => provider.baseURL === baseURL)).map((baseURL) => ({ id: `custom:${baseURL}`, label: endpointLabel(baseURL), baseURL, hasKey: true })),
    ]
    const current = providers.find((provider) => provider.baseURL === settings.baseURL)
    return { ...settings, providers, hasKey: current ? current.hasKey : !!keys[settings.baseURL] }
  }

  async handle(message: Record<string, unknown>, post: (message: unknown) => void): Promise<void> {
    if (message.type === 'ai.cancel') {
      const running = this.running
      if (running && running.id === message.id) running.controller.abort()
      return
    }
    if (typeof message.id !== 'number' || this.disposed) return
    const id = message.id
    const reply = (data: unknown) => { if (!this.disposed) post({ type: 'result', id, data }) }
    try {
      if (message.type === 'ai.shortcut.get') {
        const stored = this.context.globalState.get<unknown>(AI_SHORTCUT_KEY)
        reply(stored === undefined ? DEFAULT_AI_SHORTCUT : validateAiShortcut(stored))
        return
      }
      if (message.type === 'ai.shortcut.set') {
        const shortcut = validateAiShortcut(message.shortcut)
        await this.context.globalState.update(AI_SHORTCUT_KEY, shortcut)
        reply(shortcut)
        return
      }
      if (message.type === 'ai.panel.get') {
        const stored = this.context.globalState.get<unknown>(AI_PANEL_KEY)
        try { reply(stored === undefined ? { ...defaultAiPanel } : validateAiPanel(stored)) } catch { reply({ ...defaultAiPanel }) }
        return
      }
      if (message.type === 'ai.panel.set') {
        const panel = validateAiPanel(message.panel)
        await this.context.globalState.update(AI_PANEL_KEY, panel)
        reply(panel)
        return
      }
      if (message.type === 'shortcuts.get') {
        const stored = this.context.globalState.get<unknown>(COMMAND_SHORTCUT_KEY)
        try { reply(stored === undefined ? {} : validateShortcutMap(stored)) } catch { reply({}) }
        return
      }
      if (message.type === 'shortcuts.set') {
        const shortcuts = validateShortcutMap(message.shortcuts)
        await this.context.globalState.update(COMMAND_SHORTCUT_KEY, shortcuts)
        reply(shortcuts)
        return
      }
      if (message.type === 'ai.settings') { reply(await this.status()); return }
      if (!this.trusted()) throw new Error('请先信任当前 VS Code 工作区，再配置或调用 AI')
      if (message.type === 'ai.configure') {
        if (this.running) throw new Error('请先停止当前生成，再修改连接')
        const settings = validateAiSettings(message.settings, false)
        const key = validateApiKey(message.apiKey)
        const forget = message.forget === true
        const keyOnly = message.keyOnly === true
        if (keyOnly && !forget && !key) throw new Error('请填写 API Key')
        this.configuration = this.configuration.catch(() => {}).then(async () => {
          const keys = await this.readKeys()
          if (forget) delete keys[settings.baseURL]
          else if (key) keys[settings.baseURL] = key
          if (Object.keys(keys).length) await this.context.secrets.store(SECRET_KEY, JSON.stringify({ keys }))
          else await this.context.secrets.delete(SECRET_KEY)
          if (!keyOnly) await this.context.globalState.update(SETTINGS_KEY, settings)
        })
        await this.configuration
        reply(await this.status())
        return
      }
      if (['ai.generate', 'ai.chat', 'ai.models'].includes(String(message.type))) {
        if (this.running) throw new Error('已有 AI 请求正在进行，请稍后重试')
        if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('AI 扩展需要 Node.js 22+ 的 VS Code 扩展宿主，请升级 VS Code')
        const controller = new AbortController()
        this.running = { id, controller }
        try {
          await this.configuration
          const settings = this.readSettings()
          const requested = validateAiSettings(message.settings, message.type !== 'ai.models')
          // Model discovery may probe an address that is not saved yet, but only with the key typed
          // for it. The stored key stays bound to the saved endpoint, so it never reaches another host.
          const supplied = message.type === 'ai.models' && message.apiKey !== undefined ? validateApiKey(message.apiKey) : ''
          const storedKey = await this.readKey(requested.baseURL)
          if (!supplied && !storedKey && requested.baseURL !== settings.baseURL) throw new Error('AI 连接已改变，请重新打开 AI 设置')
          const key = supplied || storedKey
          controller.signal.throwIfAborted()
          if (message.type === 'ai.models') {
            const { fetchModels } = await import('../../src/ai/models')
            controller.signal.throwIfAborted()
            reply(await fetchModels(requested, key, controller.signal))
          } else {
            const { generateTopics, generateChat } = await import('../../src/ai/generate')
            controller.signal.throwIfAborted()
            reply(message.type === 'ai.chat'
              ? await generateChat(requested, key, validateChatInput(message.input), controller.signal)
              : await generateTopics(requested, key, validateExpansionInput(message.input), controller.signal))
          }
        } finally { if (this.running?.id === id) this.running = undefined }
      }
    } catch (error) {
      if (this.disposed) return
      post({ type: 'result', id, error: error instanceof Error && error.name === 'AbortError' ? 'AI 请求已取消' : error instanceof Error ? error.message : 'AI 操作失败' })
    }
  }
}
