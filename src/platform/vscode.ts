export interface VsCodeApi {
  postMessage(message: unknown): void
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi
  }
}

// VS Code permits acquiring this API only once per webview.
export const vscode = typeof window !== 'undefined' ? window.acquireVsCodeApi?.() : undefined
export const isVsCode = !!vscode

let nextId = 0
const requests = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout>; cleanup: () => void }>()

if (vscode) {
  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    const message = event.data
    if (!message || typeof message !== 'object' || !('type' in message) || message.type !== 'result') return
    if (!('id' in message) || typeof message.id !== 'number') return
    const request = requests.get(message.id)
    if (!request) return
    requests.delete(message.id)
    clearTimeout(request.timer)
    request.cleanup()
    if ('error' in message && typeof message.error === 'string') request.reject(new Error(message.error))
    else request.resolve('data' in message ? message.data : 'ok' in message && message.ok === true)
  })
}

export async function hostRequest(type: 'export' | 'create' | 'save', payload: Record<string, unknown> = {}): Promise<boolean> {
  return await hostDataRequest(type, payload) === true
}

export function hostDataRequest(
  type: 'export' | 'create' | 'save' | 'file.read' | 'ai.settings' | 'ai.configure' | 'ai.generate' | 'ai.chat' | 'ai.models' | 'ai.shortcut.get' | 'ai.shortcut.set' | 'ai.panel.get' | 'ai.panel.set' | 'shortcuts.get' | 'shortcuts.set',
  payload: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<unknown> {
  if (!vscode) return Promise.reject(new Error('VS Code host unavailable'))
  if (signal?.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'))
  const id = ++nextId
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', abort)
    const abort = () => {
      clearTimeout(timer)
      cleanup()
      requests.delete(id)
      vscode.postMessage({ type: 'ai.cancel', id })
      reject(new DOMException('Cancelled', 'AbortError'))
    }
    const timer = setTimeout(() => {
      requests.delete(id)
      cleanup()
      if (['ai.generate', 'ai.chat', 'ai.models'].includes(type)) vscode.postMessage({ type: 'ai.cancel', id })
      reject(new Error('VS Code 操作超时，请重试'))
    }, 120000)
    requests.set(id, { resolve, reject, timer, cleanup })
    signal?.addEventListener('abort', abort, { once: true })
    vscode.postMessage({ type, id, ...payload })
  })
}
