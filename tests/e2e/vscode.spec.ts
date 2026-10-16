import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

interface Host {
  text: string
  version: number
  hold: boolean
  cancel: boolean
  messages: Record<string, unknown>[]
  aiHold: boolean
}
declare global { interface Window { __testHost: Host } }

async function boot(page: Page) {
  await page.addInitScript(() => {
    const host: Host = {
      text: JSON.stringify({
        title: 'VS Code 测试', layout: 'mindMap', themeId: 'studio', lineStyle: 'curve',
        root: { data: { uid: 'root', text: '文件主题', expand: true }, children: [] },
      }),
      version: 1, hold: false, cancel: false, messages: [], aiHold: false,
    }
    window.__testHost = host
    let aiShortcut = 'Mod+Alt+KeyA'
    let aiSettings = { baseURL: 'https://ai.example.test/v1', model: 'test-model', hasKey: false }
    const send = (message: Record<string, unknown>) => queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', { data: message })))
    window.acquireVsCodeApi = () => ({
      postMessage(raw: unknown) {
        const message = raw as Record<string, unknown>
        host.messages.push(message)
        if (message.type === 'ai.settings') send({ type: 'result', id: message.id, data: aiSettings })
        if (message.type === 'ai.models') send({ type: 'result', id: message.id, data: ['test-model', 'other-model'] })
        if (message.type === 'ai.configure') {
          aiSettings = { ...(message.settings as typeof aiSettings), hasKey: !!message.apiKey || aiSettings.hasKey }
          send({ type: 'result', id: message.id, data: aiSettings })
        }
        if (message.type === 'ai.chat' && !host.aiHold) send({ type: 'result', id: message.id, data: { reply: '宿主回复', topics: ['宿主扩展 A', '宿主扩展 B'] } })
        if (message.type === 'ai.shortcut.get') send({ type: 'result', id: message.id, data: aiShortcut })
        if (message.type === 'ai.shortcut.set') {
          aiShortcut = String(message.shortcut)
          send({ type: 'result', id: message.id, data: aiShortcut })
        }
        if (message.type === 'ready') send({ type: 'document', text: host.text, version: host.version, dirty: false })
        if (message.type === 'edit' && !host.hold) {
          if (message.version !== host.version) { send({ type: 'error', message: '版本冲突' }); return }
          host.text = String(message.content)
          host.version++
          send({ type: 'ack', version: host.version, content: host.text, dirty: true })
        }
        if (message.type === 'save') {
          send({ type: 'saved' })
          send({ type: 'result', id: message.id, ok: true })
        }
        if (message.type === 'export' || message.type === 'create') send({ type: 'result', id: message.id, ok: !host.cancel })
      },
    })
  })
  await page.goto('/')
  await expect(page.getByLabel('文档名称')).toHaveValue('VS Code 测试')
  await expect(page.getByText('正在打开导图')).toBeHidden()
}

test('VS Code mode opens clean, edits real host state and saves without localStorage', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await boot(page)
  await expect(page.locator('.save-state')).toHaveText('所有更改已保存')
  expect(await page.evaluate(() => window.__testHost.messages.filter((message) => message.type === 'edit'))).toHaveLength(0)
  await expect(page.locator('.document-list')).toBeHidden()
  await page.getByRole('button', { name: '子主题', exact: true }).click()
  await expect.poll(() => page.evaluate(() => JSON.parse(window.__testHost.text).root.children.length)).toBe(1)
  await expect(page.locator('.save-state')).toHaveText('未保存')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.locator('.save-state')).toHaveText('所有更改已保存')
  expect(await page.evaluate(() => localStorage.getItem('xmindmap.workspace.v1'))).toBeNull()
  await page.screenshot({ path: 'test-results/vscode-webview.png', fullPage: true })
  expect(errors).toEqual([])
})

test('VS Code host updates refresh the canvas and conflicting updates preserve draft', async ({ page }) => {
  await boot(page)
  await page.evaluate(() => {
    const host = window.__testHost
    const data = JSON.parse(host.text)
    data.title = '外部修改'
    host.text = JSON.stringify(data)
    host.version++
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'document', text: host.text, version: host.version, dirty: true } }))
  })
  await expect(page.getByLabel('文档名称')).toHaveValue('外部修改')
  await page.evaluate(() => { window.__testHost.hold = true })
  await page.getByRole('button', { name: '子主题', exact: true }).click()
  await expect(page.locator('.outline-row')).toHaveCount(2)
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'document', text: window.__testHost.text, version: ++window.__testHost.version, dirty: false },
  })))
  await expect(page.getByRole('alert')).toContainText('暂停同步')
  await expect(page.locator('.outline-row')).toHaveCount(2)
})

test('VS Code native save captures inline text before replying with a snapshot', async ({ page }) => {
  await boot(page)
  await page.getByTestId('mind-map-canvas').locator('text').filter({ hasText: '文件主题' }).dblclick()
  await page.locator('.smm-node-edit-wrap').fill('原生保存捕获')
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'snapshot', id: 9 } })))
  await expect.poll(() => page.evaluate(() => {
    const message = window.__testHost.messages.find((item) => item.type === 'snapshotResult' && item.id === 9)
    return message?.content ? JSON.parse(String(message.content)).root.data.text : null
  })).toBe('原生保存捕获')
})

test('VS Code exports and creates files through host dialogs, respecting cancellation', async ({ page }) => {
  await boot(page)
  for (const type of ['JSON 导图', 'Markdown', 'SVG 矢量图', 'PNG 图片']) {
    await page.locator('.export-menu summary').click()
    await page.getByRole('button', { name: new RegExp(type) }).click()
    await expect(page.getByRole('status')).toContainText('已导出')
    await page.getByRole('button', { name: '关闭提示' }).click()
  }
  const exports = await page.evaluate(() => window.__testHost.messages.filter((message) => message.type === 'export'))
  expect(exports).toHaveLength(4)
  expect(exports[2]?.content).toMatch(/^data:image\/svg\+xml/)
  expect(exports[3]?.content).toMatch(/^data:image\/png/)
  await page.evaluate(() => { window.__testHost.cancel = true })
  await page.locator('.export-menu summary').click()
  await page.getByRole('button', { name: /JSON 导图/ }).click()
  await expect(page.getByRole('status')).toBeHidden()
  await page.getByRole('button', { name: '新建导图', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__testHost.messages.filter((message) => message.type === 'create').length)).toBe(1)
  await expect(page.getByLabel('文档名称')).toHaveValue('VS Code 测试')
})

test('a cancelled native save snapshot releases the edit queue', async ({ page }) => {
  await boot(page)
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'snapshot', id: 10 } })))
  await page.getByLabel('文档名称').fill('快照超时后的修改')
  await page.getByLabel('文档名称').press('Enter')
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'snapshotCancelled', id: 10 } })))
  await expect.poll(() => page.evaluate(() => JSON.parse(window.__testHost.text).title)).toBe('快照超时后的修改')
})

test('outline row deletion syncs to the VS Code document', async ({ page }) => {
  await boot(page)
  await page.getByRole('button', { name: '子主题', exact: true }).click()
  await expect.poll(() => page.evaluate(() => JSON.parse(window.__testHost.text).root.children.length)).toBe(1)
  await page.getByRole('button', { name: '删除大纲节点 分支主题', exact: true }).click()
  await expect.poll(() => page.evaluate(() => JSON.parse(window.__testHost.text).root.children.length)).toBe(0)
  await expect(page.locator('.outline-delete')).toHaveCount(0)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(() => page.evaluate(() => JSON.parse(window.__testHost.text).root.children.length)).toBe(1)
})

test('quick icons sync to VS Code and survive host document reload', async ({ page }) => {
  await boot(page)
  await page.getByRole('button', { name: '快捷设置图标', exact: true }).click()
  await page.getByRole('button', { name: '图标 优先级 2', exact: true }).click()
  await expect.poll(() => page.evaluate(() => JSON.parse(window.__testHost.text).root.data.icon)).toEqual(['priority_2'])
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.locator('.save-state')).toHaveText('所有更改已保存')
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'document', text: window.__testHost.text, version: ++window.__testHost.version, dirty: false },
  })))
  await expect(page.locator('.smm-node-container svg').filter({ has: page.locator('path[fill="#FA8D2E"]') })).toHaveCount(1)
})

test('VS Code persistent chat uses host models and automatically synchronizes expansion to the file', async ({ page }) => {
  await boot(page)
  await expect(page.getByRole('complementary', { name: 'AI 对话' })).toBeVisible()
  await expect(page.getByLabel('对话模型').locator('option[value="other-model"]')).toHaveCount(1)
  await page.getByLabel('对话模型').selectOption('other-model')
  expect(await page.evaluate(() => JSON.parse(window.__testHost.text).root.children.length)).toBe(0)
  await page.getByLabel('AI 对话消息').fill('扩展当前节点')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByRole('log')).toContainText('宿主回复')
  await expect.poll(() => page.evaluate(() => JSON.parse(window.__testHost.text).root.children.length)).toBe(2)
  const message = await page.evaluate(() => window.__testHost.messages.find((item) => item.type === 'ai.chat'))
  expect(message?.apiKey).toBeUndefined()
  expect((message?.settings as { model: string }).model).toBe('other-model')
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(() => page.evaluate(() => JSON.parse(window.__testHost.text).root.children.length)).toBe(0)
})

test('VS Code document replacement cancels AI generation and cannot insert into the new document', async ({ page }) => {
  await boot(page)
  await page.evaluate(() => { window.__testHost.aiHold = true })
  await page.getByLabel('AI 对话消息').fill('扩展')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByRole('button', { name: '停止生成' })).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: {
    type: 'document', text: window.__testHost.text, version: ++window.__testHost.version, dirty: false,
  } })))
  await expect(page.getByRole('complementary', { name: 'AI 对话' })).toBeVisible()
  await expect(page.getByRole('button', { name: '停止生成' })).toBeHidden()
  expect(await page.evaluate(() => window.__testHost.messages.some((message) => message.type === 'ai.cancel'))).toBe(true)
  await expect(page.locator('.outline-row')).toHaveCount(1)
})

test('VS Code AI shortcut is configurable through host storage without a model or API key', async ({ page }) => {
  await boot(page)
  const canvasRoot = page.getByTestId('mind-map-canvas').locator('text').filter({ hasText: /^文件主题$/ })
  await canvasRoot.click()
  await page.keyboard.press('Control+Alt+a')
  const input = page.getByLabel('AI 对话消息')
  await expect(input).toBeFocused()
  await page.getByRole('button', { name: 'AI 连接设置', exact: true }).click()
  await page.getByText('快捷键设置', { exact: false }).click()
  await page.getByLabel('AI 快捷键按键').selectOption('KeyB')
  await page.getByRole('button', { name: '保存快捷键', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('快捷键已保存')
  const message = await page.evaluate(() => window.__testHost.messages.find((item) => item.type === 'ai.shortcut.set'))
  expect(message?.shortcut).toBe('Mod+Alt+KeyB')
  expect(await page.evaluate(() => localStorage.getItem('xmindmap.ai.shortcut.v1'))).toBeNull()
  await page.keyboard.press('Escape')
  await canvasRoot.click()
  await page.keyboard.press('Control+Alt+a')
  await expect(input).not.toBeFocused()
  await page.keyboard.press('Control+Alt+b')
  await expect(input).toBeFocused()
  expect(await page.evaluate(() => window.__testHost.messages.some((item) => item.type === 'ai.chat'))).toBe(false)
})
