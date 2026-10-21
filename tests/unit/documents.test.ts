import { describe, expect, it } from 'vitest'
import {
  createDocument, createExample, createNode, flattenTree, loadWorkspace, openMindMapText, parseDocument,
  safeLink, saveWorkspace, serializeDocument, STORAGE_KEY, validateTree,
} from '../../src/domain/documents'
import { exportMarkdown, importFreeMind, importMarkdown, readDocumentFile } from '../../src/domain/files'
import { validateContent } from '../../vscode-extension/src/document'
import { getDocumentTheme, getTheme, themes } from '../../src/domain/themes'
import { lineStyles, supportsLineStyle, themeIds } from '../../src/domain/types'
import { isNodeIcon, normalizeIcons, replaceIcon } from '../../src/domain/icons'

describe('node icons', () => {
  it('only accepts bundled IDs and removes duplicates', () => {
    expect(normalizeIcons(['priority_1', 'priority_1', 'progress_8', 'sign_23', 'expression_20', 'priority_11', '<svg onload="alert(1)">', 'https://example.com/icon.svg', {}, null]))
      .toEqual(['priority_1', 'progress_8', 'sign_23', 'expression_20'])
    expect(normalizeIcons('priority_1')).toEqual([])
    expect(isNodeIcon('sign_0')).toBe(false)
  })
  it('replaces the same category without removing other categories', () => {
    expect(replaceIcon(['priority_1', 'sign_2'], 'priority_3')).toEqual(['sign_2', 'priority_3'])
    expect(replaceIcon(['priority_1', 'sign_2'], 'priority_1', true)).toEqual(['sign_2'])
  })
  it('retains icons in JSON, SMM and local workspace round trips', () => {
    const doc = createDocument()
    doc.root.data.icon = ['priority_2', 'progress_3']
    expect(parseDocument(JSON.parse(serializeDocument(doc))).root.data.icon).toEqual(doc.root.data.icon)
    expect(parseDocument({ root: doc.root }).root.data.icon).toEqual(doc.root.data.icon)
    let value = ''
    const storage = { setItem: (_key: string, content: string) => { value = content }, getItem: () => value }
    saveWorkspace(storage, { version: 1, activeId: doc.id, documents: [doc] })
    expect(loadWorkspace(storage)?.documents[0]?.root.data.icon).toEqual(doc.root.data.icon)
  })
})

describe('document data', () => {
  it('round-trips each connector style and preserves theme defaults', () => {
    for (const { value } of lineStyles) {
      const doc = createDocument()
      doc.lineStyle = value
      const restored = parseDocument(JSON.parse(serializeDocument(doc)))
      expect(restored.lineStyle).toBe(value)
      expect(getDocumentTheme(restored).lineStyle).toBe(value)
      restored.themeId = 'forest'
      expect(getDocumentTheme(restored).lineStyle).toBe(value)
    }
    expect(getDocumentTheme({ themeId: 'studio', lineStyle: 'straight' }).lineRadius).toBe(0)
    expect(getTheme('studio').config.lineStyle).toBe('curve')
    expect(themes.map((item) => item.id)).toEqual([...themeIds])
  })
  it('migrates old documents and whitelists SMM connector styles', () => {
    const root = createNode('root')
    expect(parseDocument({ root }).lineStyle).toBe('curve')
    expect(parseDocument({ root, lineStyle: 'bad' }).lineStyle).toBe('curve')
    expect(parseDocument({ root, theme: { config: { lineStyle: 'direct' } } }).lineStyle).toBe('direct')
    expect(parseDocument({ root, lineStyle: 'straight', theme: { config: { lineStyle: 'direct' } } }).lineStyle).toBe('straight')
    expect(parseDocument({ root, themeId: 'dusk' }).themeId).toBe('dusk')
    expect(parseDocument({ root, themeId: 'custom-css' }).themeId).toBe('studio')
    expect(supportsLineStyle('mindMap')).toBe(true)
    expect(supportsLineStyle('fishbone')).toBe(false)
  })
  it('creates independent documents and unique node IDs', () => {
    const a = createExample()
    const b = createExample()
    expect(a.id).not.toBe(b.id)
    expect(flattenTree(a.root)).toHaveLength(17)
    expect(new Set(flattenTree(a.root).map(({ node }) => node.data.uid)).size).toBe(17)
  })
  it('accepts upstream raw trees and full SMM documents', () => {
    const tree = { data: { text: '主题' }, children: [{ data: { text: '分支' } }] }
    expect(parseDocument(tree).root.children[0]?.data.text).toBe('分支')
    expect(parseDocument({ root: tree, layout: 'timeline' }).layout).toBe('timeline')
  })
  it('round-trips app data and node properties', () => {
    const doc = createDocument('测试')
    doc.root.data.note = '记录'
    doc.root.data.tag = ['todo']
    doc.root.data.fillColor = '#aabbcc'
    doc.themeId = 'forest'
    const restored = parseDocument(JSON.parse(serializeDocument(doc)))
    expect(restored.title).toBe(doc.title)
    expect(restored.root).toMatchObject(doc.root)
    expect(restored.themeId).toBe('forest')
  })
  it('rejects malformed trees and invalid children', () => {
    expect(() => validateTree({ data: {} })).toThrow('data.text')
    expect(() => validateTree({ data: { text: 'root' }, children: {} })).toThrow('children')
    expect(() => parseDocument(null)).toThrow()
  })
  it('guards excessively deep or large input', () => {
    const root = createNode('root')
    let last = root
    for (let i = 0; i < 82; i++) { const next = createNode('n'); last.children.push(next); last = next }
    expect(() => validateTree(root)).toThrow('层级')
    expect(() => validateTree(createNode('root', Array.from({ length: 5000 }, () => createNode('n'))))).toThrow('5000')
  })
  it('repairs duplicate IDs and keeps root expanded', () => {
    const result = validateTree({ data: { uid: 'a', text: 'root', expand: false }, children: [{ data: { uid: 'a', text: 'leaf' } }] })
    expect(result.children[0]?.data.uid).not.toBe('a')
    expect(result.data.expand).toBe(true)
  })
  it('filters dangerous links, CSS, HTML and remote images', () => {
    const result = validateTree({ data: {
      text: '<b>Hello</b>', richText: true, hyperlink: 'javascript:alert(1)',
      fillColor: 'url(https://untrusted.test/pixel)', image: 'https://untrusted.test/a.png',
    } })
    expect(result.data.text).toBe('Hello')
    expect(result.data.hyperlink).toBe('')
    expect(result.data.fillColor).toBeUndefined()
    expect(result.data.image).toBeUndefined()
  })
  it('validates link schemes', () => {
    expect(safeLink('https://example.com')).toBe('https://example.com/')
    expect(safeLink('mailto:user@example.com')).toBe('mailto:user@example.com')
    expect(safeLink('docs/note.md')).toBe('docs/note.md')
    expect(safeLink('')).toBe('')
    for (const link of ['javascript:alert(1)', 'data:text/html,hi', '//example.com', 'foo', '/abs/note.md']) expect(() => safeLink(link)).toThrow()
  })
  it('supports a collapsed outline without dropping stored children', () => {
    const root = createNode('root', [createNode('branch', [createNode('leaf')])])
    root.children[0]!.data.expand = false
    expect(flattenTree(root)).toHaveLength(3)
    expect(flattenTree(root, true)).toHaveLength(2)
  })
})

describe('local workspace', () => {
  function storage() {
    const values = new Map<string, string>()
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  }
  it('round-trips multiple documents, IDs and timestamps', () => {
    const local = storage()
    const a = createDocument('A')
    const b = createDocument('B')
    b.lineStyle = 'direct'
    saveWorkspace(local, { version: 1, activeId: b.id, documents: [a, b] })
    const loaded = loadWorkspace(local)!
    expect(loaded.activeId).toBe(b.id)
    expect(loaded.documents[1]?.lineStyle).toBe('direct')
    expect(loaded.documents.map((doc) => doc.id)).toEqual([a.id, b.id])
    expect(loaded.documents[0]?.createdAt).toBe(a.createdAt)
  })
  it('does not overwrite corrupt data', () => {
    const local = storage()
    local.setItem(STORAGE_KEY, '{broken')
    expect(() => loadWorkspace(local)).toThrow()
    expect(local.getItem(STORAGE_KEY)).toBe('{broken')
  })
  it('surfaces storage quota failures', () => {
    const doc = createDocument()
    expect(() => saveWorkspace({ setItem: () => { throw new Error('quota') } }, { version: 1, activeId: doc.id, documents: [doc] })).toThrow('quota')
  })
})

describe('files', () => {
  it('parses headings, formatted text and nested lists with Markdown AST', () => {
    const doc = importMarkdown('# Project\n\n## **Design**\n- Wireframe\n  - Mobile\n- Test\n\n## Ship\n', 'Project')
    expect(doc.root.data.text).toBe('Project')
    expect(doc.root.children[0]?.data.text).toBe('Design')
    expect(doc.root.children[0]?.children[0]?.children[0]?.data.text).toBe('Mobile')
    expect(doc.root.children[1]?.data.text).toBe('Ship')
  })
  it('round-trips structure and escaped punctuation via Markdown', () => {
    const root = createNode('A *project*', [createNode('[Link]', [createNode('Test #1')]), createNode('Other')])
    const result = importMarkdown(exportMarkdown(root), 'Test')
    expect(flattenTree(result.root).map(({ node }) => node.data.text)).toEqual(flattenTree(root).map(({ node }) => node.data.text))
  })
  it('handles files with limits, extensions and error messages', async () => {
    await expect(readDocumentFile(new File(['broken'], 'broken.json'))).rejects.toThrow('JSON')
    await expect(readDocumentFile(new File(['hi'], 'test.exe'))).rejects.toThrow('请选择')
    await expect(readDocumentFile(new File(['x'.repeat(5 * 1024 * 1024 + 1)], 'huge.md'))).rejects.toThrow('5 MB')
    const result = await readDocumentFile(new File(['{"data":{"text":"Imported"}}'], 'sample.smm'))
    expect(result.title).toBe('sample')
    expect(result.root.data.text).toBe('Imported')
    const blank = await readDocumentFile(new File([' \n'], 'test.xmm'))
    expect(blank.title).toBe('test')
    expect(blank.root.data.text).toBe('中心主题')
    expect(openMindMapText('').root.data.text).toBe('中心主题')
    expect(openMindMapText('   ').title).toBe('未命名导图')
    expect(validateContent('')).toBe('')
    expect(validateContent('\n')).toBe('\n')
    expect(() => validateContent('{')).toThrow()
  })
  it('imports FreeMind text, notes, links and folding', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.0.1">
<node TEXT="Project">
  <icon BUILTIN="button_ok"/>
  <node TEXT="Design" FOLDED="true" LINK="https://example.com/design">
    <richcontent TYPE="NOTE"><html><body><script>alert(1)</script><p>Keep it simple</p></body></html></richcontent>
    <node TEXT="Mobile"/>
  </node>
  <node TEXT="Ship &amp; learn" LINK="javascript:alert(1)"/>
  <node TEXT="Old"><richcontent TYPE="NODE"><html><body><p>New label</p></body></html></richcontent></node>
</node>
</map>`
    const doc = await readDocumentFile(new File([xml], 'plan.mm'))
    expect(doc.title).toBe('plan')
    expect(doc.root.data.text).toBe('Project')
    expect(doc.root.children.map((child) => child.data.text)).toEqual(['Design', 'Ship & learn', 'New label'])
    expect(doc.root.children[0]?.data.expand).toBe(false)
    expect(doc.root.children[0]?.data.note).toBe('Keep it simple')
    expect(doc.root.children[0]?.data.hyperlink).toBe('https://example.com/design')
    expect(doc.root.children[0]?.children[0]?.data.text).toBe('Mobile')
    expect(doc.root.children[1]?.data.hyperlink).toBeUndefined()
    expect(() => importFreeMind('<map></map>', 'empty')).toThrow('FreeMind')
    await expect(readDocumentFile(new File(['<map></map>'], 'empty.mm'))).rejects.toThrow('FreeMind')
    await expect(readDocumentFile(new File(['not xml'], 'bad.mm'))).rejects.toThrow('FreeMind')
  })
})
