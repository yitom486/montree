import { resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

/**
 * 折叠锚定回归（真实 Electron + mock 回放，无真实模型）：
 * 折叠块在消息末尾，贴底点开展示长内容——summary 不得被跟滚顶走（“向上展开”），
 * 底部“收起”按钮可直接关闭，无需挪回顶部。
 */
async function openPanel(page: Page) {
  const panel = page.locator('aside[aria-label="Agent 聊天"]:visible')
  if ((await panel.count()) === 0) {
    await page.getByRole('button', { name: 'AI 伴读', exact: true }).click()
  }
  await expect(panel.first()).toBeVisible({ timeout: 10_000 })
  return panel.first()
}

test.describe('折叠锚定回归', () => {
  test('贴底展开 summary 不位移且底部可收起', async ({}, info) => {
    const app = await launchBuiltApp({
      E2E_ACP_WINDOW_TEST: '1',
      E2E_ACP_COMMAND: process.execPath,
      E2E_ACP_FIXTURE: resolve('apps/desktop/e2e/fixtures/mock-window-agent.cjs'),
    })
    try {
      const window = await app.firstWindow()
      await window.setViewportSize({ width: 1280, height: 900 })
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      await window.evaluate(() => {
        const now = Date.now()
        localStorage.setItem('montree-acp-ui', JSON.stringify({ version: 0, state: {
          panelOpen: true, hudDisplayMode: 'docked', selectedRuntimeId: 'mock-window', activeThreadId: 'details-anchor',
          threads: [{ id: 'details-anchor', runtimeId: 'mock-window', title: '锚定', createdAt: now, updatedAt: now, messages: [] }],
        } }))
      })
      await window.reload()
      const panel = await openPanel(window)
      await panel.locator('textarea').fill('details-anchor')
      await panel.getByRole('button', { name: '发送', exact: true }).click()

      const details = panel.locator('details').first()
      await expect(details.locator('summary')).toContainText('点击展开查看详细分析过程', { timeout: 15_000 })
      await expect(panel.getByText('尾段收束')).toBeVisible()
      // 等流式揭示落定，避免逐字高度干扰位移测量
      await window.waitForTimeout(1500)

      // 贴底：summary 在视口内可见才点（已可见时 click 不触发 scrollIntoView）
      const viewport = panel.locator('[data-testid="chat-viewport"]')
      await viewport.evaluate((el) => { el.scrollTop = el.scrollHeight })
      await expect(details.locator('summary')).toBeVisible()
      const y0 = await details.locator('summary').evaluate((el) => el.getBoundingClientRect().top)

      await details.locator('summary').click()
      await expect(details).toHaveAttribute('open', '')
      await expect(panel.getByText('展开后的第12段详细内容')).toBeVisible()
      await window.waitForTimeout(1000)
      const y1 = await details.locator('summary').evaluate((el) => el.getBoundingClientRect().top)
      console.log(`ANCHOR_DRIFT=${JSON.stringify({ y0, y1, drift: y1 - y0 })}`)
      expect(Math.abs(y1 - y0)).toBeLessThanOrEqual(6)

      // 底部收起：不断言滚动，直关
      const collapse = details.getByRole('button', { name: '收起折叠内容' })
      await expect(collapse).toBeVisible()
      await collapse.click()
      await expect(details).not.toHaveAttribute('open', '')
      await panel.screenshot({ path: info.outputPath('details-anchor.png') })
    } finally { await app.close() }
  })
})
