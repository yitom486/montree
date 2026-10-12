import { resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

/**
 * 富文本核验单（真实 Electron + mock 回放，无真实模型）：
 * 高亮/上标/脚注/公式/折叠/任务列表/kbd 一次成形，折叠真实点开展示。
 */
async function openPanel(page: Page) {
  const activityBar = page.getByRole('complementary', { name: '活动栏' })
  const panel = page.locator('aside[aria-label="Agent 聊天"]:visible')
  if ((await panel.count()) === 0) {
    await activityBar.getByRole('button', { name: '打开 Agent 面板' }).click()
  }
  await expect(panel.first()).toBeVisible({ timeout: 10_000 })
  return panel.first()
}

test.describe('富文本核验单', () => {
  test('mark/sup/脚注/公式/折叠/任务列表/kbd', async ({}, info) => {
    const app = await launchBuiltApp({
      E2E_ACP_WINDOW_TEST: '1',
      E2E_ACP_COMMAND: process.execPath,
      E2E_ACP_FIXTURE: resolve('apps/desktop/e2e/fixtures/mock-window-agent.cjs'),
    })
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      await window.evaluate(() => {
        const now = Date.now()
        localStorage.setItem('montree-acp-ui', JSON.stringify({ version: 0, state: {
          panelOpen: true, hudDisplayMode: 'docked', selectedRuntimeId: 'mock-window', activeThreadId: 'rich-check',
          threads: [{ id: 'rich-check', runtimeId: 'mock-window', title: '核验单', createdAt: now, updatedAt: now, messages: [] }],
        } }))
      })
      await window.reload()
      const panel = await openPanel(window)
      await panel.locator('textarea').fill('rich-check')
      await panel.getByRole('button', { name: '发送', exact: true }).click()

      // 高亮与上标为真元素（非纯文本）
      await expect(panel.locator('mark', { hasText: '标记' })).toBeVisible({ timeout: 15_000 })
      await expect(panel.locator('sup', { hasText: '上标' })).toBeVisible()
      // 脚注引用与定义成对
      await expect(panel.locator('sup a[href^="#"]').first()).toBeVisible()
      await expect(panel.locator('section.footnotes')).toContainText('注脚正文')
      // 公式渲染
      await expect(panel.locator('.katex').first()).toBeVisible()
      // 折叠：原生 details，点开展示内容
      const details = panel.locator('details').first()
      await expect(details.locator('summary')).toContainText('点我展开')
      await details.locator('summary').click()
      await expect(details).toHaveAttribute('open', '')
      await expect(details).toContainText('里面是细节')
      // 任务列表：记录语义，只读复选框（已做勾选、待做未选）
      const boxes = panel.locator('input[type="checkbox"][disabled]')
      await expect(boxes).toHaveCount(2)
      await expect(boxes.nth(0)).toBeChecked()
      await expect(boxes.nth(1)).not.toBeChecked()
      // 按键帽
      await expect(panel.locator('kbd', { hasText: 'Ctrl' })).toBeVisible()
      await panel.locator('details').first().scrollIntoViewIfNeeded()
      await panel.screenshot({ path: info.outputPath('rich-check.png') })
      await info.attach('rich-check', { path: info.outputPath('rich-check.png'), contentType: 'image/png' })
    } finally {
      await app.close()
    }
  })
})
