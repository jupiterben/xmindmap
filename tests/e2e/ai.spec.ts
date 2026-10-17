import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const endpoint = 'https://ai.example.test/v1'
const completion = (reply: string, topics: string[]) => ({
  id: 'test-response', object: 'chat.completion', created: 1, model: 'model-a',
  choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ reply, topics }) }, finish_reason: 'stop' }],
})

async function open(page: Page) {
  await page.goto('/')
  await expect(page.getByText('正在打开导图')).toBeHidden()
  await expect(page.getByRole('complementary', { name: 'AI 对话' })).toBeVisible()
  await expect(page.locator('.ai-chat-target')).toContainText('产品设计')
}
async function configure(page: Page, manualModel = '') {
  await page.getByRole('button', { name: 'AI 连接设置', exact: true }).click()
  await page.getByLabel('AI API 基础地址').fill(endpoint)
  await page.getByLabel('AI API Key').fill('test-session-key')
  if (manualModel) await page.getByLabel('AI 模型', { exact: true }).fill(manualModel)
  await page.getByRole('button', { name: '保存连接并获取模型', exact: true }).click()
}
async function mockModels(page: Page) {
  await page.route(`${endpoint}/models`, (route) => route.fulfill({ json: { data: [{ id: 'model-a' }, { id: 'model-b' }] } }))
}
async function send(page: Page, text: string) {
  await page.getByLabel('AI 对话消息').fill(text)
  await page.getByRole('button', { name: '发送', exact: true }).click()
}

test('chat is persistent, saves key without model, discovers models and only expands after sending', async ({ page }) => {
  let models = 0
  const bodies: Record<string, unknown>[] = []
  await page.route(`${endpoint}/models`, async (route) => {
    models++
    expect(route.request().method()).toBe('GET')
    expect(route.request().postData()).toBeNull()
    expect(route.request().headers().authorization).toBe('Bearer test-session-key')
    await route.fulfill({ json: { data: [{ id: 'model-a' }, { id: 'model-b' }] } })
  })
  await page.route(`${endpoint}/chat/completions`, async (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>)
    await route.fulfill({ json: completion(bodies.length === 1 ? '建议从交互和视觉开始。' : '继续补充测试。', bodies.length === 1 ? ['交互规范', '视觉规范'] : ['可访问性检查']) })
  })
  await open(page)
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await expect(page.locator('.outline-row')).toHaveCount(17)
  await configure(page)
  await expect(page.getByRole('dialog', { name: 'AI 设置' })).toBeHidden()
  await expect(page.getByLabel('对话模型')).toHaveValue('model-a')
  expect(models).toBe(1)
  expect(bodies).toHaveLength(0)
  await expect(page.locator('.outline-row')).toHaveCount(17)
  await page.getByLabel('对话模型').selectOption('model-b')
  await send(page, '帮我扩展产品规范')
  await expect(page.getByRole('log')).toContainText('已添加 2 个子主题')
  await expect(page.locator('.outline-row')).toHaveCount(19)
  await expect(page.locator('.ai-chat-target')).toContainText('产品设计')
  expect(bodies[0]?.model).toBe('model-b')
  expect(JSON.stringify(bodies[0])).not.toContain('用户访谈')
  await send(page, '继续补充测试')
  await expect(page.getByRole('log')).toContainText('已添加 1 个子主题')
  await expect(page.locator('.outline-row')).toHaveCount(20)
  expect((bodies[1]?.messages as { role: string }[]).map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'user'])
  expect(JSON.stringify(bodies[1])).toContain('帮我扩展产品规范')
  expect(JSON.stringify(bodies[1])).toContain('视觉规范')
  await page.screenshot({ path: 'test-results/ai-persistent-desktop.png', fullPage: true })
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.locator('.outline-row')).toHaveCount(19)
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect(page.locator('.outline-row')).toHaveCount(20)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('test-session-key')
  await page.reload()
  await expect(page.locator('.outline-row')).toHaveCount(20)
  await expect(page.getByRole('complementary', { name: 'AI 对话' })).toBeVisible()
})

test('clarification stays conversational and automatic expansion can be disabled', async ({ page }) => {
  await mockModels(page)
  let calls = 0
  await page.route(`${endpoint}/chat/completions`, async (route) => {
    calls++
    await route.fulfill({ json: calls === 1 ? completion('你希望关注哪个方面？', []) : completion('可以考虑无障碍测试。', ['无障碍测试']) })
  })
  await open(page)
  await configure(page)
  await expect(page.getByRole('dialog', { name: 'AI 设置' })).toBeHidden()
  await send(page, '先讨论一下')
  await expect(page.getByRole('log')).toContainText('你希望关注哪个方面？')
  await expect(page.locator('.outline-row')).toHaveCount(17)
  await page.getByRole('button', { name: 'AI 连接设置', exact: true }).click()
  await page.getByLabel('回复后自动扩展当前节点').uncheck()
  await page.getByRole('button', { name: '返回对话', exact: true }).click()
  await send(page, '关注无障碍')
  await expect(page.getByRole('button', { name: '添加 1 个子主题', exact: true })).toBeVisible()
  await expect(page.locator('.outline-row')).toHaveCount(17)
  await page.getByRole('button', { name: '添加 1 个子主题', exact: true }).click()
  await expect(page.locator('.outline-row')).toHaveCount(18)
  await expect(page.getByRole('button', { name: '添加 1 个子主题', exact: true })).toHaveCount(0)
})

test('models are discovered as soon as the address and key are filled in and saved without pressing save', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  let listCalls = 0
  await page.route(`${endpoint}/models`, async (route) => {
    listCalls++
    expect(route.request().headers().authorization).toBe('Bearer test-session-key')
    await route.fulfill({ json: { data: [{ id: 'model-a' }, { id: 'model-b' }] } })
  })
  await open(page)
  await page.getByRole('button', { name: 'AI 连接设置', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'AI 设置' })
  await page.getByLabel('AI API Key').fill('test-session-key')
  await page.waitForTimeout(900)
  // 只填密钥、没改地址时不请求，也不保存
  expect(listCalls).toBe(0)
  await page.getByLabel('AI API 基础地址').fill(endpoint)
  await expect(dialog.getByRole('group', { name: '可选模型' }).getByRole('button', { name: 'model-a', exact: true })).toBeVisible()
  expect(listCalls).toBe(1)
  await expect(page.getByRole('status')).toContainText('已获取模型列表')
  expect(await page.locator('body').evaluate((element) => element.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/ai-settings-390.png', fullPage: true })
  await dialog.getByRole('button', { name: 'model-b', exact: true }).click()
  await page.getByRole('button', { name: '返回对话', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByLabel('对话模型')).toHaveValue('model-b')
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('test-session-key')
  await page.reload()
  await expect(page.getByText('正在打开导图')).toBeHidden()
  await expect(page.getByLabel('对话模型')).toHaveValue('model-b')
})

test('model discovery failure keeps the saved key and supports manual model and retry', async ({ page }) => {
  let listCalls = 0
  await page.route(`${endpoint}/models`, async (route) => {
    listCalls++
    await route.fulfill(listCalls === 1 ? { status: 404, json: {} } : { json: { data: [{ id: 'model-c' }] } })
  })
  await page.route(`${endpoint}/chat/completions`, async (route) => {
    expect(route.request().headers().authorization).toBe('Bearer test-session-key')
    expect(route.request().postDataJSON().model).toBe('manual-model')
    await route.fulfill({ json: completion('已补充。', ['手动模型结果']) })
  })
  await open(page)
  await configure(page)
  await expect(page.getByRole('alert')).toContainText('HTTP 404')
  await expect(page.getByLabel('AI API Key')).toHaveValue('')
  await expect(page.getByLabel('AI API Key')).toHaveAttribute('placeholder', '已配置，留空保留')
  await page.getByRole('button', { name: '返回对话', exact: true }).click()
  await page.getByLabel('对话模型').selectOption('__manual__')
  await page.getByLabel('手动对话模型').fill('manual-model')
  await send(page, '继续')
  await expect(page.getByRole('log')).toContainText('已添加 1 个子主题')
  await page.getByRole('button', { name: 'AI 连接设置', exact: true }).click()
  await page.getByRole('button', { name: '保存连接并获取模型', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'AI 设置' })).toBeHidden()
  await expect(page.getByLabel('对话模型').locator('option[value="model-c"]')).toHaveCount(1)
})

test('changing selection cancels generation and never applies a late reply to another node', async ({ page }) => {
  await mockModels(page)
  let release: (() => void) | undefined
  await page.route(`${endpoint}/chat/completions`, async (route) => {
    await new Promise<void>((resolve) => { release = resolve })
    await route.fulfill({ json: completion('迟到回复', ['不应插入']) }).catch(() => {})
  })
  await open(page)
  await configure(page)
  await expect(page.getByRole('dialog', { name: 'AI 设置' })).toBeHidden()
  await send(page, '请扩展')
  await expect.poll(() => !!release).toBe(true)
  await page.locator('.outline-label').filter({ hasText: /^用户访谈$/ }).click()
  await expect(page.locator('.ai-chat-target')).toContainText('用户访谈')
  release?.()
  await expect(page.getByRole('log')).not.toContainText('迟到回复')
  await expect(page.locator('.outline-row')).toHaveCount(17)
  await expect(page.getByRole('complementary', { name: 'AI 对话' })).toBeVisible()
  await expect(page.getByLabel('AI 对话消息')).toHaveValue('')
})

test('stopping, auth failure and invalid output preserve the tree and permit retry', async ({ page }) => {
  await mockModels(page)
  let calls = 0
  await page.route(`${endpoint}/chat/completions`, async (route) => {
    calls++
    if (calls === 1) await route.fulfill({ status: 401, json: { error: { message: 'secret-must-not-display' } } })
    else if (calls === 2) await route.fulfill({ json: completion('invalid', ['<script>bad</script>']) })
    else await route.fulfill({ json: completion('有效回复', ['安全扩展']) })
  })
  await open(page)
  await configure(page)
  await expect(page.getByRole('dialog', { name: 'AI 设置' })).toBeHidden()
  await send(page, '重试请求')
  await expect(page.getByRole('log')).toContainText('认证失败')
  await expect(page.locator('body')).not.toContainText('secret-must-not-display')
  await expect(page.getByLabel('AI 对话消息')).toHaveValue('重试请求')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByRole('log')).toContainText('纯文本')
  await expect(page.locator('.outline-row')).toHaveCount(17)
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByRole('log')).toContainText('已添加 1 个子主题')
  await expect(page.locator('.outline-row')).toHaveCount(18)
})

test('ai chat panel can be dragged inside the canvas', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await open(page)
  const chat = page.getByRole('complementary', { name: 'AI 对话' })
  const handle = page.getByRole('button', { name: '拖动 AI 输入框' })
  const before = (await chat.boundingBox())!
  const grip = (await handle.boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x + grip.width / 2 + 120, grip.y + grip.height / 2 - 160, { steps: 8 })
  await page.mouse.up()
  const after = (await chat.boundingBox())!
  expect(after.x).toBeGreaterThan(before.x + 80)
  expect(after.y).toBeLessThan(before.y - 80)
  const canvas = (await page.locator('.canvas-area').boundingBox())!
  expect(after.x).toBeGreaterThanOrEqual(canvas.x - 1)
  expect(after.y).toBeGreaterThanOrEqual(canvas.y - 1)
  expect(after.x + after.width).toBeLessThanOrEqual(canvas.x + canvas.width + 1)
  expect(after.y + after.height).toBeLessThanOrEqual(canvas.y + canvas.height + 1)
  await page.getByLabel('AI 对话消息').fill('仍然可以输入')
  await expect(page.getByLabel('AI 对话消息')).toHaveValue('仍然可以输入')
})

for (const width of [1280, 390]) {
  test(`persistent chat and modal settings fit at ${width}px and outside clicks preserve settings`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await open(page)
    const chat = page.getByRole('complementary', { name: 'AI 对话' })
    await expect(page.getByLabel('AI 对话消息')).toBeVisible()
    const chatBox = (await chat.boundingBox())!
    const canvas = (await page.locator('.canvas-area').boundingBox())!
    const controls = (await page.locator('.canvas-controls').boundingBox())!
    expect(chatBox.x).toBeGreaterThanOrEqual(canvas.x - 1)
    expect(chatBox.x + chatBox.width).toBeLessThanOrEqual(canvas.x + canvas.width + 1)
    expect(chatBox.y + chatBox.height).toBeLessThanOrEqual(canvas.y + canvas.height + 1)
    expect(chatBox.y + chatBox.height).toBeLessThanOrEqual(controls.y + 1)
    expect(await page.locator('body').evaluate((element) => element.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/ai-persistent-${width}.png`, fullPage: true })
    await page.getByRole('button', { name: 'AI 连接设置', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'AI 设置', exact: true })
    await page.getByLabel('AI API Key').fill('draft-key')
    const box = (await settings.boundingBox())!
    await page.mouse.click(box.x / 2, box.y + 20)
    await expect(settings).toBeVisible()
    await expect(page.getByLabel('AI API Key')).toHaveValue('draft-key')
    await page.keyboard.press('Escape')
    await expect(settings).toBeHidden()
    await expect(chat).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(chat).toBeVisible()
  })
}
