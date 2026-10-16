import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function open(page: Page) {
  await page.goto('/')
  await expect(page.getByText('正在打开导图')).toBeHidden()
  await page.getByRole('button', { name: '快捷设置图标', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '节点图标' })).toBeVisible()
}
async function savedIcons(page: Page) {
  return page.evaluate(() => {
    const workspace = JSON.parse(localStorage.getItem('xmindmap.workspace.v1') ?? '{}')
    return workspace.documents?.find((doc: { id: string }) => doc.id === workspace.activeId)?.root.data.icon ?? []
  })
}

test('quick icons render, replace, toggle, clear and undo', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await open(page)
  const one = page.getByRole('button', { name: '图标 优先级 1', exact: true })
  const two = page.getByRole('button', { name: '图标 优先级 2', exact: true })
  await one.click()
  await expect(one).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => savedIcons(page)).toEqual(['priority_1'])
  // Node icons are actual nested SVGs, not just a picker selection.
  await expect(page.locator('.smm-node-container svg[viewBox="0 0 1024 1024"]')).toHaveCount(1)
  await two.click()
  await expect(one).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => savedIcons(page)).toEqual(['priority_2'])
  await page.getByLabel('图标分类').selectOption('progress')
  await page.getByRole('button', { name: '图标 进度 3', exact: true }).click()
  await expect.poll(() => savedIcons(page)).toEqual(['priority_2', 'progress_3'])
  await expect(page.locator('.smm-node-container svg[viewBox="0 0 1024 1024"]')).toHaveCount(2)
  await page.screenshot({ path: 'test-results/quick-icons-desktop.png', fullPage: true })
  await page.getByRole('button', { name: '图标 进度 3', exact: true }).click()
  await expect.poll(() => savedIcons(page)).toEqual(['priority_2'])
  await page.getByRole('button', { name: '清空图标', exact: true }).click()
  await expect.poll(() => savedIcons(page)).toEqual([])
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '节点图标' })).toBeHidden()
  await expect(page.getByRole('button', { name: '快捷设置图标', exact: true })).toBeFocused()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(() => savedIcons(page)).toEqual(['priority_2'])
  expect(errors).toEqual([])
})

test('icons survive reload, duplicate, JSON and SVG export', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '图标 优先级 1', exact: true }).click()
  await expect.poll(() => savedIcons(page)).toEqual(['priority_1'])
  await page.reload()
  await expect(page.getByText('正在打开导图')).toBeHidden()
  await expect(page.locator('.smm-node-container svg[viewBox="0 0 1024 1024"]')).toHaveCount(1)
  await page.getByRole('button', { name: '复制当前导图', exact: true }).click()
  await expect.poll(() => savedIcons(page)).toEqual(['priority_1'])
  for (const format of ['JSON 导图', 'SVG 矢量图']) {
    await page.locator('.export-menu summary').click()
    const downloaded = page.waitForEvent('download')
    await page.getByRole('button', { name: new RegExp(format) }).click()
    const download = await downloaded
    const stream = await download.createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk as Buffer))
    const buffer = Buffer.concat(chunks)
    if (format === 'JSON 导图') {
      expect(JSON.parse(buffer.toString()).root.data.icon).toEqual(['priority_1'])
      await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'icons.json', mimeType: 'application/json', buffer })
      await expect(page.getByLabel('文档名称')).toHaveValue(/副本/)
      await expect(page.locator('.smm-node-container svg[viewBox="0 0 1024 1024"]')).toHaveCount(1)
    } else expect(buffer.toString()).toContain('#E93B30')
  }
})

test('all icon previews load and mobile picker stays within viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page)
  for (const [group, count] of [['priority', 10], ['progress', 8], ['expression', 20], ['sign', 23]] as const) {
    await page.getByLabel('图标分类').selectOption(group)
    await expect(page.locator('.node-icon-option')).toHaveCount(count)
    await expect.poll(() => page.locator('.node-icon-option img').evaluateAll((images) =>
      images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0),
    )).toBe(true)
  }
  await page.getByRole('button', { name: '图标 标记 1', exact: true }).click()
  await expect.poll(() => savedIcons(page)).toEqual(['sign_1'])
  const box = (await page.getByRole('dialog', { name: '节点图标' }).boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(390)
  await page.screenshot({ path: 'test-results/quick-icons-mobile.png', fullPage: true })
  await page.locator('.brand').click()
  await expect(page.getByRole('dialog', { name: '节点图标' })).toBeHidden()
})

test('batch icon setting updates only selected nodes and mixed state is not marked selected', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('正在打开导图')).toBeHidden()
  const canvas = page.getByTestId('mind-map-canvas')
  await canvas.locator('text').filter({ hasText: /^用户访谈$/ }).click()
  await canvas.locator('text').filter({ hasText: /^场景与痛点$/ }).click({ modifiers: ['Control'] })
  await page.getByRole('button', { name: '快捷设置图标', exact: true }).click()
  await expect(page.locator('.node-icon-heading')).toContainText('2 项')
  const choice = page.getByRole('button', { name: '图标 优先级 1', exact: true })
  await choice.click()
  await expect(choice).toHaveAttribute('aria-pressed', 'true')
  const childIcons = () => page.evaluate(() => {
    const workspace = JSON.parse(localStorage.getItem('xmindmap.workspace.v1') ?? '{}')
    const document = workspace.documents?.find((doc: { id: string }) => doc.id === workspace.activeId)
    return document?.root.children[0].children.map((node: { data: { icon?: string[] } }) => node.data.icon ?? [])
  })
  await expect.poll(childIcons).toEqual([['priority_1'], ['priority_1'], []])
  await page.keyboard.press('Escape')
  // Clicking an already-selected node preserves upstream's multi-selection.
  await canvas.locator('text').filter({ hasText: /^产品设计$/ }).click()
  await canvas.locator('text').filter({ hasText: /^用户访谈$/ }).click()
  await page.getByRole('button', { name: '快捷设置图标', exact: true }).click()
  await page.getByRole('button', { name: '清空图标', exact: true }).click()
  await expect.poll(childIcons).toEqual([[], ['priority_1'], []])
  await page.keyboard.press('Escape')
  await canvas.locator('text').filter({ hasText: /^场景与痛点$/ }).click({ modifiers: ['Control'] })
  await page.getByRole('button', { name: '快捷设置图标', exact: true }).click()
  await expect(choice).toHaveAttribute('aria-pressed', 'false')
  await choice.click()
  await expect.poll(childIcons).toEqual([['priority_1'], ['priority_1'], []])
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(childIcons).toEqual([[], ['priority_1'], []])
})
