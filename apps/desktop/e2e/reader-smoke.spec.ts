import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test, expect, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'
import { writeReaderSmokeWorkspace } from './helpers/ebook-fixture'

/** 经 Ctrl+P 打开工作区文件 */
async function openViaQuickOpen(window: Page, fileName: string, query: string): Promise<void> {
  await window.keyboard.press('Control+p')
  const dialog = window.getByRole('dialog', { name: '快速打开文件' })
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill(query)
  await expect(dialog.getByText(fileName).first()).toBeVisible({ timeout: 10_000 })
  await window.keyboard.press('Enter')
  await expect(dialog).toBeHidden({ timeout: 10_000 })
}

test.describe('阅读器冒烟（自研最小 fixture）', () => {
  test('Markdown 预览渲染 Mermaid / 公式 / 代码高亮', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'montree-e2e-reader-'))
    const { mdName } = await writeReaderSmokeWorkspace(workspace)
    const app = await launchBuiltApp({ E2E_AUTO_OPEN_PATH: workspace })

    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button',   { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      await window.getByRole('button',   { name: '更多操作', exact: true }).click()
      await window.getByRole('menuitem', { name: /打开文件夹/ }).click()
      await expect(window.getByText(mdName).first()).toBeVisible({ timeout: 15_000 })

      await openViaQuickOpen(window, mdName, 'smoke-demo')
      await window.getByRole('button', { name: '预览', exact: true }).click()

      const panel = window.locator('#main')
      await expect(panel.locator('svg').first()).toBeVisible({ timeout: 20_000 })
      await expect(panel.locator('.katex').first()).toBeVisible({ timeout: 10_000 })
      await expect(panel.getByText('const answer').first()).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('PDF 单页渲染出画布与文字层', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'montree-e2e-reader-'))
    const { pdfName } = await writeReaderSmokeWorkspace(workspace)
    const app = await launchBuiltApp({ E2E_AUTO_OPEN_PATH: workspace })

    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button',   { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      await window.getByRole('button',   { name: '更多操作', exact: true }).click()
      await window.getByRole('menuitem', { name: /打开文件夹/ }).click()
      await expect(window.getByText(pdfName).first()).toBeVisible({ timeout: 15_000 })

      await openViaQuickOpen(window, pdfName, 'smoke-sample.pdf')

      const panel = window.locator('#main')
      await expect(panel.getByText('1 / 1').first()).toBeVisible({ timeout: 20_000 })
      await expect(panel.locator('canvas').first()).toBeVisible({ timeout: 10_000 })
      await expect(panel.getByText('Montree E2E minimal PDF paragraph.').first()).toBeVisible({
        timeout: 10_000,
      })
    } finally {
      await app.close()
    }
  })

  // 注：EPUB/MOBI 改走 foliate 统一链路（closed shadow DOM），正文断言见
  // reader-foliate.spec.ts；此处保留 Markdown 与 PDF 覆盖。
})
