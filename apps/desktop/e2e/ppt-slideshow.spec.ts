import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import PptxGenJS from 'pptxgenjs'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

async function fixture() {
  const workspace = await mkdtemp(join(tmpdir(), 'montree-slideshow-'))
  const documentPath = join(workspace, 'show.pptx')
  const ppt = new PptxGenJS(); ppt.layout = 'LAYOUT_WIDE'
  for (let i = 1; i <= 3; i++) {
    const slide = ppt.addSlide(); slide.background = { color: 'F8FAFC' }
    slide.addText(`Montree · 第 ${i} 张`, { x: 1, y: 2, w: 11, h: 1, fontSize: 40, bold: true, color: '1E293B' })
    slide.addText('单页演示 · 保留原稿样式', { x: 1, y: 3.4, w: 10, h: 0.7, fontSize: 22, color: '64748B' })
  }
  const original = Buffer.from(await ppt.write({ outputType: 'arraybuffer' }) as ArrayBuffer)
  await writeFile(documentPath, original)
  const app = await launchBuiltApp({ E2E_AUTO_OPEN_PATH: workspace, E2E_DOCUMENT_TOOLS: '1' })
  const page = await app.firstWindow()
  await page.getByRole('button', { name: '更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: /打开文件夹/ }).click()
  await page.keyboard.press('Control+p')
  const dialog = page.getByRole('dialog', { name: '快速打开文件' })
  await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill('show.pptx')
  await dialog.getByRole('button', { name: 'show.pptx', exact: true }).click()
  await expect(page.locator('[data-slide="1"] [data-slide-canvas]')).toBeVisible()
  return { app, page, documentPath, original }
}
async function state(app: ElectronApplication, documentPath: string) {
  return app.evaluate(async (_, path) => {
    const invoke = (globalThis as unknown as { __montreeE2eDocumentTools: (name: string, args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }> }).__montreeE2eDocumentTools
    const result = await invoke('montree_ppt_read', { documentPath: path })
    return JSON.parse(result.content[0].text) as { revision: number; dirty: boolean; context: { visibleSlide: number; navigationSlide: number; selectionSlide: number | null } }
  }, documentPath)
}
async function expectFit(page: Page) {
  const read = () => page.locator('[data-ppt-presentation-stage]').evaluate((node) => {
    const stage = node.getBoundingClientRect(); const canvas = node.querySelector('[data-slide-canvas]')!.getBoundingClientRect()
    return { stage: { left: stage.left, right: stage.right, top: stage.top, bottom: stage.bottom }, canvas: { left: canvas.left, right: canvas.right, top: canvas.top, bottom: canvas.bottom, width: canvas.width, height: canvas.height } }
  })
  // 舞台宽度由 ResizeObserver 回填；窗口/全屏拒绝后的首帧可能仍是方形，等比例稳定后再量边界。
  await expect.poll(async () => {
    const { canvas } = await read()
    return canvas.width > 0 && canvas.height > 0 && Math.abs(canvas.width / canvas.height - 16 / 9) < 0.005
  }, { timeout: 15_000 }).toBe(true)
  const dimensions = await read()
  expect(dimensions.canvas.width).toBeGreaterThan(0)
  expect(dimensions.canvas.width / dimensions.canvas.height).toBeCloseTo(16 / 9, 2)
  expect(dimensions.canvas.left).toBeGreaterThanOrEqual(dimensions.stage.left - 1)
  expect(dimensions.canvas.right).toBeLessThanOrEqual(dimensions.stage.right + 1)
  expect(dimensions.canvas.top).toBeGreaterThanOrEqual(dimensions.stage.top - 1)
  expect(dimensions.canvas.bottom).toBeLessThanOrEqual(dimensions.stage.bottom + 1)
}

test('真实全屏单页放映：退出入口、键盘/点击翻页、AI当前页与阅读模式恢复', async ({}, info) => {
  const { app, page, documentPath, original } = await fixture()
  try {
    await page.getByRole('button', { name: '缩小', exact: true }).click()
    await page.getByRole('button', { name: '第 2 页', exact: true }).click()
    await expect.poll(async () => (await state(app, documentPath)).context.visibleSlide).toBe(2)
    await page.locator('[data-slide="2"] [data-element-id]').first().click()
    await page.getByRole('button', { name: '元素详情', exact: true }).click()
    await page.getByRole('button', { name: '全屏放映', exact: true }).click()
    await expect(page.getByRole('button', { name: '退出全屏' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true)
    await expect(page.locator('[data-slide-canvas]')).toHaveCount(1)
    await expect(page.locator('[data-ppt-presentation-slide]')).toHaveAttribute('data-slide', '2')
    await expect(page.locator('[data-ppt-viewport]')).toHaveCount(0)
    await expect(page.getByLabel('元素检查器')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '保存', exact: true })).toHaveCount(0)
    await expectFit(page)
    await page.screenshot({ path: info.outputPath('slideshow.png') })
    expect((await state(app, documentPath)).context).toEqual({ visibleSlide: 2, visibleSlides: [2], navigationSlide: 2, selectionSlide: null })
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('[data-ppt-presentation-slide]')).toHaveAttribute('data-slide', '1')
    await page.locator('[data-ppt-presentation-stage]').focus()
    await page.keyboard.press('Space')
    await expect(page.locator('[data-ppt-presentation-slide]')).toHaveAttribute('data-slide', '2')
    await page.keyboard.press('PageDown')
    await expect(page.getByRole('button', { name: '下一张幻灯片' })).toBeDisabled()
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('[data-ppt-presentation-slide]')).toHaveAttribute('data-slide', '3')
    await page.keyboard.press('Home')
    await expect(page.getByRole('button', { name: '上一张幻灯片' })).toBeDisabled()
    await page.locator('[data-ppt-presentation-slide] [data-element-id]').first().click()
    await expect(page.locator('[data-ppt-presentation-slide]')).toHaveAttribute('data-slide', '2')
    expect((await state(app, documentPath)).context.selectionSlide).toBeNull()
    await page.locator('[data-ppt-presentation-stage]').click({ button: 'right' })
    await expect(page.locator('[data-ppt-presentation-slide]')).toHaveAttribute('data-slide', '1')
    await page.keyboard.press('End')
    await page.getByRole('button', { name: '上一张幻灯片' }).click()
    await expect(page.locator('[data-ppt-presentation-slide]')).toHaveAttribute('data-slide', '2')
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-ppt-slideshow]')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false)
    await expect(page.locator('[data-slide-canvas]')).toHaveCount(3)
    await expect(page.getByRole('button', { name: '单页阅读', exact: true })).toBeVisible()
    expect(await page.locator('[data-slide="2"] [data-slide-canvas]').evaluate((node) => (node as HTMLElement).style.width)).toBe('90%')
    await expect.poll(async () => (await state(app, documentPath)).context.visibleSlide).toBe(2)
    expect(await readFile(documentPath)).toEqual(original)
  } finally { await app.close() }
})

test('全屏按钮和系统退出恢复单页阅读；拒绝全屏时可窗口放映并按宽高适配', async () => {
  const { app, page, documentPath, original } = await fixture()
  try {
    await page.getByRole('button', { name: '单页阅读', exact: true }).click()
    await page.getByRole('button', { name: '第 3 页', exact: true }).click()
    await page.getByRole('button', { name: '全屏放映', exact: true }).click()
    await page.getByRole('button', { name: '退出全屏' }).click()
    await expect(page.locator('[data-ppt-slideshow]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '连续浏览', exact: true })).toBeVisible()
    await expect(page.locator('[data-slide-canvas]')).toHaveCount(1)
    await expect(page.locator('[data-slide="3"] [data-slide-canvas]')).toBeVisible()
    await page.getByRole('button', { name: '全屏放映', exact: true }).click()
    await expect(page.getByRole('button', { name: '退出全屏' })).toBeVisible()
    await page.evaluate(() => document.exitFullscreen())
    await expect(page.locator('[data-ppt-slideshow]')).toHaveCount(0)
    // Simulate a denied browser fullscreen request; the deck must remain usable.
    await page.locator('div[data-reader-viewport]').evaluate((node) => {
      node.requestFullscreen = () => Promise.reject(new Error('fullscreen denied'))
    })
    await page.getByRole('button', { name: '全屏放映', exact: true }).click()
    await expect(page.getByRole('button', { name: '结束放映' })).toBeVisible()
    expect(await page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false)
    await expectFit(page)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 720, height: 900 }))
    await expect.poll(() => page.evaluate(() => window.innerHeight)).toBeGreaterThan(750)
    await expectFit(page)
    await page.getByRole('button', { name: '结束放映' }).click()
    await expect(page.locator('[data-ppt-slideshow]')).toHaveCount(0)
    await expect(page.locator('[data-slide-canvas]')).toHaveCount(1)
    expect(await readFile(documentPath)).toEqual(original)
  } finally { await app.close() }
})
