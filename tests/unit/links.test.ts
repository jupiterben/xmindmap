import { describe, expect, it } from 'vitest'
import { isPathInside, isRelativeMarkdownPath, resolveRelativeMarkdown } from '../../src/domain/links'
import { safeLink } from '../../src/domain/documents'
import { renderMarkdown } from '../../src/domain/markdownView'

describe('relative markdown links', () => {
  it('keeps http links and accepts markdown paths', () => {
    expect(safeLink('https://example.com')).toBe('https://example.com/')
    expect(safeLink('docs/note.md')).toBe('docs/note.md')
    expect(safeLink('.\\docs\\note.markdown')).toBe('docs/note.markdown')
    expect(safeLink('../docs/note.md')).toBe('../docs/note.md')
    expect(safeLink('docs/../readme.md')).toBe('readme.md')
    expect(isRelativeMarkdownPath('docs/note.md')).toBe(true)
    expect(isRelativeMarkdownPath('https://example.com/a.md')).toBe(false)
  })

  it('rejects absolute paths, other files and unsafe schemes', () => {
    for (const link of ['/etc/passwd.md', 'C:/note.md', '\\\\server\\share\\a.md', 'note.txt', 'javascript:alert(1)', 'file:///tmp/a.md', 'docs/note.md?x=1']) {
      expect(() => safeLink(link)).toThrow()
      expect(isRelativeMarkdownPath(link)).toBe(false)
    }
  })

  it('resolves a path inside the workspace and blocks escapes', () => {
    expect(resolveRelativeMarkdown('/proj/maps', '/proj', 'docs/note.md')).toBe('/proj/maps/docs/note.md')
    expect(resolveRelativeMarkdown('/proj/maps', '/proj', '../docs/note.md')).toBe('/proj/docs/note.md')
    expect(resolveRelativeMarkdown('/proj/maps', '/proj', 'foo/../../note.md')).toBe('/proj/note.md')
    expect(() => resolveRelativeMarkdown('/proj/maps', '/proj', '../../secret.md')).toThrow(/工作区/)
    expect(() => resolveRelativeMarkdown('/proj/maps', '/proj', '../docs/../../outside.md')).toThrow(/工作区/)
    expect(resolveRelativeMarkdown('C:\\Proj\\maps', 'c:\\proj', '..\\docs\\Note.md')).toBe('C:\\Proj\\docs\\Note.md')
    expect(isPathInside('C:\\proj', 'C:\\proj\\docs\\a.md')).toBe(true)
    expect(isPathInside('C:\\proj', 'C:\\proj-evil\\a.md')).toBe(false)
    expect(isPathInside('/proj', '/proj/a.md')).toBe(true)
  })
})

describe('markdown preview html', () => {
  it('renders common markdown and drops raw html, scripts and remote images', () => {
    const html = renderMarkdown('# 标题\n\n这是**本地**文档\n\n- 一项\n\n```\n<b>code</b>\n```\n\n[站点](https://example.com)\n\n[坏](javascript:alert(1))\n\n<script>alert(1)</script>\n\n![图](https://evil.test/a.png)')
    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<strong>本地</strong>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>')
    expect(html).toContain('&lt;b&gt;code&lt;/b&gt;')
    expect(html).toContain('href="https://example.com/"')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('<img')
    expect(html).toContain('图')
  })
})
