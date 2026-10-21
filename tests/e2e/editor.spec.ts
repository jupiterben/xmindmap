import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

const runtimeErrors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => {
  const errors: string[] = []
  runtimeErrors.set(page, errors)
  page.on('pageerror', (error) => errors.push(error.message))
})
test.afterEach(async ({ page }) => {
  // Allow upstream's 100ms history timer to finish before checking stale callbacks.
  await page.waitForTimeout(180)
  expect(runtimeErrors.get(page)).toEqual([])
})

async function openEditor(page: Page) {
  await page.goto('/')
  await expect(page.getByText('正在打开导图')).toBeHidden()
  await expect(page.getByTestId('mind-map-canvas').locator('svg').first()).toBeVisible()
  if ((page.viewportSize()?.width ?? 1280) > 1100) {
    await page.getByRole('button', { name: '切换属性面板', exact: true }).click()
  }
}

async function selectOutline(page: Page, text: string) {
  await page.locator('.outline-label').filter({ hasText: new RegExp(`^${text}$`) }).click()
}

test('outline delete appears only on the selected non-root row and is undoable', async ({ page }) => {
  await openEditor(page)
  await expect(page.locator('.outline-delete')).toHaveCount(0)
  await selectOutline(page, '用户访谈')
  const leafDelete = page.getByRole('button', { name: '删除大纲节点 用户访谈', exact: true })
  await expect(leafDelete).toBeVisible()
  await expect(page.locator('.outline-delete')).toHaveCount(1)
  await selectOutline(page, '发现问题')
  await expect(leafDelete).toBeHidden()
  const branchDelete = page.getByRole('button', { name: '删除大纲节点 发现问题', exact: true })
  await expect(branchDelete).toBeVisible()
  await page.screenshot({ path: 'test-results/outline-delete-desktop.png', fullPage: true })
  await branchDelete.click()
  await expect(page.locator('.outline-row')).toHaveCount(13)
  await expect(page.getByTestId('mind-map-canvas').locator('text').filter({ hasText: '用户访谈' })).toHaveCount(0)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.locator('.outline-row')).toHaveCount(17)
  await selectOutline(page, '产品设计')
  await expect(page.locator('.outline-delete')).toHaveCount(0)
})

test('outline search deletion works on mobile without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openEditor(page)
  await page.getByRole('button', { name: '切换左侧栏', exact: true }).click()
  await page.getByLabel('搜索节点', { exact: true }).fill('用户访谈')
  await selectOutline(page, '用户访谈')
  await expect(page.getByRole('button', { name: '删除大纲节点 用户访谈', exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/outline-delete-mobile.png', fullPage: true })
  expect(await page.locator('.outline-tree').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.getByRole('button', { name: '删除大纲节点 用户访谈', exact: true }).click()
  await expect(page.getByText('没有匹配的节点')).toBeVisible()
  await page.getByRole('button', { name: '清除搜索', exact: true }).click()
  await expect(page.locator('.outline-row')).toHaveCount(16)
})

test('renders the real map and a usable desktop layout', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await openEditor(page)
  await expect(page.locator('.outline-row')).toHaveCount(17)
  await expect(page.getByTestId('mind-map-canvas').locator('text').filter({ hasText: '产品设计' })).toBeVisible()
  expect(await page.locator('body').evaluate((element) => element.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/editor-desktop.png', fullPage: true })
  expect(errors).toEqual([])
})

test('adds, edits, styles, undoes and deletes nodes', async ({ page }) => {
  await openEditor(page)
  await page.getByRole('button', { name: '子主题', exact: true }).click()
  await expect(page.locator('.outline-row')).toHaveCount(18)
  await page.getByLabel('节点名称', { exact: true }).fill('新增计划')
  await page.getByLabel('节点备注').fill('本周完成')
  await page.getByLabel('节点标签').fill('设计, 重点')
  await page.getByRole('button', { name: '应用修改' }).click()
  await expect(page.locator('.outline-label').filter({ hasText: '新增计划' })).toBeVisible()
  await page.getByRole('button', { name: '斜体', exact: true }).click()
  await expect(page.getByRole('button', { name: '斜体', exact: true })).toHaveClass(/active/)
  await page.getByRole('button', { name: '删除节点', exact: true }).click()
  await expect(page.locator('.outline-row')).toHaveCount(17)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.locator('.outline-row')).toHaveCount(18)
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect(page.locator('.outline-row')).toHaveCount(17)
})

test('keeps typing in fields isolated from map shortcuts', async ({ page }) => {
  await openEditor(page)
  await page.getByLabel('节点名称', { exact: true }).fill('新的根主题')
  await page.getByLabel('节点名称', { exact: true }).press('Enter')
  await expect(page.locator('.outline-row')).toHaveCount(17)
  await page.getByRole('button', { name: '应用修改' }).click()
  await expect(page.locator('.outline-label').filter({ hasText: '新的根主题' })).toBeVisible()
})

test('canvas keyboard insertion and inline text editing work', async ({ page }) => {
  await openEditor(page)
  await page.getByTestId('mind-map-canvas').locator('text').filter({ hasText: '用户访谈' }).click()
  await page.keyboard.press('Tab')
  const editor = page.locator('.smm-node-edit-wrap')
  await expect(editor).toBeVisible()
  await editor.fill('键盘新节点')
  await page.keyboard.press('Enter')
  await expect(editor).toBeHidden()
  await expect(page.locator('.outline-label').filter({ hasText: '键盘新节点' })).toBeVisible()
})

test('persists content, layout and theme through refresh', async ({ page }) => {
  await openEditor(page)
  await page.getByLabel('文档名称').fill('我的项目')
  await page.getByLabel('文档名称').press('Enter')
  await page.getByLabel('导图布局').selectOption('logicalStructure')
  await page.getByLabel('导图主题', { exact: true }).selectOption('forest')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.reload()
  await expect(page.getByText('正在打开导图')).toBeHidden()
  await expect(page.getByLabel('文档名称')).toHaveValue('我的项目')
  await expect(page.getByLabel('导图布局')).toHaveValue('logicalStructure')
  await expect(page.getByLabel('导图主题', { exact: true })).toHaveValue('forest')
})

test('switches local documents without leaking data or undo history', async ({ page }) => {
  await openEditor(page)
  await page.getByRole('button', { name: '新建导图', exact: true }).click()
  await expect(page.locator('.outline-row')).toHaveCount(1)
  await page.getByRole('button', { name: '子主题', exact: true }).click()
  await expect(page.locator('.outline-row')).toHaveCount(2)
  await page.locator('.document-item').filter({ hasText: '产品设计' }).click()
  await expect(page.locator('.outline-row')).toHaveCount(17)
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
  await page.locator('.document-item').filter({ hasText: '未命名导图' }).click()
  await expect(page.locator('.outline-row')).toHaveCount(2)
  await page.getByRole('button', { name: '删除当前导图', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.locator('.document-item')).toHaveCount(1)
  await expect(page.locator('.outline-row')).toHaveCount(17)
})

test('imports SMM and Markdown, exports JSON and images', async ({ page }) => {
  await openEditor(page)
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'Imported.smm', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ root: { data: { text: '导入主题' }, children: [{ data: { text: '分支' } }] }, layout: 'timeline' })),
  })
  await expect(page.getByLabel('文档名称')).toHaveValue('Imported')
  await expect(page.locator('.outline-row')).toHaveCount(2)
  for (const type of ['JSON 导图', 'SVG 矢量图', 'PNG 图片']) {
    await page.locator('.export-menu summary').click()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: new RegExp(type) }).click()
    const download = await downloadPromise
    expect(await download.failure()).toBeNull()
    const stream = await download.createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk as Buffer))
    const content = Buffer.concat(chunks)
    expect(content.length).toBeGreaterThan(100)
    if (type === 'JSON 导图') expect(JSON.parse(content.toString()).root.data.text).toBe('导入主题')
    if (type === 'PNG 图片') expect(content.subarray(1, 4).toString()).toBe('PNG')
    if (type === 'SVG 矢量图') expect(content.toString()).toContain('<svg')
  }
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'Plan.md', mimeType: 'text/markdown', buffer: Buffer.from('# 计划\n\n- 设计\n  - 评审\n- 发布\n'),
  })
  await expect(page.locator('.outline-row')).toHaveCount(4)
  await expect(page.getByLabel('文档名称')).toHaveValue('Plan')
})

test('rejects bad imports while keeping the current document', async ({ page }) => {
  await openEditor(page)
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{}') })
  await expect(page.getByRole('alert')).toContainText('节点格式')
  await expect(page.locator('.outline-row')).toHaveCount(17)
})

test('searches hidden nodes, expands and zooms', async ({ page }) => {
  await openEditor(page)
  await page.getByRole('button', { name: '收起全部', exact: true }).click()
  await expect(page.locator('.outline-row')).toHaveCount(5)
  await page.getByLabel('搜索节点', { exact: true }).fill('用户访谈')
  await page.getByLabel('搜索节点', { exact: true }).press('Enter')
  await expect(page.getByLabel('节点名称', { exact: true })).toHaveValue('用户访谈')
  await page.getByRole('button', { name: '清除搜索', exact: true }).click()
  await selectOutline(page, '用户访谈')
  await page.getByRole('button', { name: '放大', exact: true }).click()
  await page.getByRole('button', { name: '适应画布', exact: true }).click()
  await expect(page.getByTestId('mind-map-canvas').locator('text').filter({ hasText: '产品设计' })).toBeVisible()
})

test('works on a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openEditor(page)
  expect(await page.locator('body').evaluate((element) => element.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: '切换左侧栏', exact: true }).click()
  await expect(page.locator('.outline-row')).toHaveCount(17)
  await page.getByRole('button', { name: '切换属性面板', exact: true }).click()
  await expect(page.locator('.left-panel')).toBeHidden()
  await expect(page.getByLabel('节点名称', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '切换属性面板', exact: true }).click()
  await page.screenshot({ path: 'test-results/editor-mobile.png', fullPage: true })
})

test('rapid layout changes and document switching do not leak callbacks', async ({ page }) => {
  await openEditor(page)
  for (const layout of ['timeline', 'fishbone', 'organizationStructure', 'mindMap']) {
    await page.getByLabel('导图布局').selectOption(layout)
    await page.getByRole('button', { name: '新建导图', exact: true }).click()
    await page.locator('.document-item').filter({ hasText: '产品设计' }).click()
  }
  await expect(page.locator('.outline-row')).toHaveCount(17)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.reload()
  await expect(page.locator('.outline-row')).toHaveCount(17)
})

test('all supported layouts render visible connected nodes', async ({ page }) => {
  await openEditor(page)
  for (const layout of ['mindMap', 'logicalStructure', 'logicalStructureLeft', 'organizationStructure', 'catalogOrganization', 'timeline', 'verticalTimeline', 'fishbone']) {
    await page.getByLabel('导图布局').selectOption(layout)
    await expect(page.getByTestId('mind-map-canvas').locator('text').filter({ hasText: '产品设计' })).toBeVisible()
    await page.getByRole('button', { name: '适应画布', exact: true }).click()
  }
})

test('drags a node to a different parent and can undo it', async ({ page }) => {
  await openEditor(page)
  const source = page.getByTestId('mind-map-canvas').locator('text').filter({ hasText: '用户访谈' })
  const target = page.getByTestId('mind-map-canvas').locator('text').filter({ hasText: '设计方案' })
  const sourceBox = (await source.boundingBox())!
  const targetBox = (await target.boundingBox())!
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 20 })
  await page.mouse.up()
  const discovery = page.locator('.outline-row').filter({ has: page.getByRole('button', { name: '发现问题', exact: true }) })
  await expect(discovery.locator('.outline-count')).toHaveText('2')
  const design = page.locator('.outline-row').filter({ has: page.getByRole('button', { name: '设计方案', exact: true }) })
  await expect(design.locator('.outline-count')).toHaveText('4')
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(discovery.locator('.outline-count')).toHaveText('3')
})

test('adds a local image, retains it after reload and removes it', async ({ page }) => {
  await openEditor(page)
  await page.getByLabel('节点图片文件', { exact: true }).setInputFiles({
    name: 'pixel.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'),
  })
  await expect(page.getByRole('button', { name: '移除图片', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: '切换属性面板', exact: true }).click()
  await expect(page.getByRole('button', { name: '移除图片', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '移除图片', exact: true }).click()
  await expect(page.getByRole('button', { name: '移除图片', exact: true })).toBeHidden()
})

test('preserves corrupt local data and pauses autosave', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('xmindmap.workspace.v1', '{broken'))
  await openEditor(page)
  await expect(page.getByRole('alert')).toContainText('自动保存已暂停')
  await page.getByRole('button', { name: '子主题', exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  expect(await page.evaluate(() => localStorage.getItem('xmindmap.workspace.v1'))).toBe('{broken')
})

test('saves inline editing when the page is reloaded', async ({ page }) => {
  await openEditor(page)
  await page.getByTestId('mind-map-canvas').locator('text').filter({ hasText: '产品设计' }).dblclick()
  await page.locator('.smm-node-edit-wrap').fill('页面离开时保存')
  await page.reload()
  await expect(page.locator('.outline-label').filter({ hasText: '页面离开时保存' })).toBeVisible()
})

test('connector styles change actual paths and survive theme, duplicate, import and reload', async ({ page }) => {
  await openEditor(page)
  const style = page.getByLabel('连线样式', { exact: true })
  const paths = page.locator('.smm-line-container path')
  const geometry = () => paths.evaluateAll((items) => items.map((item) => item.getAttribute('d')).join(' '))
  await expect(paths).toHaveCount(16)
  await expect.poll(geometry).toMatch(/[CQ]/i)
  await style.selectOption('straight')
  await expect.poll(geometry).not.toMatch(/[CQ]/i)
  const elbow = await geometry()
  await style.selectOption('direct')
  await expect.poll(geometry).not.toBe(elbow)
  await expect.poll(geometry).not.toMatch(/[CQ]/i)
  await page.getByLabel('导图主题', { exact: true }).selectOption('forest')
  await expect(style).toHaveValue('direct')
  await expect.poll(geometry).not.toMatch(/[CQ]/i)
  await page.screenshot({ path: 'test-results/line-style-desktop.png', fullPage: true })
  await page.getByRole('button', { name: '复制当前导图', exact: true }).click()
  await expect(style).toHaveValue('direct')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.reload()
  await expect(style).toHaveValue('direct')
  await expect.poll(geometry).not.toMatch(/[CQ]/i)
  await page.locator('.export-menu summary').click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /JSON 导图/ }).click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk as Buffer))
  const buffer = Buffer.concat(chunks)
  expect(JSON.parse(buffer.toString()).lineStyle).toBe('direct')
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'connectors.json', mimeType: 'application/json', buffer })
  await expect(page.getByRole('status')).toContainText('导入完成')
  await expect(style).toHaveValue('direct')
  await style.selectOption('curve')
  await expect.poll(geometry).toMatch(/[CQ]/i)
  await page.getByLabel('导图布局').selectOption('fishbone')
  await expect(style).toBeDisabled()
  await expect(style).toHaveValue('fixed')
  await page.getByLabel('导图布局').selectOption('mindMap')
  await expect(style).toBeEnabled()
  await expect(style).toHaveValue('curve')
})

test('connector style control is usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openEditor(page)
  await page.getByLabel('连线样式', { exact: true }).selectOption('straight')
  await expect(page.getByLabel('连线样式', { exact: true })).toHaveValue('straight')
  expect(await page.locator('body').evaluate((element) => element.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/line-style-mobile.png', fullPage: true })
})

test('panning the canvas keeps the selected node', async ({ page }) => {
  await openEditor(page)
  await selectOutline(page, '用户访谈')
  await expect(page.getByText('已选择 1 个节点')).toBeVisible()
  const canvas = page.getByTestId('mind-map-canvas')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('画布不可见')
  const start = { x: box.x + 12, y: box.y + box.height - 12 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 90, start.y - 70, { steps: 8 })
  await expect(page.getByText('已选择 1 个节点')).toBeVisible()
  await expect(canvas.locator('g.active')).toHaveCount(1)
  await page.mouse.up()
  await expect(page.getByText('已选择 1 个节点')).toBeVisible()
  await expect(canvas.locator('g.active')).toHaveCount(1)
  await page.mouse.click(start.x, start.y)
  await expect(page.getByText('未选择节点')).toBeVisible()
  await expect(canvas.locator('g.active')).toHaveCount(0)
})
