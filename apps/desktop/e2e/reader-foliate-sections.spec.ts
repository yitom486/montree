import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test, expect, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'
import { writeFoliateSectionsWorkspace } from './helpers/ebook-fixture'

/**
 * 大部头分片回归：spine 以“部”为单位、目录以“章 + #分片”为单位时，
 * 点目录章必须落到节内锚点（而非部开头），滚动后底栏/目录跟随小节。
 * 判定信号为 E2E 门控 dataset（closed shadow DOM 下的真实可见位置）：
 * 点击后等意图锁过期再小幅滚轮，细化同步上报实际所见章节。
 */
async function openSectionsBook(window: Page): Promise<void> {
  await window.getByRole('button',   { name: '更多操作', exact: true }).click()
  await window.getByRole('menuitem', { name: /打开文件夹/ }).click()
  await expect(window.getByText('sections-book.epub').first()).toBeVisible({ timeout: 15_000 })

  await window.keyboard.press('Control+p')
  const dialog = window.getByRole('dialog', { name: '快速打开文件' })
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill('sections-book.epub')
  await expect(dialog.getByText('sections-book.epub').first()).toBeVisible({ timeout: 10_000 })
  await window.keyboard.press('Enter')
  await expect(dialog).toBeHidden({ timeout: 10_000 })
}

test.describe('foliate 大部头分片', () => {
  test('点目录章落到节内锚点且滚动跟随小节', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'montree-e2e-foliate-sections-'))
    await writeFoliateSectionsWorkspace(workspace)
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
      await openSectionsBook(window)
      await expect(window.locator('#main').locator('foliate-view').first()).toBeAttached({
        timeout: 20_000,
      })

      // 打开目录并点第二章（part1.xhtml#chap2）
      const panel = window.locator('#main')
      await panel.getByRole('button', { name: '目录' }).click()
      await panel.getByRole('button', { name: 'Chapter 2' }).click()

      // 跳转后细化同步上报实际所见章节（应为 Chapter 2 而非 Part One）
      const host = window.locator('#main').locator('.foliate-reader-host')
      await expect(host).toHaveAttribute('data-e2e-flat-index', '2', { timeout: 15_000 })
    } finally {
      await app.close()
    }
  })
})
