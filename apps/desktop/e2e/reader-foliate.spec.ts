import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test, expect, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'
import { writeMinimalMobi, writeReaderSmokeWorkspace } from './helpers/ebook-fixture'

/**
 * foliate 统一阅读器 parity（E2E_FOLIATE_READER 门控，仅分支验证）：
 * 同一套断言跑新 viewer，旧 viewer 由 reader-smoke 覆盖。
 * `foliate-view` 标签存在即证明新链路挂载（而非旧 Epub/MobiViewer）。
 */
async function openWorkspaceFile(window: Page, fileName: string, query: string): Promise<void> {
  await window.getByRole('button',   { name: '更多操作', exact: true }).click()
  await window.getByRole('menuitem', { name: /打开文件夹/ }).click()
  await expect(window.getByText(fileName).first()).toBeVisible({ timeout: 15_000 })

  await window.keyboard.press('Control+p')
  const dialog = window.getByRole('dialog', { name: '快速打开文件' })
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill(query)
  await expect(dialog.getByText(fileName).first()).toBeVisible({ timeout: 10_000 })
  await window.keyboard.press('Enter')
  await expect(dialog).toBeHidden({ timeout: 10_000 })
}

test.describe('foliate 统一阅读器', () => {
  test('EPUB 章节正文可读（新链路）', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'montree-e2e-foliate-'))
    const { epubName } = await writeReaderSmokeWorkspace(workspace)
    const app = await launchBuiltApp({
      E2E_AUTO_OPEN_PATH: workspace,
      E2E_FOLIATE_READER: '1',
    })

    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button',   { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      await openWorkspaceFile(window, epubName, 'smoke-sample.epub')

      const panel = window.locator('#main')
      await expect(panel.locator('foliate-view').first()).toBeAttached({ timeout: 20_000 })
      // 内容在 closed shadow DOM 内：经 E2E 门控 dataset 断言（截图已人工确认渲染正常）
      const host = panel.locator('.foliate-reader-host')
      await expect(host).toHaveAttribute('data-e2e-section-text', /Smoke Chapter/, {
        timeout: 20_000,
      })
      await expect(host).toHaveAttribute(
        'data-e2e-section-text',
        /Montree E2E minimal EPUB paragraph\./,
      )
    } finally {
      await app.close()
    }
  })

  test('MOBI 章节正文可读（新链路，与 EPUB 同一后端）', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'montree-e2e-foliate-'))
    await writeMinimalMobi(join(workspace, 'smoke-sample.mobi'))
    const app = await launchBuiltApp({
      E2E_AUTO_OPEN_PATH: workspace,
      E2E_FOLIATE_READER: '1',
    })

    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button',   { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      await openWorkspaceFile(window, 'smoke-sample.mobi', 'smoke-sample.mobi')

      const panel = window.locator('#main')
      await expect(panel.locator('foliate-view').first()).toBeAttached({ timeout: 20_000 })
      const host = panel.locator('.foliate-reader-host')
      await expect(host).toHaveAttribute('data-e2e-section-text', /Smoke Mobi Chapter/, {
        timeout: 20_000,
      })
      await expect(host).toHaveAttribute(
        'data-e2e-section-text',
        /Montree E2E minimal MOBI paragraph\./,
      )
    } finally {
      await app.close()
    }
  })
})
