import { createDocument, isRecord, MAX_FILE_SIZE, openMindMapText, serializeDocument } from '../../src/domain/documents'

export function validateContent(content: unknown): string {
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_FILE_SIZE) {
    throw new Error('导图内容无效或超过 5 MB')
  }
  // Blank files open as a new map. Keep the original text so the file stays empty until edited.
  if (content.trim()) openMindMapText(content)
  return content
}

export function newContent(): string {
  return serializeDocument(createDocument())
}

export function parseEdit(message: unknown): { version: number; content: string } {
  if (!isRecord(message) || message.type !== 'edit' || !Number.isInteger(message.version)) throw new Error('编辑消息格式错误')
  return { version: message.version as number, content: validateContent(message.content) }
}

export function exportBytes(content: unknown, encoding: unknown, filename: unknown): { bytes: Uint8Array; name: string } {
  if (typeof content !== 'string' || content.length > 32 * 1024 * 1024 || typeof filename !== 'string') throw new Error('导出内容无效或超过大小限制')
  const name = filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 150)
  if (!/\.(json|md|svg|png)$/i.test(name)) throw new Error('不支持的导出类型')
  if (encoding === 'utf8' && /\.(json|md)$/i.test(name)) return { bytes: Buffer.from(content, 'utf8'), name }
  if (encoding === 'dataUrl') {
    const match = /^data:(image\/png|image\/svg\+xml)(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/.exec(content)
    if (!match || (match[1] === 'image/png' ? !/\.png$/i.test(name) : !/\.svg$/i.test(name))) throw new Error('图片数据格式错误')
    const bytes = match[2] ? Buffer.from(match[3]!, 'base64') : Buffer.from(decodeURIComponent(match[3]!), 'utf8')
    return { bytes, name }
  }
  throw new Error('不支持的导出编码')
}
