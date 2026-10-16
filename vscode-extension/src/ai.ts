import type * as vscode from 'vscode'
import { isRecord } from '../../src/domain/documents'
import { defaultAiSettings, validateAiSettings, validateApiKey, validateChatInput, validateExpansionInput } from '../../src/domain/ai'
import type { AiSettings, AiSettingsStatus } from '../../src/domain/ai'
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

  private async readKey(baseURL: string): Promise<string> {
    const secret = await this.context.secrets.get(SECRET_KEY)
    if (!secret) return ''
    try {
      const value: unknown = JSON.parse(secret)
      if (isRecord(value) && value.baseURL === baseURL) return validateApiKey(value.key)
    } catch { /* A malformed credential must not be reused for a different service. */ }
    return ''
  }

  async status(): Promise<AiSettingsStatus> {
    const settings = this.readSettings()
    return { ...settings, hasKey: !!await this.readKey(settings.baseURL) }
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
      if (message.type === 'ai.settings') { reply(await this.status()); return }
      if (!this.trusted()) throw new Error('请先信任当前 VS Code 工作区，再配置或调用 AI')
      if (message.type === 'ai.configure') {
        if (this.running) throw new Error('请先停止当前生成，再修改连接')
        const settings = validateAiSettings(message.settings, false)
        const key = validateApiKey(message.apiKey)
        const forget = message.forget === true
        this.configuration = this.configuration.catch(() => {}).then(async () => {
          const existingKey = await this.readKey(settings.baseURL)
          const nextKey = forget ? '' : key || existingKey
          if (nextKey) await this.context.secrets.store(SECRET_KEY, JSON.stringify({ baseURL: settings.baseURL, key: nextKey }))
          else await this.context.secrets.delete(SECRET_KEY)
          await this.context.globalState.update(SETTINGS_KEY, settings)
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
          if (!supplied && requested.baseURL !== settings.baseURL) throw new Error('AI 连接已改变，请重新打开 AI 设置')
          const key = supplied || await this.readKey(requested.baseURL)
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
