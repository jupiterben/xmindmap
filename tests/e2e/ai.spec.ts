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
async function addCustom(page: Page, url: string, key: string) {
  await page.getByRole('button', { name: '添加服务商', exact: true }).click()
  await page.getByRole('option', { name: '自定义', exact: true }).click()
  await page.getByLabel('AI API 基础地址').fill(url)
  await page.getByLabel('服务商 API Key').fill(key)
  await page.getByRole('button', { name: '添加', exact: true }).click()
}
async function configure(page: Page) {
  await page.getByRole('button', { name: 'AI 连接设置', exact: true }).click()
  await addCustom(page, endpoint, 'test-session-key')
  await expect(page.getByRole('list', { name: 'ai.example.test 可用模型' })).toContainText('model-a')
  await page.getByRole('button', { name: '确定', exact: true }).click()
}
async function mockModels(page: Page) {
  await page.route(`${endpoint}/models`, (route) => route.fulfill({ json: { data: [{ id: 'model-a' }, { id: 'model-b' }] } }))
}
async function send(page: Page, text: string, reveal = true) {
  await page.getByLabel('AI 对话消息').fill(text)
  await page.getByRole('button', { name: '发送', exact: true }).click()
  if (await page.getByRole('button', { name: '展开 AI 回复', exact: true }).isVisible()) {
    const hint = page.getByRole('button', { name: '查看 AI 回复', exact: true })
    await expect(hint).toBeVisible()
    if (reveal) await hint.click()
  }
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
  expect(models).toBe(2)
  expect(bodies).toHaveLength(0)
  await expect(page.locator('.outline-row')).toHaveCount(17)
  await page.getByLabel('对话模型').selectOption('model-b')
  await send(page, '帮我扩展产品规范', false)
  await expect(page.getByRole('button', { name: '展开 AI 回复', exact: true })).toBeVisible()
  await expect(page.getByRole('log')).toBeHidden()
  await expect(page.getByRole('button', { name: '查看 AI 回复', exact: true })).toContainText('已添加 2 个子主题')
  await page.getByRole('button', { name: '查看 AI 回复', exact: true }).click()
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
  await page.getByRole('button', { name: '确定', exact: true }).click()
  await send(page, '关注无障碍')
  await expect(page.getByRole('button', { name: '添加 1 个子主题', exact: true })).toBeVisible()
  await expect(page.locator('.outline-row')).toHaveCount(17)
  await page.getByRole('button', { name: '添加 1 个子主题', exact: true }).click()
  await expect(page.locator('.outline-row')).toHaveCount(18)
  await expect(page.getByRole('button', { name: '添加 1 个子主题', exact: true })).toHaveCount(0)
})

test('custom providers are added like built-in providers and are not requested before 添加', async ({ page }) => {
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
  await page.getByLabel('服务商 API Key').fill('test-session-key')
  await page.waitForTimeout(900)
  expect(listCalls).toBe(0)
  await page.getByRole('button', { name: '添加服务商', exact: true }).click()
  await page.getByRole('option', { name: '自定义', exact: true }).click()
  await page.getByLabel('AI API 基础地址').fill(endpoint)
  await page.waitForTimeout(900)
  expect(listCalls).toBe(0)
  await page.getByRole('button', { name: '添加', exact: true }).click()
  const modelsOnRow = dialog.getByRole('list', { name: 'ai.example.test 可用模型' })
  await expect(modelsOnRow).toContainText('model-a')
  await expect(modelsOnRow).toContainText('model-b')
  expect(listCalls).toBe(2)
  await expect(dialog.getByRole('button', { name: '移除 ai.example.test', exact: true })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('已获取 2 个模型')
  expect(await page.locator('body').evaluate((element) => element.scrollWidth <= window.innerWidth)).toBe(true)
  const footerGap = await dialog.evaluate((element) => {
    const actions = element.querySelector('.dialog-actions')
    if (!actions) return 999
    return Math.abs(element.getBoundingClientRect().bottom - actions.getBoundingClientRect().bottom)
  })
  expect(footerGap).toBeLessThan(2)
  await page.screenshot({ path: 'test-results/ai-settings-390.png', fullPage: true })
  await page.getByRole('button', { name: '确定', exact: true }).click()
  await expect(dialog).toBeHidden()
  await page.getByLabel('对话模型').selectOption('model-b')
  await expect(page.getByLabel('对话模型')).toHaveValue('model-b')
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('test-session-key')
  await page.reload()
  await expect(page.getByText('正在打开导图')).toBeHidden()
  await expect(page.getByLabel('对话模型')).toHaveValue('model-b')
})

test('a failed custom add keeps the typed key and retries without saving it', async ({ page }) => {
  let listCalls = 0
  await page.route(`${endpoint}/models`, async (route) => {
    listCalls++
    await route.fulfill(listCalls === 1 ? { status: 404, json: {} } : { json: { data: [{ id: 'model-c' }] } })
  })
  await page.route(`${endpoint}/chat/completions`, async (route) => {
    expect(route.request().headers().authorization).toBe('Bearer test-session-key')
    expect(route.request().postDataJSON().model).toBe('model-c')
    await route.fulfill({ json: completion('已补充。', ['手动模型结果']) })
  })
  await open(page)
  await page.getByRole('button', { name: 'AI 连接设置', exact: true }).click()
  await addCustom(page, endpoint, 'test-session-key')
  await expect(page.getByRole('alert')).toContainText('HTTP 404')
  await expect(page.getByLabel('服务商 API Key')).toHaveValue('test-session-key')
  await expect(page.getByRole('button', { name: '移除 ai.example.test', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '添加', exact: true }).click()
  await expect(page.getByRole('list', { name: 'ai.example.test 可用模型' })).toContainText('model-c')
  await page.getByRole('button', { name: '确定', exact: true }).click()
  await expect(page.getByLabel('对话模型')).toHaveValue('model-c')
  await send(page, '继续')
  await expect(page.getByRole('log')).toContainText('已添加 1 个子主题')
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

test('ai chat panel docks at bottom center and can be dragged', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await open(page)
  const chat = page.getByRole('complementary', { name: 'AI 对话' })
  const canvas = page.locator('.canvas-area')
  const centered = async () => {
    const box = (await chat.boundingBox())!
    const area = (await canvas.boundingBox())!
    return Math.abs(box.x + box.width / 2 - (area.x + area.width / 2)) < 8
  }
  const bottomGap = async () => {
    const box = (await chat.boundingBox())!
    const area = (await canvas.boundingBox())!
    return area.y + area.height - (box.y + box.height)
  }
  expect(await centered()).toBe(true)
  expect(await bottomGap()).toBeGreaterThanOrEqual(12)
  expect(await bottomGap()).toBeLessThanOrEqual(20)
  const handle = page.getByRole('button', { name: '拖动 AI 输入框' })
  const before = (await chat.boundingBox())!
  const grip = (await handle.boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x + grip.width / 2 + 24, grip.y + grip.height / 2 - 8, { steps: 4 })
  await page.mouse.up()
  expect(await centered()).toBe(true)
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x + grip.width / 2 + 120, grip.y + grip.height / 2 - 160, { steps: 8 })
  await page.mouse.up()
  const after = (await chat.boundingBox())!
  expect(await centered()).toBe(false)
  expect(after.x).toBeGreaterThan(before.x + 80)
  expect(after.y).toBeLessThan(before.y - 80)
  const area = (await canvas.boundingBox())!
  expect(after.x).toBeGreaterThanOrEqual(area.x - 1)
  expect(after.y).toBeGreaterThanOrEqual(area.y - 1)
  expect(after.x + after.width).toBeLessThanOrEqual(area.x + area.width + 1)
  expect(after.y + after.height).toBeLessThanOrEqual(area.y + area.height + 1)
  await handle.dblclick()
  expect(await centered()).toBe(true)
  expect(await bottomGap()).toBeGreaterThanOrEqual(12)
  expect(await bottomGap()).toBeLessThanOrEqual(20)
  await page.getByLabel('AI 对话消息').fill('仍然可以输入')
  await expect(page.getByLabel('AI 对话消息')).toHaveValue('仍然可以输入')
})

test('toolbar AI button shows and hides the input panel', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await open(page)
  const toggle = page.getByRole('button', { name: 'AI 对话', exact: true })
  const chat = page.getByRole('complementary', { name: 'AI 对话' })
  const canvas = page.locator('.canvas-area')
  await page.getByLabel('AI 对话消息').fill('先写一句')
  await toggle.click()
  await expect(chat).toBeHidden()
  await expect(page.getByRole('button', { name: '显示 AI 输入' })).toHaveCount(0)
  await toggle.click()
  await expect(page.getByLabel('AI 对话消息')).toHaveValue('先写一句')
  const restored = (await chat.boundingBox())!
  const area = (await canvas.boundingBox())!
  expect(Math.abs(restored.x + restored.width / 2 - (area.x + area.width / 2))).toBeLessThan(8)
})

test('expanding and collapsing a floating AI panel keeps its place', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await open(page)
  const chat = page.getByRole('complementary', { name: 'AI 对话' })
  const canvas = page.locator('.canvas-area')
  const handle = page.getByRole('button', { name: '拖动 AI 输入框' })
  const area = (await canvas.boundingBox())!
  const grip = (await handle.boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(area.x + 40, area.y + area.height - 150, { steps: 8 })
  await page.mouse.up()
  const before = (await chat.boundingBox())!
  await page.getByRole('button', { name: '展开 AI 回复' }).click()
  const expanded = (await chat.boundingBox())!
  expect(expanded.y + expanded.height).toBeLessThanOrEqual(area.y + area.height + 1)
  await page.getByRole('button', { name: '收起 AI 回复' }).click()
  const after = (await chat.boundingBox())!
  expect(Math.abs(after.x - before.x)).toBeLessThan(2)
  expect(Math.abs(after.y - before.y)).toBeLessThan(2)
})

test('AI can edit the current mind map when no node is selected', async ({ page }) => {
  await page.route(`${endpoint}/models`, (route) => route.fulfill({ json: { data: [{ id: 'model-a' }] } }))
  await page.route(`${endpoint}/chat/completions`, async (route) => {
    const system = String(route.request().postDataJSON().messages[0].content)
    const match = system.match(/"uid":"([^"]+)","text":"用户访谈"/)
    expect(match?.[1]).toBeTruthy()
    expect(system).toContain('发现问题')
    await route.fulfill({ json: {
      id: 'test-response', object: 'chat.completion', created: 1, model: 'model-a',
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ reply: '已把用户访谈改为用户研究', changes: [{ op: 'rename', uid: match![1], text: '用户研究' }] }) }, finish_reason: 'stop' }],
    } })
  })
  await open(page)
  await configure(page)
  const canvas = page.getByTestId('mind-map-canvas').locator('svg').first()
  const box = (await canvas.boundingBox())!
  await page.mouse.click(box.x + 8, box.y + 8)
  await expect(page.getByLabel('AI 对话消息')).toHaveAttribute('placeholder', '描述要如何修改导图…')
  await send(page, '把用户访谈改成用户研究')
  await expect(page.getByRole('log')).toContainText('已修改 1 处')
  await expect(page.locator('.outline-row').filter({ hasText: /^用户研究$/ })).toBeVisible()
  await expect(page.locator('.outline-row').filter({ hasText: /^用户访谈$/ })).toHaveCount(0)
})

test('built-in providers only need a key and the model list includes every configured provider', async ({ page }) => {
  const openai = 'https://api.openai.com/v1'
  const deepseek = 'https://api.deepseek.com/v1'
  await page.route(`${openai}/models`, (route) => route.fulfill({ json: { data: [{ id: 'gpt-4o' }] } }))
  await page.route(`${deepseek}/models`, (route) => route.fulfill({ json: { data: [{ id: 'deepseek-chat' }] } }))
  await page.route(`${openai}/chat/completions`, async (route) => {
    expect(route.request().headers().authorization).toBe('Bearer openai-key')
    expect(route.request().postDataJSON().model).toBe('gpt-4o')
    await route.fulfill({ json: completion('来自 OpenAI', []) })
  })
  await page.route(`${deepseek}/chat/completions`, async (route) => {
    expect(route.request().headers().authorization).toBe('Bearer deepseek-key')
    expect(route.request().postDataJSON().model).toBe('deepseek-chat')
    await route.fulfill({ json: completion('来自 DeepSeek', []) })
  })
  await open(page)
  await page.getByRole('button', { name: 'AI 连接设置', exact: true }).click()
  await page.getByRole('button', { name: '添加服务商', exact: true }).click()
  await page.getByRole('option', { name: 'OpenAI', exact: true }).click()
  await expect(page.getByRole('link', { name: '申请' })).toHaveAttribute('href', 'https://platform.openai.com/api-keys')
  await page.getByLabel('服务商 API Key').fill('openai-key')
  await page.getByRole('button', { name: '添加', exact: true }).click()
  await expect(page.getByRole('list', { name: 'OpenAI 可用模型' })).toContainText('gpt-4o')
  await page.getByRole('button', { name: '添加服务商', exact: true }).click()
  await page.getByRole('option', { name: 'DeepSeek', exact: true }).click()
  await expect(page.getByRole('link', { name: '申请' })).toHaveAttribute('href', 'https://platform.deepseek.com/api_keys')
  await page.getByLabel('服务商 API Key').fill('deepseek-key')
  await page.getByRole('button', { name: '添加', exact: true }).click()
  await expect(page.getByRole('list', { name: 'DeepSeek 可用模型' })).toContainText('deepseek-chat')
  await page.getByRole('button', { name: '确定', exact: true }).click()
  const models = page.getByLabel('对话模型')
  await expect(models.locator('option[value="gpt-4o"]')).toHaveCount(1)
  await expect(models.locator('option[value="deepseek-chat"]')).toHaveCount(1)
  await models.selectOption('deepseek-chat')
  await send(page, '用 deepseek')
  await expect(page.getByRole('log')).toContainText('来自 DeepSeek')
  await models.selectOption('gpt-4o')
  await send(page, '用 openai')
  await expect(page.getByRole('log')).toContainText('来自 OpenAI')
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('openai-key')
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('deepseek-key')
})

test('custom providers stay listed after the active model switches to another endpoint', async ({ page }) => {
  const other = 'https://other.example.test/v1'
  await page.route(`${endpoint}/models`, (route) => route.fulfill({ json: { data: [{ id: 'custom-model' }] } }))
  await page.route(`${other}/models`, (route) => route.fulfill({ json: { data: [{ id: 'other-model' }] } }))
  await page.route(`${other}/chat/completions`, async (route) => {
    expect(route.request().headers().authorization).toBe('Bearer other-key')
    expect(route.request().postDataJSON().model).toBe('other-model')
    await route.fulfill({ json: completion('来自自定义', []) })
  })
  await open(page)
  await page.getByRole('button', { name: 'AI 连接设置', exact: true }).click()
  await addCustom(page, endpoint, 'custom-key')
  await expect(page.getByRole('list', { name: 'ai.example.test 可用模型' })).toContainText('custom-model')
  await addCustom(page, other, 'other-key')
  await expect(page.getByRole('button', { name: '移除 ai.example.test', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '移除 other.example.test', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '确定', exact: true }).click()
  const models = page.getByLabel('对话模型')
  await expect(models.locator('option[value="custom-model"]')).toHaveCount(1)
  await models.selectOption('other-model')
  await expect(models.locator('option[value="custom-model"]')).toHaveCount(1)
  await send(page, '自定义')
  await expect(page.getByRole('log')).toContainText('来自自定义')
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
    await page.getByLabel('服务商 API Key').fill('draft-key')
    const box = (await settings.boundingBox())!
    await page.mouse.click(box.x / 2, box.y + 20)
    await expect(settings).toBeVisible()
    await expect(page.getByLabel('服务商 API Key')).toHaveValue('draft-key')
    await page.keyboard.press('Escape')
    await expect(settings).toBeHidden()
    await expect(chat).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(chat).toBeVisible()
  })
}
