import { fromMarkdown } from 'mdast-util-from-markdown'

const MAX_MARKDOWN_CHARS = 512 * 1024

interface MdNode {
  type: string
  value?: string
  depth?: number
  ordered?: boolean
  url?: string
  alt?: string
  children?: MdNode[]
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function safeHref(url: string | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href
  } catch { /* Relative and unsafe URLs stay as plain text. */ }
  return null
}

function renderChildren(node: MdNode): string {
  return (node.children ?? []).map(renderNode).join('')
}

function renderNode(node: MdNode): string {
  switch (node.type) {
    case 'root': return renderChildren(node)
    case 'paragraph': return `<p>${renderChildren(node)}</p>`
    case 'heading': {
      const level = Math.min(6, Math.max(1, node.depth ?? 1))
      return `<h${level}>${renderChildren(node)}</h${level}>`
    }
    case 'text': return escapeHtml(node.value ?? '')
    case 'emphasis': return `<em>${renderChildren(node)}</em>`
    case 'strong': return `<strong>${renderChildren(node)}</strong>`
    case 'inlineCode': return `<code>${escapeHtml(node.value ?? '')}</code>`
    case 'code': return `<pre><code>${escapeHtml(node.value ?? '')}</code></pre>`
    case 'blockquote': return `<blockquote>${renderChildren(node)}</blockquote>`
    case 'list': {
      const tag = node.ordered ? 'ol' : 'ul'
      return `<${tag}>${renderChildren(node)}</${tag}>`
    }
    case 'listItem': return `<li>${renderChildren(node)}</li>`
    case 'link': {
      const href = safeHref(node.url)
      const inner = renderChildren(node)
      return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>` : inner
    }
    case 'image': return escapeHtml(node.alt ?? '')
    case 'thematicBreak': return '<hr>'
    case 'break': return '<br>'
    case 'html': return ''
    default: return node.children ? renderChildren(node) : ''
  }
}

export function renderMarkdown(source: string): string {
  if (source.length > MAX_MARKDOWN_CHARS) throw new Error('Markdown 内容过长')
  return renderNode(fromMarkdown(source) as MdNode)
}
