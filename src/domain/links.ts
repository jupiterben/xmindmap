const MARKDOWN_FILE = /\.(md|markdown)$/i
const MAX_LINK_LENGTH = 1024

export function normalizeRelativeMarkdownPath(value: string): string {
  const raw = value.trim().replace(/\\/g, '/')
  if (!raw || raw.length > MAX_LINK_LENGTH || /[\u0000-\u001f]/.test(raw)) throw new Error('Markdown 路径无效')
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) || raw.startsWith('/')) throw new Error('Markdown 路径必须是相对路径')
  const stack: string[] = []
  for (const part of raw.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (stack.length && stack[stack.length - 1] !== '..') stack.pop()
      else stack.push('..')
      continue
    }
    if (/[:*?"<>|]/.test(part)) throw new Error('Markdown 路径无效')
    stack.push(part)
  }
  const path = stack.join('/')
  const name = path.split('/').pop() ?? ''
  if (!path || !MARKDOWN_FILE.test(name)) throw new Error('相对路径仅支持 .md 或 .markdown 文件')
  return path
}

export function isRelativeMarkdownPath(value: string): boolean {
  try {
    normalizeRelativeMarkdownPath(value)
    return true
  } catch {
    return false
  }
}

function splitFs(value: string): string[] {
  return value.replace(/\\/g, '/').split('/').filter(Boolean)
}

function hasPrefix(root: string[], target: string[]): boolean {
  return target.length >= root.length && root.every((part, index) => part.toLowerCase() === target[index]?.toLowerCase())
}

function joinFs(sample: string, parts: string[]): string {
  const sep = sample.includes('\\') ? '\\' : '/'
  const lead = sample.replace(/\\/g, '/').startsWith('/') ? sep : ''
  return lead + parts.join(sep)
}

export function resolveRelativeMarkdown(documentDir: string, workspaceDir: string, relative: string): string {
  const normalized = normalizeRelativeMarkdownPath(relative)
  const root = splitFs(workspaceDir)
  const stack = splitFs(documentDir)
  if (!root.length || !hasPrefix(root, stack)) throw new Error('路径超出工作区')
  for (const part of normalized.split('/')) {
    if (part === '..') {
      if (stack.length <= root.length) throw new Error('路径超出工作区')
      stack.pop()
    } else stack.push(part)
  }
  if (!hasPrefix(root, stack)) throw new Error('路径超出工作区')
  return joinFs(documentDir, stack)
}

export function isPathInside(root: string, target: string): boolean {
  const norm = (value: string) => value.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
  const base = norm(root)
  const file = norm(target)
  return file === base || file.startsWith(`${base}/`)
}
