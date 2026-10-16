import { resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

/**
 * 展开宽度与胎内解析回归（真实 Electron + mock 回放，无真实模型）：
 * 种子长历史 + 原生 details 块，展开前后消息列宽极差 ≤3px（滚动条不出没吃宽），
 * 胎内 markdown 二次解析成段落（非源码裸奔）。
 */
async function openPanel(page: Page) {
  const panel = page.locator('aside[aria-label="Agent 聊天"]:visible')
  if ((await panel.count()) === 0) {
    await page.getByRole('button', { name: 'AI 伴读', exact: true }).click()
  }
  await expect(panel.first()).toBeVisible({ timeout: 10_000 })
  return panel.first()
}

test.describe('details 展开宽度与胎内解析回归', () => {
  test('展开前后列宽不变且胎内 markdown 已解析', async ({}, info) => {
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
          panelOpen: true, hudDisplayMode: 'docked', selectedRuntimeId: 'mock-window', activeThreadId: 'details-expand',
          threads: [{ id: 'details-expand', runtimeId: 'mock-window', title: '展开', createdAt: now, updatedAt: now, messages: [] }],
        } }))
      })
      await window.reload()
      const panel = await openPanel(window)
      await panel.locator('textarea').fill('details-expand')
      await panel.getByRole('button', { name: '发送', exact: true }).click()

      await expect(panel.getByText('点击展开查看详细分析过程')).toBeVisible({ timeout: 15_000 })
      await expect(panel.getByText('尾部第10段收束正文')).toBeVisible({ timeout: 15_000 })
      // 等流式揭示落定
      await window.waitForTimeout(1500)

      const col = panel.locator('[data-acp-probe="message-list"]')
      const w0 = await col.evaluate((el) => el.getBoundingClientRect().width)
      await panel.locator('details > summary').first().click()
      const samples: number[] = [w0]
      for (let i = 0; i < 8; i += 1) {
        await window.waitForTimeout(150)
        samples.push(await col.evaluate((el) => el.getBoundingClientRect().width))
      }
      const range = Math.max(...samples) - Math.min(...samples)
      console.log(`EXPAND_WIDTH=${JSON.stringify({ w0, range })}`)
      expect(range).toBeLessThanOrEqual(3)

      // 胎内 markdown 已解析（非源码裸奔）
      await expect(panel.getByText('展开后的第12段详细内容')).toBeVisible()
      const parsed = await panel.evaluate((root) => {
        const d = root.querySelector('details')
        if (!d) return { found: false }
        const html = d.innerHTML ?? ''
        return {
          found: true,
          paragraphs: d.querySelectorAll('p').length,
          hasEscapedTags: html.includes('&lt;details') || html.includes('&lt;summary'),
        }
      })
      console.log(`DETAILS_PARSED=${JSON.stringify(parsed)}`)
      expect(parsed.found).toBe(true)
      expect(parsed.hasEscapedTags).toBe(false)
      expect(parsed.paragraphs).toBeGreaterThan(5)
      await panel.screenshot({ path: info.outputPath('details-expand.png') })
    } finally { await app.close() }
  })
})
