import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test, expect, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'
import { writeFoliateSectionsWorkspace } from './helpers/ebook-fixture'

/**
 * 底栏翻页回归（真实多章节 EPUB：Part One / Chapter 1 / Chapter 2 / Part Two / Chapter 3）：
 * 1. 布局：底栏收进正文列——与正文同左同宽，位于正文下方，不横跨右侧卡片轨。
 * 2. 绑定：点下一单元/上一单元，正文 data-e2e-flat-index 与底栏当前单元同步变化。
 *    注意底栏按渲染单元粒度翻页（见 reader-navigation 规则：禁止小节当翻页单元），
 *    故 Part One 的下一单元是 Part Two（flat-index 3），而非 Chapter 1。
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

test.describe('底栏翻页（正文列内聚）', () => {
  test('底栏位于正文列下方且与正文同宽，不横跨卡片轨', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'montree-e2e-footer-'))
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
      const panel = window.locator('#main')
      await expect(panel.locator('foliate-view').first()).toBeAttached({ timeout: 20_000 })

      const footer = panel.locator('footer', { hasText: '当前单元' })
      await expect(footer).toBeVisible({ timeout: 15_000 })
      const host = panel.locator('.foliate-reader-host')
      const footerBox = await footer.boundingBox()
      const hostBox = await host.boundingBox()
      expect(footerBox).not.toBeNull()
      expect(hostBox).not.toBeNull()
      // 与正文同列：左右对齐（2px 容差），位于正文下方
      expect(Math.abs(footerBox!.x - hostBox!.x)).toBeLessThanOrEqual(2)
      expect(Math.abs(footerBox!.width - hostBox!.width)).toBeLessThanOrEqual(2)
      expect(footerBox!.y).toBeGreaterThan(hostBox!.y)
      // 不横跨右侧卡片轨
      const rail = panel.locator('#marginalia-notes-stream')
      if ((await rail.count()) > 0 && (await rail.isVisible())) {
        const railBox = await rail.boundingBox()
        expect(railBox).not.toBeNull()
        expect(footerBox!.x + footerBox!.width).toBeLessThanOrEqual(railBox!.x + 1)
      }
    } finally {
      await app.close()
    }
  })

  test('点下一单元/上一单元，正文与底栏同步翻章', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'montree-e2e-footer-'))
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
      const panel = window.locator('#main')
      await expect(panel.locator('foliate-view').first()).toBeAttached({ timeout: 20_000 })

      const footer = panel.locator('footer', { hasText: '当前单元' })
      await expect(footer).toBeVisible({ timeout: 15_000 })
      const host = panel.locator('.foliate-reader-host')
      await expect(host).toHaveAttribute('data-e2e-flat-index', '0', { timeout: 15_000 })
      await expect(footer.getByText('Part One').first()).toBeVisible()

      await footer.getByRole('button', { name: /下一单元/ }).click()
      await expect(host).toHaveAttribute('data-e2e-flat-index', '3', { timeout: 15_000 })
      await expect(footer.getByText('Part Two').first()).toBeVisible()

      await footer.getByRole('button', { name: /上一单元/ }).click()
      await expect(host).toHaveAttribute('data-e2e-flat-index', '0', { timeout: 15_000 })
      await expect(footer.getByText('Part One').first()).toBeVisible()
    } finally {
      await app.close()
    }
  })
})
