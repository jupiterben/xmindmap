export function boundedFetch(fetchImpl: typeof fetch, limit = 256 * 1024): typeof fetch {
  return async (url, init) => {
    const response = await fetchImpl(url, { ...init, credentials: 'omit', redirect: 'error' })
    const reader = response.body?.getReader()
    if (!reader) return response
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.byteLength
        if (size > limit) {
          await reader.cancel()
          throw new Error('AI 返回内容过长')
        }
        chunks.push(part.value)
      }
    } finally { reader.releaseLock() }
    const body = new Uint8Array(size)
    let offset = 0
    chunks.forEach((chunk) => { body.set(chunk, offset); offset += chunk.byteLength })
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
  }
}
